import { create } from 'zustand'

interface UIState {
  settingsOpen: boolean
  sidebarOpen: boolean
  /** Model and system prompt for the "New chat" screen, before a conversation exists. */
  draft: { model: string | null; systemPrompt: string | null }
  setSettingsOpen: (open: boolean) => void
  setSidebarOpen: (open: boolean) => void
  setDraft: (draft: Partial<UIState['draft']>) => void
  resetDraft: () => void
}

export const useUI = create<UIState>()((set) => ({
  settingsOpen: false,
  sidebarOpen: false,
  draft: { model: null, systemPrompt: null },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setDraft: (draft) => set((s) => ({ draft: { ...s.draft, ...draft } })),
  resetDraft: () => set({ draft: { model: null, systemPrompt: null } }),
}))
