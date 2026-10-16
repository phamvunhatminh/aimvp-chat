import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { loadProvider, parseModelRef, ProviderError, type ModelInfo, type ProviderId } from '@/lib/providers'
import { connectedProviders, useSettings } from './settings'

const MAX_AGE_MS = 60 * 60 * 1000

interface ProviderModels {
  models: ModelInfo[]
  fetchedAt: number
  /** Last characters of the key the list was fetched with; a new key refetches. */
  keyHint: string | null
  loading: boolean
  error: string | null
}

interface CatalogState {
  byProvider: Partial<Record<ProviderId, ProviderModels>>
}

/** Each provider's model list, cached in localStorage and refreshed hourly. */
export const useModelCatalog = create<CatalogState>()(
  persist(() => ({ byProvider: {} }) as CatalogState, {
    name: 'aimvp.model-catalog',
    version: 1,
    partialize: (s) => ({
      byProvider: Object.fromEntries(
        Object.entries(s.byProvider).map(([p, e]) => [p, { ...e, loading: false, error: null }]),
      ),
    }),
  }),
)

// Superseded cache format from before multiple providers.
try {
  localStorage.removeItem('aimvp.models')
} catch {
  // Storage unavailable; nothing to clean up.
}

const keyHint = (apiKey: string | null) => (apiKey ? apiKey.slice(-6) : null)
const inflight = new Map<ProviderId, Promise<void>>()

function patch(provider: ProviderId, update: Partial<ProviderModels>) {
  useModelCatalog.setState((s) => {
    const current = s.byProvider[provider] ?? { models: [], fetchedAt: 0, keyHint: null, loading: false, error: null }
    return { byProvider: { ...s.byProvider, [provider]: { ...current, ...update } } }
  })
}

/** Fetches a provider's models unless a fresh list for this key is cached. */
export function ensureModels(provider: ProviderId, apiKey: string | null): Promise<void> {
  const entry = useModelCatalog.getState().byProvider[provider]
  const hint = keyHint(apiKey)
  const fresh = entry && entry.keyHint === hint && entry.models.length > 0 && Date.now() - entry.fetchedAt < MAX_AGE_MS
  if (fresh) return Promise.resolve()
  const pending = inflight.get(provider)
  if (pending) return pending

  // A different key may see different models, so don't show the old list as current.
  patch(provider, { loading: true, error: null, ...(entry && entry.keyHint !== hint ? { models: [] } : {}) })
  const request = loadProvider(provider)
    .then((client) => client.listModels(apiKey))
    .then((models) => patch(provider, { models, fetchedAt: Date.now(), keyHint: hint, loading: false }))
    .catch((err) =>
      patch(provider, {
        loading: false,
        error: err instanceof ProviderError ? err.message : 'Could not load models.',
      }),
    )
    .finally(() => inflight.delete(provider))
  inflight.set(provider, request)
  return request
}

export function findModel(provider: ProviderId, id: string): ModelInfo | undefined {
  return useModelCatalog.getState().byProvider[provider]?.models.find((m) => m.id === id)
}

export interface ModelGroup extends Omit<ProviderModels, 'fetchedAt' | 'keyHint'> {
  provider: ProviderId
}

/**
 * Model lists for the providers the user has keys for. With no keys at all,
 * OpenRouter's public list is shown so the picker is never empty.
 */
export function useModelGroups(): ModelGroup[] {
  const apiKeys = useSettings((s) => s.apiKeys)
  const byProvider = useModelCatalog((s) => s.byProvider)
  const providers = useMemo((): ProviderId[] => {
    const connected = connectedProviders(apiKeys)
    return connected.length > 0 ? connected : ['openrouter']
  }, [apiKeys])

  useEffect(() => {
    for (const p of providers) void ensureModels(p, apiKeys[p] ?? null)
  }, [providers, apiKeys])

  return providers.map((provider) => {
    const entry = byProvider[provider]
    return {
      provider,
      models: entry?.models ?? [],
      loading: entry?.loading ?? true,
      error: entry?.error ?? null,
    }
  })
}

/** Catalog entry for a model reference, if its provider's list has loaded. */
export function useModelInfo(ref: string): ModelInfo | undefined {
  const { provider, model } = parseModelRef(ref)
  return useModelCatalog((s) => s.byProvider[provider]?.models.find((m) => m.id === model))
}

/** Display name for a model reference, falling back to its id. */
export function useModelName(ref: string): string {
  const { provider, model } = parseModelRef(ref)
  return useModelCatalog((s) => s.byProvider[provider]?.models.find((m) => m.id === model)?.name ?? model)
}
