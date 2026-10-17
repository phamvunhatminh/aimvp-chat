import { CodeIcon, DownloadIcon, ImageDownIcon, ImageIcon } from 'lucide-react'
import { isValidElement, memo, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { downloadFile } from '@/lib/download'
import { codeFilename } from '@/lib/export-chat'
import { isSvgCode, prepareSvg, svgDataUrl, svgToPng, type PreparedSvg } from '@/lib/svg'
import { cn } from '@/lib/utils'
import { CopyButton } from './copy-button'

function languageOf(children: ReactNode): string | null {
  if (!isValidElement<{ className?: string }>(children)) return null
  return /language-([\w+-]+)/.exec(children.props.className ?? '')?.[1] ?? null
}

/** The text of a syntax tree node: the code as the model wrote it, before highlighting. */
type HastNode = { type: string; value?: string; children?: HastNode[] }
function hastText(node: HastNode | undefined): string {
  if (!node) return ''
  return node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(hastText).join('')
}

const iconButton = 'size-7 text-muted-foreground'

function CodeBlock({ code, children, ...props }: ComponentProps<'pre'> & { code: string }) {
  const language = languageOf(children)
  // SVG code shows as the picture it draws, once it is complete (not while it streams in).
  const svg = useMemo(() => (isSvgCode(language, code) ? prepareSvg(code) : null), [language, code])
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const preview = svg !== null && view === 'preview'

  return (
    <div className="code-block overflow-hidden rounded-lg border bg-code">
      <div className="flex items-center justify-between gap-2 border-b py-0.5 pr-1 pl-3 text-xs text-muted-foreground">
        <span>{svg ? 'svg' : (language ?? 'text')}</span>
        <div className="flex items-center print:hidden">
          {svg && (
            <>
              <div role="radiogroup" aria-label="Show SVG as" className="mr-1 flex rounded-md bg-muted p-0.5">
                {(['preview', 'code'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={view === v}
                    onClick={() => setView(v)}
                    className={cn(
                      'flex items-center gap-1 rounded px-2 py-0.5 capitalize transition-colors hover:text-foreground',
                      view === v && 'bg-background text-foreground shadow-sm',
                    )}
                  >
                    {v === 'preview' ? <ImageIcon className="size-3" /> : <CodeIcon className="size-3" />}
                    {v}
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className={iconButton}
                onClick={() => void downloadPng(svg)}
                aria-label="Download PNG"
                title="Download PNG"
              >
                <ImageDownIcon />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className={iconButton}
            onClick={() =>
              svg
                ? downloadFile(code, 'image.svg', 'image/svg+xml')
                : downloadFile(code, codeFilename(language), 'text/plain')
            }
            aria-label={svg ? 'Download SVG' : 'Download code'}
            title={svg ? 'Download SVG' : 'Download code'}
          >
            <DownloadIcon />
          </Button>
          <CopyButton label="Copy code" getText={() => code} />
        </div>
      </div>
      {preview ? (
        <SvgPreview svg={svg} />
      ) : (
        <pre className="overflow-x-auto p-3" {...props}>
          {children}
        </pre>
      )}
    </div>
  )
}

async function downloadPng(svg: PreparedSvg) {
  try {
    downloadFile(await svgToPng(svg), 'image.png')
  } catch {
    // e.g. Safari refuses to export SVGs that embed HTML (foreignObject).
    toast.error("This SVG can't be turned into a PNG in this browser.", { description: 'Download it as SVG instead.' })
  }
}

/** Smallest preview, in CSS pixels, for tiny icons. */
const PREVIEW_MIN = 160

/** The SVG drawn as an image on a checkerboard, so transparent parts show as such. */
function SvgPreview({ svg }: { svg: PreparedSvg }) {
  return (
    <div className="flex justify-center bg-[conic-gradient(var(--muted)_25%,transparent_0_50%,var(--muted)_0_75%,transparent_0)] bg-[length:16px_16px] p-4">
      <img
        src={svgDataUrl(svg.svg)}
        alt="SVG preview"
        width={svg.width}
        height={svg.height}
        // Icons get enlarged to be seen; big drawings shrink to fit.
        style={{ width: svg.width * Math.max(1, PREVIEW_MIN / Math.max(svg.width, svg.height)) }}
        className="h-auto max-h-96 max-w-full object-contain"
      />
    </div>
  )
}

const components: Components = {
  pre: ({ node, ...props }) => <CodeBlock code={hastText(node as HastNode | undefined)} {...props} />,
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer nofollow" />,
  // Remote images are shown as links: loading them would leak the conversation
  // to whatever host a model (or a prompt injection) chose.
  img: ({ src, alt }) =>
    typeof src === 'string' && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1">
        <ImageIcon className="size-4" />
        {alt || 'Image'}
      </a>
    ) : null,
}

/** Renders model output. Raw HTML in the markdown is never rendered. */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
