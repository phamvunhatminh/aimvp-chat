import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'
import { makePng, makeWav } from './files'
import { FakeSupabase } from './supabase'

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
  {
    id: 'img/painter',
    name: 'Painter',
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['image', 'text'] },
  },
  { id: 'openai/broke', name: 'OpenAI: Out Of Credits', pricing: { prompt: '0.00000015', completion: '0.0000006' } },
  { id: 'audio/only', name: 'Audio Only', architecture: { output_modalities: ['audio'] } },
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

export const SEARCH_ANSWER = 'Here is what the web says.'

/** An SVG reply, with a script and a remote image that must never run or load. */
export const SVG_ANSWER = [
  'Here is a blue circle:',
  '',
  '```svg',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" onload="window.__svgPwned = true">',
  '  <script>window.__svgPwned = true</script>',
  '  <image href="https://evil.example/tracker.png" width="1" height="1"/>',
  '  <circle cx="32" cy="32" r="28" fill="#1e5adc"/>',
  '</svg>',
  '```',
].join('\n')

export const OAUTH_KEY = 'sk-or-v1-oauth-0123456789'

/** What the mocked image model "paints". */
export const PAINTED_PNG = makePng(32, 32, [30, 90, 220])

export interface OpenRouterMock {
  /** Parsed JSON bodies of chat completion requests, in order. */
  chatRequests: Record<string, unknown>[]
  keyExchanges: number
  /** OpenAI speech-to-text and text-to-speech requests. */
  audioRequests: { path: string; body: string }[]
  /** Chat requests sent straight to OpenAI, Anthropic or Google. */
  directRequests: { provider: string; url: string; headers: Record<string, string>; body: Record<string, unknown> }[]
}

export const DIRECT_ANSWER = 'Hello from a direct provider'
export const TRANSCRIPT = 'Words from the microphone'

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
    if (path.startsWith('/v1/audio/')) {
      mock.audioRequests.push({ path, body: request.postDataBuffer()?.toString('latin1') ?? '' })
      if (path === '/v1/audio/transcriptions') return route.fulfill({ json: { text: TRANSCRIPT }, headers })
      return route.fulfill({ body: makeWav(300), headers: { ...headers, 'Content-Type': 'audio/wav' } })
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

/** Mocks every AI provider in a browser context. */
export async function mockOpenRouter(context: BrowserContext): Promise<OpenRouterMock> {
  const mock: OpenRouterMock = { chatRequests: [], keyExchanges: 0, audioRequests: [], directRequests: [] }
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
      if (body.model === 'img/painter') {
        const image = `data:image/png;base64,${PAINTED_PNG.toString('base64')}`
        const chunk = { choices: [{ delta: { content: 'A blue square.', images: [{ image_url: { url: image } }] } }] }
        return route.fulfill({
          body: `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
          headers: { ...headers, 'Content-Type': 'text/event-stream' },
        })
      }
      if (body.tools?.some((t: { type: string }) => t.type === 'openrouter:web_search')) {
        const cite = (url: string, title: string) => ({ type: 'url_citation', url_citation: { url, title } })
        const chunk = {
          choices: [
            {
              delta: {
                content: SEARCH_ANSWER,
                annotations: [cite('https://news.example/today', 'Today in news'), cite('https://wiki.example/x', 'Wiki X')],
              },
            },
          ],
        }
        return route.fulfill({
          body: `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
          headers: { ...headers, 'Content-Type': 'text/event-stream' },
        })
      }
      if (JSON.stringify(body.messages).includes('Draw an SVG')) {
        return route.fulfill({ body: sse(SVG_ANSWER), headers: { ...headers, 'Content-Type': 'text/event-stream' } })
      }
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

export const test = base.extend<{ openrouter: OpenRouterMock; supabase: FakeSupabase }>({
  // Auto: no test may reach the real OpenRouter. (`provide` is Playwright's `use`, renamed for the hooks lint.)
  openrouter: [async ({ context }, provide) => provide(await mockOpenRouter(context)), { auto: true }],
  // The build's Supabase project, faked, so accounts work and nothing reaches a real one.
  supabase: [
    async ({ context }, provide) => {
      const supabase = new FakeSupabase()
      await supabase.attach(context)
      await provide(supabase)
    },
    { auto: true },
  ],
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

/** Starts the app with these settings (current format) already saved. */
export async function openWithSettings(page: Page, state: Record<string, unknown>, path = '/') {
  await page.addInitScript((state) => {
    if (localStorage.getItem('aimvp.settings')) return
    localStorage.setItem('aimvp.settings', JSON.stringify({ state: { theme: 'light', ...state }, version: 2 }))
  }, state)
  await page.goto(path)
}

/** The chat transcript. */
export const messages = (page: Page) => page.getByRole('region', { name: 'Messages' })

export const composer = (page: Page) => page.getByLabel('Message', { exact: true })
