import { create } from 'zustand'

/** A prompt being written or edited in the prompt library; `id` is null for a new one. */
export interface PromptDraft {
  id: string | null
  title: string
  content: string
}

export type SettingsTab = 'general' | 'account' | 'keys' | 'voice' | 'usage' | 'data'

interface UIState {
  settingsOpen: boolean
  settingsTab: SettingsTab
  sidebarOpen: boolean
  signInOpen: boolean
  /** Model and system prompt for the "New chat" screen, before a conversation exists. */
  draft: { model: string | null; systemPrompt: string | null; webSearch: boolean }
  /** The prompt library dialog: closed, open on the list, or open on a prompt. */
  promptLibrary: { open: boolean; editing: PromptDraft | null }
  setSettingsOpen: (open: boolean) => void
  /** Opens Settings, on a given tab. */
  openSettings: (tab?: SettingsTab) => void
  setSettingsTab: (tab: SettingsTab) => void
  openPromptLibrary: (editing?: PromptDraft) => void
  setPromptEditing: (editing: PromptDraft | null) => void
  closePromptLibrary: () => void
  setSidebarOpen: (open: boolean) => void
  setSignInOpen: (open: boolean) => void
  setDraft: (draft: Partial<UIState['draft']>) => void
  resetDraft: () => void
}

export const useUI = create<UIState>()((set) => ({
  settingsOpen: false,
  settingsTab: 'general',
  sidebarOpen: false,
  signInOpen: false,
  draft: { model: null, systemPrompt: null, webSearch: false },
  promptLibrary: { open: false, editing: null },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  openSettings: (tab = 'general') => set({ settingsOpen: true, settingsTab: tab }),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  openPromptLibrary: (editing) => set({ settingsOpen: false, promptLibrary: { open: true, editing: editing ?? null } }),
  setPromptEditing: (editing) => set((s) => ({ promptLibrary: { ...s.promptLibrary, editing } })),
  closePromptLibrary: () => set({ promptLibrary: { open: false, editing: null } }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSignInOpen: (signInOpen) => set({ signInOpen }),
  setDraft: (draft) => set((s) => ({ draft: { ...s.draft, ...draft } })),
  resetDraft: () => set({ draft: { model: null, systemPrompt: null, webSearch: false } }),
}))
