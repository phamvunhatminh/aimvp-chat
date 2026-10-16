import { readSSE } from '@/lib/sse'
import { httpError, ProviderError, readErrorBody, type ApiErrorBody } from './errors'
import type { ChatMessage, ModelInfo, ProviderClient, StreamEvent } from './types'

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta'

// Keep text chat models; skip embeddings, image/video/audio generation and live APIs.
const NOT_CHAT = /(embedding|imagen|veo|tts|image|aqa|live|native-audio|robotics|computer-use)/

interface GeminiModel {
  name: string
  displayName?: string
  inputTokenLimit?: number
  outputTokenLimit?: number
  supportedGenerationMethods?: string[]
}

interface GeminiChunk {
  error?: ApiErrorBody
  promptFeedback?: { blockReason?: string }
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
}

/** Gemini reports a bad key as 400 INVALID_ARGUMENT, and a disabled one as 403. */
function normalizeStatus(status: number | null, error: ApiErrorBody) {
  if (status === 400 && /api key/i.test(error.message ?? '')) return 401
  if (status === 403) return 401
  return status
}

async function geminiFetch(path: string, apiKey: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${GEMINI_API}${path}`, {
    ...init,
    headers: { 'x-goog-api-key': apiKey, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  if (!res.ok) {
    const error = await readErrorBody(res)
    throw httpError('google', normalizeStatus(res.status, error), error.message)
  }
  return res
}

/** Gemini wants alternating turns; join consecutive messages from the same side. */
export function toGeminiContents(messages: ChatMessage[]) {
  const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    const role = m.role === 'assistant' ? 'model' : 'user'
    const last = contents.at(-1)
    if (last?.role === role) last.parts.push({ text: m.content })
    else contents.push({ role, parts: [{ text: m.content }] })
  }
  return contents
}

const BLOCKED_FINISH = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'])

export const google: ProviderClient = {
  async listModels(apiKey, signal) {
    if (!apiKey) return []
    const models: ModelInfo[] = []
    let pageToken: string | undefined
    for (let page = 0; page < 10; page++) {
      const query = `?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
      const res = await geminiFetch(`/models${query}`, apiKey, { signal })
      const body = (await res.json()) as { models?: GeminiModel[]; nextPageToken?: string }
      for (const m of body.models ?? []) {
        const id = m.name.replace(/^models\//, '')
        if (!m.supportedGenerationMethods?.includes('generateContent') || NOT_CHAT.test(id)) continue
        models.push({
          id,
          name: m.displayName ?? id,
          contextLength: m.inputTokenLimit,
          maxOutputTokens: m.outputTokenLimit,
        })
      }
      pageToken = body.nextPageToken
      if (!pageToken) break
    }
    return models
  },

  async validateKey(apiKey, signal) {
    await geminiFetch('/models?pageSize=1', apiKey, { signal })
  },

  async *streamChat({ apiKey, model, messages, signal }): AsyncGenerator<StreamEvent> {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const res = await geminiFetch(`/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, apiKey, {
      method: 'POST',
      body: JSON.stringify({
        contents: toGeminiContents(messages),
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      }),
      signal,
    })
    if (!res.body) throw httpError('google', res.status, 'Gemini returned an empty response.')

    let wroteText = false
    let usage: GeminiChunk['usageMetadata']
    for await (const data of readSSE(res.body)) {
      let chunk: GeminiChunk
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      if (chunk.error) {
        const code = typeof chunk.error.code === 'number' ? chunk.error.code : null
        throw httpError('google', normalizeStatus(code, chunk.error), chunk.error.message)
      }
      if (chunk.promptFeedback?.blockReason) {
        throw new ProviderError(`Gemini blocked this request (${chunk.promptFeedback.blockReason}).`, null, 'google')
      }
      const candidate = chunk.candidates?.[0]
      for (const part of candidate?.content?.parts ?? []) {
        if (!part.text) continue
        if (part.thought) yield { type: 'reasoning', text: part.text }
        else {
          wroteText = true
          yield { type: 'content', text: part.text }
        }
      }
      if (chunk.usageMetadata) usage = chunk.usageMetadata
      if (candidate?.finishReason && BLOCKED_FINISH.has(candidate.finishReason) && !wroteText) {
        throw new ProviderError(`Gemini stopped the reply (${candidate.finishReason}).`, null, 'google')
      }
    }
    if (usage) {
      yield {
        type: 'usage',
        usage: {
          promptTokens: usage.promptTokenCount ?? 0,
          completionTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
        },
      }
    }
  },
}
