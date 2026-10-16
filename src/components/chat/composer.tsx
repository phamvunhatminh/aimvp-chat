import { ArrowUpIcon, SquareIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { isTouchDevice } from '@/lib/utils'

export function Composer({
  onSend,
  onStop,
  streaming,
}: {
  onSend: (text: string) => void
  onStop: () => void
  streaming: boolean
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 208)}px`
  }, [text])

  function submit() {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    onSend(trimmed)
    setText('')
  }

  return (
    <div className="shrink-0 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="mx-auto flex max-w-3xl items-end gap-2 rounded-3xl border bg-background p-2 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-ring/30"
      >
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
          autoFocus={!isTouchDevice()}
          placeholder="Message aimvp…"
          aria-label="Message"
          className="max-h-52 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground"
        />
        {streaming ? (
          <Button type="button" size="icon" className="rounded-full" onClick={onStop} aria-label="Stop generating">
            <SquareIcon className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button type="submit" size="icon" className="rounded-full" disabled={!text.trim()} aria-label="Send message">
            <ArrowUpIcon />
          </Button>
        )}
      </form>
      <p className="mt-2 text-center text-xs text-muted-foreground">AI can make mistakes. Check important info.</p>
    </div>
  )
}
