import { describe, expect, it } from 'vitest'
import { appendDictation, guessLanguage, pickVoice, resolveEngine, speakableText, splitForSpeech } from './speech'

describe('speakableText', () => {
  it('drops code, links and formatting marks', () => {
    const markdown = [
      '## Getting started',
      '',
      'Install **the package** with `npm`, then read [the docs](https://example.com/docs).',
      '',
      '```sh',
      'npm install aimvp',
      '```',
      '',
      '- First _step_',
      '1. Second step',
      '- [x] Done',
      '> Quoted',
      '![chart](https://example.com/chart.png)',
      '---',
      'Call snake_case_names or see https://example.com.',
    ].join('\n')
    expect(speakableText(markdown).split('\n')).toEqual([
      'Getting started.',
      'Install the package with npm, then read the docs.',
      'First step.',
      'Second step.',
      'Done.',
      'Quoted.',
      'Call snake_case_names or see.',
    ])
  })

  it('reads tables cell by cell', () => {
    const table = '| Name | Age |\n| --- | :-: |\n| An | 30 |'
    expect(speakableText(table)).toBe('Name, Age.\nAn, 30.')
  })

  it('skips an unclosed code block to the end', () => {
    expect(speakableText('Here:\n```js\nconst a = 1')).toBe('Here:')
  })
})

describe('splitForSpeech', () => {
  it('packs whole sentences into chunks', () => {
    const chunks = splitForSpeech('One two. Three four. Five six.', 20)
    expect(chunks).toEqual(['One two. Three four.', 'Five six.'])
  })

  it('breaks long sentences at spaces', () => {
    const sentence = 'word '.repeat(30).trim()
    const chunks = splitForSpeech(sentence, 40)
    expect(chunks.every((c) => c.length <= 40)).toBe(true)
    expect(chunks.join(' ')).toBe(sentence)
  })
})

describe('guessLanguage', () => {
  it('recognises Vietnamese, Japanese and Chinese', () => {
    expect(guessLanguage('Xin chào, tôi có thể giúp gì cho bạn?', 'en-US')).toBe('vi-VN')
    expect(guessLanguage('こんにちは、元気ですか？', 'en-US')).toBe('ja-JP')
    expect(guessLanguage('你好，我能帮你什么？', 'en-US')).toBe('zh-CN')
  })

  it('reads Latin text in the preferred language unless that uses other letters', () => {
    expect(guessLanguage('Bonjour tout le monde', 'fr-FR')).toBe('fr-FR')
    expect(guessLanguage('Hello, how can I help you today?', 'vi-VN')).toBe('en-US')
    expect(guessLanguage('12345', 'vi-VN')).toBe('vi-VN')
  })
})

describe('pickVoice', () => {
  const voice = (name: string, lang: string, isDefault = false) =>
    ({ name, lang, default: isDefault, localService: true, voiceURI: name }) as SpeechSynthesisVoice

  it('prefers a natural voice in the language', () => {
    const voices = [voice('Alex', 'en-US', true), voice('Linh', 'vi-VN'), voice('Google Tiếng Việt', 'vi_VN')]
    expect(pickVoice(voices, 'vi-VN')?.name).toBe('Google Tiếng Việt')
  })

  it('falls back to the same language in another region, then to none', () => {
    expect(pickVoice([voice('Daniel', 'en-GB')], 'en-US')?.name).toBe('Daniel')
    expect(pickVoice([voice('Daniel', 'en-GB')], 'ja-JP')).toBeNull()
  })
})

describe('resolveEngine', () => {
  it('uses the preferred engine, else the other one', () => {
    expect(resolveEngine('browser', { browser: true, openai: true })).toBe('browser')
    expect(resolveEngine('browser', { browser: false, openai: true })).toBe('openai')
    expect(resolveEngine('openai', { browser: true, openai: false })).toBe('browser')
    expect(resolveEngine('openai', { browser: false, openai: false })).toBeNull()
  })
})

it('appends dictation after typed text', () => {
  expect(appendDictation('Hi ', ' there')).toBe('Hi there')
  expect(appendDictation('', 'Hello')).toBe('Hello')
})
