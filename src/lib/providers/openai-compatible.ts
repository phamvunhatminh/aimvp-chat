import { readSSE } from '@/lib/sse'
import { httpError, readErrorBody, type ApiErrorBody } from './errors'
import type { ProviderId, StreamEvent } from './types'

interface ChunkPayload {
  error?: ApiErrorBody
  choices?: { delta?: { content?: string | null; reasoning?: string | null } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
}

/** Maps a provider's error status (and body) onto the statuses `httpError` understands. */
export type StatusNormalizer = (status: number | null, error: ApiErrorBody) => number | null

/** Streams an OpenAI-style Chat Completions response (OpenAI and OpenRouter). */
export async function* streamChatCompletions(opts: {
  provider: ProviderId
  url: string
  apiKey: string
  body: Record<string, unknown>
  signal?: AbortSignal
  normalizeStatus?: StatusNormalizer
}): AsyncGenerator<StreamEvent> {
  const normalize = opts.normalizeStatus ?? ((status) => status)
  const res = await fetch(opts.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.body),
    signal: opts.signal,
  })
  if (!res.ok) {
    const error = await readErrorBody(res)
    throw httpError(opts.provider, normalize(res.status, error), error.message)
  }
  if (!res.body) throw httpError(opts.provider, res.status, 'The provider returned an empty response.')

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
      throw httpError(opts.provider, normalize(code, chunk.error), chunk.error.message)
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
