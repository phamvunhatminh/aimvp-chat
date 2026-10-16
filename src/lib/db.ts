import Dexie, { type EntityTable } from 'dexie'
import type { Usage } from './openrouter'

/**
 * Every record has a client-generated UUID, `updatedAt` and a `deletedAt`
 * tombstone so the data can later sync to a server (e.g. Cloudflare D1)
 * with a last-write-wins merge, without a schema rewrite.
 */
export interface Conversation {
  id: string
  title: string
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
  /** Model that produced an assistant message. */
  model: string | null
  status: MessageStatus
  error: string | null
  usage: Usage | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export class ChatDB extends Dexie {
  conversations!: EntityTable<Conversation, 'id'>
  messages!: EntityTable<Message, 'id'>

  constructor(name = 'aimvp') {
    super(name)
    this.version(1).stores({
      conversations: 'id, updatedAt',
      messages: 'id, [conversationId+createdAt], status, updatedAt',
    })
  }
}

export const db = new ChatDB()
