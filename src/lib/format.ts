import type { ModelInfo } from './providers'

/** Price per million input / output tokens, e.g. "$3 / $15 per 1M". Null when unknown or variable. */
export function formatPricing(model: Pick<ModelInfo, 'pricing'>): string | null {
  const prompt = Number(model.pricing?.prompt)
  const completion = Number(model.pricing?.completion)
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return null
  if (prompt < 0 || completion < 0) return null
  if (prompt === 0 && completion === 0) return 'Free'
  const perMillion = (perToken: number) => `$${Number((perToken * 1_000_000).toFixed(2))}`
  return `${perMillion(prompt)} / ${perMillion(completion)} per 1M`
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

/** Rough token count of text: about four characters per token for English. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** 950, 1.2k, 34k, 1.5M. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return `${Number((tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0))}k`
  return `${Number((tokens / 1_000_000).toFixed(1))}M`
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "just now", "5 minutes ago", "2 hours ago", "yesterday". */
export function formatAgo(time: number, now = Date.now()): string {
  const seconds = Math.round((time - now) / 1000)
  if (seconds > -45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes > -60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours > -24) return relative.format(hours, 'hour')
  return relative.format(Math.round(hours / 24), 'day')
}
