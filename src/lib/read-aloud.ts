import { toast } from 'sonner'
import { create } from 'zustand'
import { useSettings } from '@/stores/settings'
import {
  canSpeakInBrowser,
  guessLanguage,
  pickVoice,
  resolveEngine,
  speakableText,
  speechLanguage,
  splitForSpeech,
} from './speech'

interface ReadAloudState {
  /** The message being read, if any. */
  messageId: string | null
  /** Waiting for the first audio from OpenAI. */
  loading: boolean
}

export const useReadAloud = create<ReadAloudState>()(() => ({ messageId: null, loading: false }))

/** Whether this browser and these settings can read replies aloud. */
export function useCanReadAloud(): boolean {
  const hasOpenAI = useSettings((s) => !!s.apiKeys.openai)
  return hasOpenAI || canSpeakInBrowser()
}

interface Playback {
  stop: () => void
}

let current: Playback | null = null

export function stopReading() {
  current?.stop()
  current = null
  useReadAloud.setState({ messageId: null, loading: false })
}

/** Reads a reply aloud, stopping whatever was being read. Call it from a click so audio may start. */
export function readAloud(messageId: string, markdown: string) {
  stopReading()
  const text = speakableText(markdown)
  if (!text) return
  const { apiKeys, speechOutput, speechVoice, speechLanguage: language } = useSettings.getState()
  const engine = resolveEngine(speechOutput, { browser: canSpeakInBrowser(), openai: !!apiKeys.openai })
  if (!engine) return

  const playback: Playback = { stop: () => {} }
  const isCurrent = () => current === playback
  const callbacks = {
    onPlaying: () => isCurrent() && useReadAloud.setState({ loading: false }),
    onEnd: () => isCurrent() && stopReading(),
    onError: (message: string) => {
      if (!isCurrent()) return
      stopReading()
      toast.error("Couldn't read this aloud", { description: message })
    },
  }
  current = playback
  useReadAloud.setState({ messageId, loading: engine === 'openai' })
  playback.stop =
    engine === 'browser'
      ? speakInBrowser(text, guessLanguage(text, speechLanguage(language)), callbacks)
      : speakWithOpenAI(text, apiKeys.openai!, speechVoice, callbacks)
}

interface Callbacks {
  onPlaying: () => void
  onEnd: () => void
  onError: (message: string) => void
}

// Voices load asynchronously in Chrome; ask early so they're ready by the first click.
if (canSpeakInBrowser()) speechSynthesis.getVoices()

function speakInBrowser(text: string, lang: string, { onEnd, onError }: Callbacks): () => void {
  speechSynthesis.cancel()
  const voice = pickVoice(speechSynthesis.getVoices(), lang)
  // Short pieces: Chrome's online voices stop after about 15 seconds of one utterance.
  const chunks = splitForSpeech(text, 200)
  let stopped = false
  // Chrome drops the events of utterances that get garbage-collected, so keep them referenced.
  const utterances = chunks.map((chunk, i) => {
    const utterance = new SpeechSynthesisUtterance(chunk)
    utterance.lang = voice?.lang ?? lang
    if (voice) utterance.voice = voice
    utterance.onerror = (e) => {
      if (stopped || e.error === 'interrupted' || e.error === 'canceled') return
      stopped = true
      speechSynthesis.cancel()
      onError(e.error === 'language-unavailable' ? 'No voice for this language is installed.' : e.error)
    }
    if (i === chunks.length - 1) utterance.onend = () => !stopped && onEnd()
    return utterance
  })
  for (const utterance of utterances) speechSynthesis.speak(utterance)
  return () => {
    stopped = true
    utterances.length = 0
    speechSynthesis.cancel()
  }
}

/** A blank WAV clip, played on click so Safari lets the same element play the real audio later. */
function silentClip(): Blob {
  const samples = 800
  const view = new DataView(new ArrayBuffer(44 + samples))
  const ascii = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true) // PCM header size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, 8000, true) // sample rate
  view.setUint32(28, 8000, true) // byte rate
  view.setUint16(32, 1, true) // block align
  view.setUint16(34, 8, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples, true)
  for (let i = 0; i < samples; i++) view.setUint8(44 + i, 128)
  return new Blob([view], { type: 'audio/wav' })
}

function speakWithOpenAI(text: string, apiKey: string, voice: string, callbacks: Callbacks): () => void {
  const controller = new AbortController()
  const audio = new Audio()
  let url = URL.createObjectURL(silentClip())
  audio.src = url
  audio.play().catch(() => {})

  const play = async (blob: Blob) => {
    URL.revokeObjectURL(url)
    url = URL.createObjectURL(blob)
    audio.src = url
    await audio.play()
    callbacks.onPlaying()
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error('The audio could not be played.'))
      controller.signal.addEventListener('abort', () => resolve(), { once: true })
    })
  }

  void (async () => {
    const { synthesizeSpeech } = await import('./providers/openai')
    const speak = (chunk: string) => synthesizeSpeech(apiKey, chunk, voice, controller.signal)
    // The speech API takes up to 4096 characters; fetch each next piece while the current one plays.
    const chunks = splitForSpeech(text, 4000)
    let next = speak(chunks[0])
    for (let i = 0; i < chunks.length && !controller.signal.aborted; i++) {
      const blob = await next
      if (i + 1 < chunks.length) {
        next = speak(chunks[i + 1])
        next.catch(() => {}) // Reported when awaited.
      }
      await play(blob)
    }
    if (!controller.signal.aborted) callbacks.onEnd()
  })()
    .catch((err: unknown) => {
      if (!controller.signal.aborted) callbacks.onError(err instanceof Error ? err.message : String(err))
    })
    .finally(() => URL.revokeObjectURL(url))

  return () => {
    controller.abort()
    audio.pause()
  }
}
