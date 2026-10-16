import { openrouter } from './openrouter'
import type { ProviderClient, ProviderId } from './types'

export * from './errors'
export * from './meta'
export * from './models'
export * from './types'

// Each provider is its own chunk, loaded the first time it is used. OpenRouter
// is small and needed up front (OAuth, credits, the public model list).
const loaders: Record<ProviderId, () => Promise<ProviderClient>> = {
  openrouter: () => Promise.resolve(openrouter),
  openai: () => import('./openai').then((m) => m.openai),
  anthropic: () => import('./anthropic').then((m) => m.anthropic),
  google: () => import('./google').then((m) => m.google),
}

export function loadProvider(id: ProviderId): Promise<ProviderClient> {
  return loaders[id]()
}
