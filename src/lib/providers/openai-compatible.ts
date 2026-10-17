import { readSSE } from '@/lib/sse'
import { httpError, readErrorBody, type ApiErrorBody } from './errors'
import {
  documentAsText,
  parseDataUrl,
  toSource,
  type ChatMessage,
  type ProviderId,
  type Source,
  type StreamEvent,
} from './types'

/**
 * A web citation on a reply. Chat Completions nests the link in `url_citation`;
 * the Responses API puts it on the annotation itself.
 */
export type Annotation = { type?: string; url?: string; title?: string; url_citation?: { url?: string; title?: string } }

export function sourcesOf(annotations: Annotation[] | undefined): Source[] {
  return (annotations ?? []).flatMap((a) => {
    if (a.type !== 'url_citation') return []
    const link = a.url_citation ?? a
    return toSource(link.url, link.title) ?? []
  })
}

interface ChunkPayload {
  error?: ApiErrorBody
  choices?: {
    delta?: {
      content?: string | null
      reasoning?: string | null
      /** Generated images (OpenRouter image models). */
      images?: { image_url?: { url?: string } }[]
      /** Web citations (OpenRouter web search). */
      annotations?: Annotation[]
    }
    message?: { annotations?: Annotation[] }
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    cost?: number
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }
  }
}

/** Chat Completions messages: images as data URLs; documents as their extracted text. */
export function toChatCompletionsMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === 'string'
        ? m.content
        : m.content.map((p) => {
            if (p.type === 'image') return { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } }
            if (p.type === 'document') return { type: 'text', text: documentAsText(p.name, p.text) }
            return { type: 'text', text: p.text }
          }),
  }))
}

/**
 * Marks the end of the conversation for prompt caching (Anthropic models through OpenRouter,
 * which only cache what is marked). Each turn caches everything so far, so the next turn
 * reads earlier messages and files from the cache instead of paying full price again.
 */
export function withCacheBreakpoint<T extends { role: string; content: unknown }>(messages: T[]): T[] {
  const last = messages.at(-1)
  if (!last) return messages
  type Part = { type: string; [key: string]: unknown }
  const parts: Part[] =
    typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...(last.content as Part[])]
  const end = parts.at(-1)
  if (!end) return messages
  parts[parts.length - 1] = { ...end, cache_control: { type: 'ephemeral' } }
  return [...messages.slice(0, -1), { ...last, content: parts }]
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
    for (const image of delta?.images ?? []) {
      const parsed = parseDataUrl(image.image_url?.url ?? '')
      if (parsed) yield { type: 'image', ...parsed }
    }
    const sources = sourcesOf(delta?.annotations ?? chunk.choices?.[0]?.message?.annotations)
    if (sources.length) yield { type: 'sources', sources }
    if (chunk.usage) {
      yield {
        type: 'usage',
        usage: {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
          cacheWriteTokens: chunk.usage.prompt_tokens_details?.cache_write_tokens,
          cost: chunk.usage.cost,
        },
      }
    }
  }
}
