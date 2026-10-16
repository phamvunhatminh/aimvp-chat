import {
  CodeIcon,
  GlobeIcon,
  GraduationCapIcon,
  LanguagesIcon,
  LightbulbIcon,
  PaperclipIcon,
  PenLineIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { ChatHeader } from '@/components/chat/chat-header'
import { Composer, type Suggestion } from '@/components/chat/composer'
import { MessageList } from '@/components/chat/message-list'
import { ConnectCard } from '@/components/connect-card'
import { ProjectOverview } from '@/components/project-overview'
import { Button } from '@/components/ui/button'
import { useConversation, useMessages, useProject } from '@/hooks/use-data'
import { sendMessage, stopStreaming } from '@/lib/chat'
import { downloadFile } from '@/lib/download'
import { conversationToMarkdown, slugify } from '@/lib/export-chat'
import type { PreparedFile } from '@/lib/files'
import { parseModelRef, PROVIDERS } from '@/lib/providers'
import { stopReading } from '@/lib/read-aloud'
import { createConversation, updateConversation } from '@/lib/repo'
import { cn } from '@/lib/utils'
import { usePriceLookup } from '@/hooks/use-usage'
import { formatCost, formatTokens } from '@/lib/format'
import { chatTotals } from '@/lib/usage'
import { useModelInfo, useModelName } from '@/stores/models'
import { addFiles } from '@/stores/composer'
import { connectedProviders, useSettings } from '@/stores/settings'
import { useIsStreaming } from '@/stores/streams'
import { useUI } from '@/stores/ui'

/**
 * `/` and `/p/:projectId` start a new chat (in that project); `/c/:id` opens one.
 * Remount per route so per-chat state (composer text, scroll) starts fresh.
 */
export function ChatRoute() {
  const { id, projectId } = useParams()
  return <ChatPage key={id ?? `new:${projectId ?? ''}`} id={id} newChatProjectId={projectId} />
}

function ChatPage({ id, newChatProjectId }: { id: string | undefined; newChatProjectId: string | undefined }) {
  const conversation = useConversation(id)
  const messages = useMessages(id)
  const project = useProject(conversation?.projectId ?? newChatProjectId)
  const apiKeys = useSettings((s) => s.apiKeys)
  const defaultModel = useSettings((s) => s.defaultModel)
  const defaultSystemPrompt = useSettings((s) => s.defaultSystemPrompt)
  const draft = useUI((s) => s.draft)
  const setDraft = useUI((s) => s.setDraft)
  const resetDraft = useUI((s) => s.resetDraft)
  const streaming = useIsStreaming(id)
  const modelInfo = useModelInfo(conversation?.model ?? draft.model ?? defaultModel)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const price = usePriceLookup()

  useEffect(() => {
    const name = conversation?.title ?? (newChatProjectId ? project?.name : undefined)
    document.title = name ?? 'New chat'
  }, [conversation, project, newChatProjectId])

  // Stop reading a reply aloud when leaving its chat.
  useEffect(() => stopReading, [])

  if (id && conversation === null) return <NotFound what="Chat" />
  if (newChatProjectId && project === null) return <NotFound what="Project" />
  // Avoid flashing the empty state while an existing chat or project loads.
  if (id && (conversation === undefined || messages === undefined)) return null
  if (newChatProjectId && project === undefined) return null

  const model = conversation?.model ?? draft.model ?? defaultModel
  const systemPrompt = conversation?.systemPrompt ?? draft.systemPrompt ?? defaultSystemPrompt
  const webSearch = conversation ? !!conversation.webSearch : draft.webSearch
  const canSearch = !modelInfo?.outputs?.image && modelInfo?.webSearch !== false
  const hasMessages = !!messages && messages.length > 0
  const hasAnyKey = connectedProviders(apiKeys).length > 0
  const totals = messages ? chatTotals(messages, price) : null
  const needsKey = hasAnyKey && !apiKeys[parseModelRef(model).provider]

  async function handleSend(text: string, files: PreparedFile[]) {
    if (conversation) {
      void sendMessage(conversation.id, text, files)
      return
    }
    const created = await createConversation({ model, systemPrompt, webSearch, projectId: newChatProjectId ?? null })
    resetDraft()
    navigate(`/c/${created.id}`)
    void sendMessage(created.id, text, files)
  }

  const changeModel = (next: string) =>
    conversation ? void updateConversation(conversation.id, { model: next }) : setDraft({ model: next })
  // A new chat (outside a project page) puts the message box in the middle, ChatGPT-style.
  const isNewChat = !hasMessages && !(project && newChatProjectId)

  const composer = (variant: 'docked' | 'hero') => (
    <Composer
      variant={variant}
      suggestions={variant === 'hero' && !modelInfo?.outputs?.image ? SUGGESTIONS : undefined}
      onSend={(text, files) => void handleSend(text, files)}
      onStop={() => id && stopStreaming(id)}
      streaming={streaming}
      modelRef={model}
      onModelChange={changeModel}
      tools={
        canSearch && (
          <WebSearchToggle
            on={webSearch}
            onChange={(next) =>
              conversation ? void updateConversation(conversation.id, { webSearch: next }) : setDraft({ webSearch: next })
            }
          />
        )
      }
      placeholder={
        modelInfo?.outputs?.image
          ? 'Describe the image you want…'
          : project && newChatProjectId
            ? `New chat in ${project.name}…`
            : undefined
      }
    />
  )

  return (
    <FileDropZone enabled={hasAnyKey}>
      <ChatHeader
        title={hasMessages ? conversation?.title : undefined}
        systemPrompt={systemPrompt}
        onSystemPromptChange={(next) =>
          conversation
            ? void updateConversation(conversation.id, { systemPrompt: next })
            : setDraft({ systemPrompt: next })
        }
        // The project page already shows its name, so the header link is for chats in it.
        project={newChatProjectId ? null : project}
        usageNote={totals ? usageNote(totals) : undefined}
        onDownloadMarkdown={
          conversation && hasMessages
            ? () =>
                downloadFile(
                  conversationToMarkdown(conversation, messages),
                  `${slugify(conversation.title)}.md`,
                  'text/markdown',
                )
            : undefined
        }
      />
      {conversation && (
        <h1 className="mx-auto hidden w-full max-w-3xl px-4 pb-4 text-2xl font-semibold print:block">
          {conversation.title}
        </h1>
      )}

      {hasMessages ? (
        <MessageList messages={messages} busy={streaming} focusMessageId={searchParams.get('m')} />
      ) : project && newChatProjectId ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ProjectOverview project={project} />
        </div>
      ) : hasAnyKey ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto pt-4 pb-[12dvh]">
          <h1 className="mb-7 px-6 text-center text-[1.75rem] font-semibold tracking-tight sm:text-[2rem]">
            What can I help with?
          </h1>
          {needsKey && <MissingKeyNotice modelRef={model} />}
          {composer('hero')}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto py-8">
          <ConnectCard />
        </div>
      )}

      {!isNewChat && needsKey && <MissingKeyNotice modelRef={model} />}
      {!isNewChat && (hasAnyKey ? composer('docked') : (hasMessages || newChatProjectId) && <ReconnectBar />)}
    </FileDropZone>
  )
}

/** Starting points under the message box of a new chat. */
const SUGGESTIONS: Suggestion[] = [
  { icon: PenLineIcon, label: 'Write', text: 'Help me write ' },
  { icon: LightbulbIcon, label: 'Brainstorm', text: 'Brainstorm ideas for ' },
  { icon: GraduationCapIcon, label: 'Explain', text: 'Explain in simple terms: ' },
  { icon: CodeIcon, label: 'Code', text: 'Write code that ' },
  { icon: LanguagesIcon, label: 'Translate', text: 'Translate into English: ' },
]

/** "~$0.02 · 12k tokens", or nothing before the chat has used any. */
function usageNote({ tokens, cost, estimated }: ReturnType<typeof chatTotals>): string | undefined {
  if (tokens === 0) return undefined
  const spend = cost > 0 ? `${estimated ? '~' : ''}${formatCost(cost)} · ` : ''
  return `${spend}${formatTokens(tokens)} tokens`
}

/** Lets the model search the web for this chat's replies. */
function WebSearchToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={on ? 'sm' : 'icon'}
      aria-pressed={on}
      aria-label="Search the web"
      onClick={() => onChange(!on)}
      title={on ? 'Web search is on' : 'Search the web'}
      className={cn(
        'rounded-full',
        on
          ? 'h-9 bg-sky-500/10 px-3 text-sky-700 hover:bg-sky-500/15 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-400'
          : 'text-muted-foreground',
      )}
    >
      <GlobeIcon />
      {on && 'Search'}
    </Button>
  )
}

/** Lets files be dropped anywhere on the chat to attach them. */
function FileDropZone({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const hasFiles = (e: DragEvent) => enabled && e.dataTransfer.types.includes('Files')

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        depth.current++
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault()
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current = 0
        setDragging(false)
        void addFiles(e.dataTransfer.files)
      }}
    >
      {children}
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-ring bg-background/90 text-sm font-medium">
          <PaperclipIcon className="size-6" />
          Drop images or files to attach
        </div>
      )}
    </div>
  )
}

/** The chosen model belongs to a provider the user has no key for yet. */
function MissingKeyNotice({ modelRef }: { modelRef: string }) {
  const openSettings = useUI((s) => s.openSettings)
  const name = useModelName(modelRef)
  const provider = PROVIDERS[parseModelRef(modelRef).provider].name
  return (
    <div className="mx-auto mb-2 flex w-[calc(100%-1.5rem)] max-w-3xl flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/50 px-4 py-2 text-sm sm:w-[calc(100%-2rem)]">
      <span className="text-muted-foreground">
        {name} runs on {provider}. Add your {provider} key, or pick another model above.
      </span>
      <Button variant="outline" size="sm" onClick={() => openSettings('keys')}>
        Add key
      </Button>
    </div>
  )
}

function ReconnectBar() {
  const openSettings = useUI((s) => s.openSettings)
  return (
    <div className="shrink-0 border-t px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] text-center text-sm">
      <span className="text-muted-foreground">Add an API key to continue this chat.</span>{' '}
      <Button variant="link" className="h-auto p-0" onClick={() => openSettings('keys')}>
        Open Settings
      </Button>
    </div>
  )
}

function NotFound({ what }: { what: 'Chat' | 'Project' }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">{what} not found</h1>
      <p className="text-muted-foreground">It may have been deleted, or it lives in another browser.</p>
      <Button asChild>
        <Link to="/">Start a new chat</Link>
      </Button>
    </div>
  )
}
