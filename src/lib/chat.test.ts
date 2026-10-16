import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettings } from '@/stores/settings'
import { useStreams } from '@/stores/streams'
import { contentChunk, dataEvent, jsonResponse, sseResponse } from '@/test/sse-response'
import { buildPrompt, editAndResend, regenerate, sendMessage, stopStreaming } from './chat'
import { db, type Message } from './db'
import type { PreparedFile } from './files'
import { createConversation, createProject, deleteConversation, getConversation, getMessages } from './repo'

beforeEach(async () => {
  await db.blobs.clear()
  await db.projects.clear()
  await db.conversations.clear()
  await db.messages.clear()
  useSettings.setState({ apiKeys: { openrouter: 'sk-test' } })
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
    const c = await createConversation({ model: 'openrouter:openai/gpt-test', systemPrompt: 'Be brief.' })

    await sendMessage(c.id, 'Hello\nsecond line')

    const messages = await getMessages(c.id)
    expect(summary(messages)).toEqual([
      ['user', 'Hello\nsecond line', 'done'],
      ['assistant', 'Hi there!', 'done'],
    ])
    expect(messages[1]).toMatchObject({
      model: 'openrouter:openai/gpt-test',
      usage: { promptTokens: 5, completionTokens: 1 },
    })
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

  it("records a missing key for the model's provider without calling any API", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const c = await createConversation({ model: 'anthropic:claude-opus-5-5', systemPrompt: '' })
    await sendMessage(c.id, 'hi')
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await getMessages(c.id))[1]).toMatchObject({
      status: 'error',
      error: 'Add your Anthropic API key in Settings to use this model.',
    })
  })

  it("routes to the model's provider with that provider's key", async () => {
    useSettings.setState({ apiKeys: { openrouter: 'sk-or', openai: 'sk-openai' } })
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([contentChunk('from OpenAI'), 'data: [DONE]\n\n']),
    )
    vi.stubGlobal('fetch', fetchMock)
    const c = await createConversation({ model: 'openai:gpt-5', systemPrompt: '' })
    await sendMessage(c.id, 'hi')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-openai')
    expect(JSON.parse(init.body).model).toBe('gpt-5')
    expect((await getMessages(c.id))[1]).toMatchObject({ content: 'from OpenAI', model: 'openai:gpt-5' })
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

describe('projects', () => {
  it("sends the project's instructions before the chat's system prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const project = await createProject({ name: 'Work', instructions: 'You help with work.' })
    const c = await createConversation({ model: 'm/x', systemPrompt: 'Be brief.', projectId: project.id })
    await sendMessage(c.id, 'hi')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages).toEqual([
      { role: 'system', content: 'You help with work.\n\nBe brief.' },
      { role: 'user', content: 'hi' },
    ])
  })
})

describe('attachments', () => {
  const image: PreparedFile = {
    attachment: { id: 'img', kind: 'image', name: 'cat.jpg', mimeType: 'image/jpeg', size: 3, text: '', width: 1, height: 1 },
    data: new Uint8Array([1, 2, 3]).buffer,
  }
  const pdf: PreparedFile = {
    attachment: { id: 'pdf', kind: 'file', name: 'spec.pdf', mimeType: 'application/pdf', size: 4, text: 'PDF text' },
    data: new Uint8Array([37, 80, 68, 70]).buffer,
  }
  const notes: PreparedFile = {
    attachment: { id: 'txt', kind: 'file', name: 'notes.md', mimeType: 'text/markdown', size: 5, text: 'hello' },
    data: null,
  }

  it('stores files and sends them with the message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const c = await createConversation({ model: 'm/x', systemPrompt: '' })
    await sendMessage(c.id, 'What is this?', [image, pdf, notes])

    const [user] = await getMessages(c.id)
    expect(user.attachments.map((a) => [a.name, a.blobId !== null])).toEqual([
      ['cat.jpg', true],
      ['spec.pdf', true],
      ['notes.md', false],
    ])
    expect(await db.blobs.count()).toBe(2)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQID' } },
      { type: 'text', text: '<file name="spec.pdf">\nPDF text\n</file>' },
      { type: 'text', text: '<file name="notes.md">\nhello\n</file>' },
      { type: 'text', text: 'What is this?' },
    ])
  })

  it('titles a files-only chat after the first file and deletes stored files with the chat', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('ok')))
    const c = await createConversation({ model: 'm/x', systemPrompt: '' })
    await sendMessage(c.id, '', [image])
    expect((await getConversation(c.id))?.title).toBe('cat.jpg')
    expect(await db.blobs.count()).toBe(1)
    await deleteConversation(c.id)
    expect(await db.blobs.count()).toBe(0)
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
  it('skips failed and empty replies and blank system prompts', async () => {
    const m = (role: Message['role'], content: string, status: Message['status'] = 'done') =>
      ({ role, content, status }) as Message
    expect(
      await buildPrompt(['  ', ''], [m('user', 'a'), m('assistant', 'oops', 'error'), m('assistant', ''), m('assistant', 'b')]),
    ).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ])
  })
})
