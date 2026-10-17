import { toast } from 'sonner'
import { findModel } from '@/stores/models'
import { useSettings } from '@/stores/settings'
import { useStreams } from '@/stores/streams'
import { useUI } from '@/stores/ui'
import { base64ToBytes, bytesToBase64 } from './base64'
import type { Attachment, Message } from './db'
import type { PreparedFile } from './files'
import {
  documentAsText,
  loadProvider,
  makesImages,
  parseModelRef,
  ProviderError,
  PROVIDERS,
  type ChatMessage,
  type ContentPart,
  type Source,
  type Usage,
} from './providers'
import { newId } from './utils'
import {
  addMessage,
  deleteMessages,
  deriveTitle,
  getBlob,
  getConversation,
  getMessages,
  getProject,
  NEW_CHAT_TITLE,
  saveBlob,
  updateConversation,
  updateMessage,
} from './repo'

const UI_FLUSH_MS = 50
const PERSIST_MS = 1000

async function toContentPart(a: Attachment): Promise<ContentPart> {
  const blob = a.blobId ? await getBlob(a.blobId) : undefined
  if (a.kind === 'image') {
    return blob
      ? { type: 'image', mimeType: blob.mimeType, data: bytesToBase64(blob.data) }
      : { type: 'text', text: `[Image "${a.name}" is no longer available.]` }
  }
  // "Text only" sends the text read in the browser, far fewer tokens than the pages themselves.
  // Scans have no text, so they still go as the file.
  const textOnly = useSettings.getState().pdfMode === 'text' && a.text.trim() !== ''
  if (a.mimeType === 'application/pdf' && blob && !textOnly) {
    return { type: 'document', name: a.name, data: bytesToBase64(blob.data), text: a.text }
  }
  return { type: 'text', text: documentAsText(a.name, a.text) }
}

/** A project's files as one section of the system prompt. */
export function projectFilesPrompt(files: Attachment[]): string {
  if (files.length === 0) return ''
  const header = 'Project files, for reference in every chat of this project:'
  return [header, ...files.map((f) => documentAsText(f.name, f.text))].join('\n\n')
}

/**
 * The request messages: project instructions and files first, then the chat's own system
 * prompt (blank parts dropped), then the history with each user message's files.
 */
export async function buildPrompt(systemPrompts: string[], history: Message[]): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = []
  const system = systemPrompts.filter((p) => p.trim()).join('\n\n')
  if (system) messages.push({ role: 'system', content: system })
  for (const m of history) {
    // Failed or empty replies are shown to the user but never sent back to the model.
    if (m.role === 'assistant' && (m.status !== 'done' || !m.content)) continue
    if (m.role === 'assistant' || !m.attachments?.length) {
      messages.push({ role: m.role, content: m.content })
      continue
    }
    const parts = await Promise.all(m.attachments.map(toContentPart))
    if (m.content) parts.push({ type: 'text', text: m.content })
    messages.push({ role: 'user', content: parts })
  }
  return messages
}

/** Stores the files' bytes and returns their attachments. */
async function saveAttachments(files: PreparedFile[]): Promise<Attachment[]> {
  return Promise.all(
    files.map(async ({ attachment, data }) => ({
      ...attachment,
      blobId: data ? await saveBlob(data, attachment.mimeType) : null,
    })),
  )
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

export async function sendMessage(conversationId: string, text: string, files: PreparedFile[] = []): Promise<void> {
  const conversation = await getConversation(conversationId)
  if (!conversation || isStreaming(conversationId)) return
  // A new message supersedes any failed reply above it.
  await deleteMessages(conversationId, (m) => m.status === 'error')
  const attachments = await saveAttachments(files)
  await addMessage({ conversationId, role: 'user', content: text, attachments })
  if (conversation.title === NEW_CHAT_TITLE) {
    await updateConversation(conversationId, { title: deriveTitle(text || (files[0]?.attachment.name ?? '')) })
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

function errorMessage(err: unknown, providerName: string): string {
  if (err instanceof ProviderError) return err.message
  return `Could not reach ${providerName}. Check your connection and try again.`
}

async function runCompletion(conversationId: string): Promise<void> {
  const conversation = await getConversation(conversationId)
  if (!conversation || isStreaming(conversationId)) return
  const history = await getMessages(conversationId)
  const project = conversation.projectId ? await getProject(conversation.projectId) : undefined
  const { provider, model } = parseModelRef(conversation.model)
  const providerName = PROVIDERS[provider].name
  const apiKey = useSettings.getState().apiKeys[provider]

  const modelInfo = findModel(provider, model)
  // Image models don't search; neither do models their provider says can't.
  const webSearch = !!conversation.webSearch && !makesImages(modelInfo) && modelInfo?.webSearch !== false

  const controller = new AbortController()
  useStreams.setState((s) => ({ controllers: { ...s.controllers, [conversationId]: controller } }))

  const reply = await addMessage({
    conversationId,
    role: 'assistant',
    content: '',
    model: conversation.model,
    status: 'streaming',
    webSearch,
  })

  let content = ''
  let reasoning = ''
  let usage: Usage | null = null
  const images: Attachment[] = []
  const sources: Source[] = []
  const startedAt = performance.now()
  let firstTokenAt: number | null = null
  const timing = () => {
    const end = performance.now()
    return { firstTokenMs: Math.round((firstTokenAt ?? end) - startedAt), totalMs: Math.round(end - startedAt) }
  }
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let lastPersist = Date.now()

  const flushDraft = () => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = null
    useStreams.setState((s) => ({ drafts: { ...s.drafts, [reply.id]: { content, reasoning } } }))
  }

  try {
    if (!apiKey) {
      throw new ProviderError(`Add your ${providerName} API key in Settings to use this model.`, 401, provider)
    }
    const client = await loadProvider(provider)
    const stream = client.streamChat({
      apiKey,
      model,
      modelInfo,
      webSearch,
      messages: await buildPrompt(
        [project?.instructions ?? '', projectFilesPrompt(project?.files ?? []), conversation.systemPrompt],
        history,
      ),
      signal: controller.signal,
    })
    for await (const event of stream) {
      if (firstTokenAt === null && event.type !== 'usage' && event.type !== 'sources') firstTokenAt = performance.now()
      if (event.type === 'content') content += event.text
      else if (event.type === 'reasoning') reasoning += event.text
      else if (event.type === 'usage') usage = event.usage
      else if (event.type === 'sources') {
        const fresh = event.sources.filter((s, i, all) => all.findIndex((x) => x.url === s.url) === i)
        const added = fresh.filter((s) => !sources.some((x) => x.url === s.url))
        if (added.length) {
          sources.push(...added)
          await updateMessage(reply.id, { sources: [...sources] })
        }
      } else {
        // Generated images are saved right away and shown as soon as they arrive.
        const bytes = base64ToBytes(event.data)
        const ext = event.mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
        images.push({
          id: newId(),
          kind: 'image',
          name: `image-${images.length + 1}.${ext}`,
          mimeType: event.mimeType,
          size: bytes.byteLength,
          text: '',
          blobId: await saveBlob(bytes.buffer, event.mimeType),
        })
        await updateMessage(reply.id, { attachments: [...images] })
      }
      flushTimer ??= setTimeout(flushDraft, UI_FLUSH_MS)
      // Save progress now and then so a closed tab keeps most of the reply.
      if (Date.now() - lastPersist > PERSIST_MS) {
        lastPersist = Date.now()
        void updateMessage(reply.id, { content, reasoning })
      }
    }
    flushDraft()
    await updateMessage(reply.id, { content, reasoning, usage, timing: timing(), status: 'done' })
  } catch (err) {
    flushDraft()
    if (controller.signal.aborted) {
      // Stopped by the user: keep whatever arrived, drop the reply if nothing did.
      if (content || reasoning || images.length) {
        await updateMessage(reply.id, { content, reasoning, usage, timing: timing(), status: 'done' })
      }
      else await deleteMessages(conversationId, (m) => m.id === reply.id)
    } else {
      await updateMessage(reply.id, { content, reasoning, status: 'error', error: errorMessage(err, providerName) })
      if (err instanceof ProviderError && err.isAuthError) {
        toast.error(`${providerName} key needed`, {
          description: err.message,
          action: { label: 'Settings', onClick: () => useUI.getState().openSettings('keys') },
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
