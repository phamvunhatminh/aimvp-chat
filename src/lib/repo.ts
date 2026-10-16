import Dexie from 'dexie'
import { base64ToBytes, bytesToBase64 } from './base64'
import { db, type Attachment, type Conversation, type Message, type Project, type StoredBlob } from './db'
import { normalizeModelRef } from './providers'
import { newId } from './utils'

export const NEW_CHAT_TITLE = 'New chat'

let lastTimestamp = 0
/** Strictly increasing timestamps so messages created in the same millisecond keep their order. */
export function now(): number {
  const t = Date.now()
  lastTimestamp = t > lastTimestamp ? t : lastTimestamp + 1
  return lastTimestamp
}

export function deriveTitle(text: string): string {
  const firstLine = text.split('\n').find((line) => line.trim()) ?? ''
  const clean = firstLine
    .replace(/^[\s#>*\-`]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return NEW_CHAT_TITLE
  return clean.length > 60 ? `${clean.slice(0, 57).trimEnd()}…` : clean
}

// --- Projects --------------------------------------------------------------

export async function createProject(init: { name: string; instructions?: string }): Promise<Project> {
  const t = now()
  const project: Project = {
    id: newId(),
    name: init.name.trim(),
    instructions: init.instructions ?? '',
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  }
  await db.projects.add(project)
  return project
}

export async function getProject(id: string): Promise<Project | undefined> {
  const project = await db.projects.get(id)
  return project && !project.deletedAt ? project : undefined
}

/** Projects in name order, like folders. */
export async function listProjects(): Promise<Project[]> {
  const projects = await db.projects.filter((p) => !p.deletedAt).toArray()
  return projects.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export async function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'instructions'>>): Promise<void> {
  await db.projects
    .where('id')
    .equals(id)
    .filter((p) => !p.deletedAt)
    .modify({ ...patch, updatedAt: now() })
}

/** Tombstones the project; its chats are kept and move back to the main chat list. */
export async function deleteProject(id: string): Promise<void> {
  await db.transaction('rw', db.projects, db.conversations, async () => {
    const t = now()
    await db.projects.update(id, { name: '', instructions: '', updatedAt: t, deletedAt: t })
    await db.conversations.where('projectId').equals(id).modify({ projectId: null, updatedAt: t })
  })
}

// --- Conversations ---------------------------------------------------------

export async function createConversation(init: {
  model: string
  systemPrompt: string
  projectId?: string | null
  title?: string
}): Promise<Conversation> {
  const t = now()
  const conversation: Conversation = {
    id: newId(),
    projectId: init.projectId ?? null,
    title: init.title ?? NEW_CHAT_TITLE,
    model: init.model,
    systemPrompt: init.systemPrompt,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  }
  await db.conversations.add(conversation)
  return conversation
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  const conversation = await db.conversations.get(id)
  return conversation && !conversation.deletedAt ? conversation : undefined
}

export async function listConversations(): Promise<Conversation[]> {
  return db.conversations
    .orderBy('updatedAt')
    .reverse()
    .filter((c) => !c.deletedAt)
    .toArray()
}

// Updates skip tombstoned rows, so a reply still streaming can't resurrect deleted content.

export async function updateConversation(
  id: string,
  patch: Partial<Pick<Conversation, 'title' | 'model' | 'systemPrompt' | 'projectId'>>,
): Promise<void> {
  await db.conversations
    .where('id')
    .equals(id)
    .filter((c) => !c.deletedAt)
    .modify({ ...patch, updatedAt: now() })
}

/** Fields wiped from a tombstoned message, so deleted content doesn't linger. */
const WIPED = { content: '', reasoning: '', attachments: [] as Attachment[] }

/** Tombstones the conversation and its messages, wiping their content and files. */
export async function deleteConversation(id: string): Promise<void> {
  await db.transaction('rw', db.conversations, db.messages, db.blobs, async () => {
    const t = now()
    await db.conversations.update(id, { title: '', systemPrompt: '', updatedAt: t, deletedAt: t })
    await deleteBlobsOf(await messagesOf(id).toArray())
    await messagesOf(id).modify({ ...WIPED, updatedAt: t, deletedAt: t })
  })
}

// --- Messages --------------------------------------------------------------

function messagesOf(conversationId: string) {
  return db.messages
    .where('[conversationId+createdAt]')
    .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  return messagesOf(conversationId)
    .filter((m) => !m.deletedAt)
    .toArray()
}

export async function addMessage(
  init: Pick<Message, 'conversationId' | 'role' | 'content'> & Partial<Message>,
): Promise<Message> {
  const t = now()
  const message: Message = {
    attachments: [],
    reasoning: '',
    model: null,
    status: 'done',
    error: null,
    usage: null,
    ...init,
    id: newId(),
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  }
  await db.messages.add(message)
  return message
}

export async function updateMessage(
  id: string,
  patch: Partial<Pick<Message, 'content' | 'attachments' | 'reasoning' | 'status' | 'error' | 'usage'>>,
): Promise<void> {
  await db.messages
    .where('id')
    .equals(id)
    .filter((m) => !m.deletedAt)
    .modify({ ...patch, updatedAt: now() })
}

/** Tombstones messages matching `predicate` in a conversation, deleting their files. */
export async function deleteMessages(
  conversationId: string,
  predicate: (m: Message) => boolean,
): Promise<void> {
  const t = now()
  await db.transaction('rw', db.messages, db.blobs, async () => {
    const matching = messagesOf(conversationId).filter((m) => !m.deletedAt && predicate(m))
    await deleteBlobsOf(await matching.toArray())
    await matching.modify({ ...WIPED, updatedAt: t, deletedAt: t })
  })
}

// --- Blobs -----------------------------------------------------------------

export async function saveBlob(data: ArrayBuffer, mimeType: string): Promise<string> {
  const id = newId()
  await db.blobs.add({ id, mimeType, data, createdAt: now() })
  return id
}

export function getBlob(id: string): Promise<StoredBlob | undefined> {
  return db.blobs.get(id)
}

async function deleteBlobsOf(messages: Message[]): Promise<void> {
  const ids = messages.flatMap((m) => (m.attachments ?? []).map((a) => a.blobId).filter((id) => id !== null))
  if (ids.length) await db.blobs.bulkDelete(ids)
}

/** Marks replies left `streaming` by a closed tab as interrupted. */
export async function recoverInterruptedMessages(): Promise<void> {
  const t = now()
  await db.messages
    .where('status')
    .equals('streaming')
    .modify({ status: 'error', error: 'Interrupted before the reply finished.', updatedAt: t })
}

// --- Export / import -------------------------------------------------------

export interface ExportedBlob {
  id: string
  mimeType: string
  /** Base64 of the bytes. */
  data: string
}

export interface ExportFile {
  app: 'aimvp'
  version: 1
  exportedAt: number
  /** Absent in exports made before projects existed. */
  projects?: Project[]
  conversations: Conversation[]
  messages: Message[]
  /** Images and PDFs referenced by message attachments; absent in older exports. */
  blobs?: ExportedBlob[]
}

export async function exportData(): Promise<ExportFile> {
  const [projects, conversations, messages] = await Promise.all([
    db.projects.filter((p) => !p.deletedAt).toArray(),
    db.conversations.filter((c) => !c.deletedAt).toArray(),
    db.messages.filter((m) => !m.deletedAt).toArray(),
  ])
  const blobIds = messages.flatMap((m) => m.attachments.map((a) => a.blobId).filter((id) => id !== null))
  const blobs = (await db.blobs.bulkGet(blobIds))
    .filter((b) => b !== undefined)
    .map((b) => ({ id: b.id, mimeType: b.mimeType, data: bytesToBase64(b.data) }))
  return { app: 'aimvp', version: 1, exportedAt: Date.now(), projects, conversations, messages, blobs }
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function toProject(raw: unknown): Project | null {
  const r = raw as Record<string, unknown>
  if (!r || !isString(r.id) || !isString(r.name)) return null
  if (!isNumber(r.createdAt) || !isNumber(r.updatedAt)) return null
  return {
    id: r.id,
    name: r.name,
    instructions: isString(r.instructions) ? r.instructions : '',
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: isNumber(r.deletedAt) ? r.deletedAt : null,
  }
}

function toConversation(raw: unknown): Conversation | null {
  const r = raw as Record<string, unknown>
  if (!r || !isString(r.id) || !isString(r.title) || !isString(r.model)) return null
  if (!isNumber(r.createdAt) || !isNumber(r.updatedAt)) return null
  return {
    id: r.id,
    projectId: isString(r.projectId) ? r.projectId : null,
    title: r.title,
    model: normalizeModelRef(r.model),
    systemPrompt: isString(r.systemPrompt) ? r.systemPrompt : '',
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: isNumber(r.deletedAt) ? r.deletedAt : null,
  }
}

function toAttachment(raw: unknown): Attachment | null {
  const r = raw as Record<string, unknown>
  if (!r || !isString(r.id) || !isString(r.name) || !isString(r.mimeType)) return null
  if (r.kind !== 'image' && r.kind !== 'file') return null
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    mimeType: r.mimeType,
    size: isNumber(r.size) ? r.size : 0,
    text: isString(r.text) ? r.text : '',
    blobId: isString(r.blobId) ? r.blobId : null,
    ...(isNumber(r.width) && isNumber(r.height) ? { width: r.width, height: r.height } : {}),
  }
}

function toMessage(raw: unknown): Message | null {
  const r = raw as Record<string, unknown>
  if (!r || !isString(r.id) || !isString(r.conversationId) || !isString(r.content)) return null
  if (r.role !== 'user' && r.role !== 'assistant') return null
  if (!isNumber(r.createdAt) || !isNumber(r.updatedAt)) return null
  const status = r.status === 'error' ? 'error' : 'done'
  return {
    id: r.id,
    conversationId: r.conversationId,
    role: r.role,
    content: r.content,
    attachments: (Array.isArray(r.attachments) ? r.attachments : []).map(toAttachment).filter((a) => a !== null),
    reasoning: isString(r.reasoning) ? r.reasoning : '',
    model: isString(r.model) ? normalizeModelRef(r.model) : null,
    status,
    error: status === 'error' ? (isString(r.error) ? r.error : 'Unknown error') : null,
    usage: (r.usage as Message['usage']) ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: isNumber(r.deletedAt) ? r.deletedAt : null,
  }
}

/** Merges an export into the local database; the newer `updatedAt` wins per record. */
export async function importData(
  file: unknown,
): Promise<{ projects: number; conversations: number; messages: number }> {
  const f = file as Partial<ExportFile>
  if (!f || f.app !== 'aimvp' || f.version !== 1 || !Array.isArray(f.conversations) || !Array.isArray(f.messages)) {
    throw new Error('This file is not an aimvp export.')
  }
  const projects = (Array.isArray(f.projects) ? f.projects : []).map(toProject).filter((p) => p !== null)
  const conversations = f.conversations.map(toConversation).filter((c) => c !== null)
  const messages = f.messages.map(toMessage).filter((m) => m !== null)
  const blobs: StoredBlob[] = (Array.isArray(f.blobs) ? f.blobs : []).flatMap((b) => {
    if (!b || !isString(b.id) || !isString(b.mimeType) || !isString(b.data)) return []
    try {
      return [{ id: b.id, mimeType: b.mimeType, data: base64ToBytes(b.data).buffer, createdAt: Date.now() }]
    } catch {
      return []
    }
  })

  return db.transaction('rw', [db.projects, db.conversations, db.messages, db.blobs], async () => {
    const newer = <T extends { id: string; updatedAt: number }>(incoming: T[], existing: (T | undefined)[]) =>
      incoming.filter((r, i) => !existing[i] || existing[i].updatedAt < r.updatedAt)

    const keptProjects = newer(projects, await db.projects.bulkGet(projects.map((p) => p.id)))
    const keptConversations = newer(conversations, await db.conversations.bulkGet(conversations.map((c) => c.id)))
    const keptMessages = newer(messages, await db.messages.bulkGet(messages.map((m) => m.id)))
    await db.projects.bulkPut(keptProjects)
    await db.conversations.bulkPut(keptConversations)
    await db.messages.bulkPut(keptMessages)
    // Blobs are immutable and keyed by id, so existing ones can simply be kept.
    const existingBlobs = await db.blobs.bulkGet(blobs.map((b) => b.id))
    await db.blobs.bulkAdd(blobs.filter((_, i) => !existingBlobs[i]))
    return { projects: keptProjects.length, conversations: keptConversations.length, messages: keptMessages.length }
  })
}

export async function deleteAllData(): Promise<void> {
  await db.transaction('rw', [db.projects, db.conversations, db.messages, db.blobs], async () => {
    await db.blobs.clear()
    await db.projects.clear()
    await db.conversations.clear()
    await db.messages.clear()
  })
}

// --- Sidebar grouping ------------------------------------------------------

export interface ConversationGroup {
  label: string
  items: Conversation[]
}

/** Groups conversations (already sorted newest first) into date buckets. */
export function groupByDate(conversations: Conversation[], at = new Date()): ConversationGroup[] {
  const startOfToday = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
  const day = 24 * 60 * 60 * 1000
  const buckets: [string, number][] = [
    ['Today', startOfToday],
    ['Yesterday', startOfToday - day],
    ['Previous 7 days', startOfToday - 7 * day],
    ['Previous 30 days', startOfToday - 30 * day],
    ['Older', -Infinity],
  ]
  const groups: ConversationGroup[] = []
  for (const c of conversations) {
    const label = buckets.find(([, start]) => c.updatedAt >= start)![0]
    const last = groups.at(-1)
    if (last?.label === label) last.items.push(c)
    else groups.push({ label, items: [c] })
  }
  return groups
}
