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
  /** What the model can read besides text, when the provider says (absent = unknown). */
  inputs?: { image?: boolean; pdf?: boolean }
}

export type ContentPart =
  | { type: 'text'; text: string }
  /** Base64 image bytes. */
  | { type: 'image'; mimeType: string; data: string }
  /**
   * A PDF as base64. Providers that read PDFs natively get the file; others
   * get `text`, the text extracted in the browser.
   */
  | { type: 'document'; name: string; data: string; text: string }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

/** A message's content as plain text, for providers or places that only take text. */
export function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  return content
    .map((p) => (p.type === 'text' ? p.text : p.type === 'document' ? documentAsText(p.name, p.text) : ''))
    .filter(Boolean)
    .join('\n\n')
}

/** How a file's text is shown to a model that doesn't read the file itself. */
export function documentAsText(name: string, text: string): string {
  const body = text.trim() || '(No text could be extracted from this file. It may be a scanned document.)'
  return `<file name="${name.replace(/"/g, "'")}">\n${body}\n</file>`
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
