import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ChatHeader } from '@/components/chat/chat-header'
import { Composer } from '@/components/chat/composer'
import { MessageList } from '@/components/chat/message-list'
import { ConnectCard } from '@/components/connect-card'
import { Logo } from '@/components/logo'
import { ProjectOverview } from '@/components/project-overview'
import { Button } from '@/components/ui/button'
import { useConversation, useMessages, useProject } from '@/hooks/use-data'
import { sendMessage, stopStreaming } from '@/lib/chat'
import { parseModelRef, PROVIDERS } from '@/lib/providers'
import { createConversation, updateConversation } from '@/lib/repo'
import { useModelName } from '@/stores/models'
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
  const navigate = useNavigate()

  useEffect(() => {
    const name = conversation?.title ?? (newChatProjectId ? project?.name : undefined)
    document.title = name ? `${name} · aimvp` : 'aimvp'
  }, [conversation, project, newChatProjectId])

  if (id && conversation === null) return <NotFound what="Chat" />
  if (newChatProjectId && project === null) return <NotFound what="Project" />
  // Avoid flashing the empty state while an existing chat or project loads.
  if (id && (conversation === undefined || messages === undefined)) return null
  if (newChatProjectId && project === undefined) return null

  const model = conversation?.model ?? draft.model ?? defaultModel
  const systemPrompt = conversation?.systemPrompt ?? draft.systemPrompt ?? defaultSystemPrompt
  const hasMessages = !!messages && messages.length > 0
  const hasAnyKey = connectedProviders(apiKeys).length > 0
  const needsKey = hasAnyKey && !apiKeys[parseModelRef(model).provider]

  async function handleSend(text: string) {
    if (conversation) {
      void sendMessage(conversation.id, text)
      return
    }
    const created = await createConversation({ model, systemPrompt, projectId: newChatProjectId ?? null })
    resetDraft()
    navigate(`/c/${created.id}`)
    void sendMessage(created.id, text)
  }

  return (
    <>
      <ChatHeader
        model={model}
        onModelChange={(next) =>
          conversation ? void updateConversation(conversation.id, { model: next }) : setDraft({ model: next })
        }
        systemPrompt={systemPrompt}
        onSystemPromptChange={(next) =>
          conversation
            ? void updateConversation(conversation.id, { systemPrompt: next })
            : setDraft({ systemPrompt: next })
        }
        // The project page already shows its name, so the header link is for chats in it.
        project={newChatProjectId ? null : project}
      />

      {hasMessages ? (
        <MessageList messages={messages} busy={streaming} />
      ) : project && newChatProjectId ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ProjectOverview project={project} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto py-8">
          {hasAnyKey ? <EmptyChat /> : <ConnectCard />}
        </div>
      )}

      {needsKey && <MissingKeyNotice modelRef={model} />}
      {hasAnyKey ? (
        <Composer
          onSend={(text) => void handleSend(text)}
          onStop={() => id && stopStreaming(id)}
          streaming={streaming}
          placeholder={project && newChatProjectId ? `New chat in ${project.name}…` : undefined}
        />
      ) : (
        (hasMessages || newChatProjectId) && <ReconnectBar />
      )}
    </>
  )
}

function EmptyChat() {
  return (
    <div className="flex flex-col items-center gap-4 px-6 text-center">
      <Logo className="size-10" />
      <h1 className="text-2xl font-semibold tracking-tight">What can I help with?</h1>
    </div>
  )
}

/** The chosen model belongs to a provider the user has no key for yet. */
function MissingKeyNotice({ modelRef }: { modelRef: string }) {
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const name = useModelName(modelRef)
  const provider = PROVIDERS[parseModelRef(modelRef).provider].name
  return (
    <div className="mx-auto mb-2 flex w-[calc(100%-1.5rem)] max-w-3xl flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/50 px-4 py-2 text-sm sm:w-[calc(100%-2rem)]">
      <span className="text-muted-foreground">
        {name} runs on {provider}. Add your {provider} key, or pick another model above.
      </span>
      <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
        Add key
      </Button>
    </div>
  )
}

function ReconnectBar() {
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  return (
    <div className="shrink-0 border-t px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] text-center text-sm">
      <span className="text-muted-foreground">Add an API key to continue this chat.</span>{' '}
      <Button variant="link" className="h-auto p-0" onClick={() => setSettingsOpen(true)}>
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
