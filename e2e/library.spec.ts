import { composer, expect, openWithKey, test } from './fixtures'

const openSidebar = async (page: import('@playwright/test').Page) => {
  if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Open sidebar' }).click()
}

test('save a prompt and insert it with /', async ({ page }) => {
  await openWithKey(page)
  await page.getByRole('button', { name: 'Saved prompts' }).click()
  await expect(page.getByText('No saved prompts yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Manage prompts…' }).click()

  const library = page.getByRole('dialog', { name: 'Prompt library' })
  await library.getByRole('button', { name: 'New prompt' }).click()
  const editor = page.getByRole('dialog', { name: 'New prompt' })
  await editor.getByLabel('Title').fill('Translate')
  await editor.getByLabel('Prompt', { exact: true }).fill('Translate to {{language}}: good morning')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(library.getByRole('list', { name: 'Saved prompts' })).toContainText('Translate')
  await page.keyboard.press('Escape')

  await composer(page).fill('/tra')
  const options = page.getByRole('listbox', { name: 'Saved prompts' })
  await expect(options.getByRole('option', { name: /Translate/ })).toHaveAttribute('aria-selected', 'true')
  await composer(page).press('Enter')
  await expect(composer(page)).toHaveValue('Translate to {{language}}: good morning')
  await expect(options).toBeHidden()
  // The blank is selected, so typing fills it in.
  await page.keyboard.type('French')
  await expect(composer(page)).toHaveValue('Translate to French: good morning')

  // Escape hides the list until the message stops starting with "/".
  await composer(page).fill('/t')
  await expect(options).toBeVisible()
  await composer(page).press('Escape')
  await expect(options).toBeHidden()
  await composer(page).fill('')
  await composer(page).fill('/t')
  await expect(options).toBeVisible()
})

test('save a sent message as a prompt', async ({ page }) => {
  await openWithKey(page)
  await composer(page).fill('Explain recursion with an example')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('.markdown pre')).toBeVisible()
  await page.getByRole('button', { name: 'Save as prompt' }).click()
  const editor = page.getByRole('dialog', { name: 'New prompt' })
  await expect(editor.getByLabel('Title')).toHaveValue('Explain recursion with an example')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Prompt added to your library')).toBeVisible()
})

test('search finds words inside messages and opens the match', async ({ page }) => {
  await openWithKey(page)
  await composer(page).fill('Tell me about Hà Nội')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('.markdown pre')).toBeVisible()
  await page.getByRole('link', { name: 'New chat' }).click()

  await openSidebar(page)
  await page.getByRole('textbox', { name: 'Search chats' }).fill('BOLD ANS')
  const results = page.getByRole('region', { name: 'Search results' })
  await expect(results.locator('mark')).toHaveText('bold ans')
  await expect(results).toContainText('Here is a bold answer')
  await results.getByRole('link').click()
  await expect(page).toHaveURL(/\/c\/[\w-]+\?m=[\w-]+$/)
  await expect(page.locator('.search-hit')).toContainText('Here is a bold answer')

  // Accents don't matter.
  await openSidebar(page)
  await page.getByRole('textbox', { name: 'Search chats' }).fill('ha noi')
  await expect(page.getByRole('region', { name: 'Search results' }).locator('mark').first()).toHaveText('Hà Nội')
  await page.getByRole('textbox', { name: 'Search chats' }).fill('nothing like this')
  await expect(page.getByText('No chats match your search.')).toBeVisible()
})

test('project files are sent with every chat in the project', async ({ page, openrouter }) => {
  await openWithKey(page)
  await openSidebar(page)
  await page.getByRole('button', { name: 'New project' }).first().click()
  await page.getByLabel('Project name').fill('Handbook')
  await page.getByRole('button', { name: 'Create' }).click()

  await page.getByLabel('Add project files').setInputFiles([
    { name: 'policy.md', mimeType: 'text/markdown', buffer: Buffer.from('# Leave policy\nTwenty days a year.') },
    { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('not really') },
  ])
  const files = page.getByRole('region', { name: 'Project files' })
  await expect(files.getByText('policy.md')).toBeVisible()
  await expect(page.getByText('photo.png: projects take documents.', { exact: false })).toBeVisible()
  await expect(files).toContainText('Sent with every message in this project')

  await composer(page).fill('How many leave days?')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('.markdown pre')).toBeVisible()
  const system = (openrouter.chatRequests[0].messages as { role: string; content: string }[])[0]
  expect(system.role).toBe('system')
  expect(system.content).toContain('<file name="policy.md">\n# Leave policy\nTwenty days a year.\n</file>')

  await page.goBack()
  await files.getByRole('button', { name: 'Remove policy.md' }).click()
  await expect(files.getByText('policy.md')).toBeHidden()
})
