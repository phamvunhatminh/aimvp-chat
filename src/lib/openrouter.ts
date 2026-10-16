import { readSSE } from './sse'

export const OPENROUTER_API = 'https://openrouter.ai/api/v1'
export const DEFAULT_MODEL = 'openrouter/auto'

export interface ORModel {
  id: string
  name: string
  description?: string
  context_length?: number | null
  created?: number
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
}

export interface KeyInfo {
  label?: string
  usage: number
  limit: number | null
  limit_remaining?: number | null
  is_free_tier?: boolean
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

export class OpenRouterError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'OpenRouterError'
    this.status = status
  }

  get isAuthError() {
    return this.status === 401
  }
}

function friendlyMessage(status: number | null, apiMessage?: string): string {
  switch (status) {
    case 401:
      return 'Your OpenRouter key is invalid or was revoked. Reconnect it in Settings.'
    case 402:
      return 'Your OpenRouter account is out of credits. Add credits at openrouter.ai/settings/credits.'
    case 403:
      return apiMessage ? `Request blocked by moderation: ${apiMessage}` : 'Request blocked by moderation.'
    case 408:
      return 'The model took too long to respond. Try again.'
    case 429:
      return 'Rate limited. Wait a moment, or pick a different model.'
    case 502:
    case 503:
      return 'The model provider is unavailable right now. Try again or pick a different model.'
    default:
      return apiMessage || `OpenRouter request failed${status ? ` (HTTP ${status})` : ''}.`
  }
}

async function errorFromResponse(res: Response): Promise<OpenRouterError> {
  let apiMessage: string | undefined
  try {
    const body = await res.json()
    apiMessage = body?.error?.message
  } catch {
    // Body was not JSON; fall back to the status code.
  }
  return new OpenRouterError(friendlyMessage(res.status, apiMessage), res.status)
}

function authHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` }
}

export async function fetchModels(signal?: AbortSignal): Promise<ORModel[]> {
  const res = await fetch(`${OPENROUTER_API}/models`, { signal })
  if (!res.ok) throw await errorFromResponse(res)
  const body = (await res.json()) as { data: ORModel[] }
  return body.data.filter((m) => m.architecture?.output_modalities?.includes('text') ?? true)
}

export async function fetchKeyInfo(apiKey: string, signal?: AbortSignal): Promise<KeyInfo> {
  const res = await fetch(`${OPENROUTER_API}/key`, { headers: authHeaders(apiKey), signal })
  if (!res.ok) throw await errorFromResponse(res)
  const body = (await res.json()) as { data: KeyInfo }
  return body.data
}

interface ChunkPayload {
  error?: { code?: number | string; message?: string }
  choices?: { delta?: { content?: string | null; reasoning?: string | null } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
}

/** Streams a chat completion. Abort with `signal`; errors throw `OpenRouterError`. */
export async function* streamChat(opts: {
  apiKey: string
  model: string
  messages: ChatMessage[]
  signal?: AbortSignal
}): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${OPENROUTER_API}/chat/completions`, {
    method: 'POST',
    headers: { ...authHeaders(opts.apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      usage: { include: true },
    }),
    signal: opts.signal,
  })
  if (!res.ok) throw await errorFromResponse(res)
  if (!res.body) throw new OpenRouterError('OpenRouter returned an empty response.', res.status)

  for await (const data of readSSE(res.body)) {
    if (data === '[DONE]') return
    let chunk: ChunkPayload
    try {
      chunk = JSON.parse(data)
    } catch {
      continue
    }
    // Errors after the stream started arrive as a chunk, not an HTTP status.
    if (chunk.error) {
      const code = typeof chunk.error.code === 'number' ? chunk.error.code : null
      throw new OpenRouterError(friendlyMessage(code, chunk.error.message), code)
    }
    const delta = chunk.choices?.[0]?.delta
    if (delta?.reasoning) yield { type: 'reasoning', text: delta.reasoning }
    if (delta?.content) yield { type: 'content', text: delta.content }
    if (chunk.usage) {
      yield {
        type: 'usage',
        usage: {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          cost: chunk.usage.cost,
        },
      }
    }
  }
}

/** Price per million input / output tokens, e.g. "$3 / $15 per 1M". Null when unknown or variable. */
export function formatPricing(model: Pick<ORModel, 'pricing'>): string | null {
  const prompt = Number(model.pricing?.prompt)
  const completion = Number(model.pricing?.completion)
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return null
  if (prompt < 0 || completion < 0) return null
  if (prompt === 0 && completion === 0) return 'Free'
  const perMillion = (perToken: number) => `$${Number((perToken * 1_000_000).toFixed(2))}`
  return `${perMillion(prompt)} / ${perMillion(completion)} per 1M`
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}
