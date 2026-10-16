import { describe, expect, it } from 'vitest'
import { sseResponse } from '@/test/sse-response'
import { createSSEParser, readSSE } from './sse'

function parse(chunks: string[]): string[] {
  const events: string[] = []
  const parser = createSSEParser((data) => events.push(data))
  for (const chunk of chunks) parser.feed(chunk)
  parser.flush()
  return events
}

describe('createSSEParser', () => {
  it('emits one event per blank-line-terminated block', () => {
    expect(parse(['data: a\n\ndata: b\n\n'])).toEqual(['a', 'b'])
  })

  it('ignores comment lines such as OpenRouter keep-alives', () => {
    expect(parse([': OPENROUTER PROCESSING\n\ndata: {"x":1}\n\n'])).toEqual(['{"x":1}'])
  })

  it('reassembles lines split across chunks', () => {
    expect(parse(['da', 'ta: hel', 'lo\n', '\n'])).toEqual(['hello'])
  })

  it('handles CRLF, including a CR/LF pair split across chunks', () => {
    expect(parse(['data: a\r', '\n\r\ndata: b\r\n\r\n'])).toEqual(['a', 'b'])
  })

  it('joins multi-line data with newlines', () => {
    expect(parse(['data: one\ndata: two\n\n'])).toEqual(['one\ntwo'])
  })

  it('ignores other fields and strips only one leading space', () => {
    expect(parse(['event: message\nid: 1\ndata:  spaced\n\n'])).toEqual([' spaced'])
  })

  it('flushes a final event without a trailing blank line', () => {
    expect(parse(['data: last'])).toEqual(['last'])
  })
})

describe('readSSE', () => {
  it('yields data payloads from a response body', async () => {
    const res = sseResponse(['data: 1\n\n', ': ping\n\ndata: 2\n', '\ndata: [DONE]\n\n'])
    const out: string[] = []
    for await (const data of readSSE(res.body!)) out.push(data)
    expect(out).toEqual(['1', '2', '[DONE]'])
  })

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: Xin chào\n\n')
    const split = bytes.indexOf(0xc3) + 1 // in the middle of "à"
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, split))
        c.enqueue(bytes.slice(split))
        c.close()
      },
    })
    const out: string[] = []
    for await (const data of readSSE(body)) out.push(data)
    expect(out).toEqual(['Xin chào'])
  })
})
