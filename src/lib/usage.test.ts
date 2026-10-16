import { describe, expect, it } from 'vitest'
import type { Conversation, Message, Project } from './db'
import type { PriceLookup } from './pricing'
import { chatTotals, computeUsage, periodStart } from './usage'

const day = 86_400_000
const now = new Date(2026, 9, 16, 12).getTime() // Oct 16, local noon

const conversation = (id: string, projectId: string | null = null, deletedAt: number | null = null) =>
  ({ id, projectId, title: `Chat ${id}`, deletedAt }) as Conversation

let n = 0
const reply = (conversationId: string, at: number, model: string, usage: Message['usage'], extra: Partial<Message> = {}) =>
  ({
    id: `m${n++}`,
    conversationId,
    role: 'assistant',
    status: 'done',
    model,
    usage,
    attachments: [],
    createdAt: at,
    deletedAt: null,
    ...extra,
  }) as Message

const question = (conversationId: string, at: number) =>
  ({ id: `m${n++}`, conversationId, role: 'user', status: 'done', attachments: [], createdAt: at }) as unknown as Message

// Claude is estimated at $1 per 1k tokens either way; OpenRouter costs come with the reply.
const price: PriceLookup = (provider) => (provider === 'anthropic' ? { prompt: 0.001, completion: 0.001 } : null)

describe('periodStart', () => {
  it('starts periods at local midnight', () => {
    const at = new Date(2026, 9, 16, 15, 30)
    expect(new Date(periodStart('7d', at))).toEqual(new Date(2026, 9, 10))
    expect(new Date(periodStart('30d', at))).toEqual(new Date(2026, 8, 17))
    expect(new Date(periodStart('month', at))).toEqual(new Date(2026, 9, 1))
    expect(periodStart('all', at)).toBe(0)
  })
})

describe('computeUsage', () => {
  const projects = [{ id: 'p', name: 'Work', deletedAt: null } as Project]
  const conversations = [conversation('a', 'p'), conversation('b'), conversation('gone', null, now)]
  const messages = [
    question('a', now - 2 * day),
    reply('a', now - 2 * day, 'openrouter:openai/gpt-5', { promptTokens: 100, completionTokens: 50, cost: 0.25 }, {
      timing: { firstTokenMs: 400, totalMs: 1400 },
    }),
    reply('b', now - day, 'anthropic:claude-opus-5-5', { promptTokens: 1000, completionTokens: 1000 }, {
      webSearch: true,
      timing: { firstTokenMs: 800, totalMs: 2800 },
    }),
    reply('gone', now, 'google:gemini-2.5-flash', { promptTokens: 10, completionTokens: 10 }, { deletedAt: now }),
    reply('b', now, 'openrouter:img/painter', { promptTokens: 0, completionTokens: 0, cost: 0.04 }, {
      attachments: [{ kind: 'image' } as Message['attachments'][number]],
    }),
    reply('b', now - 40 * day, 'openrouter:openai/gpt-5', { promptTokens: 1, completionTokens: 1, cost: 9 }),
    reply('b', now, 'openrouter:a/b', null, { status: 'error' }),
  ]
  const stats = computeUsage({ messages, conversations, projects, start: periodStart('7d', new Date(now)), now, price })

  it('adds up spend, estimates and tokens in the period', () => {
    expect(stats.totals).toMatchObject({
      cost: 0.25 + 2 + 0.04,
      estimatedCost: 2,
      unpriced: 1,
      promptTokens: 1110,
      completionTokens: 1060,
      replies: 4,
      messages: 1,
      chats: 3,
      images: 1,
      webSearches: 1,
    })
  })

  it('averages speed over timed replies', () => {
    expect(stats.totals.firstTokenMs).toBe(600)
    expect(stats.totals.tokensPerSecond).toBeCloseTo(1050 / 3)
  })

  it('buckets by day and breaks down by provider, model, project and chat', () => {
    expect(stats.bucketSize).toBe('day')
    expect(stats.buckets).toHaveLength(7)
    expect(stats.buckets.at(-1)).toMatchObject({ cost: 0.04, replies: 2 })
    expect(stats.byProvider.map((r) => [r.label, r.replies])).toEqual([
      ['Anthropic', 1],
      ['OpenRouter', 2],
      ['Google Gemini', 1],
    ])
    expect(stats.byProject.map((r) => r.label)).toEqual(['No project', 'Work'])
    // Deleted chats count toward spend but aren't listed.
    expect(stats.topChats.map((r) => r.key)).toEqual(['b', 'a'])
  })

  it('switches to months for long periods', () => {
    const all = computeUsage({ messages, conversations, projects, start: 0, now: now + 200 * day, price })
    expect(all.bucketSize).toBe('month')
    expect(all.totals.cost).toBeCloseTo(9 + 0.25 + 2 + 0.04)
  })
})

it('totals one chat', () => {
  const messages = [
    reply('a', now, 'anthropic:claude-opus-5-5', { promptTokens: 500, completionTokens: 500 }),
    reply('a', now, 'openrouter:x/y', { promptTokens: 10, completionTokens: 10, cost: 0.01 }),
  ]
  expect(chatTotals(messages, price)).toEqual({ tokens: 1020, cost: 1.01, estimated: true })
})
