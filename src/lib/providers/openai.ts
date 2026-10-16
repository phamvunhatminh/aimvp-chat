import { readSSE } from '@/lib/sse'
import { httpError, readErrorBody, type ApiErrorBody } from './errors'
import { sourcesOf, streamChatCompletions, toChatCompletionsMessages, type Annotation } from './openai-compatible'
import {
  textOf,
  type ChatMessage,
  type ChatRequest,
  type ModelInfo,
  type ProviderClient,
  type StreamEvent,
} from './types'

const OPENAI_API = 'https://api.openai.com/v1'

// /v1/models also lists embedding, audio, image and Responses-only models;
// keep the ones that work with streaming Chat Completions.
const CHAT_MODEL = /^(gpt-|chatgpt-|o\d)/
const NOT_CHAT = /(audio|realtime|transcribe|tts|image|embedding|moderation|instruct|codex|computer-use|deep-research|-pro\b)/
/** Models served by the Images API instead of Chat Completions. */
const IMAGE_MODEL = /^(gpt-image|dall-e-3)/

// OpenAI's model list carries no capabilities; these families accept images.
const VISION_MODEL = /^(gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|chatgpt-4o|o1(?!-mini)|o3|o4)/

/** OpenAI reports an empty balance as 429 `insufficient_quota`. */
function normalizeStatus(status: number | null, error: ApiErrorBody) {
  return error.code === 'insufficient_quota' || error.type === 'insufficient_quota' ? 402 : status
}

async function openaiFetch(path: string, apiKey: string, init: RequestInit = {}) {
  const res = await fetch(`${OPENAI_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      // FormData bodies set their own multipart Content-Type.
      ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (!res.ok) {
    const error = await readErrorBody(res)
    throw httpError('openai', normalizeStatus(res.status, error), error.message)
  }
  return res
}

/** One image from the Images API, prompted by the latest user message. */
async function* generateImage({ apiKey, model, messages, signal }: ChatRequest): AsyncGenerator<StreamEvent> {
  const lastUser = messages.findLast((m) => m.role === 'user')
  const prompt = lastUser ? textOf(lastUser.content).trim() : ''
  if (!prompt) throw httpError('openai', 400, 'Describe the image you want in your message.')
  const res = await openaiFetch('/images/generations', apiKey, {
    method: 'POST',
    // dall-e-3 returns a URL unless asked for base64; gpt-image models always return base64.
    body: JSON.stringify({ model, prompt, n: 1, ...(model.startsWith('dall-e') ? { response_format: 'b64_json' } : {}) }),
    signal,
  })
  const body = (await res.json()) as {
    data?: { b64_json?: string; revised_prompt?: string }[]
    output_format?: string
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const image = body.data?.[0]
  if (!image?.b64_json) throw httpError('openai', null, 'OpenAI did not return an image.')
  if (image.revised_prompt) yield { type: 'content', text: `_${image.revised_prompt}_` }
  yield { type: 'image', mimeType: `image/${body.output_format ?? 'png'}`, data: image.b64_json }
  if (body.usage) {
    yield {
      type: 'usage',
      usage: { promptTokens: body.usage.input_tokens ?? 0, completionTokens: body.usage.output_tokens ?? 0 },
    }
  }
}

/** Responses API input: same turns, with its own content part types. */
export function toResponsesInput(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === 'string'
        ? m.content
        : m.content.map((p) => {
            if (p.type === 'image') return { type: 'input_image', image_url: `data:${p.mimeType};base64,${p.data}` }
            if (p.type === 'document') {
              return { type: 'input_file', filename: p.name, file_data: `data:application/pdf;base64,${p.data}` }
            }
            return { type: m.role === 'assistant' ? 'output_text' : 'input_text', text: p.text }
          }),
  }))
}

interface ResponsesEvent {
  type: string
  delta?: string
  annotation?: Annotation
  response?: {
    usage?: { input_tokens?: number; output_tokens?: number }
    error?: { message?: string } | null
    output?: { content?: { annotations?: Annotation[] }[] }[]
  }
  message?: string
}

/**
 * Web search needs OpenAI's Responses API (Chat Completions only searches with the
 * `*-search-*` models), so searching replies stream from there.
 */
async function* streamWithWebSearch({ apiKey, model, messages, signal }: ChatRequest): AsyncGenerator<StreamEvent> {
  const res = await openaiFetch('/responses', apiKey, {
    method: 'POST',
    body: JSON.stringify({ model, input: toResponsesInput(messages), tools: [{ type: 'web_search' }], stream: true }),
    signal,
  })
  if (!res.body) throw httpError('openai', res.status, 'OpenAI returned an empty response.')
  let cited = false
  for await (const data of readSSE(res.body)) {
    let event: ResponsesEvent
    try {
      event = JSON.parse(data)
    } catch {
      continue
    }
    if (event.type === 'response.output_text.delta' && event.delta) yield { type: 'content', text: event.delta }
    else if (event.type === 'response.reasoning_summary_text.delta' && event.delta) {
      yield { type: 'reasoning', text: event.delta }
    } else if (event.type === 'response.output_text.annotation.added') {
      const sources = sourcesOf(event.annotation ? [event.annotation] : [])
      if (sources.length) {
        cited = true
        yield { type: 'sources', sources }
      }
    } else if (event.type === 'response.completed') {
      if (!cited) {
        const annotations = event.response?.output?.flatMap((o) => o.content?.flatMap((c) => c.annotations ?? []) ?? [])
        const sources = sourcesOf(annotations)
        if (sources.length) yield { type: 'sources', sources }
      }
      const usage = event.response?.usage
      if (usage) {
        yield { type: 'usage', usage: { promptTokens: usage.input_tokens ?? 0, completionTokens: usage.output_tokens ?? 0 } }
      }
    } else if (event.type === 'response.failed' || event.type === 'error') {
      throw httpError('openai', null, event.response?.error?.message ?? event.message ?? 'OpenAI stopped the reply.')
    }
  }
}

export const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe'
export const SPEECH_MODEL = 'gpt-4o-mini-tts'
/** Speech to text. `language` (e.g. `vi-VN`) is a hint; empty lets the model detect it. */
export async function transcribeAudio(apiKey: string, audio: Blob, language: string, signal?: AbortSignal) {
  const form = new FormData()
  // OpenAI reads the format from the file extension: audio/webm;codecs=opus → speech.webm.
  form.append('file', audio, `speech.${audio.type.split(/[/;]/)[1] || 'webm'}`)
  form.append('model', TRANSCRIBE_MODEL)
  if (language) form.append('language', language.split('-')[0])
  const res = await openaiFetch('/audio/transcriptions', apiKey, { method: 'POST', body: form, signal })
  return ((await res.json()) as { text?: string }).text?.trim() ?? ''
}

/** Text to speech, as MP3. Input is limited to 4096 characters. */
export async function synthesizeSpeech(apiKey: string, input: string, voice: string, signal?: AbortSignal) {
  const res = await openaiFetch('/audio/speech', apiKey, {
    method: 'POST',
    body: JSON.stringify({ model: SPEECH_MODEL, voice, input, response_format: 'mp3' }),
    signal,
  })
  return res.blob()
}

export const openai: ProviderClient = {
  async listModels(apiKey, signal) {
    const res = await openaiFetch('/models', apiKey ?? '', { signal })
    const body = (await res.json()) as { data: { id: string; created?: number }[] }
    return body.data
      .flatMap((m): ModelInfo[] => {
        if (IMAGE_MODEL.test(m.id)) {
          return [{ id: m.id, name: m.id, created: m.created, outputs: { image: true, text: false } }]
        }
        if (!CHAT_MODEL.test(m.id) || NOT_CHAT.test(m.id)) return []
        return [{ id: m.id, name: m.id, created: m.created, inputs: { image: VISION_MODEL.test(m.id) } }]
      })
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
  },

  async validateKey(apiKey, signal) {
    await openai.listModels(apiKey, signal)
  },

  streamChat(request) {
    if (IMAGE_MODEL.test(request.model)) return generateImage(request)
    if (request.webSearch) return streamWithWebSearch(request)
    const { apiKey, model, messages, signal } = request
    return streamChatCompletions({
      provider: 'openai',
      url: `${OPENAI_API}/chat/completions`,
      apiKey,
      body: { model, messages: toChatCompletionsMessages(messages), stream: true, stream_options: { include_usage: true } },
      signal,
      normalizeStatus,
    })
  },
}
