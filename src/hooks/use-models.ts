import { useEffect, useState } from 'react'
import { fetchModels, type ORModel } from '@/lib/openrouter'

const CACHE_KEY = 'aimvp.models'
const MAX_AGE_MS = 60 * 60 * 1000

type CachedModel = Pick<ORModel, 'id' | 'name' | 'context_length' | 'pricing' | 'created'>

interface ModelsState {
  models: CachedModel[]
  loading: boolean
  error: string | null
}

function readCache(): { at: number; models: CachedModel[] } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

let inflight: Promise<CachedModel[]> | null = null

function loadModels(): Promise<CachedModel[]> {
  inflight ??= fetchModels()
    .then((all) => {
      const models = all.map(({ id, name, context_length, pricing, created }) => ({
        id,
        name,
        context_length,
        pricing: pricing && { prompt: pricing.prompt, completion: pricing.completion },
        created,
      }))
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), models }))
      } catch {
        // Storage full; the list still works for this session.
      }
      return models
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** OpenRouter's model list, cached in localStorage and refreshed hourly. */
export function useModels(): ModelsState {
  const [state, setState] = useState<ModelsState>(() => {
    const cached = readCache()
    return { models: cached?.models ?? [], loading: !cached, error: null }
  })

  useEffect(() => {
    const cached = readCache()
    if (cached && Date.now() - cached.at < MAX_AGE_MS) return
    let active = true
    loadModels()
      .then((models) => active && setState({ models, loading: false, error: null }))
      .catch(() => active && setState((s) => ({ ...s, loading: false, error: 'Could not load models.' })))
    return () => {
      active = false
    }
  }, [])

  return state
}
