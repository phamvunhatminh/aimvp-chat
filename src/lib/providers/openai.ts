import { httpError, readErrorBody, type ApiErrorBody } from './errors'
import { streamChatCompletions } from './openai-compatible'
import type { ModelInfo, ProviderClient } from './types'

const OPENAI_API = 'https://api.openai.com/v1'

// /v1/models also lists embedding, audio, image and Responses-only models;
// keep the ones that work with streaming Chat Completions.
const CHAT_MODEL = /^(gpt-|chatgpt-|o\d)/
const NOT_CHAT = /(audio|realtime|transcribe|tts|image|embedding|moderation|instruct|codex|computer-use|deep-research|-pro\b)/

/** OpenAI reports an empty balance as 429 `insufficient_quota`. */
function normalizeStatus(status: number | null, error: ApiErrorBody) {
  return error.code === 'insufficient_quota' || error.type === 'insufficient_quota' ? 402 : status
}

export const openai: ProviderClient = {
  async listModels(apiKey, signal) {
    const res = await fetch(`${OPENAI_API}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal })
    if (!res.ok) {
      const error = await readErrorBody(res)
      throw httpError('openai', normalizeStatus(res.status, error), error.message)
    }
    const body = (await res.json()) as { data: { id: string; created?: number }[] }
    return body.data
      .filter((m) => CHAT_MODEL.test(m.id) && !NOT_CHAT.test(m.id))
      .map((m): ModelInfo => ({ id: m.id, name: m.id, created: m.created }))
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
  },

  async validateKey(apiKey, signal) {
    await openai.listModels(apiKey, signal)
  },

  streamChat({ apiKey, model, messages, signal }) {
    return streamChatCompletions({
      provider: 'openai',
      url: `${OPENAI_API}/chat/completions`,
      apiKey,
      body: { model, messages, stream: true, stream_options: { include_usage: true } },
      signal,
      normalizeStatus,
    })
  },
}
