import type { SpeechEngine } from '@/stores/settings'

/** Languages offered for speech, besides following the browser. */
export const SPEECH_LANGUAGES = [
  { tag: 'vi-VN', name: 'Tiếng Việt' },
  { tag: 'en-US', name: 'English (US)' },
  { tag: 'en-GB', name: 'English (UK)' },
  { tag: 'zh-CN', name: '中文 (简体)' },
  { tag: 'ja-JP', name: '日本語' },
  { tag: 'ko-KR', name: '한국어' },
  { tag: 'fr-FR', name: 'Français' },
  { tag: 'de-DE', name: 'Deutsch' },
  { tag: 'es-ES', name: 'Español' },
] as const

/** Voices of OpenAI's speech model. */
export const OPENAI_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'fable',
  'marin',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
] as const

/** The language to listen and speak in: the user's choice, else the browser's. */
export function speechLanguage(setting: string): string {
  return setting || navigator.language || 'en-US'
}

/** Picks the preferred engine if it works here, else the other one, else none. */
export function resolveEngine(preferred: SpeechEngine, available: Record<SpeechEngine, boolean>): SpeechEngine | null {
  if (available[preferred]) return preferred
  const other = preferred === 'browser' ? 'openai' : 'browser'
  return available[other] ? other : null
}

// --- Browser speech recognition (Web Speech API) ---

/** The part of the Web Speech API we use; TypeScript's DOM types only cover its events. */
export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export function browserRecognition(): (new () => SpeechRecognitionLike) | null {
  type Constructor = new () => SpeechRecognitionLike
  const w = window as { SpeechRecognition?: Constructor; webkitSpeechRecognition?: Constructor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Can record audio to send to a transcription API. */
export function canRecordAudio(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export function canSpeakInBrowser(): boolean {
  return typeof speechSynthesis !== 'undefined'
}

export function recognitionErrorMessage(error: string): string {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow it in your browser settings.'
    case 'audio-capture':
      return 'No microphone was found.'
    case 'network':
      return 'Voice input in this browser needs an internet connection.'
    case 'language-not-supported':
      return "This browser can't listen in that language. Pick another in Settings → Voice."
    default:
      return 'Voice input stopped unexpectedly.'
  }
}

/** Appends dictated text to what is already typed. */
export function appendDictation(typed: string, dictated: string): string {
  return [typed.trimEnd(), dictated.trim()].filter(Boolean).join(' ')
}

// --- Preparing replies for reading aloud ---

const ENDS_SENTENCE = /[.!?…:;,。！？、]$/

/** Turns Markdown into the text worth hearing: no code blocks, links, URLs or formatting marks. */
export function speakableText(markdown: string): string {
  const lines: string[] = []
  let fence: string | null = null
  for (const raw of markdown.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(raw)?.[1]
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (marker) {
      fence = marker
      continue
    }
    const line = speakableLine(raw)
    // Headings and list items have no full stop; add one so the voice pauses.
    if (line) lines.push(ENDS_SENTENCE.test(line) ? line : `${line}.`)
  }
  return lines.join('\n')
}

function speakableLine(line: string): string {
  // Table dividers and horizontal rules.
  if (/^[\s|:-]+$/.test(line) && line.includes('-')) return ''
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return ''
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links: keep their text
    .replace(/<(script|style)\b[^>]*>.*?<\/\1>/gi, '') // scripts and styles, with their content
    .replace(/<\/?[a-z][^>]*>/gi, '') // HTML tags
    .replace(/https?:\/\/\S+/g, '') // bare URLs
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/^\s*(>\s*)+/, '') // quotes
    .replace(/^\s*#{1,6}\s+/, '') // headings
    .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '') // list markers and task boxes
    .replace(/\*+|~~/g, '') // bold, italics, strikethrough
    .replace(/(^|\W)_+|_+(?=\W|$)/g, '$1') // _italics_, keeping snake_case
    .replace(/\s*\|\s*/g, ', ') // table cells
    .replace(/\s+/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
}

/** Splits text into pieces of at most `max` characters, at sentence breaks where possible. */
export function splitForSpeech(text: string, max: number): string[] {
  const sentences =
    typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text), (s) => s.segment)
      : (text.match(/[^.!?。！？\n]+[.!?。！？]*\s*|\n+/g) ?? [])
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences.flatMap((s) => splitLong(s, max))) {
    if (current && (current + sentence).trimEnd().length > max) {
      chunks.push(current.trim())
      current = ''
    }
    current += sentence
  }
  chunks.push(current.trim())
  return chunks.filter(Boolean)
}

/** Breaks one over-long sentence at commas or spaces. */
function splitLong(sentence: string, max: number): string[] {
  const parts: string[] = []
  let rest = sentence
  while (rest.length > max) {
    const comma = rest.lastIndexOf(', ', max - 2)
    const space = rest.lastIndexOf(' ', max - 1)
    const at = comma > max / 2 ? comma + 2 : space > max / 2 ? space + 1 : max
    parts.push(rest.slice(0, at))
    rest = rest.slice(at)
  }
  parts.push(rest)
  return parts
}

// Scripts that identify a language, checked in order (Japanese mixes kana with Chinese characters).
const SCRIPTS: { tag: string; pattern: RegExp; share: number }[] = [
  { tag: 'ja-JP', pattern: /[぀-ヿ]/g, share: 0.1 },
  { tag: 'ko-KR', pattern: /[가-힯ᄀ-ᇿ]/g, share: 0.2 },
  { tag: 'zh-CN', pattern: /[一-鿿]/g, share: 0.2 },
  { tag: 'ru-RU', pattern: /[Ѐ-ӿ]/g, share: 0.2 },
  { tag: 'th-TH', pattern: /[฀-๿]/g, share: 0.2 },
  { tag: 'ar-SA', pattern: /[؀-ۿ]/g, share: 0.2 },
  { tag: 'hi-IN', pattern: /[ऀ-ॿ]/g, share: 0.2 },
  // Only some Vietnamese letters carry these marks, so a small share is enough.
  {
    tag: 'vi-VN',
    pattern: /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi,
    share: 0.03,
  },
]

/**
 * Guesses the language of a reply so the browser reads it with a matching voice.
 * Falls back to `preferred`, or to English when `preferred` uses a script the text doesn't.
 */
export function guessLanguage(text: string, preferred: string): string {
  const sample = text.slice(0, 2000)
  const letters = sample.match(/\p{L}/gu)?.length ?? 0
  if (letters === 0) return preferred
  const found = SCRIPTS.find((s) => (sample.match(s.pattern)?.length ?? 0) / letters >= s.share)
  if (found) return found.tag
  const base = preferred.split('-')[0]
  return SCRIPTS.some((s) => s.tag.startsWith(`${base}-`)) ? 'en-US' : preferred
}

/** The best installed voice for a language, or null to let the browser choose. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const normalize = (tag: string) => tag.replace('_', '-').toLowerCase()
  const wanted = normalize(lang)
  const exact = voices.filter((v) => normalize(v.lang) === wanted)
  const matching = exact.length ? exact : voices.filter((v) => normalize(v.lang).split('-')[0] === wanted.split('-')[0])
  return (
    matching.find((v) => /natural|neural|premium|enhanced|google/i.test(v.name)) ??
    matching.find((v) => v.default) ??
    matching[0] ??
    null
  )
}
