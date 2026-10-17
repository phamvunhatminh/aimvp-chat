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
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string }
  /** Supports streamed reasoning that the app should ask for (Anthropic adaptive thinking). */
  reasoning?: boolean
  /** What the model can read besides text, when the provider says (absent = unknown). */
  inputs?: { image?: boolean; pdf?: boolean }
  /** What the model produces (absent = text only). */
  outputs?: { image?: boolean; text?: boolean }
  /** False when the provider says the model can't search the web (absent = assume it can). */
  webSearch?: boolean
}

/** The model makes images (possibly alongside text). */
export const makesImages = (m: ModelInfo | undefined) => m?.outputs?.image === true

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
  /** All input tokens, including those read from or written to the provider's prompt cache. */
  promptTokens: number
  completionTokens: number
  /** Input tokens read from the prompt cache (billed at a fraction of the input price). */
  cachedTokens?: number
  /** Input tokens written to the prompt cache (Anthropic bills these at a premium). */
  cacheWriteTokens?: number
  /** Exact USD cost, when the provider reports it (OpenRouter). */
  cost?: number
}

/** A web page a reply drew on. */
export interface Source {
  url: string
  title: string
}

export type StreamEvent =
  | { type: 'content'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'usage'; usage: Usage }
  /** A generated image, base64. */
  | { type: 'image'; mimeType: string; data: string }
  /** Web pages found or cited by a web search. */
  | { type: 'sources'; sources: Source[] }

/** Only http(s) links are kept as sources, so a reply can't smuggle in `javascript:` URLs. */
export function toSource(url: unknown, title: unknown): Source | null {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null
  return { url, title: typeof title === 'string' && title.trim() ? title.trim() : new URL(url).hostname }
}

/** Splits a `data:image/png;base64,...` URL; null for anything else. */
export function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(url)
  return match ? { mimeType: match[1], data: match[2] } : null
}

export interface ChatRequest {
  apiKey: string
  model: string
  /** Catalog entry for `model`, when known. */
  modelInfo?: ModelInfo
  messages: ChatMessage[]
  /** Let the model search the web and cite what it finds. */
  webSearch?: boolean
  signal?: AbortSignal
}

export interface ProviderClient {
  listModels(apiKey: string | null, signal?: AbortSignal): Promise<ModelInfo[]>
  /** Resolves if the key works; throws `ProviderError` otherwise. */
  validateKey(apiKey: string, signal?: AbortSignal): Promise<void>
  streamChat(request: ChatRequest): AsyncGenerator<StreamEvent>
}
