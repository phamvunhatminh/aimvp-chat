import { ImageIcon } from 'lucide-react'
import { isValidElement, memo, useRef, type ComponentProps, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { CopyButton } from './copy-button'

function languageOf(children: ReactNode): string | null {
  if (!isValidElement<{ className?: string }>(children)) return null
  return /language-([\w+-]+)/.exec(children.props.className ?? '')?.[1] ?? null
}

function CodeBlock({ children, ...props }: ComponentProps<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  return (
    <div className="code-block overflow-hidden rounded-lg border bg-code">
      <div className="flex items-center justify-between border-b py-0.5 pr-1 pl-3 text-xs text-muted-foreground">
        <span>{languageOf(children) ?? 'text'}</span>
        <CopyButton label="Copy code" getText={() => ref.current?.textContent ?? ''} />
      </div>
      <pre ref={ref} className="overflow-x-auto p-3" {...props}>
        {children}
      </pre>
    </div>
  )
}

const components: Components = {
  pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
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
