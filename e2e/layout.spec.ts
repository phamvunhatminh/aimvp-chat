import { composer, expect, openWithKey, test } from './fixtures'

test('a new chat starts in the middle with suggestions and the model in the message box', async ({ page }) => {
  await openWithKey(page)
  await expect(page.getByRole('heading', { name: 'What can I help with?' })).toBeVisible()
  await page.getByRole('list', { name: 'Suggestions' }).getByRole('button', { name: 'Brainstorm' }).click()
  await expect(composer(page)).toHaveValue('Brainstorm ideas for ')
  await expect(composer(page)).toBeFocused()

  await page.getByRole('button', { name: 'Auto Router' }).click()
  await page.getByPlaceholder('Search models…').fill('claude')
  await page.getByRole('option', { name: /Claude Test/ }).click()
  await expect(page.getByRole('button', { name: 'Anthropic: Claude Test' })).toBeVisible()

  await composer(page).fill('A docked message box after this')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('.markdown pre')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Suggestions' })).toHaveCount(0)
  await expect(page.locator('header').getByText('A docked message box after this')).toBeVisible()
})

test('the sidebar can be hidden on wide screens, and stays hidden', async ({ page }) => {
  test.skip(test.info().project.name === 'mobile', 'Phones use the slide-over sidebar')
  await openWithKey(page)
  const history = page.getByRole('navigation', { name: 'Chat history' })
  await page.getByRole('button', { name: 'Hide sidebar' }).click()
  await expect(history).toBeHidden()
  await page.reload()
  await expect(history).toBeHidden()
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await expect(history).toBeVisible()
})
