import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  anthropicStream,
  contentChunk,
  dataEvent,
  jsonResponse,
  namedEvent,
  sseResponse,
} from '@/test/sse-response'
import { anthropic } from './anthropic'
import { ProviderError } from './errors'
import { google, toGeminiContents } from './google'
import { normalizeModelRef, parseModelRef } from './models'
import { openai } from './openai'
import { fetchKeyInfo, openrouter } from './openrouter'
import type { ChatRequest, ProviderClient, StreamEvent } from './types'

async function collect(client: ProviderClient, request: ChatRequest) {
  const events: StreamEvent[] = []
  for await (const e of client.streamChat(request)) events.push(e)
  return events
}

/** Runs a stream and returns the events seen before it failed, plus the error. */
async function collectUntilError(client: ProviderClient, request: ChatRequest) {
  const events: StreamEvent[] = []
  try {
    for await (const e of client.streamChat(request)) events.push(e)
  } catch (error) {
    return { events, error: error as ProviderError }
  }
  throw new Error('expected the stream to fail')
}

const messages = [
  { role: 'system' as const, content: 'Be brief.' },
  { role: 'user' as const, content: 'hi' },
]

function mockFetch(...responses: Response[]) {
  const fn = vi.fn()
  for (const r of responses) fn.mockResolvedValueOnce(r)
  vi.stubGlobal('fetch', fn)
  return fn
}

const requestOf = (fn: ReturnType<typeof vi.fn>, call = 0) => {
  const [input, init = {}] = fn.mock.calls[call] as [string | URL | Request, RequestInit | undefined]
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  return {
    url,
    headers: new Headers(init.headers),
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('model references', () => {
  it('parses provider-prefixed references', () => {
    expect(parseModelRef('anthropic:claude-opus-5-5')).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' })
    expect(parseModelRef('google:gemini-2.5-flash')).toEqual({ provider: 'google', model: 'gemini-2.5-flash' })
  })

  it('treats unprefixed and unknown-prefix ids as OpenRouter ids', () => {
    expect(parseModelRef('openrouter/auto')).toEqual({ provider: 'openrouter', model: 'openrouter/auto' })
    expect(parseModelRef('meta-llama/llama-3:free')).toEqual({ provider: 'openrouter', model: 'meta-llama/llama-3:free' })
    expect(normalizeModelRef('openai/gpt-4o')).toBe('openrouter:openai/gpt-4o')
    expect(normalizeModelRef('openai:gpt-5')).toBe('openai:gpt-5')
  })
})

describe('OpenRouter', () => {
  it('lists text models sorted by name', async () => {
    mockFetch(
      jsonResponse({
        data: [
          { id: 'b/x', name: 'Zeta', architecture: { output_modalities: ['text'] } },
          { id: 'a/y', name: 'Alpha' },
          { id: 'img/z', name: 'Image', architecture: { output_modalities: ['image'] } },
        ],
      }),
    )
    expect((await openrouter.listModels(null)).map((m) => m.id)).toEqual(['a/y', 'b/x'])
  })

  it('streams content, reasoning and usage with cost', async () => {
    const fetchMock = mockFetch(
      sseResponse([
        ': OPENROUTER PROCESSING\n\n',
        dataEvent({ choices: [{ delta: { reasoning: 'hmm' } }] }),
        contentChunk('Hel'),
        contentChunk('lo'),
        dataEvent({ choices: [{ delta: {} }], usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.0001 } }),
        'data: [DONE]\n\n',
      ]),
    )
    expect(await collect(openrouter, { apiKey: 'sk-or', model: 'a/b', messages })).toEqual([
      { type: 'reasoning', text: 'hmm' },
      { type: 'content', text: 'Hel' },
      { type: 'content', text: 'lo' },
      { type: 'usage', usage: { promptTokens: 3, completionTokens: 2, cost: 0.0001 } },
    ])
    const req = requestOf(fetchMock)
    expect(req.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(req.headers.get('Authorization')).toBe('Bearer sk-or')
    expect(req.body).toMatchObject({ model: 'a/b', stream: true, messages })
  })

  it('maps HTTP and mid-stream errors', async () => {
    mockFetch(jsonResponse({ error: { message: 'Insufficient credits' } }, 402))
    const credits = await collectUntilError(openrouter, { apiKey: 'k', model: 'a/b', messages })
    expect(credits.error.message).toMatch(/OpenRouter account is out of credits/)

    mockFetch(sseResponse([contentChunk('partial'), dataEvent({ error: { code: 502, message: 'Provider died' } })]))
    const midStream = await collectUntilError(openrouter, { apiKey: 'k', model: 'a/b', messages })
    expect(midStream.events).toEqual([{ type: 'content', text: 'partial' }])
    expect(midStream.error.status).toBe(502)
  })

  it('flags a bad key as an auth error', async () => {
    mockFetch(jsonResponse({ error: { message: 'No auth' } }, 401))
    const { error } = await collectUntilError(openrouter, { apiKey: 'k', model: 'a/b', messages })
    expect(error.isAuthError).toBe(true)
  })

  it('reads key credits', async () => {
    mockFetch(jsonResponse({ data: { usage: 1.5, limit: null } }))
    expect(await fetchKeyInfo('sk')).toEqual({ usage: 1.5, limit: null })
  })
})

describe('OpenAI', () => {
  it('lists only chat models, newest first', async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        data: [
          { id: 'gpt-4o-mini', created: 100 },
          { id: 'gpt-5', created: 300 },
          { id: 'o3', created: 200 },
          { id: 'text-embedding-3-large', created: 400 },
          { id: 'whisper-1', created: 400 },
          { id: 'gpt-4o-audio-preview', created: 400 },
          { id: 'gpt-4o-realtime-preview', created: 400 },
          { id: 'gpt-image-1', created: 400 },
          { id: 'o1-pro', created: 400 },
          { id: 'dall-e-3', created: 400 },
          { id: 'gpt-3.5-turbo-instruct', created: 400 },
        ],
      }),
    )
    expect((await openai.listModels('sk')).map((m) => m.id)).toEqual(['gpt-5', 'o3', 'gpt-4o-mini'])
    expect(requestOf(fetchMock).headers.get('Authorization')).toBe('Bearer sk')
  })

  it('streams Chat Completions with usage included', async () => {
    const fetchMock = mockFetch(
      sseResponse([
        contentChunk('Hi'),
        dataEvent({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 1 } }),
        'data: [DONE]\n\n',
      ]),
    )
    expect(await collect(openai, { apiKey: 'sk', model: 'gpt-5', messages })).toEqual([
      { type: 'content', text: 'Hi' },
      { type: 'usage', usage: { promptTokens: 4, completionTokens: 1, cost: undefined } },
    ])
    const req = requestOf(fetchMock)
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(req.body).toEqual({ model: 'gpt-5', messages, stream: true, stream_options: { include_usage: true } })
  })

  it('reports an empty balance as out of credits', async () => {
    mockFetch(jsonResponse({ error: { message: 'You exceeded your quota', code: 'insufficient_quota' } }, 429))
    const { error } = await collectUntilError(openai, { apiKey: 'sk', model: 'gpt-5', messages })
    expect(error.status).toBe(402)
    expect(error.message).toMatch(/OpenAI account is out of credits/)
  })

  it('validates keys against the models endpoint', async () => {
    mockFetch(jsonResponse({ error: { message: 'Incorrect API key' } }, 401))
    await expect(openai.validateKey('bad')).rejects.toMatchObject({ status: 401 })
  })
})

describe('Anthropic', () => {
  it('lists models with output limits and thinking support', async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        data: [
          {
            type: 'model',
            id: 'claude-opus-5-5',
            display_name: 'Claude Opus 5.5',
            created_at: '2026-09-01T00:00:00Z',
            max_input_tokens: 1_000_000,
            max_tokens: 128_000,
            capabilities: { thinking: { supported: true, types: { adaptive: { supported: true } } } },
          },
          {
            type: 'model',
            id: 'claude-haiku-4-5',
            display_name: 'Claude Haiku 4.5',
            created_at: '2025-10-01T00:00:00Z',
            max_input_tokens: 200_000,
            max_tokens: 64_000,
            capabilities: { thinking: { supported: true, types: { adaptive: { supported: false } } } },
          },
        ],
        has_more: false,
        first_id: 'claude-opus-5-5',
        last_id: 'claude-haiku-4-5',
      }),
    )
    const models = await anthropic.listModels('sk-ant')
    expect(models).toMatchObject([
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', maxOutputTokens: 128_000, reasoning: true },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', maxOutputTokens: 64_000, reasoning: false },
    ])
    const req = requestOf(fetchMock)
    expect(req.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models\?limit=1000/)
    expect(req.headers.get('x-api-key')).toBe('sk-ant')
    expect(req.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')
  })

  it('streams thinking and text, sending the system prompt separately', async () => {
    const fetchMock = mockFetch(anthropicStream({ thinking: 'Let me think', text: ['Hel', 'lo'] }))
    const events = await collect(anthropic, {
      apiKey: 'sk-ant',
      model: 'claude-opus-5-5',
      modelInfo: { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', maxOutputTokens: 128_000, reasoning: true },
      messages,
    })
    expect(events).toEqual([
      { type: 'reasoning', text: 'Let me think' },
      { type: 'content', text: 'Hel' },
      { type: 'content', text: 'lo' },
      { type: 'usage', usage: { promptTokens: 10, completionTokens: 5 } },
    ])
    const req = requestOf(fetchMock)
    expect(req.url).toBe('https://api.anthropic.com/v1/messages')
    expect(req.headers.get('anthropic-version')).toBe('2023-06-01')
    expect(req.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 64_000,
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'hi' }],
      thinking: { type: 'adaptive', display: 'summarized' },
      stream: true,
    })
  })

  it('omits thinking and uses a safe max_tokens for unknown models', async () => {
    const fetchMock = mockFetch(anthropicStream({ text: ['ok'] }))
    await collect(anthropic, { apiKey: 'k', model: 'claude-custom', messages: [{ role: 'user', content: 'hi' }] })
    const { body } = requestOf(fetchMock)
    expect(body.max_tokens).toBe(16_000)
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('system')
  })

  it('maps auth, billing and overload errors', async () => {
    mockFetch(jsonResponse({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401))
    const auth = await collectUntilError(anthropic, { apiKey: 'bad', model: 'm', messages })
    expect(auth.error).toBeInstanceOf(ProviderError)
    expect(auth.error.isAuthError).toBe(true)

    mockFetch(
      jsonResponse(
        { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } },
        400,
      ),
    )
    const billing = await collectUntilError(anthropic, { apiKey: 'k', model: 'm', messages })
    expect(billing.error.message).toMatch(/Anthropic account is out of credits/)

    mockFetch(
      sseResponse([
        namedEvent({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } as { type: string }),
      ]),
    )
    const overloaded = await collectUntilError(anthropic, { apiKey: 'k', model: 'm', messages })
    expect(overloaded.error.message).toMatch(/Anthropic is unavailable or overloaded/)
  })

  it('turns a refusal into an error after keeping the partial text', async () => {
    mockFetch(anthropicStream({ text: ['I can'], stopReason: 'refusal' }))
    const { events, error } = await collectUntilError(anthropic, { apiKey: 'k', model: 'm', messages })
    expect(events[0]).toEqual({ type: 'content', text: 'I can' })
    expect(error.message).toMatch(/declined/)
  })
})

describe('Google Gemini', () => {
  it('lists generateContent models across pages', async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        models: [
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            outputTokenLimit: 65536,
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/imagen-4.0-generate', supportedGenerationMethods: ['generateContent'] },
        ],
        nextPageToken: 'p2',
      }),
      jsonResponse({
        models: [
          { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
        ],
      }),
    )
    expect((await google.listModels('AIza')).map((m) => [m.id, m.name])).toEqual([
      ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
      ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
    ])
    expect(requestOf(fetchMock).headers.get('x-goog-api-key')).toBe('AIza')
    expect(requestOf(fetchMock, 1).url).toContain('pageToken=p2')
  })

  it('streams text and thoughts with the system instruction and merged turns', async () => {
    const fetchMock = mockFetch(
      sseResponse([
        dataEvent({ candidates: [{ content: { parts: [{ text: 'Thinking…', thought: true }] } }] }),
        dataEvent({ candidates: [{ content: { parts: [{ text: 'Hel' }] } }] }),
        dataEvent({
          candidates: [{ content: { parts: [{ text: 'lo' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, thoughtsTokenCount: 3 },
        }),
      ]),
    )
    const events = await collect(google, {
      apiKey: 'AIza',
      model: 'gemini-2.5-flash',
      messages: [...messages, { role: 'user', content: 'again' }],
    })
    expect(events).toEqual([
      { type: 'reasoning', text: 'Thinking…' },
      { type: 'content', text: 'Hel' },
      { type: 'content', text: 'lo' },
      { type: 'usage', usage: { promptTokens: 7, completionTokens: 5 } },
    ])
    const req = requestOf(fetchMock)
    expect(req.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    )
    expect(req.body).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'hi' }, { text: 'again' }] }],
      systemInstruction: { parts: [{ text: 'Be brief.' }] },
    })
  })

  it('treats an invalid key as an auth error', async () => {
    mockFetch(jsonResponse({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 400))
    const { error } = await collectUntilError(google, { apiKey: 'bad', model: 'gemini-2.5-flash', messages })
    expect(error.isAuthError).toBe(true)
    expect(error.message).toMatch(/Google Gemini API key is invalid/)
  })

  it('reports blocked prompts and replies', async () => {
    mockFetch(sseResponse([dataEvent({ promptFeedback: { blockReason: 'SAFETY' } })]))
    const prompt = await collectUntilError(google, { apiKey: 'k', model: 'g', messages })
    expect(prompt.error.message).toMatch(/blocked this request \(SAFETY\)/)

    mockFetch(sseResponse([dataEvent({ candidates: [{ finishReason: 'SAFETY' }] })]))
    const reply = await collectUntilError(google, { apiKey: 'k', model: 'g', messages })
    expect(reply.error.message).toMatch(/stopped the reply \(SAFETY\)/)
  })

  it('maps roles to user/model', () => {
    expect(
      toGeminiContents([
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ]),
    ).toEqual([
      { role: 'user', parts: [{ text: 'a' }] },
      { role: 'model', parts: [{ text: 'b' }] },
    ])
  })
})
