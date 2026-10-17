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

/**
 * Preferences that follow the user's account to their other devices. API keys never
 * leave the device, and neither do the default model (it depends on which keys a
 * device has) and the sidebar's state.
 */
export const ACCOUNT_SETTINGS = [
  'defaultSystemPrompt',
  'favoriteModels',
  'theme',
  'speechInput',
  'speechOutput',
  'speechVoice',
  'speechLanguage',
  'showUsageInSidebar',
  'monthlyBudget',
  'pdfMode',
] as const satisfies readonly (keyof PersistedSettings)[]

export type AccountSettings = Pick<PersistedSettings, (typeof ACCOUNT_SETTINGS)[number]>

export function pickAccountSettings(state: AccountSettings): AccountSettings {
  return Object.fromEntries(ACCOUNT_SETTINGS.map((key) => [key, state[key]])) as unknown as AccountSettings
}

const oneOf =
  <T extends string>(...values: T[]) =>
  (v: unknown): v is T =>
    values.includes(v as T)
const isString = (v: unknown): v is string => typeof v === 'string'

const ACCOUNT_SETTING_CHECKS: { [K in keyof AccountSettings]: (v: unknown) => v is AccountSettings[K] } = {
  defaultSystemPrompt: isString,
  favoriteModels: (v): v is string[] => Array.isArray(v) && v.every(isString),
  theme: oneOf('system', 'light', 'dark'),
  speechInput: oneOf('browser', 'openai'),
  speechOutput: oneOf('browser', 'openai'),
  speechVoice: isString,
  speechLanguage: isString,
  showUsageInSidebar: (v): v is boolean => typeof v === 'boolean',
  monthlyBudget: (v): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0),
  pdfMode: oneOf('file', 'text'),
}

/** The valid preferences in settings from the account; anything else is left alone. */
export function parseAccountSettings(raw: unknown): Partial<AccountSettings> {
  const r = (raw ?? {}) as Record<string, unknown>
  return Object.fromEntries(
    ACCOUNT_SETTINGS.filter((key) => ACCOUNT_SETTING_CHECKS[key](r[key])).map((key) => [key, r[key]]),
  )
}

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
