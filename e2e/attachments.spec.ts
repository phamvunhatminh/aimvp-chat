import { composer, expect, openWithKey, test } from './fixtures'
import { makeDocx, makePdf, makePng } from './files'

const fileInput = (page: import('@playwright/test').Page) => page.locator('input[type="file"][multiple]')

type ChatBody = { messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[] }

test('attach an image, send it, and open it full size', async ({ page, openrouter }) => {
  await openWithKey(page)
  await fileInput(page).setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: makePng(64, 48) })
  const attachments = page.getByLabel('Attachments')
  await expect(attachments.getByRole('img', { name: 'red.jpg' })).toBeVisible()

  await composer(page).fill('What colour is this?')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('.markdown pre')).toBeVisible()

  const body = openrouter.chatRequests[0] as unknown as ChatBody
  const parts = body.messages.at(-1)!.content as { type: string; image_url?: { url: string }; text?: string }[]
  expect(parts[0].type).toBe('image_url')
  expect(parts[0].image_url!.url).toMatch(/^data:image\/jpeg;base64,/)
  expect(parts[1]).toEqual({ type: 'text', text: 'What colour is this?' })

  await page.getByRole('button', { name: 'Open red.jpg' }).click()
  const viewer = page.getByRole('dialog')
  await expect(viewer.getByRole('img', { name: 'red.jpg' })).toBeVisible()
  const download = page.waitForEvent('download')
  await viewer.getByRole('button', { name: 'Download' }).click()
  expect((await download).suggestedFilename()).toBe('red.jpg')
})

test('PDF and Word files are read in the browser and sent as text', async ({ page, openrouter }) => {
  await openWithKey(page)
  await fileInput(page).setInputFiles([
    { name: 'spec.pdf', mimeType: 'application/pdf', buffer: makePdf('Hello from the PDF') },
    { name: 'brief.docx', mimeType: '', buffer: makeDocx(['Launch on Friday', 'Budget is small']) },
  ])
  await expect(page.getByLabel('Attachments').getByText('PDF ·')).toBeVisible()
  await expect(page.getByLabel('Attachments').getByText('Word ·')).toBeVisible()
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('.markdown pre')).toBeVisible()

  const parts = (openrouter.chatRequests[0] as unknown as ChatBody).messages.at(-1)!.content as { text: string }[]
  expect(parts[0].text).toContain('<file name="spec.pdf">')
  expect(parts[0].text).toContain('Hello from the PDF')
  expect(parts[1].text).toBe('<file name="brief.docx">\nLaunch on Friday\nBudget is small\n</file>')
  // A message with only files is titled after the first one.
  await expect(page).toHaveTitle('spec.pdf')
})

test('paste a screenshot and drop a file onto the chat', async ({ page }) => {
  await openWithKey(page)
  await composer(page).click()
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 20
    canvas.height = 20
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'))
    const data = new DataTransfer()
    data.items.add(new File([blob], 'image.png', { type: 'image/png' }))
    document.querySelector('textarea')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
  })
  await expect(page.getByLabel('Attachments').getByRole('img', { name: 'image.jpg' })).toBeVisible()

  await page.evaluate(() => {
    const data = new DataTransfer()
    data.items.add(new File(['dropped text'], 'dropped.txt', { type: 'text/plain' }))
    const target = document.querySelector('main')!.firstElementChild!
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }))
    }
  })
  await expect(page.getByLabel('Attachments').getByText('dropped.txt')).toBeVisible()
  await page.getByRole('button', { name: 'Remove dropped.txt' }).click()
  await expect(page.getByLabel('Attachments').getByText('dropped.txt')).toHaveCount(0)
})

test('warns when the model cannot read images and rejects unsupported files', async ({ page }) => {
  await openWithKey(page)
  await page.getByRole('button', { name: 'Auto Router' }).click()
  await page.getByPlaceholder('Search models…').fill('text only')
  await page.getByRole('option', { name: /Text Only Model/ }).click()
  await fileInput(page).setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: makePng(8, 8) })
  await expect(page.getByText("This model can't read images")).toBeVisible()

  await fileInput(page).setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('x') })
  await expect(page.getByText("clip.mp4: this file type isn't supported yet.")).toBeVisible()
})
