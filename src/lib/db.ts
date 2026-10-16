import Dexie, { type EntityTable } from 'dexie'
import { normalizeModelRef, type Usage } from './providers'

/**
 * Every record has a client-generated UUID, `updatedAt` and a `deletedAt`
 * tombstone so the data can later sync to a server (e.g. Cloudflare D1)
 * with a last-write-wins merge, without a schema rewrite.
 */
export interface Project {
  id: string
  name: string
  /** Sent with every chat in the project, ahead of the chat's own system prompt. */
  instructions: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface Conversation {
  id: string
  /** The project this chat is filed under, if any. */
  projectId: string | null
  title: string
  /** Model reference, `provider:model-id`. */
  model: string
  systemPrompt: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type MessageStatus = 'done' | 'streaming' | 'error'

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  reasoning: string
  /** Model reference (`provider:model-id`) that produced an assistant message. */
  model: string | null
  status: MessageStatus
  error: string | null
  usage: Usage | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export class ChatDB extends Dexie {
  projects!: EntityTable<Project, 'id'>
  conversations!: EntityTable<Conversation, 'id'>
  messages!: EntityTable<Message, 'id'>

  constructor(name = 'aimvp') {
    super(name)
    this.version(1).stores({
      conversations: 'id, updatedAt',
      messages: 'id, [conversationId+createdAt], status, updatedAt',
    })
    // v2: model ids gained a provider prefix (`openrouter:...`) when more providers arrived.
    this.version(2).upgrade(async (tx) => {
      await tx
        .table<Conversation>('conversations')
        .toCollection()
        .modify((c) => {
          c.model = normalizeModelRef(c.model)
        })
      await tx
        .table<Message>('messages')
        .toCollection()
        .modify((m) => {
          if (m.model) m.model = normalizeModelRef(m.model)
        })
    })
    // v3: projects group chats and share instructions.
    this.version(3)
      .stores({ projects: 'id, updatedAt', conversations: 'id, updatedAt, projectId' })
      .upgrade(async (tx) => {
        await tx
          .table<Conversation>('conversations')
          .toCollection()
          .modify((c) => {
            c.projectId ??= null
          })
      })
  }
}

export const db = new ChatDB()
