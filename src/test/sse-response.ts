/** Builds a streaming fetch Response from raw SSE text chunks. */
export function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' }, ...init })
}

export function dataEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/** A named SSE event, as the Anthropic API sends them. */
export function namedEvent(payload: { type: string }): string {
  return `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`
}

export function contentChunk(text: string): string {
  return dataEvent({ choices: [{ delta: { content: text } }] })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** An Anthropic Messages stream: optional thinking, then text, then the stop reason. */
export function anthropicStream(opts: {
  text: string[]
  thinking?: string
  stopReason?: string
  /** Extra usage on message_start, e.g. prompt cache reads and writes. */
  usage?: Record<string, number>
}): Response {
  const events: { type: string; [key: string]: unknown }[] = [
    {
      type: 'message_start',
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1, ...opts.usage },
      },
    },
  ]
  let index = 0
  if (opts.thinking) {
    events.push(
      { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: opts.thinking } },
      { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'sig' } },
      { type: 'content_block_stop', index },
    )
    index++
  }
  events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
  for (const text of opts.text) events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } })
  events.push(
    { type: 'content_block_stop', index },
    {
      type: 'message_delta',
      delta: { stop_reason: opts.stopReason ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: 5 },
    },
    { type: 'message_stop' },
  )
  return sseResponse(events.map(namedEvent))
}
