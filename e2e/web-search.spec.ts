import { composer, expect, openWithKey, SEARCH_ANSWER, test } from './fixtures'

test('search the web and show the sources', async ({ page, openrouter }) => {
  await openWithKey(page)
  const toggle = page.getByRole('button', { name: 'Search the web' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')

  await composer(page).fill('What happened today?')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText(SEARCH_ANSWER)).toBeVisible()
  const sources = page.getByRole('list', { name: 'Sources' })
  await expect(sources.getByRole('link', { name: /Today in news/ })).toHaveAttribute('href', 'https://news.example/today')
  await expect(sources.getByRole('link')).toHaveCount(2)
  expect(openrouter.chatRequests[0].tools).toEqual([{ type: 'openrouter:web_search' }])

  // The setting belongs to the chat.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Search the web' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Search the web' }).click()
  await composer(page).fill('And without searching?')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('.markdown pre')).toBeVisible()
  expect(openrouter.chatRequests[1].tools).toBeUndefined()
})
