import { toast } from 'sonner'
import { useSettings } from '@/stores/settings'
import { useStreams } from '@/stores/streams'
import { useUI } from '@/stores/ui'
import type { Message } from './db'
import { OpenRouterError, streamChat, type ChatMessage, type Usage } from './openrouter'
import {
  addMessage,
  deleteMessages,
  deriveTitle,
  getConversation,
  getMessages,
  NEW_CHAT_TITLE,
  updateConversation,
  updateMessage,
} from './repo'

const UI_FLUSH_MS = 50
const PERSIST_MS = 1000

export function buildPrompt(systemPrompt: string, history: Message[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  if (systemPrompt.trim()) messages.push({ role: 'system', content: systemPrompt })
  for (const m of history) {
    // Failed or empty replies are shown to the user but never sent back to the model.
    if (m.role === 'assistant' && (m.status !== 'done' || !m.content)) continue
    messages.push({ role: m.role, content: m.content })
  }
  return messages
}

export function isStreaming(conversationId: string): boolean {
  return conversationId in useStreams.getState().controllers
}

export function stopStreaming(conversationId: string): void {
  useStreams.getState().controllers[conversationId]?.abort()
}

let storagePersistRequested = false
/** Asks the browser not to evict chat history under storage pressure (notably Safari). */
function requestPersistentStorage() {
  if (storagePersistRequested) return
  storagePersistRequested = true
  navigator.storage?.persist?.().catch(() => {})
}

export async function sendMessage(conversationId: string, text: string): Promise<void> {
  const conversation = await getConversation(conversationId)
  if (!conversation || isStreaming(conversationId)) return
  // A new message supersedes any failed reply above it.
  await deleteMessages(conversationId, (m) => m.status === 'error')
  await addMessage({ conversationId, role: 'user', content: text })
  if (conversation.title === NEW_CHAT_TITLE) {
    await updateConversation(conversationId, { title: deriveTitle(text) })
  }
  requestPersistentStorage()
  await runCompletion(conversationId)
}

/** Replaces a user message and discards everything after it, then asks again. */
export async function editAndResend(conversationId: string, messageId: string, text: string): Promise<void> {
  if (isStreaming(conversationId)) return
  const history = await getMessages(conversationId)
  const target = history.find((m) => m.id === messageId)
  if (!target || target.role !== 'user') return
  await deleteMessages(conversationId, (m) => m.createdAt > target.createdAt)
  await updateMessage(messageId, { content: text })
  await runCompletion(conversationId)
}

/** Discards the replies after the last user message and asks again. */
export async function regenerate(conversationId: string): Promise<void> {
  if (isStreaming(conversationId)) return
  const history = await getMessages(conversationId)
  const lastUser = history.findLast((m) => m.role === 'user')
  if (!lastUser) return
  await deleteMessages(conversationId, (m) => m.createdAt > lastUser.createdAt)
  await runCompletion(conversationId)
}

function errorMessage(err: unknown): string {
  if (err instanceof OpenRouterError) return err.message
  return 'Could not reach OpenRouter. Check your connection and try again.'
}

async function runCompletion(conversationId: string): Promise<void> {
  const conversation = await getConversation(conversationId)
  if (!conversation || isStreaming(conversationId)) return
  const history = await getMessages(conversationId)
  const apiKey = useSettings.getState().apiKey

  const controller = new AbortController()
  useStreams.setState((s) => ({ controllers: { ...s.controllers, [conversationId]: controller } }))

  const reply = await addMessage({
    conversationId,
    role: 'assistant',
    content: '',
    model: conversation.model,
    status: 'streaming',
  })

  let content = ''
  let reasoning = ''
  let usage: Usage | null = null
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let lastPersist = Date.now()

  const flushDraft = () => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    useStreams.setState((s) => ({ drafts: { ...s.drafts, [reply.id]: { content, reasoning } } }))
  }

  try {
    if (!apiKey) throw new OpenRouterError('Connect your OpenRouter account to start chatting.', 401)
    const stream = streamChat({
      apiKey,
      model: conversation.model,
      messages: buildPrompt(conversation.systemPrompt, history),
      signal: controller.signal,
    })
    for await (const event of stream) {
      if (event.type === 'content') content += event.text
      else if (event.type === 'reasoning') reasoning += event.text
      else usage = event.usage
      flushTimer ??= setTimeout(flushDraft, UI_FLUSH_MS)
      // Save progress now and then so a closed tab keeps most of the reply.
      if (Date.now() - lastPersist > PERSIST_MS) {
        lastPersist = Date.now()
        void updateMessage(reply.id, { content, reasoning })
      }
    }
    flushDraft()
    await updateMessage(reply.id, { content, reasoning, usage, status: 'done' })
  } catch (err) {
    flushDraft()
    if (controller.signal.aborted) {
      // Stopped by the user: keep whatever arrived, drop the reply if nothing did.
      if (content || reasoning) await updateMessage(reply.id, { content, reasoning, usage, status: 'done' })
      else await deleteMessages(conversationId, (m) => m.id === reply.id)
    } else {
      await updateMessage(reply.id, { content, reasoning, status: 'error', error: errorMessage(err) })
      if (err instanceof OpenRouterError && err.isAuthError) {
        toast.error('OpenRouter key needed', {
          description: err.message,
          action: { label: 'Settings', onClick: () => useUI.getState().setSettingsOpen(true) },
        })
      }
    }
  } finally {
    useStreams.setState((s) => {
      const { [conversationId]: _, ...controllers } = s.controllers
      return { controllers }
    })
    await updateConversation(conversationId, {})
  }
}
