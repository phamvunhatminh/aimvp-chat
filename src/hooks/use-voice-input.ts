import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  appendDictation,
  browserRecognition,
  canRecordAudio,
  recognitionErrorMessage,
  resolveEngine,
  speechLanguage,
} from '@/lib/speech'
import { useSettings } from '@/stores/settings'

export type VoiceStatus = 'idle' | 'listening' | 'transcribing'

/** OpenAI accepts files up to 25 MB; ten minutes of speech stays well under that. */
const MAX_RECORDING_MS = 10 * 60_000

interface Session {
  /** Finish and keep what was said. */
  stop: () => void
  /** Finish and drop anything not yet in the text box. */
  cancel: () => void
}

/**
 * Dictation into the composer. The browser engine types as you speak; OpenAI records,
 * then transcribes when you stop.
 */
export function useVoiceInput({ getText, setText }: { getText: () => string; setText: (text: string) => void }) {
  const apiKey = useSettings((s) => s.apiKeys.openai)
  const preferred = useSettings((s) => s.speechInput)
  const language = useSettings((s) => s.speechLanguage)
  const engine = resolveEngine(preferred, { browser: !!browserRecognition(), openai: !!apiKey && canRecordAudio() })
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const session = useRef<Session | null>(null)

  useEffect(() => () => session.current?.cancel(), [])

  function finish() {
    session.current = null
    setStatus('idle')
    setStartedAt(null)
  }

  function listenInBrowser() {
    const Recognition = browserRecognition()!
    const recognition = new Recognition()
    const typed = getText()
    let cancelled = false
    recognition.lang = speechLanguage(language)
    recognition.interimResults = true
    // Android's recognizer repeats earlier phrases in continuous mode, so it stops at the first pause there.
    recognition.continuous = !/Android/i.test(navigator.userAgent)
    recognition.onresult = (event) => {
      if (cancelled) return
      setText(appendDictation(typed, Array.from(event.results, (r) => r[0].transcript).join('')))
    }
    recognition.onerror = (event) => {
      if (event.error !== 'aborted' && event.error !== 'no-speech') toast.error(recognitionErrorMessage(event.error))
    }
    recognition.onend = finish
    try {
      recognition.start()
    } catch {
      toast.error(recognitionErrorMessage(''))
      return
    }
    session.current = {
      stop: () => recognition.stop(),
      cancel: () => {
        cancelled = true
        recognition.abort()
      },
    }
    setStatus('listening')
  }

  async function recordForOpenAI() {
    // Hold the slot while the browser asks for the microphone.
    let dropped = false
    const drop = () => {
      dropped = true
    }
    session.current = { stop: drop, cancel: drop }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      finish()
      toast.error(
        (err as Error).name === 'NotFoundError'
          ? recognitionErrorMessage('audio-capture')
          : recognitionErrorMessage('not-allowed'),
      )
      return
    }
    if (dropped) {
      for (const track of stream.getTracks()) track.stop()
      return finish()
    }
    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    const controller = new AbortController()
    const timeout = setTimeout(() => recorder.stop(), MAX_RECORDING_MS)
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    recorder.onstop = async () => {
      clearTimeout(timeout)
      for (const track of stream.getTracks()) track.stop()
      if (controller.signal.aborted || chunks.length === 0) return finish()
      setStatus('transcribing')
      try {
        const { transcribeAudio } = await import('@/lib/providers/openai')
        const audio = new Blob(chunks, { type: recorder.mimeType || chunks[0].type })
        const text = await transcribeAudio(apiKey!, audio, language, controller.signal)
        if (text) setText(appendDictation(getText(), text))
      } catch (err) {
        if (!controller.signal.aborted) toast.error("Couldn't transcribe that", { description: (err as Error).message })
      } finally {
        finish()
      }
    }
    recorder.start()
    session.current = {
      stop: () => recorder.state !== 'inactive' && recorder.stop(),
      cancel: () => {
        controller.abort()
        if (recorder.state !== 'inactive') recorder.stop()
      },
    }
    setStatus('listening')
    setStartedAt(Date.now())
  }

  return {
    /** The engine in use, or null when voice input isn't available here. */
    engine,
    status,
    /** When OpenAI recording began, for a timer. */
    startedAt,
    start() {
      if (!engine || session.current) return
      if (engine === 'browser') listenInBrowser()
      else void recordForOpenAI()
    },
    stop: () => session.current?.stop(),
    cancel: () => session.current?.cancel(),
  }
}
