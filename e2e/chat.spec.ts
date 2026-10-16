import { ANSWER, composer, expect, OAUTH_KEY, openWithKey, test } from './fixtures'

test('first run: paste an API key', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Chat with any AI model' })).toBeVisible()
  await expect(composer(page)).toHaveCount(0)

  await page.getByRole('button', { name: 'Paste an API key instead' }).click()
  await page.getByLabel('OpenRouter API key').fill('sk-or-v1-pasted-0123456789')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Connected')).toBeVisible()
  await expect(page.getByText('Used $1.23 of $10.00 limit')).toBeVisible()
})

test('OAuth callback stores the key and redeems the code once', async ({ page, openrouter }) => {
  await page.goto('/')
  await page.evaluate(() => sessionStorage.setItem('aimvp.oauth.verifier', 'test-verifier'))
  await page.goto('/auth/callback?code=abc123')
  await expect(page).toHaveURL('/')
  await expect(page.getByText('What can I help with?')).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aimvp.settings')!).state.apiKey)
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
  await expect(page.getByText('anthropic/claude-test · 42 tokens · $0.0004')).toBeVisible()
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
