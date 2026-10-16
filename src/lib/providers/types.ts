export type ProviderId = 'openrouter' | 'openai' | 'anthropic' | 'google'

export const PROVIDER_IDS: readonly ProviderId[] = ['openrouter', 'openai', 'anthropic', 'google']

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value)
}

export interface ModelInfo {
  /** The provider's own model id, e.g. `gpt-5` or `anthropic/claude-sonnet-4`. */
  id: string
  name: string
  /** Unix seconds; used for "newest first" ordering where the API offers it. */
  created?: number
  contextLength?: number | null
  maxOutputTokens?: number | null
  /** USD per token, as strings (OpenRouter only). */
  pricing?: { prompt?: string; completion?: string }
  /** Supports streamed reasoning that the app should ask for (Anthropic adaptive thinking). */
  reasoning?: boolean
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface Usage {
  promptTokens: number
  completionTokens: number
  cost?: number
}

export type StreamEvent =
  | { type: 'content'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'usage'; usage: Usage }

export interface ChatRequest {
  apiKey: string
  model: string
  /** Catalog entry for `model`, when known. */
  modelInfo?: ModelInfo
  messages: ChatMessage[]
  signal?: AbortSignal
}

export interface ProviderClient {
  listModels(apiKey: string | null, signal?: AbortSignal): Promise<ModelInfo[]>
  /** Resolves if the key works; throws `ProviderError` otherwise. */
  validateKey(apiKey: string, signal?: AbortSignal): Promise<void>
  streamChat(request: ChatRequest): AsyncGenerator<StreamEvent>
}
