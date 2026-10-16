import { readFile } from 'node:fs/promises'
import { composer, expect, openWithKey, test } from './fixtures'

test('download a chat as Markdown, code as a file, and print', async ({ page }) => {
  await openWithKey(page)
  await composer(page).fill('Show me a greeting')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('.markdown pre')).toBeVisible()

  const codeDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download code' }).click()
  const code = await codeDownload
  expect(code.suggestedFilename()).toBe('snippet.ts')
  expect(await readFile(await code.path(), 'utf8')).toContain('const greet')

  await page.getByRole('button', { name: 'Chat options' }).click()
  const mdDownload = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Download as Markdown' }).click()
  const md = await mdDownload
  expect(md.suggestedFilename()).toBe('show-me-a-greeting.md')
  const text = await readFile(await md.path(), 'utf8')
  expect(text).toMatch(/^# Show me a greeting\n/)
  expect(text).toContain('## You\n\nShow me a greeting')
  expect(text).toContain('## Assistant (openrouter/auto · OpenRouter)')

  await page.evaluate(() => {
    ;(window as unknown as { printed: boolean }).printed = false
    window.print = () => {
      ;(window as unknown as { printed: boolean }).printed = true
    }
  })
  await page.getByRole('button', { name: 'Chat options' }).click()
  await page.getByRole('menuitem', { name: 'Print or save as PDF' }).click()
  expect(await page.evaluate(() => (window as unknown as { printed: boolean }).printed)).toBe(true)

  // In print layout the sidebar, header and composer disappear and the title shows.
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('heading', { name: 'Show me a greeting', level: 1 })).toBeVisible()
  await expect(page.getByLabel('Message', { exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Chat options' })).toBeHidden()
})
