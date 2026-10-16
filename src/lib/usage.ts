import { db, type Conversation, type Message, type Project } from './db'
import { costOf, type PriceLookup } from './pricing'
import { parseModelRef, PROVIDERS, type ProviderId } from './providers'

export type UsagePeriod = '7d' | '30d' | 'month' | 'all'

export const USAGE_PERIODS: { value: UsagePeriod; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
]

/** When a period starts, at local midnight. */
export function periodStart(period: UsagePeriod, now = new Date()): number {
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset).getTime()
  if (period === '7d') return day(6)
  if (period === '30d') return day(29)
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  return 0
}

export interface UsageTotals {
  /** USD, exact and estimated together. */
  cost: number
  /** The part of `cost` estimated from list prices. */
  estimatedCost: number
  /** Replies with tokens but no known price. */
  unpriced: number
  promptTokens: number
  completionTokens: number
  replies: number
}

export interface UsageRow extends UsageTotals {
  key: string
  label: string
}

export interface UsageBucket {
  /** Local midnight of the day, or of the month's first day. */
  start: number
  cost: number
  tokens: number
  replies: number
  /** The same, split by provider. */
  byProvider: Partial<Record<ProviderId, { cost: number; tokens: number }>>
}

export interface UsageStats {
  start: number
  totals: UsageTotals & {
    /** Messages the user sent. */
    messages: number
    chats: number
    images: number
    webSearches: number
    /** Average wait for the first token, in ms. */
    firstTokenMs: number | null
    /** Output speed once the reply started. */
    tokensPerSecond: number | null
  }
  bucketSize: 'day' | 'month'
  buckets: UsageBucket[]
  byProvider: UsageRow[]
  byModel: UsageRow[]
  byProject: UsageRow[]
  topChats: UsageRow[]
}

const emptyTotals = (): UsageTotals => ({
  cost: 0,
  estimatedCost: 0,
  unpriced: 0,
  promptTokens: 0,
  completionTokens: 0,
  replies: 0,
})

/** Charts switch from days to months beyond this many days. */
const MAX_DAY_BUCKETS = 92

function bucketStarts(start: number, end: number, size: 'day' | 'month'): number[] {
  const starts: number[] = []
  const d = new Date(start)
  d.setHours(0, 0, 0, 0)
  if (size === 'month') d.setDate(1)
  while (d.getTime() <= end) {
    starts.push(d.getTime())
    if (size === 'day') d.setDate(d.getDate() + 1)
    else d.setMonth(d.getMonth() + 1)
  }
  return starts
}

function bucketOf(t: number, size: 'day' | 'month'): number {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), size === 'day' ? d.getDate() : 1).getTime()
}

const byCost = (a: UsageRow, b: UsageRow) =>
  b.cost - a.cost || b.promptTokens + b.completionTokens - (a.promptTokens + a.completionTokens)

/**
 * Usage of messages created from `start` until `now`. Replies later deleted still
 * count toward spend and tokens: that money was spent.
 */
export function computeUsage({
  messages,
  conversations,
  projects,
  start,
  now = Date.now(),
  price,
}: {
  messages: Message[]
  conversations: Conversation[]
  projects: Project[]
  start: number
  now?: number
  price: PriceLookup
}): UsageStats {
  const inRange = messages.filter((m) => m.createdAt >= start && m.createdAt <= now)
  const first = start || inRange.reduce((min, m) => Math.min(min, m.createdAt), now)
  const bucketSize = (now - first) / 86_400_000 > MAX_DAY_BUCKETS ? 'month' : 'day'
  const buckets = new Map(
    bucketStarts(first, now, bucketSize).map((s): [number, UsageBucket] => [
      s,
      { start: s, cost: 0, tokens: 0, replies: 0, byProvider: {} },
    ]),
  )

  const conversationsById = new Map(conversations.map((c) => [c.id, c]))
  const projectNames = new Map(projects.filter((p) => !p.deletedAt).map((p) => [p.id, p.name]))
  const rows = {
    provider: new Map<string, UsageRow>(),
    model: new Map<string, UsageRow>(),
    project: new Map<string, UsageRow>(),
    chat: new Map<string, UsageRow>(),
  }
  const row = (table: Map<string, UsageRow>, key: string, label: string) => {
    let r = table.get(key)
    if (!r) table.set(key, (r = { key, label, ...emptyTotals() }))
    return r
  }

  const totals = { ...emptyTotals(), messages: 0, chats: 0, images: 0, webSearches: 0 }
  const chats = new Set<string>()
  let timed = 0
  let firstTokenMs = 0
  let generatedTokens = 0
  let generatingMs = 0

  for (const m of inRange) {
    chats.add(m.conversationId)
    if (m.role === 'user') {
      totals.messages++
      continue
    }
    if (m.status === 'streaming') continue
    const usage = m.usage
    if (m.status === 'error' && !usage) continue
    totals.images += (m.attachments ?? []).filter((a) => a.kind === 'image').length
    if (m.webSearch) totals.webSearches++
    if (m.timing && usage && usage.completionTokens > 0) {
      timed++
      firstTokenMs += m.timing.firstTokenMs
      const ms = m.timing.totalMs - m.timing.firstTokenMs
      if (ms > 100) {
        generatedTokens += usage.completionTokens
        generatingMs += ms
      }
    }

    const ref = m.model ? parseModelRef(m.model) : null
    const conversation = conversationsById.get(m.conversationId)
    const projectId = conversation?.projectId ?? null
    const projectName = projectId ? projectNames.get(projectId) : undefined
    const targets = [
      totals,
      ...(ref && m.model
        ? [row(rows.provider, ref.provider, PROVIDERS[ref.provider].name), row(rows.model, m.model, ref.model)]
        : []),
      row(rows.project, projectName ? projectId! : '', projectName ?? 'No project'),
      ...(conversation && !conversation.deletedAt ? [row(rows.chat, conversation.id, conversation.title)] : []),
    ]
    const cost = usage && ref ? costOf(usage, price(ref.provider, ref.model)) : null
    const bucket = buckets.get(bucketOf(m.createdAt, bucketSize))
    for (const t of targets) {
      t.replies++
      if (!usage) continue
      t.promptTokens += usage.promptTokens
      t.completionTokens += usage.completionTokens
      if (cost) {
        t.cost += cost.cost
        if (cost.estimated) t.estimatedCost += cost.cost
      } else if (usage.promptTokens + usage.completionTokens > 0) t.unpriced++
    }
    if (bucket) {
      const tokens = usage ? usage.promptTokens + usage.completionTokens : 0
      bucket.replies++
      bucket.tokens += tokens
      bucket.cost += cost?.cost ?? 0
      if (ref) {
        const part = (bucket.byProvider[ref.provider] ??= { cost: 0, tokens: 0 })
        part.tokens += tokens
        part.cost += cost?.cost ?? 0
      }
    }
  }
  totals.chats = chats.size

  return {
    start: first,
    totals: {
      ...totals,
      firstTokenMs: timed ? firstTokenMs / timed : null,
      tokensPerSecond: generatingMs ? generatedTokens / (generatingMs / 1000) : null,
    },
    bucketSize,
    buckets: [...buckets.values()],
    byProvider: [...rows.provider.values()].sort(byCost),
    byModel: [...rows.model.values()].sort(byCost),
    byProject: [...rows.project.values()].sort(byCost),
    topChats: [...rows.chat.values()].sort(byCost).slice(0, 5),
  }
}

/** Messages created since `start` (deleted ones too), with the chats and projects they belong to. */
export async function loadUsageData(start: number) {
  const [messages, conversations, projects] = await Promise.all([
    // A message's updatedAt is never before its createdAt, so this index range covers the period.
    db.messages.where('updatedAt').aboveOrEqual(start).toArray(),
    db.conversations.toArray(),
    db.projects.toArray(),
  ])
  return { messages: messages.filter((m) => m.createdAt >= start), conversations, projects }
}

/** Totals for one chat's messages. */
export function chatTotals(messages: Message[], price: PriceLookup) {
  let tokens = 0
  let cost = 0
  let estimated = false
  for (const m of messages) {
    if (!m.usage) continue
    tokens += m.usage.promptTokens + m.usage.completionTokens
    const ref = m.model ? parseModelRef(m.model) : null
    const c = ref ? costOf(m.usage, price(ref.provider, ref.model)) : null
    if (c) {
      cost += c.cost
      estimated ||= c.estimated
    }
  }
  return { tokens, cost, estimated }
}
