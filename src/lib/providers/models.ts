import { isProviderId, type ModelInfo, type ProviderId } from './types'

/**
 * Models are referenced as `provider:model-id`, e.g. `anthropic:claude-opus-5-5`.
 * A reference without a known provider prefix is an OpenRouter id (the format
 * stored before other providers existed); OpenRouter ids use `vendor/model`.
 */
export interface ModelRef {
  provider: ProviderId
  model: string
}

export const DEFAULT_MODEL = 'openrouter:openrouter/auto'

export function parseModelRef(ref: string): ModelRef {
  const colon = ref.indexOf(':')
  const prefix = colon > 0 ? ref.slice(0, colon) : null
  if (isProviderId(prefix)) return { provider: prefix, model: ref.slice(colon + 1) }
  return { provider: 'openrouter', model: ref }
}

export function toModelRef(provider: ProviderId, model: string): string {
  return `${provider}:${model}`
}

/** Canonical form of a possibly legacy reference. */
export function normalizeModelRef(ref: string): string {
  const { provider, model } = parseModelRef(ref)
  return toModelRef(provider, model)
}

/** Each provider's everyday chat model, best first: the newest model matching the first pattern that matches any. */
const PREFERRED: Record<Exclude<ProviderId, 'openrouter'>, RegExp[]> = {
  anthropic: [/^claude-sonnet-/, /^claude-/],
  openai: [/^gpt-\d+(\.\d+)?$/, /^gpt-\d+(\.\d+)?-mini$/, /^gpt-/],
  google: [/^gemini-\d+(\.\d+)?-flash$/, /^gemini-\d+(\.\d+)?-pro$/, /^gemini-/],
}

const newestFirst = (a: Pick<ModelInfo, 'id' | 'created'>, b: Pick<ModelInfo, 'id' | 'created'>) =>
  (b.created ?? 0) - (a.created ?? 0) || b.id.localeCompare(a.id, undefined, { numeric: true })

/**
 * A sensible model to start with at a provider, chosen from its model list
 * (null until the list has loaded). OpenRouter picks per message with its auto router.
 */
export function suggestedModel(
  provider: ProviderId,
  models: Pick<ModelInfo, 'id' | 'created' | 'outputs'>[],
): string | null {
  if (provider === 'openrouter') return 'openrouter/auto'
  const chat = models.filter((m) => !m.outputs?.image)
  for (const pattern of PREFERRED[provider]) {
    const matches = chat.filter((m) => pattern.test(m.id))
    if (matches.length) return [...matches].sort(newestFirst)[0].id
  }
  return chat[0]?.id ?? null
}
