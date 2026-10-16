import { ArrowDownIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Message } from '@/lib/db'
import { MessageItem } from './message-item'

const STICK_THRESHOLD_PX = 80

export function MessageList({ messages, busy }: { messages: Message[]; busy: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
  }

  // Follow the reply as it grows, unless the user scrolled up to read.
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) scrollToBottom()
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  // Sending a message always jumps to the bottom.
  const last = messages.at(-1)
  useLayoutEffect(() => {
    if (last?.role === 'user') {
      stickToBottom.current = true
      scrollToBottom()
    }
  }, [last?.id, last?.role])

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto overscroll-contain"
        onScroll={(e) => {
          const el = e.currentTarget
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight
          stickToBottom.current = distance < STICK_THRESHOLD_PX
          setShowJump(distance > 240)
        }}
      >
        <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-4 pb-8">
          {messages.map((m, i) => (
            <MessageItem key={m.id} message={m} isLast={i === messages.length - 1} conversationBusy={busy} />
          ))}
        </div>
      </div>
      {showJump && (
        <Button
          variant="outline"
          size="icon"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
          onClick={() => {
            stickToBottom.current = true
            scrollToBottom('smooth')
          }}
          aria-label="Scroll to bottom"
        >
          <ArrowDownIcon />
        </Button>
      )}
    </div>
  )
}
