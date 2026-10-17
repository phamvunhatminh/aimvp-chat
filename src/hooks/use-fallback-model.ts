import { useEffect } from 'react'
import { parseModelRef, suggestedModel, toModelRef } from '@/lib/providers'
import { ensureModels, useModelCatalog } from '@/stores/models'
import { connectedProviders, useSettings } from '@/stores/settings'

/** A model at the first provider the user has a key for, or null (no keys, or its list is still loading). */
export function useFallbackModel(): string | null {
  const apiKeys = useSettings((s) => s.apiKeys)
  const provider = connectedProviders(apiKeys)[0]
  const models = useModelCatalog((s) => (provider ? s.byProvider[provider]?.models : undefined))

  useEffect(() => {
    if (provider) void ensureModels(provider, apiKeys[provider] ?? null)
  }, [provider, apiKeys])

  if (!provider) return null
  const id = suggestedModel(provider, models ?? [])
  return id ? toModelRef(provider, id) : null
}

/**
 * Moves the default model for new chats to a provider the user has a key for,
 * e.g. from OpenRouter's auto router to Claude when only an Anthropic key is added.
 */
export function useUsableDefaultModel() {
  const fallback = useFallbackModel()
  const apiKeys = useSettings((s) => s.apiKeys)
  const defaultModel = useSettings((s) => s.defaultModel)
  const setDefaultModel = useSettings((s) => s.setDefaultModel)

  useEffect(() => {
    if (fallback && !apiKeys[parseModelRef(defaultModel).provider]) setDefaultModel(fallback)
  }, [fallback, apiKeys, defaultModel, setDefaultModel])
}
