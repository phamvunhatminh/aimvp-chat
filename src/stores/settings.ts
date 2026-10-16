import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_MODEL } from '@/lib/openrouter'

export type Theme = 'system' | 'light' | 'dark'

interface SettingsState {
  /** The user's own OpenRouter key. It never leaves this browser except to call OpenRouter. */
  apiKey: string | null
  defaultModel: string
  defaultSystemPrompt: string
  favoriteModels: string[]
  theme: Theme
  setApiKey: (apiKey: string | null) => void
  setDefaultModel: (model: string) => void
  setDefaultSystemPrompt: (prompt: string) => void
  toggleFavoriteModel: (model: string) => void
  setTheme: (theme: Theme) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      apiKey: null,
      defaultModel: DEFAULT_MODEL,
      defaultSystemPrompt: '',
      favoriteModels: [],
      theme: 'system',
      setApiKey: (apiKey) => set({ apiKey }),
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
      version: 1,
      partialize: ({ apiKey, defaultModel, defaultSystemPrompt, favoriteModels, theme }) => ({
        apiKey,
        defaultModel,
        defaultSystemPrompt,
        favoriteModels,
        theme,
      }),
    },
  ),
)
