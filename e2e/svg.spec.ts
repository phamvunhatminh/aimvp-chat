import { readFile } from 'node:fs/promises'
import { composer, expect, openWithKey, test } from './fixtures'

test('SVG code shows as an image and downloads as PNG or SVG', async ({ page }) => {
  await openWithKey(page)
  await composer(page).fill('Draw an SVG of a circle')
  await page.getByRole('button', { name: 'Send message' }).click()

  const preview = page.getByRole('img', { name: 'SVG preview' })
  await expect(preview).toBeVisible()
  expect(await preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64)
  // Shown as an image: its script and event handlers never run.
  expect(await page.evaluate(() => '__svgPwned' in window)).toBe(false)

  await page.getByRole('radio', { name: 'Code' }).click()
  await expect(page.locator('.markdown pre')).toContainText('<circle cx="32"')
  await page.getByRole('radio', { name: 'Preview' }).click()
  await expect(preview).toBeVisible()

  const png = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PNG' }).click()
  const pngFile = await png
  expect(pngFile.suggestedFilename()).toBe('image.png')
  const bytes = await readFile((await pngFile.path())!)
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG')
  // Small drawings are exported at 2048 px.
  expect(bytes.readUInt32BE(16)).toBe(2048)

  const svg = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download SVG' }).click()
  const svgFile = await svg
  expect(svgFile.suggestedFilename()).toBe('image.svg')
  expect(await readFile((await svgFile.path())!, 'utf8')).toContain('<circle cx="32" cy="32" r="28" fill="#1e5adc"/>')
})
