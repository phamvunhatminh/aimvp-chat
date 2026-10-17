import { readSSE } from '@/lib/sse'
import { httpError, ProviderError, readErrorBody, type ApiErrorBody } from './errors'
import {
  makesImages,
  textOf,
  toSource,
  type ChatMessage,
  type ModelInfo,
  type ProviderClient,
  type StreamEvent,
} from './types'

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta'

// Keep text and image chat models; skip embeddings, Imagen/Veo (other APIs), audio and live models.
const NOT_CHAT = /(embedding|imagen|veo|tts|aqa|live|native-audio|robotics|computer-use)/
/** Gemini models that can answer with images, e.g. gemini-2.5-flash-image. */
const IMAGE_MODEL = /-image/

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
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string } }[] }
    finishReason?: string
    /** Pages Google Search found, when grounding is on. */
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] }
  }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
    /** Prompt tokens served from Gemini's implicit cache. */
    cachedContentTokenCount?: number
  }
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

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

function toGeminiParts(content: ChatMessage['content']): GeminiPart[] {
  if (typeof content === 'string') return [{ text: content }]
  return content.map((p): GeminiPart => {
    if (p.type === 'image') return { inlineData: { mimeType: p.mimeType, data: p.data } }
    if (p.type === 'document') return { inlineData: { mimeType: 'application/pdf', data: p.data } }
    return { text: p.text }
  })
}

/** Gemini wants alternating turns; join consecutive messages from the same side. */
export function toGeminiContents(messages: ChatMessage[]) {
  const contents: { role: 'user' | 'model'; parts: GeminiPart[] }[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    const role = m.role === 'assistant' ? 'model' : 'user'
    const last = contents.at(-1)
    if (last?.role === role) last.parts.push(...toGeminiParts(m.content))
    else contents.push({ role, parts: toGeminiParts(m.content) })
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
          // Gemini models are multimodal: images and PDFs as inline data.
          inputs: { image: true, pdf: true },
          outputs: IMAGE_MODEL.test(id) ? { image: true, text: true } : undefined,
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

  async *streamChat({ apiKey, model, modelInfo, messages, webSearch, signal }): AsyncGenerator<StreamEvent> {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => textOf(m.content))
      .join('\n\n')
    const makesImage = makesImages(modelInfo) || IMAGE_MODEL.test(model)
    const res = await geminiFetch(`/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, apiKey, {
      method: 'POST',
      body: JSON.stringify({
        contents: toGeminiContents(messages),
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(makesImage ? { generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } } : {}),
        ...(webSearch && !makesImage ? { tools: [{ google_search: {} }] } : {}),
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
        if (part.inlineData?.data) {
          wroteText = true
          yield { type: 'image', mimeType: part.inlineData.mimeType ?? 'image/png', data: part.inlineData.data }
          continue
        }
        if (!part.text) continue
        if (part.thought) yield { type: 'reasoning', text: part.text }
        else {
          wroteText = true
          yield { type: 'content', text: part.text }
        }
      }
      // Titles are the sites' domains; the links go through Google's redirector.
      const sources = (candidate?.groundingMetadata?.groundingChunks ?? []).flatMap(
        (c) => toSource(c.web?.uri, c.web?.title) ?? [],
      )
      if (sources.length) yield { type: 'sources', sources }
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
          cachedTokens: usage.cachedContentTokenCount,
        },
      }
    }
  },
}
