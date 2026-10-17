import Anthropic from '@anthropic-ai/sdk'
import { httpError, networkError, ProviderError } from './errors'
import {
  textOf,
  toSource,
  type ChatMessage,
  type ModelInfo,
  type ProviderClient,
  type Source,
  type StreamEvent,
} from './types'

/** Used when the model's output limit is unknown (e.g. a model id typed by hand). */
const FALLBACK_MAX_TOKENS = 16_000
/** Plenty for a chat reply; the SDK needs streaming above ~16k, which we always use. */
const MAX_TOKENS_CAP = 64_000
/** Searches Claude may run for one reply. */
const MAX_SEARCHES = 5
/** A long search turn can pause; continue it at most this many times. */
const MAX_CONTINUATIONS = 3

function client(apiKey: string) {
  // The key is the user's own, entered in this browser; the SDK sends the
  // `anthropic-dangerous-direct-browser-access` header that CORS requires.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

/** Message content as Anthropic blocks; files and images go before the text. */
export function toAnthropicContent(content: ChatMessage['content']): Anthropic.MessageParam['content'] {
  if (typeof content === 'string') return content
  return content.map((p): Anthropic.ContentBlockParam => {
    if (p.type === 'image') {
      return { type: 'image', source: { type: 'base64', media_type: p.mimeType as ImageMediaType, data: p.data } }
    }
    if (p.type === 'document') {
      return { type: 'document', title: p.name, source: { type: 'base64', media_type: 'application/pdf', data: p.data } }
    }
    return { type: 'text', text: p.text }
  })
}

function toProviderError(err: unknown): unknown {
  // Aborts are the caller's own doing; let them through untouched.
  if (err instanceof Anthropic.APIUserAbortError) return err
  // APIConnectionError subclasses APIError, so check it first.
  if (err instanceof Anthropic.APIConnectionError) return networkError('anthropic')
  if (err instanceof Anthropic.APIError) {
    const body = err.error as { error?: { message?: string } } | undefined
    const apiMessage = body?.error?.message ?? err.message
    let status: number | null = typeof err.status === 'number' ? err.status : null
    if (err.type === 'billing_error' || /credit balance/i.test(apiMessage)) status = 402
    else if (err.type === 'overloaded_error') status = 529
    else if (err.type === 'authentication_error') status = 401
    return httpError('anthropic', status, apiMessage)
  }
  return err
}

export const anthropic: ProviderClient = {
  async listModels(apiKey, signal) {
    if (!apiKey) return []
    const models: ModelInfo[] = []
    try {
      // Iterating the page auto-paginates; the API lists newest first.
      for await (const m of client(apiKey).models.list({ limit: 1000 }, { signal })) {
        models.push({
          id: m.id,
          name: m.display_name,
          created: Date.parse(m.created_at) / 1000,
          contextLength: m.max_input_tokens,
          maxOutputTokens: m.max_tokens,
          reasoning: m.capabilities?.thinking?.types?.adaptive?.supported === true,
          inputs: m.capabilities
            ? { image: m.capabilities.image_input?.supported, pdf: m.capabilities.pdf_input?.supported }
            : undefined,
          webSearch: (m.capabilities as { server_tools?: { web_search?: { supported?: boolean } } } | null)
            ?.server_tools?.web_search?.supported,
        })
      }
    } catch (err) {
      throw toProviderError(err)
    }
    return models
  },

  async validateKey(apiKey, signal) {
    try {
      await client(apiKey).models.list({ limit: 1 }, { signal })
    } catch (err) {
      throw toProviderError(err)
    }
  },

  async *streamChat({ apiKey, model, modelInfo, messages, webSearch, signal }): AsyncGenerator<StreamEvent> {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => textOf(m.content))
      .join('\n\n')
    // Consecutive same-role turns are fine: the API merges them.
    const turns: Anthropic.MessageParam[] = messages.flatMap((m) =>
      m.role === 'system' ? [] : [{ role: m.role, content: toAnthropicContent(m.content) }],
    )
    const params: Anthropic.MessageStreamParams = {
      model,
      max_tokens: Math.min(modelInfo?.maxOutputTokens ?? FALLBACK_MAX_TOKENS, MAX_TOKENS_CAP),
      messages: turns,
      ...(system ? { system } : {}),
      // Summarized thinking streams while the model reasons, instead of a silent pause.
      ...(modelInfo?.reasoning ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
      // Automatic prompt caching: each turn caches the conversation so far, so the next one reads
      // it (files included) at about a tenth of the input price instead of paying for it again.
      cache_control: { type: 'ephemeral' },
      ...(webSearch ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }] } : {}),
    }

    let wroteText = false
    let promptTokens = 0
    let completionTokens = 0
    let cachedTokens = 0
    let cacheWriteTokens = 0
    let cited = false
    const found: Source[] = []
    try {
      for (let turn = 0; ; turn++) {
        const stream = client(apiKey).messages.stream(params, { signal })
        for await (const event of stream) {
          if (event.type === 'content_block_start' && event.content_block.type === 'web_search_tool_result') {
            const results = event.content_block.content
            if (Array.isArray(results)) found.push(...results.flatMap((r) => toSource(r.url, r.title) ?? []))
          }
          if (event.type !== 'content_block_delta') continue
          if (event.delta.type === 'text_delta') {
            wroteText = true
            yield { type: 'content', text: event.delta.text }
          } else if (event.delta.type === 'thinking_delta') {
            yield { type: 'reasoning', text: event.delta.thinking }
          } else if (event.delta.type === 'citations_delta' && event.delta.citation.type === 'web_search_result_location') {
            const source = toSource(event.delta.citation.url, event.delta.citation.title)
            if (source) {
              cited = true
              yield { type: 'sources', sources: [source] }
            }
          }
        }
        const message = await stream.finalMessage()
        cachedTokens += message.usage.cache_read_input_tokens ?? 0
        cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0
        promptTokens +=
          message.usage.input_tokens +
          (message.usage.cache_read_input_tokens ?? 0) +
          (message.usage.cache_creation_input_tokens ?? 0)
        completionTokens += message.usage.output_tokens
        if (message.stop_reason === 'refusal') {
          throw new ProviderError(
            wroteText ? 'Claude stopped and declined to continue this reply.' : 'Claude declined to answer this request.',
            null,
            'anthropic',
          )
        }
        // A paused search turn continues when its partial reply is sent back as is.
        if (message.stop_reason !== 'pause_turn' || turn >= MAX_CONTINUATIONS) break
        params.messages = [...turns, { role: 'assistant', content: message.content as Anthropic.ContentBlockParam[] }]
      }
      // Without inline citations, list what the searches found.
      if (!cited && found.length) yield { type: 'sources', sources: found }
      yield {
        type: 'usage',
        usage: {
          promptTokens,
          completionTokens,
          cachedTokens: cachedTokens || undefined,
          cacheWriteTokens: cacheWriteTokens || undefined,
        },
      }
    } catch (err) {
      throw toProviderError(err)
    }
  },
}
