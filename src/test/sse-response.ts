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

export function contentChunk(text: string): string {
  return dataEvent({ choices: [{ delta: { content: text } }] })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
