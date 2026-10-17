import type { Page } from '@playwright/test'
import { makePng } from './files'
import { composer, expect, messages, mockOpenRouter, openWithKey, test } from './fixtures'
import { GITHUB_USER } from './supabase'

const fileInput = (page: Page) => page.locator('input[type="file"][multiple]')

/** Opens the slide-over sidebar on phones; on wide screens it's always there. */
async function openSidebar(page: Page) {
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Open sidebar' }).click()
}

test('sign up, and your chats and files follow you to another device', async ({ page, browser, supabase }) => {
  // A chat from before signing in joins the account.
  await openWithKey(page)
  await fileInput(page).setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: makePng(64, 48) })
  await composer(page).fill('Remember this picture')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.locator('.markdown pre')).toBeVisible()

  await openSidebar(page)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('dialog', { name: 'Sign in' }).getByRole('button', { name: 'Create an account' }).click()
  const signUp = page.getByRole('dialog', { name: 'Create an account' })
  await signUp.getByLabel('Email').fill('me@example.com')
  await signUp.getByLabel('Password').fill('correct horse')
  await signUp.getByRole('button', { name: 'Create account' }).click()
  await expect(signUp).toHaveCount(0)

  await expect.poll(() => supabase.recordsOf('message').length).toBe(2)
  expect(supabase.recordsOf('conversation')[0].data).toMatchObject({ title: 'Remember this picture' })
  expect(supabase.files.size).toBe(1)
  // Keys never leave the device.
  expect(JSON.stringify([...supabase.records.values()])).not.toContain('sk-or-v1')

  // A second device signs in and finds the chat, picture included.
  const laptop = await browser.newContext()
  await mockOpenRouter(laptop)
  await supabase.attach(laptop)
  const other = await laptop.newPage()
  await openWithKey(other)
  await openSidebar(other)
  await other.getByRole('button', { name: 'Sign in' }).click()
  const signIn = other.getByRole('dialog', { name: 'Sign in' })
  await signIn.getByLabel('Email').fill('me@example.com')
  await signIn.getByLabel('Password').fill('wrong horse')
  await signIn.getByRole('button', { name: 'Sign in' }).click()
  await expect(signIn.getByRole('alert')).toHaveText('Invalid login credentials')
  await signIn.getByLabel('Password').fill('correct horse')
  await signIn.getByRole('button', { name: 'Sign in' }).click()
  await expect(signIn).toHaveCount(0)

  const history = other.getByRole('navigation', { name: 'Chat history' })
  await openSidebar(other)
  await history.getByRole('link', { name: 'Remember this picture' }).click()
  await expect(messages(other).getByText('Remember this picture')).toBeVisible()
  const picture = messages(other).getByRole('img', { name: 'red.jpg' })
  await expect(picture).toBeVisible()
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64)

  // A rename there reaches the first device when it comes back into focus.
  await openSidebar(other)
  await history.getByRole('button', { name: 'Options for Remember this picture' }).click()
  await other.getByRole('menuitem', { name: 'Rename' }).click()
  await other.getByLabel('Chat title').fill('Red picture')
  await other.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => (supabase.recordsOf('conversation')[0].data as { title: string }).title).toBe('Red picture')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page).toHaveTitle('Red picture')
  await laptop.close()

  // Signing out takes the chats off this device; the account keeps them.
  await openSidebar(page)
  await page.getByRole('button', { name: 'Account: me' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' }).getByText('me@example.com')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('Signed out')).toBeVisible()
  await openSidebar(page)
  await expect(page.getByRole('navigation', { name: 'Chat history' }).getByText('Your chats will appear here.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  expect(supabase.recordsOf('conversation')).toHaveLength(1)
})

test('continue with GitHub', async ({ page }) => {
  await openWithKey(page)
  await openSidebar(page)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('button', { name: 'Continue with GitHub' }).click()

  await expect(page.getByText('Signed in. Your chats will sync across devices.')).toBeVisible()
  await expect(page).toHaveURL('/')
  await openSidebar(page)
  const account = page.getByRole('button', { name: `Account: ${GITHUB_USER.name}` })
  await expect.poll(() => account.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(8)
  await account.click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByText(GITHUB_USER.email)).toBeVisible()
  await expect(settings.getByRole('status')).toHaveText('Synced just now')
})

test('reset a forgotten password', async ({ page, supabase }) => {
  supabase.users.push({ id: crypto.randomUUID(), email: 'me@example.com', password: 'old password', metadata: {}, provider: 'email' })
  await openWithKey(page)
  await openSidebar(page)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  const reset = page.getByRole('dialog', { name: 'Reset your password' })
  await reset.getByLabel('Email').fill('me@example.com')
  await reset.getByRole('button', { name: 'Send reset link' }).click()
  await expect(reset.getByRole('status')).toContainText('a link to reset its password is on its way')

  // The link in the email.
  await page.goto(supabase.resets[0].link)
  const choose = page.getByRole('dialog', { name: 'Choose a new password' })
  await choose.getByLabel('New password').fill('new password')
  await choose.getByRole('button', { name: 'Save password' }).click()
  await expect(page.getByText('Password changed')).toBeVisible()
  expect(supabase.users[0].password).toBe('new password')
})
