import Anthropic from '@anthropic-ai/sdk'
import { httpError, networkError, ProviderError } from './errors'
import { textOf, type ChatMessage, type ModelInfo, type ProviderClient, type StreamEvent } from './types'

/** Used when the model's output limit is unknown (e.g. a model id typed by hand). */
const FALLBACK_MAX_TOKENS = 16_000
/** Plenty for a chat reply; the SDK needs streaming above ~16k, which we always use. */
const MAX_TOKENS_CAP = 64_000

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

  async *streamChat({ apiKey, model, modelInfo, messages, signal }): AsyncGenerator<StreamEvent> {
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
    }

    let wroteText = false
    try {
      const stream = client(apiKey).messages.stream(params, { signal })
      for await (const event of stream) {
        if (event.type !== 'content_block_delta') continue
        if (event.delta.type === 'text_delta') {
          wroteText = true
          yield { type: 'content', text: event.delta.text }
        } else if (event.delta.type === 'thinking_delta') {
          yield { type: 'reasoning', text: event.delta.thinking }
        }
      }
      const message = await stream.finalMessage()
      yield {
        type: 'usage',
        usage: {
          promptTokens:
            message.usage.input_tokens +
            (message.usage.cache_read_input_tokens ?? 0) +
            (message.usage.cache_creation_input_tokens ?? 0),
          completionTokens: message.usage.output_tokens,
        },
      }
      if (message.stop_reason === 'refusal') {
        throw new ProviderError(
          wroteText ? 'Claude stopped and declined to continue this reply.' : 'Claude declined to answer this request.',
          null,
          'anthropic',
        )
      }
    } catch (err) {
      throw toProviderError(err)
    }
  },
}
