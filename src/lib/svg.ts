/** A code block that holds an SVG image: tagged svg, or xml/html/untagged code starting with `<svg`. */
export function isSvgCode(language: string | null, code: string): boolean {
  if (language === 'svg') return true
  if (language && !['xml', 'html', 'text', 'plaintext'].includes(language)) return false
  return /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(code)
}

/** Size used for SVGs that state none. */
const DEFAULT_SIZE = 512

export interface PreparedSvg {
  /** The SVG with explicit pixel width and height, so an <img> shows it at its intended size. */
  svg: string
  width: number
  height: number
}

/** A pixel length from an attribute like "120" or "120px"; null for %, em and the like. */
function pixels(value: string | null): number | null {
  const match = value && /^\s*([\d.]+)\s*(px)?\s*$/.exec(value)
  const n = match ? Number(match[1]) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Parses SVG code for display as an image. Null when it isn't a complete, well-formed SVG,
 * e.g. while a reply is still streaming it. Parsing builds an inert document: nothing runs.
 */
export function prepareSvg(code: string): PreparedSvg | null {
  const doc = new DOMParser().parseFromString(code.trim(), 'image/svg+xml')
  const root = doc.documentElement
  if (doc.getElementsByTagName('parsererror').length > 0 || root.localName !== 'svg') return null
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  const viewBox = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  const [vbWidth, vbHeight] = viewBox.length === 4 && viewBox.every(Number.isFinite) ? viewBox.slice(2) : [0, 0]
  let width = pixels(root.getAttribute('width'))
  let height = pixels(root.getAttribute('height'))
  if (!width && !height && vbWidth > 0 && vbHeight > 0) [width, height] = [vbWidth, vbHeight]
  else if (width && !height) height = vbWidth > 0 ? (width * vbHeight) / vbWidth : width
  else if (height && !width) width = vbHeight > 0 ? (height * vbWidth) / vbHeight : height
  width ||= DEFAULT_SIZE
  height ||= DEFAULT_SIZE
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  return { svg: new XMLSerializer().serializeToString(root), width, height }
}

/** A data URL for an <img>. Images never run scripts or fetch what an SVG links to. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** PNG export size: at least 2048 px on the long edge for small drawings, at most 8192. */
export function pngScale(width: number, height: number): number {
  const long = Math.max(width, height)
  return Math.min(Math.max(2048 / long, 1), 8192 / long)
}

/** Draws the SVG onto a canvas at high resolution and encodes it as PNG, keeping transparency. */
export async function svgToPng({ svg, width, height }: PreparedSvg): Promise<Blob> {
  const image = new Image()
  image.src = svgDataUrl(svg)
  await image.decode()
  const scale = pngScale(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The PNG could not be made.'))), 'image/png'),
  )
}
