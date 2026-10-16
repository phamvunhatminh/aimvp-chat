import { ArrowDownIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Message } from '@/lib/db'
import { MessageItem } from './message-item'

const STICK_THRESHOLD_PX = 80

/** How long to keep a message from search in view while the replies around it render. */
const FOCUS_HOLD_MS = 1500

export function MessageList({
  messages,
  busy,
  focusMessageId,
}: {
  messages: Message[]
  busy: boolean
  /** A message to scroll to and highlight, e.g. a search result. */
  focusMessageId?: string | null
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(!focusMessageId)
  const focused = useRef({ id: focusMessageId, until: 0 })
  const [showJump, setShowJump] = useState(false)

  const scrollToFocused = () => {
    const el = focused.current.id ? document.getElementById(`m-${focused.current.id}`) : null
    el?.scrollIntoView({ block: 'center' })
    return el
  }

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
  }

  // Follow the reply as it grows, unless the user scrolled up to read.
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (Date.now() < focused.current.until) scrollToFocused()
      else if (stickToBottom.current) scrollToBottom()
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

  // Opening a search result shows that message, briefly highlighted, while the replies around it render.
  useLayoutEffect(() => {
    focused.current = { id: focusMessageId, until: 0 }
    const el = scrollToFocused()
    if (!el) return
    stickToBottom.current = false
    focused.current.until = Date.now() + FOCUS_HOLD_MS
    el.classList.remove('search-hit')
    void el.offsetWidth // restarts the animation
    el.classList.add('search-hit')
  }, [focusMessageId])

  return (
    <div className="relative min-h-0 flex-1 print:block">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto overscroll-contain print:h-auto print:overflow-visible"
        // Scrolling by hand ends the hold on a search result.
        onWheel={() => {
          focused.current.until = 0
        }}
        onTouchMove={() => {
          focused.current.until = 0
        }}
        onScroll={(e) => {
          const el = e.currentTarget
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight
          stickToBottom.current = distance < STICK_THRESHOLD_PX
          setShowJump(distance > 240)
        }}
      >
        <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-4 pb-8">
          {messages.map((m, i) => (
            <div key={m.id} id={`m-${m.id}`} className="scroll-mt-4 rounded-2xl">
              <MessageItem message={m} isLast={i === messages.length - 1} conversationBusy={busy} />
            </div>
          ))}
        </div>
      </div>
      {showJump && (
        <Button
          variant="outline"
          size="icon"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md print:hidden"
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
