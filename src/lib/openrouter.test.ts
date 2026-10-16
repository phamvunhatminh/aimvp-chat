import { afterEach, describe, expect, it, vi } from 'vitest'
import { contentChunk, dataEvent, jsonResponse, sseResponse } from '@/test/sse-response'
import { fetchKeyInfo, formatPricing, OpenRouterError, streamChat, type StreamEvent } from './openrouter'

async function collect(gen: AsyncGenerator<StreamEvent>) {
  const events: StreamEvent[] = []
  for await (const e of gen) events.push(e)
  return events
}

const opts = { apiKey: 'sk-test', model: 'openai/gpt-test', messages: [{ role: 'user' as const, content: 'hi' }] }

afterEach(() => vi.unstubAllGlobals())

describe('streamChat', () => {
  it('sends an authenticated streaming request and yields content, reasoning and usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        ': OPENROUTER PROCESSING\n\n',
        dataEvent({ choices: [{ delta: { reasoning: 'hmm' } }] }),
        contentChunk('Hel'),
        contentChunk('lo'),
        dataEvent({ choices: [{ delta: {} }], usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.0001 } }),
        'data: [DONE]\n\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    expect(await collect(streamChat(opts))).toEqual([
      { type: 'reasoning', text: 'hmm' },
      { type: 'content', text: 'Hel' },
      { type: 'content', text: 'lo' },
      { type: 'usage', usage: { promptTokens: 3, completionTokens: 2, cost: 0.0001 } },
    ])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(init.body)).toMatchObject({ model: 'openai/gpt-test', stream: true, messages: opts.messages })
  })

  it('maps HTTP errors to friendly messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'Insufficient credits' } }, 402)))
    const err = await collect(streamChat(opts)).catch((e) => e)
    expect(err).toBeInstanceOf(OpenRouterError)
    expect(err.status).toBe(402)
    expect(err.message).toMatch(/out of credits/)
  })

  it('flags 401 as an auth error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'No auth' } }, 401)))
    const err = await collect(streamChat(opts)).catch((e) => e)
    expect(err.isAuthError).toBe(true)
  })

  it('throws on an error chunk sent after the stream started', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          contentChunk('partial'),
          dataEvent({ error: { code: 502, message: 'Provider died' }, choices: [{ finish_reason: 'error' }] }),
        ]),
      ),
    )
    const events: StreamEvent[] = []
    const err = await (async () => {
      for await (const e of streamChat(opts)) events.push(e)
    })().catch((e) => e)
    expect(events).toEqual([{ type: 'content', text: 'partial' }])
    expect(err).toBeInstanceOf(OpenRouterError)
    expect(err.status).toBe(502)
  })

  it('skips malformed chunks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(['data: {oops\n\n', contentChunk('ok')])))
    expect(await collect(streamChat(opts))).toEqual([{ type: 'content', text: 'ok' }])
  })
})

describe('fetchKeyInfo', () => {
  it('returns the key data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { usage: 1.5, limit: null } })))
    expect(await fetchKeyInfo('sk-test')).toEqual({ usage: 1.5, limit: null })
  })
})

describe('formatPricing', () => {
  it('formats per-million prices', () => {
    expect(formatPricing({ pricing: { prompt: '0.000003', completion: '0.000015' } })).toBe('$3 / $15 per 1M')
    expect(formatPricing({ pricing: { prompt: '0.00000015', completion: '0.0000006' } })).toBe('$0.15 / $0.6 per 1M')
  })

  it('labels free models and hides variable pricing', () => {
    expect(formatPricing({ pricing: { prompt: '0', completion: '0' } })).toBe('Free')
    expect(formatPricing({ pricing: { prompt: '-1', completion: '-1' } })).toBeNull()
    expect(formatPricing({})).toBeNull()
  })
})
