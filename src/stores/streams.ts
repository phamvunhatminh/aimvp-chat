import { create } from 'zustand'

export interface Draft {
  content: string
  reasoning: string
}

interface StreamsState {
  /** In-flight requests, keyed by conversation id. */
  controllers: Record<string, AbortController>
  /**
   * Live text of replies being streamed, keyed by message id. Shown only while
   * the stored message is still `streaming`, so a draft that outlives its
   * stream is harmless and never flickers back to stale stored text.
   */
  drafts: Record<string, Draft>
}

export const useStreams = create<StreamsState>()(() => ({ controllers: {}, drafts: {} }))

export const useIsStreaming = (conversationId: string | undefined) =>
  useStreams((s) => (conversationId ? conversationId in s.controllers : false))
