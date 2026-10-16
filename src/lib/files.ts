import type { Attachment } from './db'
import { newId } from './utils'

export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_TEXT_CHARS = 200_000
/** Longest image edge sent to models; larger images cost more tokens without helping. */
export const IMAGE_MAX_EDGE = 1600

const TEXT_EXTENSIONS = new Set(
  (
    'txt md markdown csv tsv json jsonl xml yaml yml toml ini cfg conf log html htm css scss sass less ' +
    'js mjs cjs jsx ts tsx vue svelte py rb php java kt kts swift go rs c h cc cpp hpp cs m mm dart scala ' +
    'sh bash zsh ps1 bat sql graphql gql proto r lua pl ex exs erl hs clj tex rst srt vtt env gitignore dockerfile'
  ).split(' '),
)

/** Everything the attach button accepts. */
export const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', '.pdf', '.docx', '.xlsx']
  .concat([...TEXT_EXTENSIONS].map((ext) => `.${ext}`))
  .join(',')

export type FileKind = 'image' | 'pdf' | 'docx' | 'xlsx' | 'text'

export class FileError extends Error {}

function extensionOf(name: string): string {
  const base = name.toLowerCase().split('/').pop() ?? ''
  if (base === 'dockerfile' || base === '.gitignore' || base === '.env') return base.replace(/^\./, '')
  return base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : ''
}

export function fileKind(file: { name: string; type: string }): FileKind | null {
  const ext = extensionOf(file.name)
  if (/^image\/(png|jpeg|webp|gif)$/.test(file.type) || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
    return 'image'
  }
  if (file.type === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'xlsx') return 'xlsx'
  if (file.type.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) return 'text'
  return null
}

/** Scales `width`×`height` down (never up) so the longest edge is at most `maxEdge`. */
export function fitWithin(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function truncateText(text: string, max = MAX_TEXT_CHARS): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n[Truncated: the file is longer than ${max.toLocaleString('en-US')} characters.]`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A file ready to attach: its metadata, plus the bytes to store for images and PDFs. */
export interface PreparedFile {
  attachment: Omit<Attachment, 'blobId'>
  data: ArrayBuffer | null
}

export async function prepareFile(file: File): Promise<PreparedFile> {
  const kind = fileKind(file)
  if (!kind) throw new FileError(`${file.name}: this file type isn't supported yet.`)
  if (file.size > MAX_FILE_BYTES) {
    throw new FileError(`${file.name} is larger than ${formatBytes(MAX_FILE_BYTES)}.`)
  }
  const base = { id: newId(), name: file.name, text: '' }

  if (kind === 'image') {
    const image = await prepareImage(file)
    // Re-encoded images get a matching extension, so downloads open correctly.
    const name = image.mimeType === 'image/jpeg' ? file.name.replace(/\.(png|webp|gif|jpe?g)$/i, '') + '.jpg' : file.name
    return {
      attachment: { ...base, name, kind: 'image', mimeType: image.mimeType, size: image.data.byteLength, ...image.size },
      data: image.data,
    }
  }

  const bytes = await file.arrayBuffer()
  const text =
    kind === 'pdf'
      ? await extractPdfText(bytes)
      : kind === 'docx'
        ? await extractDocxText(bytes)
        : kind === 'xlsx'
          ? await extractXlsxText(file)
          : new TextDecoder().decode(bytes)
  const mimeType =
    kind === 'pdf'
      ? 'application/pdf'
      : kind === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : kind === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : file.type || 'text/plain'
  return {
    attachment: { ...base, kind: 'file', mimeType, size: file.size, text: truncateText(text) },
    // Keep the PDF itself: Claude and Gemini read it directly, including scans and layout.
    data: kind === 'pdf' ? bytes : null,
  }
}

async function prepareImage(file: File) {
  // GIFs may be animated; send them as they are when they're a reasonable size.
  if (file.type === 'image/gif' && file.size <= 5 * 1024 * 1024) {
    const bitmap = await createImageBitmap(file).catch(() => null)
    return {
      mimeType: 'image/gif',
      data: await file.arrayBuffer(),
      size: bitmap ? { width: bitmap.width, height: bitmap.height } : {},
    }
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new FileError(`${file.name}: this browser can't read the image. Try a PNG or JPEG.`)
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, IMAGE_MAX_EDGE)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new FileError(`${file.name}: could not process the image.`)
  // JPEG has no transparency; paint transparent areas white rather than black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new FileError(`${file.name}: could not process the image.`)
  return { mimeType: 'image/jpeg', data: await blob.arrayBuffer(), size: { width, height } }
}

async function extractPdfText(bytes: ArrayBuffer): Promise<string> {
  // pdf.js is large; load it (and its worker) only when a PDF is attached.
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  try {
    // pdf.js takes ownership of the buffer it's given, so hand it a copy.
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) })
    const doc = await task.promise
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages && pages.join('').length < MAX_TEXT_CHARS; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''))
    }
    await task.destroy()
    return pages.join('\n\n').trim()
  } catch {
    throw new FileError("This PDF couldn't be read. It may be damaged or password-protected.")
  }
}

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

/** Plain text of a .docx: one line per paragraph, tabs and line breaks kept. */
export async function extractDocxText(bytes: ArrayBuffer): Promise<string> {
  const { strFromU8, unzipSync } = await import('fflate')
  let xml: Uint8Array | undefined
  try {
    xml = unzipSync(new Uint8Array(bytes), {
      // Only inflate the main document, and refuse absurd sizes (zip bombs).
      filter: (f) => f.name === 'word/document.xml' && f.originalSize < 50 * 1024 * 1024,
    })['word/document.xml']
  } catch {
    xml = undefined
  }
  if (!xml) throw new FileError("This .docx file couldn't be read.")
  const doc = new DOMParser().parseFromString(strFromU8(xml), 'application/xml')
  const lines: string[] = []
  for (const paragraph of Array.from(doc.getElementsByTagNameNS(WORD_NS, 'p'))) {
    let line = ''
    const walk = (node: Element) => {
      for (const child of Array.from(node.children)) {
        if (child.namespaceURI !== WORD_NS) continue
        if (child.localName === 't') line += child.textContent ?? ''
        else if (child.localName === 'tab') line += '\t'
        else if (child.localName === 'br' || child.localName === 'cr') line += '\n'
        else if (child.localName !== 'p') walk(child)
      }
    }
    walk(paragraph)
    lines.push(line)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function csvCell(value: unknown): string {
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : value == null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Every sheet of a .xlsx as CSV, under a heading with the sheet name. */
async function extractXlsxText(file: File): Promise<string> {
  try {
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    const sheets = await readXlsxFile(file)
    return sheets
      .map(({ sheet, data }) => `## Sheet: ${sheet}\n${data.map((row) => row.map(csvCell).join(',')).join('\n')}`)
      .join('\n\n')
  } catch {
    throw new FileError("This .xlsx file couldn't be read.")
  }
}
