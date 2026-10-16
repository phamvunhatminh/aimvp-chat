import { ANSWER, composer, DIRECT_ANSWER, expect, OAUTH_KEY, openWithKey, test } from './fixtures'

test('first run: paste an API key', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Chat with any AI model' })).toBeVisible()
  await expect(composer(page)).toHaveCount(0)

  await page.getByRole('button', { name: 'Use an OpenAI, Anthropic or Google key' }).click()
  await page.getByLabel('OpenRouter API key').fill('sk-or-v1-pasted-0123456789')
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  await expect(page.getByText('Used $1.23 of $10.00 limit')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible()
})

test('OAuth callback stores the key and redeems the code once', async ({ page, openrouter }) => {
  await page.goto('/')
  await page.evaluate(() => sessionStorage.setItem('aimvp.oauth.verifier', 'test-verifier'))
  await page.goto('/auth/callback?code=abc123')
  await expect(page).toHaveURL('/')
  await expect(page.getByText('What can I help with?')).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aimvp.settings')!).state.apiKeys.openrouter)
  expect(saved).toBe(OAUTH_KEY)
  expect(openrouter.keyExchanges).toBe(1)
})

test('send a message with a chosen model and system prompt', async ({ page, openrouter }) => {
  await openWithKey(page)

  await page.getByRole('button', { name: 'Auto Router' }).click()
  await expect(page.getByText('Image Only')).toHaveCount(0)
  await page.getByPlaceholder('Search models…').fill('claude')
  await page.getByRole('option', { name: /Claude Test/ }).click()

  await page.getByRole('button', { name: 'System prompt' }).click()
  await page.getByPlaceholder('You are a helpful assistant…').fill('Answer like a pirate.')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await composer(page).fill('How do I greet someone?')
  await page.getByRole('button', { name: 'Send message' }).click()

  await expect(page).toHaveURL(/\/c\/[\w-]+$/)
  await expect(page.locator('.markdown pre')).toContainText('const greet')
  await expect(page.locator('.markdown strong')).toHaveText('bold')
  await expect(page.getByText('anthropic/claude-test · OpenRouter · 42 tokens · $0.0004')).toBeVisible()
  await expect(page).toHaveTitle('How do I greet someone? · aimvp')

  // Untrusted output: raw HTML is shown as text and remote images become links.
  await expect(page.locator('.markdown script')).toHaveCount(0)
  await expect(page.locator('.markdown img')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'tracker' })).toBeVisible()
  expect(await page.evaluate(() => 'pwned' in window || '__pwned' in window)).toBe(false)

  expect(openrouter.chatRequests).toHaveLength(1)
  expect(openrouter.chatRequests[0]).toMatchObject({
    model: 'anthropic/claude-test',
    stream: true,
    messages: [
      { role: 'system', content: 'Answer like a pirate.' },
      { role: 'user', content: 'How do I greet someone?' },
    ],
  })
})

test('API errors are explained and can be retried', async ({ page, openrouter }) => {
  await openWithKey(page)
  await page.getByRole('button', { name: 'Auto Router' }).click()
  await page.getByPlaceholder('Search models…').fill('credits')
  await page.getByRole('option', { name: /Out Of Credits/ }).click()

  await composer(page).fill('Hello?')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText(/out of credits/)).toBeVisible()

  await page.getByRole('button', { name: 'OpenAI: Out Of Credits' }).click()
  await page.getByPlaceholder('Search models…').fill('claude')
  await page.getByRole('option', { name: /Claude Test/ }).click()
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.locator('.markdown pre')).toBeVisible()
  await expect(page.getByText(/out of credits/)).toHaveCount(0)
  expect(openrouter.chatRequests.map((r) => r.model)).toEqual(['openai/broke', 'anthropic/claude-test'])
})

const DIRECT = [
  { provider: 'openai', name: 'OpenAI', key: 'sk-proj-openai-0123456789', model: 'gpt-5', label: 'gpt-5', tokens: 12 },
  {
    provider: 'anthropic',
    name: 'Anthropic',
    key: 'sk-ant-api03-0123456789',
    model: 'Claude Opus 5.5',
    label: 'claude-opus-5-5',
    tokens: 15,
  },
  {
    provider: 'google',
    name: 'Google Gemini',
    key: 'AIzaSy-0123456789',
    model: 'Gemini 2.5 Flash',
    label: 'gemini-2.5-flash',
    tokens: 9,
  },
] as const

for (const p of DIRECT) {
  test(`chat directly with ${p.name} using its own key`, async ({ page, openrouter }) => {
    await openWithKey(page)
    await page.getByRole('button', { name: 'System prompt' }).click()
    await page.getByPlaceholder('You are a helpful assistant…').fill('Be brief.')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Open sidebar' }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByLabel(`${p.name} API key`).fill(p.key)
    await page.getByLabel(`${p.name} API key`).press('Enter')
    await expect(page.getByText(`${p.name} key saved`)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: /Auto Router/ }).click()
    await expect(page.getByRole('group', { name: p.name })).toBeVisible()
    await page.getByRole('option', { name: new RegExp(p.model) }).first().click()
    await composer(page).fill('Hi there')
    await page.getByRole('button', { name: 'Send message' }).click()

    await expect(page.locator('.markdown')).toHaveText(DIRECT_ANSWER)
    await expect(page.getByText(`${p.label} · ${p.name} · ${p.tokens} tokens`)).toBeVisible()
    expect(openrouter.chatRequests).toHaveLength(0)
    const [request] = openrouter.directRequests
    expect(request.provider).toBe(p.provider)
    const sentKey = request.headers['authorization'] ?? request.headers['x-api-key'] ?? request.headers['x-goog-api-key']
    expect(sentKey?.replace('Bearer ', '')).toBe(p.key)
    expect(JSON.stringify(request.body)).toContain('Be brief.')
    if (p.provider === 'anthropic') {
      expect(request.headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    }
  })
}

test('a model whose provider has no key explains what to do', async ({ page }) => {
  await openWithKey(page)
  await page.getByRole('button', { name: 'Auto Router' }).click()
  await page.getByPlaceholder('Search models…').fill('anthropic:claude-opus-5-5')
  await page.getByRole('option', { name: /Use "claude-opus-5-5"/ }).click()
  await expect(page.getByText('claude-opus-5-5 runs on Anthropic. Add your Anthropic key, or pick another model above.')).toBeVisible()
  await page.getByRole('button', { name: 'Add key' }).click()
  await expect(page.getByLabel('Anthropic API key')).toBeVisible()
})

test('history persists and can be renamed and deleted', async ({ page }) => {
  await openWithKey(page)
  await composer(page).fill('Remember me')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('.markdown pre')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('main').getByText('Remember me', { exact: true })).toBeVisible()
  await expect(page.locator('.markdown pre')).toBeVisible()

  if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Open sidebar' }).click()
  const sidebar = page.getByRole('navigation', { name: 'Chat history' })
  await sidebar.getByRole('button', { name: 'Options for Remember me' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByLabel('Chat title').fill('Renamed chat')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(sidebar.getByRole('link', { name: 'Renamed chat' })).toBeVisible()

  await sidebar.getByRole('button', { name: 'Options for Renamed chat' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page).toHaveURL('/')
  await expect(sidebar.getByText('Your chats will appear here.')).toBeVisible()
})

test('edit a sent message and get a new answer', async ({ page, openrouter }) => {
  await openWithKey(page)
  await composer(page).fill('Original question')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('.markdown pre')).toBeVisible()

  await page.getByRole('main').getByText('Original question', { exact: true }).hover()
  await page.getByRole('button', { name: 'Edit message' }).click()
  await page.getByLabel('Edit message').fill('Edited question')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('main').getByText('Edited question', { exact: true })).toBeVisible()
  await expect.poll(() => openrouter.chatRequests.length).toBe(2)
  expect(openrouter.chatRequests[1].messages).toEqual([{ role: 'user', content: 'Edited question' }])
  await expect(page.locator('.markdown pre')).toHaveCount(1)
})

test.describe('mobile', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch-only behaviour')

  test('Enter adds a newline, the drawer opens, and nothing overflows', async ({ page }) => {
    await openWithKey(page)
    await composer(page).fill('Line one')
    await composer(page).press('Enter')
    await expect(composer(page)).toHaveValue('Line one\n')

    await page.getByRole('button', { name: 'Send message' }).tap()
    await expect(page.locator('.markdown')).toContainText(ANSWER.split('\n')[0].replace(/\*/g, ''))

    await page.getByRole('button', { name: 'Open sidebar' }).tap()
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Line one' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

test.describe('projects', () => {
  const openSidebar = async (page: import('@playwright/test').Page) => {
    if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Open sidebar' }).click()
    return page.getByRole('navigation', { name: 'Chat history' })
  }

  test('create a project and chat inside it with its instructions', async ({ page, openrouter }) => {
    await openWithKey(page)
    await openSidebar(page)
    await page.getByRole('button', { name: 'New project' }).first().click()
    await page.getByLabel('Project name').fill('Launch plan')
    await page.getByRole('button', { name: 'Create' }).click()

    await expect(page).toHaveURL(/\/p\/[\w-]+$/)
    await expect(page.getByRole('heading', { name: 'Launch plan' })).toBeVisible()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByRole('textbox', { name: 'Project instructions' }).fill('We are launching aimvp.')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('We are launching aimvp.')).toBeVisible()

    await composer(page).fill('Draft a tweet')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page).toHaveURL(/\/c\/[\w-]+$/)
    await expect(page.locator('.markdown pre')).toBeVisible()
    expect((openrouter.chatRequests[0].messages as unknown[])[0]).toEqual({
      role: 'system',
      content: 'We are launching aimvp.',
    })

    // Filed under the project, not in the main chat list.
    const sidebar = await openSidebar(page)
    await expect(sidebar.getByRole('link', { name: 'Draft a tweet' })).toHaveCount(0)
    await expect(sidebar.getByRole('link', { name: 'Launch plan' })).toBeVisible()
    if (test.info().project.name === 'mobile') await page.keyboard.press('Escape')

    await page.getByTitle('Project: Launch plan').click()
    await expect(
      page.getByRole('region', { name: 'Chats in this project' }).getByRole('link', { name: 'Draft a tweet' }),
    ).toBeVisible()
  })

  test('move a chat into a new project and back out', async ({ page }) => {
    await openWithKey(page)
    await composer(page).fill('Loose chat')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.markdown pre')).toBeVisible()

    const sidebar = await openSidebar(page)
    await sidebar.getByRole('button', { name: 'Options for Loose chat' }).click()
    await page.getByRole('menuitem', { name: 'Move to project…' }).click()
    await page.getByLabel('New project name').fill('Archive')
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Move to project' })).toHaveCount(0)

    await expect(sidebar.getByRole('link', { name: 'Loose chat' })).toHaveCount(0)
    await expect(sidebar.getByRole('link', { name: 'Archive' })).toBeVisible()

    // Moving it out again works from the project page too.
    await sidebar.getByRole('link', { name: 'Archive' }).click()
    const projectChats = page.getByRole('region', { name: 'Chats in this project' })
    await projectChats.getByRole('button', { name: 'Options for Loose chat' }).click()
    await page.getByRole('menuitem', { name: 'Move to project…' }).click()
    await page.getByRole('button', { name: 'Remove from project' }).click()
    await expect(projectChats.getByRole('link', { name: 'Loose chat' })).toHaveCount(0)
    await page.getByRole('main').getByRole('button', { name: 'Options for project Archive' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page).toHaveURL('/')
  })

  test('deleting a project keeps its chats', async ({ page }) => {
    await openWithKey(page)
    await composer(page).fill('Keep me')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.markdown pre')).toBeVisible()

    const sidebar = await openSidebar(page)
    await sidebar.getByRole('button', { name: 'Options for Keep me' }).click()
    await page.getByRole('menuitem', { name: 'Move to project…' }).click()
    await page.getByLabel('New project name').fill('Archive')
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(sidebar.getByRole('link', { name: 'Keep me' })).toHaveCount(0)

    await sidebar.getByRole('button', { name: 'Options for project Archive' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(sidebar.getByRole('link', { name: 'Archive' })).toHaveCount(0)
    await expect(sidebar.getByRole('link', { name: 'Keep me' })).toBeVisible()
  })
})
