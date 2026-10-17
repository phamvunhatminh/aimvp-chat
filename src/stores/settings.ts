import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_MODEL, normalizeModelRef, PROVIDER_IDS, type ProviderId } from '@/lib/providers'

export type Theme = 'system' | 'light' | 'dark'

export type ApiKeys = Partial<Record<ProviderId, string>>

/** How attached PDFs reach models that can read the file itself (Claude, Gemini). */
export type PdfMode = 'file' | 'text'

/** Who turns speech into text and back: the browser (free) or OpenAI (billed to the OpenAI key). */
export type SpeechEngine = 'browser' | 'openai'

interface SettingsState {
  /** The user's own keys. They never leave this browser except to call that provider. */
  apiKeys: ApiKeys
  /** Model reference (`provider:model`) for new chats. */
  defaultModel: string
  defaultSystemPrompt: string
  favoriteModels: string[]
  theme: Theme
  speechInput: SpeechEngine
  speechOutput: SpeechEngine
  /** OpenAI voice for read aloud. */
  speechVoice: string
  /** BCP 47 tag such as `vi-VN`, or '' to follow the browser. */
  speechLanguage: string
  /** Show this month's spend in the sidebar. */
  showUsageInSidebar: boolean
  /** USD a month, to compare spend against; null for none. */
  monthlyBudget: number | null
  /** The sidebar is hidden on wide screens. */
  sidebarCollapsed: boolean
  pdfMode: PdfMode
  setApiKey: (provider: ProviderId, apiKey: string | null) => void
  setDefaultModel: (model: string) => void
  setDefaultSystemPrompt: (prompt: string) => void
  toggleFavoriteModel: (model: string) => void
  setTheme: (theme: Theme) => void
  setSpeech: (speech: Partial<Pick<SettingsState, 'speechInput' | 'speechOutput' | 'speechVoice' | 'speechLanguage'>>) => void
  setUsagePrefs: (prefs: Partial<Pick<SettingsState, 'showUsageInSidebar' | 'monthlyBudget'>>) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setPdfMode: (mode: PdfMode) => void
}

type PersistedSettings = Pick<
  SettingsState,
  | 'apiKeys'
  | 'defaultModel'
  | 'defaultSystemPrompt'
  | 'favoriteModels'
  | 'theme'
  | 'speechInput'
  | 'speechOutput'
  | 'speechVoice'
  | 'speechLanguage'
  | 'showUsageInSidebar'
  | 'monthlyBudget'
  | 'sidebarCollapsed'
  | 'pdfMode'
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
      speechInput: 'browser',
      speechOutput: 'browser',
      speechVoice: 'alloy',
      speechLanguage: '',
      showUsageInSidebar: true,
      monthlyBudget: null,
      sidebarCollapsed: false,
      pdfMode: 'file',
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
      setSpeech: (speech) => set(speech),
      setUsagePrefs: (prefs) => set(prefs),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setPdfMode: (pdfMode) => set({ pdfMode }),
    }),
    {
      // public/theme-init.js reads `state.theme` from this key before first paint.
      name: 'aimvp.settings',
      version: 2,
      migrate: migrateSettings,
      partialize: (s): PersistedSettings => ({
        apiKeys: s.apiKeys,
        defaultModel: s.defaultModel,
        defaultSystemPrompt: s.defaultSystemPrompt,
        favoriteModels: s.favoriteModels,
        theme: s.theme,
        speechInput: s.speechInput,
        speechOutput: s.speechOutput,
        speechVoice: s.speechVoice,
        speechLanguage: s.speechLanguage,
        showUsageInSidebar: s.showUsageInSidebar,
        monthlyBudget: s.monthlyBudget,
        sidebarCollapsed: s.sidebarCollapsed,
        pdfMode: s.pdfMode,
      }),
    },
  ),
)
