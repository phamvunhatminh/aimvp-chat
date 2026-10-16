import { httpError, readErrorBody } from './errors'
import { streamChatCompletions, toChatCompletionsMessages } from './openai-compatible'
import { makesImages, type ModelInfo, type ProviderClient } from './types'

export const OPENROUTER_API = 'https://openrouter.ai/api/v1'

export interface KeyInfo {
  label?: string
  usage: number
  limit: number | null
  limit_remaining?: number | null
  is_free_tier?: boolean
}

interface ORModel {
  id: string
  name: string
  created?: number
  context_length?: number | null
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
}

/** Credits used and the key's limit. */
export async function fetchKeyInfo(apiKey: string, signal?: AbortSignal): Promise<KeyInfo> {
  const res = await fetch(`${OPENROUTER_API}/key`, { headers: { Authorization: `Bearer ${apiKey}` }, signal })
  if (!res.ok) throw httpError('openrouter', res.status, (await readErrorBody(res)).message)
  const body = (await res.json()) as { data: KeyInfo }
  return body.data
}

export const openrouter: ProviderClient = {
  // The model list is public, so it loads before the user has a key.
  async listModels(_apiKey, signal) {
    const res = await fetch(`${OPENROUTER_API}/models`, { signal })
    if (!res.ok) throw httpError('openrouter', res.status, (await readErrorBody(res)).message)
    const body = (await res.json()) as { data: ORModel[] }
    return body.data
      .filter((m) => {
        const out = m.architecture?.output_modalities
        return !out || out.includes('text') || out.includes('image')
      })
      .map(
        (m): ModelInfo => ({
          id: m.id,
          name: m.name,
          created: m.created,
          contextLength: m.context_length,
          pricing: m.pricing && { prompt: m.pricing.prompt, completion: m.pricing.completion },
          inputs: m.architecture?.input_modalities && {
            image: m.architecture.input_modalities.includes('image'),
            pdf: m.architecture.input_modalities.includes('file'),
          },
          outputs: m.architecture?.output_modalities?.includes('image')
            ? { image: true, text: m.architecture.output_modalities.includes('text') }
            : undefined,
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  async validateKey(apiKey, signal) {
    await fetchKeyInfo(apiKey, signal)
  },

  streamChat({ apiKey, model, modelInfo, messages, webSearch, signal }) {
    return streamChatCompletions({
      provider: 'openrouter',
      url: `${OPENROUTER_API}/chat/completions`,
      apiKey,
      body: {
        model,
        messages: toChatCompletionsMessages(messages),
        stream: true,
        usage: { include: true },
        // Image models only return images when asked for them.
        ...(makesImages(modelInfo) ? { modalities: modelInfo?.outputs?.text === false ? ['image'] : ['image', 'text'] } : {}),
        // OpenRouter's search tool: the model's own provider search where it has one, else Exa.
        ...(webSearch ? { tools: [{ type: 'openrouter:web_search' }] } : {}),
      },
      signal,
    })
  },
}
