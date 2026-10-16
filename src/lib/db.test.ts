import Dexie from 'dexie'
import { expect, it } from 'vitest'
import { ChatDB } from './db'

it('upgrades v1 OpenRouter model ids to provider references', async () => {
  const name = 'aimvp-upgrade-test'
  const v1 = new Dexie(name)
  v1.version(1).stores({
    conversations: 'id, updatedAt',
    messages: 'id, [conversationId+createdAt], status, updatedAt',
  })
  await v1.table('conversations').add({ id: 'c1', title: 't', model: 'openai/gpt-4o', updatedAt: 1 })
  await v1.table('messages').bulkAdd([
    { id: 'm1', conversationId: 'c1', role: 'user', model: null, createdAt: 1, updatedAt: 1 },
    { id: 'm2', conversationId: 'c1', role: 'assistant', model: 'openai/gpt-4o', createdAt: 2, updatedAt: 2 },
  ])
  v1.close()

  const db = new ChatDB(name)
  expect((await db.conversations.get('c1'))?.model).toBe('openrouter:openai/gpt-4o')
  expect((await db.messages.get('m1'))?.model).toBeNull()
  expect((await db.messages.get('m2'))?.model).toBe('openrouter:openai/gpt-4o')
  db.close()
  await Dexie.delete(name)
})

it('v3 adds projects and files existing chats under no project', async () => {
  const name = 'aimvp-upgrade-v3-test'
  const v2 = new Dexie(name)
  v2.version(1).stores({
    conversations: 'id, updatedAt',
    messages: 'id, [conversationId+createdAt], status, updatedAt',
  })
  v2.version(2).stores({})
  await v2.table('conversations').add({ id: 'c1', title: 't', model: 'openrouter:a/b', updatedAt: 1 })
  v2.close()

  const db = new ChatDB(name)
  expect((await db.conversations.get('c1'))?.projectId).toBeNull()
  expect(await db.projects.count()).toBe(0)
  db.close()
  await Dexie.delete(name)
})
