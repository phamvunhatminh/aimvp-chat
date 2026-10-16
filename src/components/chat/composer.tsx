import { AlertTriangleIcon, ArrowUpIcon, PaperclipIcon, SquareIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ACCEPT, type PreparedFile } from '@/lib/files'
import { parseModelRef } from '@/lib/providers'
import { isTouchDevice } from '@/lib/utils'
import { addFiles, takeFiles, useComposer } from '@/stores/composer'
import { useModelCatalog } from '@/stores/models'
import { PendingAttachments } from './attachments'

export function Composer({
  onSend,
  onStop,
  streaming,
  modelRef,
  placeholder = 'Message aimvp…',
  tools,
}: {
  onSend: (text: string, files: PreparedFile[]) => void
  onStop: () => void
  streaming: boolean
  /** The chat's model, to warn about attachments it can't read. */
  modelRef: string
  placeholder?: string
  /** Extra buttons for the toolbar, left of send. */
  tools?: ReactNode
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const files = useComposer((s) => s.files)
  const processing = files.some((f) => f.status === 'processing')
  const hasImages = files.some((f) => f.prepared?.attachment.kind === 'image')
  const { provider, model } = parseModelRef(modelRef)
  const readsImages = useModelCatalog((s) => s.byProvider[provider]?.models.find((m) => m.id === model)?.inputs?.image)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 208)}px`
  }, [text])

  const canSend = (text.trim() !== '' || files.length > 0) && !processing && !streaming

  function submit() {
    if (!canSend) return
    onSend(text.trim(), takeFiles())
    setText('')
  }

  return (
    <div className="shrink-0 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-4 print:hidden">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="mx-auto max-w-3xl rounded-3xl border bg-background p-2 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-ring/30"
      >
        <PendingAttachments files={files} />
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends on desktop; on phones it inserts a newline. Never send mid-IME composition.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isTouchDevice()) {
              e.preventDefault()
              submit()
            }
          }}
          onPaste={(e) => {
            // Pasted screenshots and files become attachments; plain text pastes as usual.
            if (e.clipboardData.files.length > 0) {
              e.preventDefault()
              void addFiles(e.clipboardData.files)
            }
          }}
          autoFocus={!isTouchDevice()}
          placeholder={placeholder}
          aria-label="Message"
          className="block max-h-52 min-h-10 w-full resize-none bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-full text-muted-foreground"
            onClick={() => fileInput.current?.click()}
            aria-label="Attach files"
            title="Attach images or files"
          >
            <PaperclipIcon />
          </Button>
          {tools}
          {hasImages && readsImages === false && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
              <AlertTriangleIcon className="size-3.5 shrink-0" />
              <span className="truncate">This model can't read images</span>
            </span>
          )}
          <div className="ml-auto">
            {streaming ? (
              <Button type="button" size="icon" className="rounded-full" onClick={onStop} aria-label="Stop generating">
                <SquareIcon className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button type="submit" size="icon" className="rounded-full" disabled={!canSend} aria-label="Send message">
                <ArrowUpIcon />
              </Button>
            )}
          </div>
        </div>
      </form>
      <p className="mt-2 text-center text-xs text-muted-foreground">AI can make mistakes. Check important info.</p>
    </div>
  )
}
