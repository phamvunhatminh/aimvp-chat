import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettings } from '@/stores/settings'
import { useStreams } from '@/stores/streams'
import { contentChunk, dataEvent, jsonResponse, sseResponse } from '@/test/sse-response'
import { buildPrompt, editAndResend, regenerate, sendMessage, stopStreaming } from './chat'
import { db, type Message } from './db'
import { createConversation, getConversation, getMessages } from './repo'

beforeEach(async () => {
  await db.conversations.clear()
  await db.messages.clear()
  useSettings.setState({ apiKey: 'sk-test' })
  useStreams.setState({ controllers: {}, drafts: {} })
})

afterEach(() => vi.unstubAllGlobals())

const reply = (text: string) =>
  sseResponse([
    contentChunk(text),
    dataEvent({ choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 1, cost: 0.001 } }),
    'data: [DONE]\n\n',
  ])

const summary = (messages: Message[]) => messages.map((m) => [m.role, m.content, m.status])

describe('sendMessage', () => {
  it('stores the user message and the streamed reply, and titles the chat', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('Hi there!'))
    vi.stubGlobal('fetch', fetchMock)
    const c = await createConversation({ model: 'openai/gpt-test', systemPrompt: 'Be brief.' })

    await sendMessage(c.id, 'Hello\nsecond line')

    const messages = await getMessages(c.id)
    expect(summary(messages)).toEqual([
      ['user', 'Hello\nsecond line', 'done'],
      ['assistant', 'Hi there!', 'done'],
    ])
    expect(messages[1]).toMatchObject({ model: 'openai/gpt-test', usage: { promptTokens: 5, completionTokens: 1 } })
    expect((await getConversation(c.id))?.title).toBe('Hello')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Hello\nsecond line' },
    ])
    expect(useStreams.getState().controllers).toEqual({})
  })

  it('records API errors on the reply and replaces them on the next message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ error: { message: 'x' } }, 429)))
    const c = await createConversation({ model: 'm/x', systemPrompt: '' })
    await sendMessage(c.id, 'one')
    const [, failed] = await getMessages(c.id)
    expect(failed).toMatchObject({ status: 'error', error: expect.stringMatching(/Rate limited/) })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('ok')))
    await sendMessage(c.id, 'two')
    expect(summary(await getMessages(c.id))).toEqual([
      ['user', 'one', 'done'],
      ['user', 'two', 'done'],
      ['assistant', 'ok', 'done'],
    ])
  })

  it('records a missing key as an error without calling the API', async () => {
    useSettings.setState({ apiKey: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const c = await createConversation({ model: 'm/x', systemPrompt: '' })
    await sendMessage(c.id, 'hi')
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await getMessages(c.id))[1]).toMatchObject({ status: 'error' })
  })

  it('keeps the partial reply when stopped', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start: (c) => void (stream = c) })
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        // Like real fetch: aborting errors the body that is being read.
        init.signal?.addEventListener('abort', () => stream.error(new DOMException('Aborted', 'AbortError')))
        return Promise.resolve(new Response(body, { status: 200 }))
      }),
    )
    const c = await createConversation({ model: 'm/x', systemPrompt: '' })
    const done = sendMessage(c.id, 'hi')
    const replyId = await vi.waitFor(async () => {
      const [, assistant] = await getMessages(c.id)
      expect(assistant).toBeDefined()
      return assistant.id
    })
    stream.enqueue(new TextEncoder().encode(contentChunk('Partial')))
    await vi.waitFor(() => expect(useStreams.getState().drafts[replyId]?.content).toBe('Partial'))
    stopStreaming(c.id)
    await done
    expect(summary(await getMessages(c.id))).toEqual([
      ['user', 'hi', 'done'],
      ['assistant', 'Partial', 'done'],
    ])
  })

  it('drops the reply when stopped before anything arrived', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
          ),
      ),
    )
    const c = await createConversation({ model: 'm/x', systemPrompt: '' })
    const done = sendMessage(c.id, 'hi')
    await vi.waitFor(async () => expect(await getMessages(c.id)).toHaveLength(2))
    stopStreaming(c.id)
    await done
    expect(summary(await getMessages(c.id))).toEqual([['user', 'hi', 'done']])
  })
})

describe('regenerate and edit', () => {
  it('regenerate replaces the last reply', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply('first')).mockResolvedValueOnce(reply('second')))
    const c = await createConversation({ model: 'm/x', systemPrompt: '' })
    await sendMessage(c.id, 'q')
    await regenerate(c.id)
    expect(summary(await getMessages(c.id))).toEqual([
      ['user', 'q', 'done'],
      ['assistant', 'second', 'done'],
    ])
  })

  it('editing a message drops everything after it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply('a1'))
      .mockResolvedValueOnce(reply('a2'))
      .mockResolvedValueOnce(reply('a1-edited'))
    vi.stubGlobal('fetch', fetchMock)
    const c = await createConversation({ model: 'm/x', systemPrompt: '' })
    await sendMessage(c.id, 'q1')
    await sendMessage(c.id, 'q2')
    const [first] = await getMessages(c.id)
    await editAndResend(c.id, first.id, 'q1 edited')
    expect(summary(await getMessages(c.id))).toEqual([
      ['user', 'q1 edited', 'done'],
      ['assistant', 'a1-edited', 'done'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).messages).toEqual([{ role: 'user', content: 'q1 edited' }])
  })
})

describe('buildPrompt', () => {
  it('skips failed and empty replies and blank system prompts', () => {
    const m = (role: Message['role'], content: string, status: Message['status'] = 'done') =>
      ({ role, content, status }) as Message
    expect(
      buildPrompt('  ', [m('user', 'a'), m('assistant', 'oops', 'error'), m('assistant', ''), m('assistant', 'b')]),
    ).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ])
  })
})
