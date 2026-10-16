import { composer, expect, openWithKey, test } from './fixtures'

const openSidebar = async (page: import('@playwright/test').Page) => {
  if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Open sidebar' }).click()
}

test('usage shows in the sidebar and on the dashboard', async ({ page }) => {
  await openWithKey(page)
  await composer(page).fill('How much does this cost?')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('.markdown pre')).toBeVisible()

  // Per chat, in the chat's menu (the mocked reply cost $0.00042 for 42 tokens).
  await page.getByRole('button', { name: 'Chat options' }).click()
  await expect(page.getByText('This chat: $0.0004 · 42 tokens')).toBeVisible()
  await page.keyboard.press('Escape')

  await openSidebar(page)
  const widget = page.getByRole('link', { name: 'Usage this month' })
  await expect(widget).toContainText('$0.0004')
  await widget.click()

  await expect(page).toHaveURL(/\/usage$/)
  await expect(page.getByRole('heading', { name: 'Usage', level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Spend', exact: true })).toContainText('$0.0004')
  await expect(page.getByRole('region', { name: 'Tokens', exact: true })).toContainText('12 in · 30 out')
  await expect(page.getByRole('region', { name: 'Activity' })).toContainText('1 reply')
  await expect(page.getByRole('region', { name: 'By model' })).toContainText('Auto Router')
  await expect(page.getByRole('region', { name: 'Top chats' }).getByRole('link')).toHaveText('How much does this cost?')

  await page.getByRole('radio', { name: '7 days' }).click()
  await expect(page.getByRole('radio', { name: '7 days' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('region', { name: 'Spend per day' }).getByRole('img')).toHaveAttribute(
    'aria-label',
    /\$0\.0004 in total/,
  )
})

test('a budget shows progress, and the sidebar widget can be hidden', async ({ page }) => {
  await openWithKey(page)
  await composer(page).fill('hi')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('.markdown pre')).toBeVisible()

  await openSidebar(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByLabel('Monthly budget').fill('10')
  await settings.getByLabel('Monthly budget').press('Enter')
  await page.keyboard.press('Escape')
  await openSidebar(page)
  const widget = page.getByRole('link', { name: 'Usage this month' })
  await expect(widget).toContainText('/ $10.00')
  await expect(widget.getByRole('meter', { name: 'Monthly budget used' })).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()
  await settings.getByRole('switch', { name: "Show this month's usage in the sidebar" }).click()
  await page.keyboard.press('Escape')
  await openSidebar(page)
  await expect(page.getByRole('link', { name: 'Usage this month' })).toBeHidden()
  await expect(page.getByRole('link', { name: 'Usage', exact: true })).toBeVisible()
})
