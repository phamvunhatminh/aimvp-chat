import { ANSWER, composer, expect, openWithKey, openWithSettings, test, TRANSCRIPT } from './fixtures'

declare global {
  interface Window {
    /** Utterances passed to the stubbed speechSynthesis. */
    __spoken: { text: string; lang: string }[]
    /** Makes the stubbed recognizer hear `text`. */
    __hear: (text: string) => void
    /** Ends the stubbed speech. */
    __finishSpeaking: () => void
  }
}

// A fake microphone, and audio that may play without waiting on a real sound device.
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  },
})

test.describe('browser speech', () => {
  test.beforeEach(async ({ page }) => {
    // Headless Chromium can neither listen nor speak, so stand in for the Web Speech API.
    await page.addInitScript(() => {
      class FakeRecognition {
        lang = ''
        continuous = false
        interimResults = false
        onresult: ((e: unknown) => void) | null = null
        onerror: ((e: unknown) => void) | null = null
        onend: (() => void) | null = null
        start() {
          window.__hear = (text) => this.onresult?.({ results: [[{ transcript: text }]] })
        }
        stop() {
          this.onend?.()
        }
        abort() {
          this.onend?.()
        }
      }
      for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) {
        Object.defineProperty(window, name, { value: FakeRecognition, configurable: true })
      }
      window.__spoken = []
      let queue: SpeechSynthesisUtterance[] = []
      Object.defineProperty(window, 'speechSynthesis', {
        value: {
          getVoices: () => [],
          speak: (u: SpeechSynthesisUtterance) => {
            window.__spoken.push({ text: u.text, lang: u.lang })
            queue.push(u)
          },
          cancel: () => {
            queue = []
          },
        },
      })
      window.__finishSpeaking = () => {
        for (const u of queue) u.onend?.(new Event('end') as SpeechSynthesisEvent)
        queue = []
      }
    })
  })

  test('dictate a message, then hear the reply', async ({ page, openrouter }) => {
    await openWithKey(page)
    await composer(page).fill('Note:')
    await page.getByRole('button', { name: 'Start voice input' }).click()
    await page.evaluate(() => window.__hear('hello from my voice'))
    await expect(composer(page)).toHaveValue('Note: hello from my voice')
    await page.getByRole('button', { name: 'Stop voice input' }).click()
    await expect(page.getByRole('button', { name: 'Start voice input' })).toBeVisible()

    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.markdown pre')).toBeVisible()
    expect(JSON.stringify(openrouter.chatRequests[0].messages)).toContain('Note: hello from my voice')

    await page.getByRole('button', { name: 'Read aloud' }).click()
    await expect(page.getByRole('button', { name: 'Stop reading' })).toBeVisible()
    const spoken = await page.evaluate(() => window.__spoken.map((u) => u.text).join(' '))
    expect(spoken).toContain('Here is a bold answer:')
    expect(spoken).not.toContain('const greet')
    expect(ANSWER).toContain('const greet')

    await page.evaluate(() => window.__finishSpeaking())
    await expect(page.getByRole('button', { name: 'Read aloud' })).toBeVisible()
  })
})

test.describe('OpenAI speech', () => {
  test.use({ permissions: ['microphone'] })

  test('record and transcribe, then read the reply with an OpenAI voice', async ({ page, openrouter }) => {
    await openWithSettings(page, {
      apiKeys: { openrouter: 'sk-or-v1-test-0123456789', openai: 'sk-proj-openai-0123456789' },
      speechInput: 'openai',
      speechOutput: 'openai',
      speechVoice: 'coral',
    })
    await page.getByRole('button', { name: 'Start voice input' }).click()
    await expect(page.getByLabel('Recording time')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Stop voice input' }).click()
    await expect(composer(page)).toHaveValue(TRANSCRIPT)
    expect(openrouter.audioRequests[0].path).toBe('/v1/audio/transcriptions')
    expect(openrouter.audioRequests[0].body).toContain('gpt-4o-mini-transcribe')

    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.markdown pre')).toBeVisible()
    await page.getByRole('button', { name: 'Read aloud' }).click()
    await expect(page.getByRole('button', { name: 'Stop reading' })).toBeVisible()
    // The 300 ms clip plays to the end.
    await expect(page.getByRole('button', { name: 'Read aloud' })).toBeVisible()
    const speech = JSON.parse(openrouter.audioRequests[1].body)
    expect(speech).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'coral', response_format: 'mp3' })
    expect(speech.input).toContain('Here is a bold answer:')
    expect(speech.input).not.toContain('const greet')
  })
})
