import Dexie, { type EntityTable, type Transaction } from 'dexie'
import { normalizeModelRef, type Source, type Usage } from './providers'

/**
 * Every record has a client-generated UUID, `updatedAt` and a `deletedAt`
 * tombstone, so it syncs with the signed-in account by a last-write-wins merge.
 */
export interface Project {
  id: string
  name: string
  /** Sent with every chat in the project, ahead of the chat's own system prompt. */
  instructions: string
  /** Documents whose text is sent with every chat in the project, after the instructions. */
  files: Attachment[]
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
  /** Replies may search the web (absent in chats from before web search). */
  webSearch?: boolean
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type MessageStatus = 'done' | 'streaming' | 'error'

export interface Attachment {
  id: string
  kind: 'image' | 'file'
  name: string
  mimeType: string
  /** Bytes of the stored original (images are stored after downscaling). */
  size: number
  /** Text extracted from a document; empty for images. */
  text: string
  /** The original bytes in the `blobs` table: images and PDFs. */
  blobId: string | null
  width?: number
  height?: number
}

/** A reusable prompt from the prompt library, inserted with `/` in the composer. */
export interface SavedPrompt {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

/** Binary data kept out of message rows so chat lists stay light. */
export interface StoredBlob {
  id: string
  mimeType: string
  data: ArrayBuffer
  createdAt: number
}

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  attachments: Attachment[]
  reasoning: string
  /** Model reference (`provider:model-id`) that produced an assistant message. */
  model: string | null
  status: MessageStatus
  error: string | null
  usage: Usage | null
  /** Web pages an assistant reply searched or cited. */
  sources?: Source[]
  /** The reply was asked for with web search on. */
  webSearch?: boolean
  /** How long the reply took: to its first token, and in all (absent before this was recorded). */
  timing?: { firstTokenMs: number; totalMs: number } | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

/** 0 while the account lacks this version of a record; set by sync, cleared by every local write. */
export interface SyncFlag {
  synced?: 0 | 1
}

/** Sync bookkeeping: the account this data belongs to, how far it has pulled, and so on. */
export interface MetaEntry {
  key: string
  value: unknown
}

/** Files deleted here that the account may still hold. */
export interface DeletedBlob {
  id: string
}

/** Transactions writing what came from the account, which mustn't be sent back. */
const accountTransactions = new WeakSet<Transaction>()
let onLocalChange: (() => void) | null = null

/** Calls `listener` after each local change to synced data (one listener at a time). */
export function setLocalChangeListener(listener: (() => void) | null): void {
  onLocalChange = listener
}

export class ChatDB extends Dexie {
  projects!: EntityTable<Project & SyncFlag, 'id'>
  conversations!: EntityTable<Conversation & SyncFlag, 'id'>
  messages!: EntityTable<Message & SyncFlag, 'id'>
  blobs!: EntityTable<StoredBlob & SyncFlag, 'id'>
  prompts!: EntityTable<SavedPrompt & SyncFlag, 'id'>
  meta!: EntityTable<MetaEntry, 'key'>
  deletedBlobs!: EntityTable<DeletedBlob, 'id'>

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
    // v4: messages carry attachments; their bytes live in `blobs`.
    this.version(4)
      .stores({ blobs: 'id' })
      .upgrade(async (tx) => {
        await tx
          .table<Message>('messages')
          .toCollection()
          .modify((m) => {
            m.attachments ??= []
          })
      })
    // v5: projects carry files, and saved prompts arrive.
    this.version(5)
      .stores({ prompts: 'id, updatedAt' })
      .upgrade(async (tx) => {
        await tx
          .table<Project>('projects')
          .toCollection()
          .modify((p) => {
            p.files ??= []
          })
      })
    // v6: data syncs with the signed-in account; everything so far is yet to be uploaded.
    this.version(6)
      .stores({
        projects: 'id, updatedAt, synced',
        conversations: 'id, updatedAt, projectId, synced',
        messages: 'id, [conversationId+createdAt], status, updatedAt, synced',
        prompts: 'id, updatedAt, synced',
        blobs: 'id, synced',
        meta: 'key',
        deletedBlobs: 'id',
      })
      .upgrade(async (tx) => {
        for (const name of ['projects', 'conversations', 'messages', 'prompts', 'blobs']) {
          await tx.table(name).toCollection().modify({ synced: 0 })
        }
      })

    for (const table of [this.projects, this.conversations, this.messages, this.prompts, this.blobs]) {
      table.hook('creating', (_key, record, tx) => {
        if (accountTransactions.has(tx)) return
        record.synced = 0
        onLocalChange?.()
      })
      table.hook('updating', (changes, _key, record, tx) => {
        if (accountTransactions.has(tx)) return
        onLocalChange?.()
        // An edit must be newer than what it edits, even when the version it edits came
        // from a device whose clock runs ahead; otherwise that version would win the merge.
        const updatedAt = (changes as { updatedAt?: unknown }).updatedAt
        const previous = (record as { updatedAt?: unknown }).updatedAt
        if (typeof updatedAt === 'number' && typeof previous === 'number' && updatedAt <= previous) {
          return { synced: 0, updatedAt: previous + 1 }
        }
        return { synced: 0 }
      })
    }
  }

  /** A read-write transaction for data from the account: its writes stay marked as synced. */
  fromAccount<T>(tables: Dexie.Table[], scope: () => Promise<T>): Promise<T> {
    return this.transaction('rw', tables, (tx) => {
      accountTransactions.add(tx)
      return scope()
    })
  }
}

export const db = new ChatDB()
