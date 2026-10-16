import {
  AlertCircleIcon,
  BookmarkPlusIcon,
  BrainIcon,
  GlobeIcon,
  Loader2Icon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  Volume2Icon,
} from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { editAndResend, regenerate } from '@/lib/chat'
import type { Message } from '@/lib/db'
import { usePriceLookup } from '@/hooks/use-usage'
import { formatCost } from '@/lib/format'
import { costOf } from '@/lib/pricing'
import { parseModelRef, PROVIDERS, type Source } from '@/lib/providers'
import { readAloud, stopReading, useCanReadAloud, useReadAloud } from '@/lib/read-aloud'
import { deriveTitle } from '@/lib/repo'
import { useModelName } from '@/stores/models'
import { useStreams } from '@/stores/streams'
import { useUI } from '@/stores/ui'
import { MessageAttachments } from './attachments'

// The markdown + syntax highlighting stack is most of the bundle; load it on demand.
const Markdown = lazy(() => import('@/components/markdown').then((m) => ({ default: m.Markdown })))

const actionRow =
  'flex items-center gap-0.5 text-xs text-muted-foreground transition-opacity print:hidden [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100'

export function MessageItem({
  message,
  isLast,
  conversationBusy,
}: {
  message: Message
  isLast: boolean
  conversationBusy: boolean
}) {
  return message.role === 'user' ? (
    <UserMessage message={message} busy={conversationBusy} />
  ) : (
    <AssistantMessage message={message} isLast={isLast} busy={conversationBusy} />
  )
}

function UserMessage({ message, busy }: { message: Message; busy: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const openPromptLibrary = useUI((s) => s.openPromptLibrary)

  if (editing) {
    return (
      <div className="ml-auto w-full max-w-[85%] space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-24 rounded-2xl bg-secondary"
          autoFocus
          aria-label="Edit message"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!draft.trim()}
            onClick={() => {
              setEditing(false)
              void editAndResend(message.conversationId, message.id, draft.trim())
            }}
          >
            Send
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex flex-col items-end gap-1">
      <MessageAttachments attachments={message.attachments ?? []} align="end" />
      {message.content && (
        <div className="max-w-[85%] rounded-3xl bg-secondary px-4 py-2.5 text-[15px] leading-7 break-words whitespace-pre-wrap">
          {message.content}
        </div>
      )}
      <div className={actionRow}>
        <CopyButton getText={() => message.content} />
        {message.content && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            onClick={() => openPromptLibrary({ id: null, title: deriveTitle(message.content), content: message.content })}
            aria-label="Save as prompt"
            title="Save as prompt"
          >
            <BookmarkPlusIcon />
          </Button>
        )}
        {!busy && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            onClick={() => {
              setDraft(message.content)
              setEditing(true)
            }}
            aria-label="Edit message"
            title="Edit"
          >
            <PencilIcon />
          </Button>
        )}
      </div>
    </div>
  )
}

function AssistantMessage({ message, isLast, busy }: { message: Message; isLast: boolean; busy: boolean }) {
  const streaming = message.status === 'streaming'
  const draft = useStreams((s) => (streaming ? s.drafts[message.id] : undefined))
  const content = draft?.content ?? message.content
  const reasoning = draft?.reasoning ?? message.reasoning
  const canRegenerate = isLast && !busy

  return (
    <div className="group flex flex-col gap-1">
      {reasoning && (
        <details className="rounded-lg border px-3 py-2 text-sm text-muted-foreground" open={streaming && !content}>
          <summary className="flex cursor-pointer list-none items-center gap-2 select-none">
            <BrainIcon className="size-4" />
            {streaming && !content ? 'Thinking…' : 'Thought process'}
          </summary>
          <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap">{reasoning}</div>
        </details>
      )}

      <MessageAttachments attachments={message.attachments ?? []} />

      {content ? (
        <Suspense fallback={<div className="markdown whitespace-pre-wrap">{content}</div>}>
          <Markdown content={content} />
        </Suspense>
      ) : streaming && message.webSearch && !reasoning ? (
        <div className="flex h-7 items-center gap-2 text-sm text-muted-foreground" role="status">
          <GlobeIcon className="size-4 animate-pulse" />
          {message.sources?.length ? `Reading ${message.sources.length} sources…` : 'Searching the web…'}
        </div>
      ) : streaming && !reasoning && !message.attachments?.length ? (
        <TypingIndicator />
      ) : null}

      {!streaming && !!message.sources?.length && <Sources sources={message.sources} />}

      {message.status === 'error' && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <p className="flex-1">{message.error}</p>
          {canRegenerate && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-foreground"
              onClick={() => void regenerate(message.conversationId)}
            >
              Retry
            </Button>
          )}
        </div>
      )}

      {!streaming && (
        <div className={actionRow}>
          {content && <CopyButton getText={() => content} />}
          {content && <ReadAloudButton messageId={message.id} content={content} />}
          {canRegenerate && message.status === 'done' && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7"
              onClick={() => void regenerate(message.conversationId)}
              aria-label="Regenerate response"
              title="Regenerate"
            >
              <RefreshCwIcon />
            </Button>
          )}
          <MessageMeta message={message} />
        </div>
      )}
    </div>
  )
}

const SHOWN_SOURCES = 4

/** The web pages a reply drew on, as links. */
function Sources({ sources }: { sources: Source[] }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? sources : sources.slice(0, SHOWN_SOURCES)
  return (
    <ol className="mt-1 flex flex-wrap gap-1.5 text-xs" aria-label="Sources">
      {shown.map((s, i) => {
        const host = new URL(s.url).hostname.replace(/^www\./, '')
        return (
          <li key={s.url} className="min-w-0">
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={s.url}
              className="flex max-w-64 items-center gap-1.5 rounded-full border px-2.5 py-1 hover:bg-accent"
            >
              <span className="text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="truncate">{s.title}</span>
              {!s.title.includes(host) && !host.endsWith('vertexaisearch.cloud.google.com') && (
                <span className="shrink-0 text-muted-foreground">{host}</span>
              )}
            </a>
          </li>
        )
      })}
      {sources.length > SHOWN_SOURCES && !expanded && (
        <li>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded-full border px-2.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            +{sources.length - SHOWN_SOURCES} more
          </button>
        </li>
      )}
    </ol>
  )
}

function ReadAloudButton({ messageId, content }: { messageId: string; content: string }) {
  const available = useCanReadAloud()
  const reading = useReadAloud((s) => s.messageId === messageId)
  const loading = useReadAloud((s) => s.messageId === messageId && s.loading)
  if (!available) return null
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="size-7"
      onClick={() => (reading ? stopReading() : readAloud(messageId, content))}
      aria-label={reading ? 'Stop reading' : 'Read aloud'}
      title={reading ? 'Stop reading' : 'Read aloud'}
    >
      {loading ? (
        <Loader2Icon className="animate-spin" />
      ) : reading ? (
        <SquareIcon className="size-3 fill-current" />
      ) : (
        <Volume2Icon />
      )}
    </Button>
  )
}

function MessageMeta({ message }: { message: Message }) {
  const price = usePriceLookup()
  const ref = message.model ? parseModelRef(message.model) : null
  const name = useModelName(message.model ?? '')
  const parts = [ref && `${name} · ${PROVIDERS[ref.provider].name}`]
  if (message.usage) {
    parts.push(`${(message.usage.promptTokens + message.usage.completionTokens).toLocaleString()} tokens`)
    const cost = ref ? costOf(message.usage, price(ref.provider, ref.model)) : null
    if (cost) parts.push(`${cost.estimated ? '~' : ''}${formatCost(cost.cost)}`)
  }
  const text = parts.filter(Boolean).join(' · ')
  return text ? <span className="ml-1 truncate">{text}</span> : null
}

function TypingIndicator() {
  return (
    <div className="flex h-7 items-center gap-1" aria-label="Generating response" role="status">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-2 animate-bounce rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  )
}
