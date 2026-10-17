import type { ModelInfo, ProviderId, Usage } from './providers'

/** USD per token. */
export interface Price {
  prompt: number
  completion: number
  /** Input read from the prompt cache, when the list gives it. */
  cacheRead?: number
  /** Input written to the prompt cache, when the list gives it. */
  cacheWrite?: number
}

/** Typical cache prices relative to input, for models whose list price doesn't say. */
const CACHE_READ_RATE = 0.1
const CACHE_WRITE_RATE = 1.25

export type PriceLookup = (provider: ProviderId, model: string) => Price | null

function toPrice(model: ModelInfo | undefined): Price | null {
  const prompt = Number(model?.pricing?.prompt)
  const completion = Number(model?.pricing?.completion)
  // OpenRouter marks variable prices (openrouter/auto) as -1.
  if (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) return null
  const optional = (value: string | undefined) => {
    const n = Number(value)
    return value !== undefined && Number.isFinite(n) && n >= 0 ? n : undefined
  }
  return {
    prompt,
    completion,
    cacheRead: optional(model?.pricing?.input_cache_read),
    cacheWrite: optional(model?.pricing?.input_cache_write),
  }
}

/** OpenRouter lists each maker's models under these prefixes. */
const OPENROUTER_PREFIX: Record<Exclude<ProviderId, 'openrouter'>, string> = {
  openai: 'openai/',
  anthropic: 'anthropic/',
  google: 'google/',
}

/** One spelling per model: "claude-opus-4-1-20250805" and "claude-opus-4.1" both become "claude-opus-4-1". */
export function canonicalModelId(id: string): string {
  return id
    .toLowerCase()
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '')
    .replace(/[._:]/g, '-')
}

/**
 * Prices from OpenRouter's public model list: its own models, and the same model
 * at OpenAI, Anthropic or Google (their list prices match what OpenRouter charges).
 */
export function makePriceLookup(openrouterModels: ModelInfo[]): PriceLookup {
  const byId = new Map(openrouterModels.map((m) => [m.id, m]))
  const byCanonical = new Map<string, ModelInfo>()
  for (const m of openrouterModels) {
    const key = canonicalModelId(m.id)
    if (!byCanonical.has(key)) byCanonical.set(key, m)
  }
  const cache = new Map<string, Price | null>()
  return (provider, model) => {
    const key = `${provider}:${model}`
    if (!cache.has(key)) {
      cache.set(
        key,
        provider === 'openrouter'
          ? toPrice(byId.get(model))
          : toPrice(byCanonical.get(canonicalModelId(OPENROUTER_PREFIX[provider] + model))),
      )
    }
    return cache.get(key)!
  }
}

/**
 * What a reply cost: exact when the provider said (OpenRouter), else estimated from list prices,
 * with cached input at the cache's price.
 */
export function costOf(usage: Usage, price: Price | null): { cost: number; estimated: boolean } | null {
  if (usage.cost !== undefined) return { cost: usage.cost, estimated: false }
  if (!price) return null
  const cached = usage.cachedTokens ?? 0
  const written = usage.cacheWriteTokens ?? 0
  const fresh = Math.max(0, usage.promptTokens - cached - written)
  const cost =
    fresh * price.prompt +
    cached * (price.cacheRead ?? price.prompt * CACHE_READ_RATE) +
    written * (price.cacheWrite ?? price.prompt * CACHE_WRITE_RATE) +
    usage.completionTokens * price.completion
  return { cost, estimated: true }
}
