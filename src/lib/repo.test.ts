import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Conversation } from './db'
import {
  addMessage,
  addProjectFiles,
  createConversation,
  createPrompt,
  deletePrompt,
  listPrompts,
  removeProjectFile,
  searchChats,
  updatePrompt,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  saveBlob,
  updateConversation,
  updateProject,
  deleteConversation,
  deleteMessages,
  deriveTitle,
  exportData,
  getConversation,
  getMessages,
  groupByDate,
  importData,
  listConversations,
  recoverInterruptedMessages,
  updateMessage,
} from './repo'

beforeEach(async () => {
  await db.prompts.clear()
  await db.blobs.clear()
  await db.projects.clear()
  await db.conversations.clear()
  await db.messages.clear()
})

const newChat = () => createConversation({ model: 'openai/gpt-test', systemPrompt: '' })

describe('conversations', () => {
  it('lists newest first and hides deleted ones', async () => {
    const a = await newChat()
    const b = await newChat()
    expect((await listConversations()).map((c) => c.id)).toEqual([b.id, a.id])

    await addMessage({ conversationId: a.id, role: 'user', content: 'secret' })
    await deleteConversation(a.id)
    expect((await listConversations()).map((c) => c.id)).toEqual([b.id])
    expect(await getConversation(a.id)).toBeUndefined()

    // Tombstones are kept for future sync, but their content is wiped.
    const tombstone = await db.conversations.get(a.id)
    expect(tombstone?.deletedAt).toBeTypeOf('number')
    const [message] = await db.messages.toArray()
    expect(message.content).toBe('')
    expect(message.deletedAt).toBeTypeOf('number')
  })

  it('does not resurrect content written after deletion', async () => {
    const c = await newChat()
    const m = await addMessage({ conversationId: c.id, role: 'assistant', content: '' })
    await deleteConversation(c.id)
    await updateMessage(m.id, { content: 'late chunk' })
    expect((await db.messages.get(m.id))?.content).toBe('')
  })
})

describe('messages', () => {
  it('keeps insertion order even within the same millisecond', async () => {
    const c = await newChat()
    for (let i = 0; i < 20; i++) await addMessage({ conversationId: c.id, role: 'user', content: String(i) })
    expect((await getMessages(c.id)).map((m) => m.content)).toEqual(Array.from({ length: 20 }, (_, i) => String(i)))
  })

  it('tombstones messages matching a predicate', async () => {
    const c = await newChat()
    await addMessage({ conversationId: c.id, role: 'user', content: 'keep' })
    await addMessage({ conversationId: c.id, role: 'assistant', content: 'drop', status: 'error' })
    await deleteMessages(c.id, (m) => m.status === 'error')
    expect((await getMessages(c.id)).map((m) => m.content)).toEqual(['keep'])
  })

  it('marks replies interrupted by a closed tab as errors', async () => {
    const c = await newChat()
    const m = await addMessage({ conversationId: c.id, role: 'assistant', content: 'half', status: 'streaming' })
    await recoverInterruptedMessages()
    expect(await db.messages.get(m.id)).toMatchObject({ status: 'error', content: 'half' })
  })
})

describe('projects', () => {
  it('lists projects by name and files chats under them', async () => {
    const b = await createProject({ name: 'beta' })
    const a = await createProject({ name: 'Alpha', instructions: 'Be formal.' })
    expect((await listProjects()).map((p) => p.name)).toEqual(['Alpha', 'beta'])

    const chat = await createConversation({ model: 'm', systemPrompt: '', projectId: a.id })
    expect(chat.projectId).toBe(a.id)
    await updateConversation(chat.id, { projectId: b.id })
    expect((await db.conversations.get(chat.id))?.projectId).toBe(b.id)

    await updateProject(a.id, { name: 'Alpha 2', instructions: 'Be brief.' })
    expect(await getProject(a.id)).toMatchObject({ name: 'Alpha 2', instructions: 'Be brief.' })
  })

  it('adds and removes project files', async () => {
    const p = await createProject({ name: 'Docs' })
    const file = (id: string) => ({ id, kind: 'file' as const, name: `${id}.md`, mimeType: 'text/markdown', size: 4, text: id, blobId: null })
    await addProjectFiles(p.id, [file('a'), file('b')])
    await removeProjectFile(p.id, 'a')
    expect((await getProject(p.id))?.files.map((f) => f.name)).toEqual(['b.md'])
  })

  it('deleting a project keeps its chats and moves them out', async () => {
    const p = await createProject({ name: 'Temp', instructions: 'secret' })
    const chat = await createConversation({ model: 'm', systemPrompt: '', projectId: p.id })
    await deleteProject(p.id)
    expect(await getProject(p.id)).toBeUndefined()
    expect(await listProjects()).toEqual([])
    expect((await db.projects.get(p.id))?.instructions).toBe('')
    expect((await getConversation(chat.id))?.projectId).toBeNull()
  })
})

describe('saved prompts', () => {
  it('creates, lists by title, edits and deletes prompts', async () => {
    const b = await createPrompt({ title: 'translate', content: 'Translate to {{language}}:' })
    const a = await createPrompt({ title: ' Summarize ', content: 'Summarize:' })
    expect((await listPrompts()).map((p) => p.title)).toEqual(['Summarize', 'translate'])
    await updatePrompt(a.id, { content: 'Summarize briefly:' })
    await deletePrompt(b.id)
    expect(await listPrompts()).toMatchObject([{ title: 'Summarize', content: 'Summarize briefly:' }])
    expect(await db.prompts.get(b.id)).toMatchObject({ title: '', content: '' })
  })
})

describe('searchChats', () => {
  it('finds titles and message text regardless of case and accents, newest first', async () => {
    const older = await createConversation({ model: 'm', systemPrompt: '', title: 'Du lịch Việt Nam' })
    const newer = await createConversation({ model: 'm', systemPrompt: '', title: 'Recipes' })
    await addMessage({ conversationId: newer.id, role: 'user', content: 'How do I cook phở?' })
    const reply = await addMessage({ conversationId: newer.id, role: 'assistant', content: 'Start with a VIỆT broth.' })
    const gone = await createConversation({ model: 'm', systemPrompt: '', title: 'viet notes' })
    await deleteConversation(gone.id)

    const results = await searchChats('viet')
    expect(results.map((r) => r.conversation.id)).toEqual([newer.id, older.id])
    expect(results[0]).toMatchObject({ title: null, message: { id: reply.id, match: { match: 'VIỆT' } } })
    expect(results[1].title).toEqual({ before: 'Du lịch ', match: 'Việt', after: ' Nam' })
    expect(await searchChats('pho')).toMatchObject([{ message: { match: { before: 'How do I cook ', match: 'phở' } } }])
    expect(await searchChats('   ')).toEqual([])
  })
})

describe('export / import', () => {
  it('round-trips data and keeps the newer copy of each record', async () => {
    const c = await newChat()
    await addMessage({ conversationId: c.id, role: 'user', content: 'hello' })
    const file = await exportData()
    expect(file).toMatchObject({ app: 'aimvp', version: 1 })

    await db.conversations.clear()
    await db.messages.clear()
    expect(await importData(JSON.parse(JSON.stringify(file)))).toEqual({
      projects: 0,
      conversations: 1,
      messages: 1,
      prompts: 0,
    })
    expect((await getMessages(c.id)).map((m) => m.content)).toEqual(['hello'])

    // Re-importing the same (not newer) data changes nothing.
    expect(await importData(file)).toEqual({ projects: 0, conversations: 0, messages: 0, prompts: 0 })
  })

  it('round-trips projects and accepts exports from before projects existed', async () => {
    const p = await createProject({ name: 'Work', instructions: 'Be formal.' })
    const c = await createConversation({ model: 'm', systemPrompt: '', projectId: p.id })
    const file = JSON.parse(JSON.stringify(await exportData()))
    await db.projects.clear()
    await db.conversations.clear()

    expect(await importData(file)).toMatchObject({ projects: 1, conversations: 1 })
    expect(await getProject(p.id)).toMatchObject({ name: 'Work', instructions: 'Be formal.' })
    expect((await getConversation(c.id))?.projectId).toBe(p.id)

    const legacy = { ...file, projects: undefined, conversations: [{ ...file.conversations[0], id: 'old', projectId: undefined }] }
    await importData(legacy)
    expect((await getConversation('old'))?.projectId).toBeNull()
  })

  it('round-trips prompts and project files', async () => {
    const p = await createProject({ name: 'Docs' })
    const doc = { id: 'f', kind: 'file' as const, name: 'brief.md', mimeType: 'text/markdown', size: 5, text: 'brief', blobId: null }
    await addProjectFiles(p.id, [doc])
    await createPrompt({ title: 'Fix grammar', content: 'Fix the grammar:' })
    const file = JSON.parse(JSON.stringify(await exportData()))
    await db.projects.clear()
    await db.prompts.clear()

    expect(await importData(file)).toMatchObject({ projects: 1, prompts: 1 })
    expect((await getProject(p.id))?.files).toEqual([doc])
    expect(await listPrompts()).toMatchObject([{ title: 'Fix grammar', content: 'Fix the grammar:' }])
  })

  it('round-trips attached images', async () => {
    const c = await createConversation({ model: 'm', systemPrompt: '' })
    const blobId = await saveBlob(new Uint8Array([9, 8, 7]).buffer, 'image/png')
    await addMessage({
      conversationId: c.id,
      role: 'user',
      content: 'look',
      attachments: [{ id: 'a', kind: 'image', name: 'x.png', mimeType: 'image/png', size: 3, text: '', blobId }],
    })
    const file = JSON.parse(JSON.stringify(await exportData()))
    expect(file.blobs).toEqual([{ id: blobId, mimeType: 'image/png', data: 'CQgH' }])

    await db.blobs.clear()
    await db.messages.clear()
    await importData(file)
    const blob = await db.blobs.get(blobId)
    expect(Array.from(new Uint8Array(blob!.data))).toEqual([9, 8, 7])
    expect((await getMessages(c.id))[0].attachments[0]).toMatchObject({ name: 'x.png', blobId })
  })

  it('rejects files that are not chat exports', async () => {
    await expect(importData({ foo: 1 })).rejects.toThrow(/isn't a chat export/)
  })

  it('drops malformed records', async () => {
    const result = await importData({
      app: 'aimvp',
      version: 1,
      exportedAt: 0,
      conversations: [{ id: 'x' }],
      messages: [{ id: 'y', role: 'system' }],
      prompts: [{ id: 'z', title: 'no content' }],
    })
    expect(result).toEqual({ projects: 0, conversations: 0, messages: 0, prompts: 0 })
  })
})

describe('deriveTitle', () => {
  it('uses the first non-empty line without markdown markers', () => {
    expect(deriveTitle('\n\n## How do I   center a div?\nmore')).toBe('How do I center a div?')
  })

  it('truncates long titles', () => {
    const title = deriveTitle('a'.repeat(100))
    expect(title.length).toBeLessThanOrEqual(58)
    expect(title.endsWith('…')).toBe(true)
  })

  it('falls back to "New chat"', () => {
    expect(deriveTitle('   ')).toBe('New chat')
  })
})

describe('groupByDate', () => {
  it('buckets conversations by recency', () => {
    const at = new Date(2026, 9, 16, 12)
    const day = 86_400_000
    const make = (id: string, updatedAt: number) => ({ id, updatedAt }) as Conversation
    const groups = groupByDate(
      [make('a', at.getTime()), make('b', at.getTime() - day), make('c', at.getTime() - 3 * day), make('d', 0)],
      at,
    )
    expect(groups.map((g) => [g.label, g.items.map((c) => c.id)])).toEqual([
      ['Today', ['a']],
      ['Yesterday', ['b']],
      ['Previous 7 days', ['c']],
      ['Older', ['d']],
    ])
  })
})
