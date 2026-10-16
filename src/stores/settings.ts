import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_MODEL, normalizeModelRef, PROVIDER_IDS, type ProviderId } from '@/lib/providers'

export type Theme = 'system' | 'light' | 'dark'

export type ApiKeys = Partial<Record<ProviderId, string>>

interface SettingsState {
  /** The user's own keys. They never leave this browser except to call that provider. */
  apiKeys: ApiKeys
  /** Model reference (`provider:model`) for new chats. */
  defaultModel: string
  defaultSystemPrompt: string
  favoriteModels: string[]
  theme: Theme
  setApiKey: (provider: ProviderId, apiKey: string | null) => void
  setDefaultModel: (model: string) => void
  setDefaultSystemPrompt: (prompt: string) => void
  toggleFavoriteModel: (model: string) => void
  setTheme: (theme: Theme) => void
}

type PersistedSettings = Pick<
  SettingsState,
  'apiKeys' | 'defaultModel' | 'defaultSystemPrompt' | 'favoriteModels' | 'theme'
>

/** Providers the user has a key for, in display order. */
export function connectedProviders(apiKeys: ApiKeys): ProviderId[] {
  return PROVIDER_IDS.filter((p) => !!apiKeys[p])
}

/** Upgrades settings saved by older versions of the app. */
export function migrateSettings(persisted: unknown, version: number): PersistedSettings {
  const state = { ...(persisted as Record<string, unknown>) }
  if (version < 2) {
    // v1 had a single OpenRouter key and OpenRouter-only model ids.
    const legacyKey = typeof state.apiKey === 'string' ? state.apiKey : null
    delete state.apiKey
    state.apiKeys = legacyKey ? { openrouter: legacyKey } : {}
    if (typeof state.defaultModel === 'string') state.defaultModel = normalizeModelRef(state.defaultModel)
    if (Array.isArray(state.favoriteModels)) {
      state.favoriteModels = state.favoriteModels.filter((m) => typeof m === 'string').map(normalizeModelRef)
    }
  }
  return state as unknown as PersistedSettings
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      apiKeys: {},
      defaultModel: DEFAULT_MODEL,
      defaultSystemPrompt: '',
      favoriteModels: [],
      theme: 'system',
      setApiKey: (provider, apiKey) =>
        set((s) => {
          const apiKeys = { ...s.apiKeys }
          if (apiKey) apiKeys[provider] = apiKey
          else delete apiKeys[provider]
          return { apiKeys }
        }),
      setDefaultModel: (defaultModel) => set({ defaultModel }),
      setDefaultSystemPrompt: (defaultSystemPrompt) => set({ defaultSystemPrompt }),
      toggleFavoriteModel: (model) =>
        set((s) => ({
          favoriteModels: s.favoriteModels.includes(model)
            ? s.favoriteModels.filter((m) => m !== model)
            : [...s.favoriteModels, model],
        })),
      setTheme: (theme) => set({ theme }),
    }),
    {
      // public/theme-init.js reads `state.theme` from this key before first paint.
      name: 'aimvp.settings',
      version: 2,
      migrate: migrateSettings,
      partialize: ({ apiKeys, defaultModel, defaultSystemPrompt, favoriteModels, theme }): PersistedSettings => ({
        apiKeys,
        defaultModel,
        defaultSystemPrompt,
        favoriteModels,
        theme,
      }),
    },
  ),
)
