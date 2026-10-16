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
