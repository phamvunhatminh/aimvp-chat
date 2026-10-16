import { isProviderId, type ProviderId } from './types'

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
