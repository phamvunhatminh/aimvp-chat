import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ChatHeader } from '@/components/chat/chat-header'
import { Composer } from '@/components/chat/composer'
import { MessageList } from '@/components/chat/message-list'
import { ConnectCard } from '@/components/connect-card'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { useConversation, useMessages } from '@/hooks/use-data'
import { sendMessage, stopStreaming } from '@/lib/chat'
import { connectOpenRouter } from '@/lib/connect'
import { createConversation, updateConversation } from '@/lib/repo'
import { useSettings } from '@/stores/settings'
import { useIsStreaming } from '@/stores/streams'
import { useUI } from '@/stores/ui'

/** Remount per conversation so per-chat state (composer text, scroll) starts fresh. */
export function ChatRoute() {
  const { id } = useParams()
  return <ChatPage key={id ?? 'new'} id={id} />
}

function ChatPage({ id }: { id: string | undefined }) {
  const conversation = useConversation(id)
  const messages = useMessages(id)
  const apiKey = useSettings((s) => s.apiKey)
  const defaultModel = useSettings((s) => s.defaultModel)
  const defaultSystemPrompt = useSettings((s) => s.defaultSystemPrompt)
  const draft = useUI((s) => s.draft)
  const setDraft = useUI((s) => s.setDraft)
  const resetDraft = useUI((s) => s.resetDraft)
  const streaming = useIsStreaming(id)
  const navigate = useNavigate()

  useEffect(() => {
    document.title = conversation ? `${conversation.title} · aimvp` : 'aimvp'
  }, [conversation])

  if (id && conversation === null) return <NotFound />
  // Avoid flashing the empty state while an existing chat loads.
  if (id && (conversation === undefined || messages === undefined)) return null

  const model = conversation?.model ?? draft.model ?? defaultModel
  const systemPrompt = conversation?.systemPrompt ?? draft.systemPrompt ?? defaultSystemPrompt
  const hasMessages = !!messages && messages.length > 0

  async function handleSend(text: string) {
    if (conversation) {
      void sendMessage(conversation.id, text)
      return
    }
    const created = await createConversation({ model, systemPrompt })
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
      />

      {hasMessages ? (
        <MessageList messages={messages} busy={streaming} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto py-8">
          {apiKey ? <EmptyChat /> : <ConnectCard />}
        </div>
      )}

      {apiKey ? (
        <Composer onSend={(text) => void handleSend(text)} onStop={() => id && stopStreaming(id)} streaming={streaming} />
      ) : (
        hasMessages && <ReconnectBar />
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

function ReconnectBar() {
  return (
    <div className="shrink-0 border-t px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] text-center text-sm">
      <span className="text-muted-foreground">Connect OpenRouter to continue this chat.</span>{' '}
      <Button variant="link" className="h-auto p-0" onClick={() => void connectOpenRouter()}>
        Connect
      </Button>
    </div>
  )
}

function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">Chat not found</h1>
      <p className="text-muted-foreground">It may have been deleted, or it lives in another browser.</p>
      <Button asChild>
        <Link to="/">Start a new chat</Link>
      </Button>
    </div>
  )
}
