import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'

export const MODELS = [
  { id: 'openrouter/auto', name: 'Auto Router', pricing: { prompt: '-1', completion: '-1' } },
  { id: 'anthropic/claude-test', name: 'Anthropic: Claude Test', pricing: { prompt: '0.000003', completion: '0.000015' } },
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
}

function sse(text: string): string {
  let body = ': OPENROUTER PROCESSING\n\n'
  for (const chunk of text.match(/[\s\S]{1,10}/g) ?? []) {
    body += `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`
  }
  const usage = { prompt_tokens: 12, completion_tokens: 30, cost: 0.00042 }
  body += `data: ${JSON.stringify({ choices: [{ delta: {} }], usage })}\n\ndata: [DONE]\n\n`
  return body
}

async function mockOpenRouter(context: BrowserContext): Promise<OpenRouterMock> {
  const mock: OpenRouterMock = { chatRequests: [], keyExchanges: 0 }
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
