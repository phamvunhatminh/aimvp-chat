import { composer, expect, openWithKey, test } from './fixtures'

test('generate an image with an image model and download it', async ({ page, openrouter }) => {
  await openWithKey(page)
  await page.getByRole('button', { name: 'Auto Router' }).click()
  await page.getByPlaceholder('Search models…').fill('painter')
  const option = page.getByRole('option', { name: /Painter/ })
  await expect(option.getByText('Image', { exact: true })).toBeVisible()
  await option.click()

  await expect(composer(page)).toHaveAttribute('placeholder', 'Describe the image you want…')
  await composer(page).fill('A blue square')
  await page.getByRole('button', { name: 'Send message' }).click()

  await expect(page.getByText('A blue square.')).toBeVisible()
  await page.getByRole('button', { name: 'Open image-1.png' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('dialog').getByRole('button', { name: 'Download' }).click()
  expect((await download).suggestedFilename()).toBe('image-1.png')
  expect(openrouter.chatRequests[0]).toMatchObject({ model: 'img/painter', modalities: ['image', 'text'] })
})
