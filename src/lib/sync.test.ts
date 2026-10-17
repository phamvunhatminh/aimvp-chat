import { beforeEach, describe, expect, it } from 'vitest'
import { useSettings } from '@/stores/settings'
import { db, type Message } from './db'
import {
  addMessage,
  createConversation,
  createPrompt,
  deleteAllData,
  deleteConversation,
  getBlob,
  getMessages,
  listConversations,
  saveBlob,
  setMissingBlobFetcher,
  updateConversation,
  updateMessage,
} from './repo'
import { fetchBlob, linkAccount, syncWith, unlinkAccount, watchSettings, type AccountRecord, type PulledRecord, type SyncRemote } from './sync'

/** The account's side: last write wins, like the `push_records` function in supabase/schema.sql. */
class FakeRemote implements SyncRemote {
  records = new Map<string, PulledRecord>()
  blobs = new Map<string, { data: ArrayBuffer; mimeType: string }>()
  pushes: AccountRecord[][] = []
  private clock = Date.parse('2026-01-01T00:00:00Z')
  /** Runs inside the next push, before it lands: another tab's edit while the request is out. */
  duringPush: (() => Promise<void>) | null = null

  private stamp() {
    return new Date(this.clock++).toISOString()
  }

  /** A change made on another device. */
  put(record: AccountRecord) {
    this.records.set(`${record.kind}:${record.id}`, { ...record, modifiedAt: this.stamp() })
  }

  get(kind: string, id: string) {
    return this.records.get(`${kind}:${id}`)
  }

  async push(records: AccountRecord[]) {
    this.pushes.push(records)
    const during = this.duringPush
    this.duringPush = null
    await during?.()
    for (const r of records) {
      const current = this.get(r.kind, r.id)
      if (!current || current.updatedAt < r.updatedAt) this.put(r)
    }
  }

  async pull(since: string | null, limit: number) {
    return [...this.records.values()]
      .filter((r) => !since || Date.parse(r.modifiedAt) > Date.parse(since))
      .sort((a, b) => Date.parse(a.modifiedAt) - Date.parse(b.modifiedAt))
      .slice(0, limit)
  }

  async uploadBlob(id: string, data: ArrayBuffer, mimeType: string) {
    this.blobs.set(id, { data, mimeType })
  }

  async downloadBlob(id: string) {
    return this.blobs.get(id) ?? null
  }

  async removeBlobs(ids: string[]) {
    for (const id of ids) this.blobs.delete(id)
  }
}

const bytes = (...values: number[]) => new Uint8Array(values).buffer

function remoteMessage(conversationId: string, patch: Partial<Message> = {}): Message {
  return {
    id: crypto.randomUUID(),
    conversationId,
    role: 'assistant',
    content: 'From the phone',
    attachments: [],
    reasoning: '',
    model: 'openrouter:openrouter/auto',
    status: 'done',
    error: null,
    usage: null,
    createdAt: 100,
    updatedAt: 100,
    deletedAt: null,
    ...patch,
  }
}

let remote: FakeRemote

beforeEach(async () => {
  await unlinkAccount()
  remote = new FakeRemote()
  setMissingBlobFetcher(null)
})

describe('linkAccount', () => {
  it('joins data from before sign-in to the account, and keeps it for the same account', async () => {
    await createPrompt({ title: 'Mine', content: 'x' })
    expect(await linkAccount('user-a')).toBe('joined')
    expect(await linkAccount('user-a')).toBe('same')
    expect(await db.prompts.count()).toBe(1)
  })

  it("removes another account's data", async () => {
    await linkAccount('user-a')
    await createPrompt({ title: 'Theirs', content: 'x' })
    expect(await linkAccount('user-b')).toBe('replaced')
    expect(await db.prompts.count()).toBe(0)
  })
})

describe('syncWith', () => {
  it('uploads local records and files, then leaves them alone', async () => {
    const c = await createConversation({ model: 'openrouter:openrouter/auto', systemPrompt: '' })
    const blobId = await saveBlob(bytes(1, 2, 3), 'image/png')
    const attachment = { id: 'a1', kind: 'image' as const, name: 'x.png', mimeType: 'image/png', size: 3, text: '', blobId }
    const m = await addMessage({ conversationId: c.id, role: 'user', content: 'hi', attachments: [attachment] })
    await linkAccount('user-a')
    await syncWith(remote)

    expect(remote.get('conversation', c.id)?.data).toMatchObject({ id: c.id, model: 'openrouter:openrouter/auto' })
    expect(remote.get('message', m.id)?.data).toMatchObject({ content: 'hi', attachments: [{ blobId }] })
    expect(remote.get('message', m.id)?.data).not.toHaveProperty('synced')
    expect(remote.blobs.get(blobId)?.mimeType).toBe('image/png')
    expect(await db.messages.where('synced').equals(0).count()).toBe(0)

    remote.pushes = []
    await syncWith(remote)
    expect(remote.pushes).toEqual([])
  })

  it('takes newer records from the account without sending them back', async () => {
    await linkAccount('user-a')
    const c = await createConversation({ model: 'm', systemPrompt: '', title: 'Old title' })
    await syncWith(remote)
    const reply = remoteMessage(c.id)
    remote.put({ kind: 'conversation', id: c.id, data: { ...c, title: 'Renamed on phone', updatedAt: c.updatedAt + 1 }, updatedAt: c.updatedAt + 1 })
    remote.put({ kind: 'message', id: reply.id, data: reply, updatedAt: reply.updatedAt })
    remote.pushes = []

    await syncWith(remote)
    expect((await listConversations())[0].title).toBe('Renamed on phone')
    expect((await getMessages(c.id)).map((m) => m.content)).toEqual(['From the phone'])
    expect(remote.pushes).toEqual([])
  })

  it('keeps the newer local version when both sides changed', async () => {
    await linkAccount('user-a')
    const c = await createConversation({ model: 'm', systemPrompt: '', title: 'Start' })
    await syncWith(remote)
    remote.put({ kind: 'conversation', id: c.id, data: { ...c, title: 'Phone', updatedAt: c.updatedAt + 1 }, updatedAt: c.updatedAt + 1 })
    await updateConversation(c.id, { title: 'Laptop' })

    await syncWith(remote)
    expect((await listConversations())[0].title).toBe('Laptop')
    expect(remote.get('conversation', c.id)?.data).toMatchObject({ title: 'Laptop' })
  })

  it("keeps an edit made here even when the version it edits came from a clock running ahead", async () => {
    await linkAccount('user-a')
    const c = await createConversation({ model: 'm', systemPrompt: '', title: 'Start' })
    await syncWith(remote)
    const future = Date.now() + 3_600_000
    remote.put({ kind: 'conversation', id: c.id, data: { ...c, title: 'From the future', updatedAt: future }, updatedAt: future })
    await syncWith(remote)
    await updateConversation(c.id, { title: 'Edited here' })

    await syncWith(remote)
    expect(remote.get('conversation', c.id)?.data).toMatchObject({ title: 'Edited here' })
  })

  it('still sends records when a file fails to upload, and reports the failure', async () => {
    await linkAccount('user-a')
    await saveBlob(bytes(1), 'image/png')
    await createPrompt({ title: 'P', content: 'x' })
    remote.uploadBlob = async () => {
      throw new Error('Payload too large')
    }
    await expect(syncWith(remote)).rejects.toThrow('Payload too large')
    expect([...remote.records.values()].map((r) => r.kind)).toContain('prompt')
    expect(await db.blobs.where('synced').equals(0).count()).toBe(1)
  })

  it('pulls in pages past the first', async () => {
    await linkAccount('user-a')
    const c = await createConversation({ model: 'm', systemPrompt: '' })
    for (let i = 0; i < 600; i++) {
      const m = remoteMessage(c.id, { content: String(i), createdAt: 100 + i })
      remote.put({ kind: 'message', id: m.id, data: m, updatedAt: m.updatedAt })
    }
    await syncWith(remote)
    expect(await getMessages(c.id)).toHaveLength(600)
  }, 20_000)

  it('ignores records that are not valid', async () => {
    await linkAccount('user-a')
    remote.put({ kind: 'conversation', id: 'bad', data: { id: 'bad' }, updatedAt: 1 })
    remote.put({ kind: 'mystery', id: 'x', data: {}, updatedAt: 1 } as unknown as AccountRecord)
    await syncWith(remote)
    expect(await db.conversations.count()).toBe(0)
  })

  it('holds a reply back until it finishes streaming', async () => {
    await linkAccount('user-a')
    const c = await createConversation({ model: 'm', systemPrompt: '' })
    const reply = await addMessage({ conversationId: c.id, role: 'assistant', content: 'Hal', status: 'streaming' })
    await syncWith(remote)
    expect(remote.get('message', reply.id)).toBeUndefined()

    await updateMessage(reply.id, { content: 'Hello', status: 'done' })
    await syncWith(remote)
    expect(remote.get('message', reply.id)?.data).toMatchObject({ content: 'Hello', status: 'done' })
  })

  it('sends a record edited while it was being sent again', async () => {
    await linkAccount('user-a')
    const c = await createConversation({ model: 'm', systemPrompt: '', title: 'First' })
    remote.duringPush = () => updateConversation(c.id, { title: 'Second' })
    await syncWith(remote)
    expect(await db.conversations.where('synced').equals(0).count()).toBe(1)

    await syncWith(remote)
    expect(remote.get('conversation', c.id)?.data).toMatchObject({ title: 'Second' })
  })

  it('deletes files of messages deleted here, and of messages deleted elsewhere', async () => {
    await linkAccount('user-a')
    const c = await createConversation({ model: 'm', systemPrompt: '' })
    const blobId = await saveBlob(bytes(1), 'image/png')
    const attachment = { id: 'a1', kind: 'image' as const, name: 'x.png', mimeType: 'image/png', size: 1, text: '', blobId }
    const m = await addMessage({ conversationId: c.id, role: 'user', content: 'hi', attachments: [attachment] })
    await syncWith(remote)
    expect(remote.blobs.has(blobId)).toBe(true)

    // Elsewhere: the message is deleted, and this device drops its copy of the file.
    const tombstone = { ...m, content: '', attachments: [], updatedAt: m.updatedAt + 1, deletedAt: m.updatedAt + 1 }
    remote.put({ kind: 'message', id: m.id, data: tombstone, updatedAt: tombstone.updatedAt })
    await syncWith(remote)
    expect(await getMessages(c.id)).toEqual([])
    expect(await db.blobs.get(blobId)).toBeUndefined()

    // Here: a chat with a file is deleted, and so is the account's copy of the file.
    const other = await saveBlob(bytes(2), 'image/png')
    await addMessage({ conversationId: c.id, role: 'user', content: 'again', attachments: [{ ...attachment, blobId: other }] })
    await syncWith(remote)
    expect(remote.blobs.has(other)).toBe(true)
    await deleteConversation(c.id)
    await syncWith(remote)
    expect(remote.blobs.has(other)).toBe(false)
    expect(remote.get('conversation', c.id)?.data).toMatchObject({ title: '', deletedAt: expect.any(Number) })
  })

  it('deletes everything everywhere once linked', async () => {
    await linkAccount('user-a')
    const c = await createConversation({ model: 'm', systemPrompt: '' })
    await createPrompt({ title: 'P', content: 'x' })
    const blobId = await saveBlob(bytes(1), 'image/png')
    await syncWith(remote)

    await deleteAllData()
    await syncWith(remote)
    expect(remote.get('conversation', c.id)?.data).toMatchObject({ deletedAt: expect.any(Number) })
    expect([...remote.records.values()].filter((r) => r.kind === 'prompt').map((r) => r.data)).toMatchObject([
      { title: '', deletedAt: expect.any(Number) },
    ])
    expect(remote.blobs.has(blobId)).toBe(false)
  })
})

describe('fetchBlob', () => {
  it('downloads a file this device lacks, once', async () => {
    await linkAccount('user-a')
    remote.blobs.set('b1', { data: bytes(7, 7), mimeType: 'application/pdf' })
    let downloads = 0
    const download = remote.downloadBlob.bind(remote)
    remote.downloadBlob = (id) => {
      downloads++
      return download(id)
    }
    setMissingBlobFetcher((id) => fetchBlob(remote, id))

    const [a, b] = await Promise.all([getBlob('b1'), getBlob('b1')])
    expect(a?.mimeType).toBe('application/pdf')
    expect(Array.from(new Uint8Array(b!.data))).toEqual([7, 7])
    expect(await getBlob('b1')).toBeDefined()
    expect(downloads).toBe(1)
    // It came from the account, so it isn't uploaded back.
    expect((await db.blobs.get('b1'))?.synced).toBe(1)
    expect(await getBlob('missing')).toBeUndefined()
    remote.downloadBlob = () => Promise.reject(new Error('offline'))
    expect(await getBlob('also-missing')).toBeUndefined()
  })
})

describe('preferences', () => {
  beforeEach(() => {
    useSettings.setState({ theme: 'system', apiKeys: {}, defaultSystemPrompt: '', defaultModel: 'openrouter:openrouter/auto' })
  })

  it('sends preferences without keys or the default model, and takes newer ones', async () => {
    const stop = watchSettings(() => {})
    try {
      useSettings.setState({ apiKeys: { openai: 'sk-secret' }, defaultModel: 'openai:gpt-5' })
      useSettings.getState().setTheme('dark')
      await new Promise((r) => setTimeout(r, 10))
      await linkAccount('user-a')
      await syncWith(remote)
      const sent = remote.get('settings', 'preferences')
      expect(sent?.data).toMatchObject({ theme: 'dark' })
      expect(JSON.stringify(sent)).not.toContain('sk-secret')
      expect(sent?.data).not.toHaveProperty('defaultModel')

      remote.put({
        kind: 'settings',
        id: 'preferences',
        data: { ...(sent!.data as object), theme: 'light', defaultSystemPrompt: 'Be brief.', pdfMode: 'nonsense' },
        updatedAt: sent!.updatedAt + 1,
      })
      remote.pushes = []
      await syncWith(remote)
      expect(useSettings.getState()).toMatchObject({ theme: 'light', defaultSystemPrompt: 'Be brief.', pdfMode: 'file' })
      // Taking the account's preferences doesn't count as a change here.
      await new Promise((r) => setTimeout(r, 10))
      await syncWith(remote)
      expect(remote.pushes).toEqual([])
    } finally {
      stop()
    }
  })

  it("adopts the account's preferences on a device that never changed its own", async () => {
    remote.put({ kind: 'settings', id: 'preferences', data: { theme: 'dark' }, updatedAt: 1 })
    await linkAccount('user-a')
    await syncWith(remote)
    expect(useSettings.getState().theme).toBe('dark')
  })
})
