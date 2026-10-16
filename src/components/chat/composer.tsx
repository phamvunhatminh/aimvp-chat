import {
  AlertTriangleIcon,
  ArrowUpIcon,
  Loader2Icon,
  MicIcon,
  PaperclipIcon,
  SquareIcon,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ModelPicker } from '@/components/model-picker'
import { Button } from '@/components/ui/button'
import { usePromptPicker } from '@/hooks/use-prompt-picker'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { ACCEPT, type PreparedFile } from '@/lib/files'
import { parseModelRef } from '@/lib/providers'
import { cn, isTouchDevice } from '@/lib/utils'
import { addFiles, takeFiles, useComposer } from '@/stores/composer'
import { useModelCatalog } from '@/stores/models'
import { PendingAttachments } from './attachments'
import { PromptButton, PromptPicker } from './prompt-picker'

/** A starting point offered under the message box of a new chat. */
export interface Suggestion {
  icon: LucideIcon
  label: string
  /** Put in the message box, ready to finish. */
  text: string
}

const toolButton = 'rounded-full text-muted-foreground hover:text-foreground'

export function Composer({
  onSend,
  onStop,
  streaming,
  modelRef,
  onModelChange,
  placeholder = 'Ask anything',
  tools,
  variant = 'docked',
  suggestions,
}: {
  onSend: (text: string, files: PreparedFile[]) => void
  onStop: () => void
  streaming: boolean
  /** The chat's model: shown in the toolbar, and used to warn about attachments it can't read. */
  modelRef: string
  onModelChange?: (ref: string) => void
  placeholder?: string
  /** Extra buttons for the toolbar, after the built-in ones. */
  tools?: ReactNode
  /** `hero` sits in the middle of an empty chat, with suggestions under it. */
  variant?: 'docked' | 'hero'
  suggestions?: Suggestion[]
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const promptButton = useRef<HTMLButtonElement>(null)
  const files = useComposer((s) => s.files)
  const processing = files.some((f) => f.status === 'processing')
  const hasImages = files.some((f) => f.prepared?.attachment.kind === 'image')
  const { provider, model } = parseModelRef(modelRef)
  const readsImages = useModelCatalog((s) => s.byProvider[provider]?.models.find((m) => m.id === model)?.inputs?.image)
  const voice = useVoiceInput({ getText: () => ref.current?.value ?? '', setText })
  const picker = usePromptPicker(ref, text, setText)
  // OpenAI dictation lands in the text box only after recording stops.
  const awaitingDictation = voice.engine === 'openai' && voice.status !== 'idle'

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 208)}px`
  }, [text])

  const canSend = (text.trim() !== '' || files.length > 0) && !processing && !streaming && !awaitingDictation

  function submit() {
    if (!canSend) return
    voice.cancel()
    onSend(text.trim(), takeFiles())
    setText('')
  }

  function applySuggestion(suggestion: Suggestion) {
    setText(suggestion.text)
    requestAnimationFrame(() => {
      const el = ref.current
      el?.focus()
      el?.setSelectionRange(suggestion.text.length, suggestion.text.length)
    })
  }

  return (
    <div
      className={cn(
        'w-full px-3 sm:px-4 print:hidden',
        variant === 'docked' && 'shrink-0 pb-[max(env(safe-area-inset-bottom),0.75rem)]',
      )}
    >
      <PromptPicker picker={picker} textarea={ref} buttonRef={promptButton}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="mx-auto max-w-3xl rounded-[1.75rem] border bg-background p-2 shadow-composer transition-colors focus-within:border-ring/70 dark:bg-popover"
        >
          <PendingAttachments files={files} />
          <textarea
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              picker.onTextChange()
            }}
            onKeyDown={(e) => {
              if (picker.handleTextareaKey(e)) return
              // Enter sends on desktop; on phones it inserts a newline. Never send mid-IME composition.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isTouchDevice()) {
                e.preventDefault()
                submit()
              }
            }}
            onPaste={(e) => {
              // Pasted screenshots and files become attachments; plain text pastes as usual.
              if (e.clipboardData.files.length > 0) {
                e.preventDefault()
                void addFiles(e.clipboardData.files)
              }
            }}
            autoFocus={!isTouchDevice()}
            placeholder={placeholder}
            aria-label="Message"
            {...picker.textareaProps}
            className="block max-h-52 min-h-11 w-full resize-none bg-transparent px-3 py-2.5 text-base outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-1">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={toolButton}
              onClick={() => fileInput.current?.click()}
              aria-label="Attach files"
              title="Attach images or files"
            >
              <PaperclipIcon />
            </Button>
            <PromptButton picker={picker} buttonRef={promptButton} />
            {tools}
            {hasImages && readsImages === false && (
              <span className="flex min-w-0 items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                <AlertTriangleIcon className="size-3.5 shrink-0" />
                <span className="truncate">This model can't read images</span>
              </span>
            )}
            <div className="ml-auto flex min-w-0 items-center gap-1">
              {onModelChange && (
                <ModelPicker
                  variant="composer"
                  value={modelRef}
                  onChange={onModelChange}
                  className="max-w-[9.5rem] sm:max-w-[16rem]"
                />
              )}
              <VoiceButton voice={voice} />
              {streaming ? (
                <Button type="button" size="icon" className="rounded-full" onClick={onStop} aria-label="Stop generating">
                  <SquareIcon className="size-3.5 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  className="rounded-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
                  disabled={!canSend}
                  aria-label="Send message"
                >
                  <ArrowUpIcon />
                </Button>
              )}
            </div>
          </div>
        </form>
      </PromptPicker>
      {variant === 'hero' && suggestions?.length ? (
        <ul className="mx-auto mt-4 flex max-w-3xl flex-wrap justify-center gap-2" aria-label="Suggestions">
          {suggestions.map((s) => (
            <li key={s.label}>
              <button
                type="button"
                onClick={() => applySuggestion(s)}
                className="flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <s.icon className="size-4" />
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {variant === 'docked' && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">AI can make mistakes. Check important info.</p>
      )}
    </div>
  )
}

function VoiceButton({ voice }: { voice: ReturnType<typeof useVoiceInput> }) {
  if (!voice.engine) return null
  if (voice.status === 'transcribing') {
    return (
      <Button type="button" variant="ghost" size="icon" className="rounded-full" disabled aria-label="Transcribing">
        <Loader2Icon className="animate-spin" />
      </Button>
    )
  }
  const listening = voice.status === 'listening'
  return (
    <>
      {listening && voice.startedAt !== null && <RecordingTimer startedAt={voice.startedAt} />}
      <Button
        type="button"
        variant={listening ? 'destructive' : 'ghost'}
        size="icon"
        className={listening ? 'relative rounded-full' : toolButton}
        onClick={listening ? voice.stop : voice.start}
        aria-label={listening ? 'Stop voice input' : 'Start voice input'}
        aria-pressed={listening}
        title={listening ? 'Stop' : 'Voice input'}
      >
        {listening && <span className="absolute inset-0 animate-ping rounded-full bg-destructive/40" />}
        {listening ? <SquareIcon className="size-3.5 fill-current" /> : <MicIcon />}
      </Button>
    </>
  )
}

function RecordingTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  return (
    <span className="text-xs text-muted-foreground tabular-nums" aria-label="Recording time">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  )
}
