/**
 * Minimal Server-Sent Events parser (https://html.spec.whatwg.org/multipage/server-sent-events.html).
 * Only `data` fields matter for chat completions; comment lines such as
 * `: OPENROUTER PROCESSING` keep-alives are ignored.
 */
export function createSSEParser(onData: (data: string) => void) {
  let buffer = ''
  let dataLines: string[] = []

  function dispatch() {
    if (dataLines.length > 0) onData(dataLines.join('\n'))
    dataLines = []
  }

  function processLine(line: string) {
    if (line === '') return dispatch()
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') dataLines.push(value)
  }

  return {
    feed(chunk: string) {
      buffer += chunk
      // A trailing "\r" may be the first half of "\r\n": wait for the next chunk.
      const holdCR = buffer.endsWith('\r')
      const lines = (holdCR ? buffer.slice(0, -1) : buffer).split(/\r\n|\r|\n/)
      // The last element is an incomplete line; keep it for the next chunk.
      buffer = (lines.pop() ?? '') + (holdCR ? '\r' : '')
      for (const line of lines) processLine(line)
    },
    flush() {
      const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
      if (line !== '') processLine(line)
      buffer = ''
      dispatch()
    },
  }
}

/** Yields the `data` payload of each event in an SSE response body. */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const queue: string[] = []
  const parser = createSSEParser((data) => queue.push(data))
  const decoder = new TextDecoder()
  const reader = body.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      parser.feed(decoder.decode(value, { stream: true }))
      while (queue.length > 0) yield queue.shift()!
    }
    parser.feed(decoder.decode())
    parser.flush()
    while (queue.length > 0) yield queue.shift()!
  } finally {
    // No-op when the stream already ended; stops the download if the consumer bailed early.
    reader.cancel().catch(() => {})
  }
}
