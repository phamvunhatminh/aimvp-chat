import { create } from 'zustand'

/** A prompt being written or edited in the prompt library; `id` is null for a new one. */
export interface PromptDraft {
  id: string | null
  title: string
  content: string
}

interface UIState {
  settingsOpen: boolean
  sidebarOpen: boolean
  /** Model and system prompt for the "New chat" screen, before a conversation exists. */
  draft: { model: string | null; systemPrompt: string | null; webSearch: boolean }
  /** The prompt library dialog: closed, open on the list, or open on a prompt. */
  promptLibrary: { open: boolean; editing: PromptDraft | null }
  setSettingsOpen: (open: boolean) => void
  openPromptLibrary: (editing?: PromptDraft) => void
  setPromptEditing: (editing: PromptDraft | null) => void
  closePromptLibrary: () => void
  setSidebarOpen: (open: boolean) => void
  setDraft: (draft: Partial<UIState['draft']>) => void
  resetDraft: () => void
}

export const useUI = create<UIState>()((set) => ({
  settingsOpen: false,
  sidebarOpen: false,
  draft: { model: null, systemPrompt: null, webSearch: false },
  promptLibrary: { open: false, editing: null },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  openPromptLibrary: (editing) => set({ settingsOpen: false, promptLibrary: { open: true, editing: editing ?? null } }),
  setPromptEditing: (editing) => set((s) => ({ promptLibrary: { ...s.promptLibrary, editing } })),
  closePromptLibrary: () => set({ promptLibrary: { open: false, editing: null } }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setDraft: (draft) => set((s) => ({ draft: { ...s.draft, ...draft } })),
  resetDraft: () => set({ draft: { model: null, systemPrompt: null, webSearch: false } }),
}))
