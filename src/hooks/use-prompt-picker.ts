import { useId, useState, type KeyboardEvent, type RefObject } from 'react'
import { usePrompts } from '@/hooks/use-data'
import type { SavedPrompt } from '@/lib/db'
import { filterPrompts, insertPrompt } from '@/lib/prompts'

/** Typing `/` at the start of the message, or the toolbar button, lists saved prompts to insert. */
export function usePromptPicker(
  textarea: RefObject<HTMLTextAreaElement | null>,
  text: string,
  setText: (text: string) => void,
) {
  const prompts = usePrompts()
  const listId = useId()
  const [browsing, setBrowsing] = useState(false)
  const [browseQuery, setBrowseQuery] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)

  const slashQuery = /^\/([^\n]*)$/.exec(text)?.[1] ?? null
  // Escape hides the `/` list until the message stops starting with `/`.
  if (dismissed && slashQuery === null) setDismissed(false)
  const matches = filterPrompts(prompts ?? [], browsing ? browseQuery : (slashQuery ?? ''))
  const slashOpen = !browsing && slashQuery !== null && !dismissed && matches.length > 0
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1))

  function pick(prompt: SavedPrompt) {
    const el = textarea.current
    const selection: [number, number] = el ? [el.selectionStart, el.selectionEnd] : [text.length, text.length]
    const inserted = insertPrompt(text, selection, prompt.content, slashOpen || !text.trim())
    setText(inserted.text)
    setBrowsing(false)
    setBrowseQuery('')
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(...inserted.select)
    })
  }

  /** Arrow keys, Enter, Tab and Escape for the open list; true when the key was used. */
  function handleListKey(e: KeyboardEvent): boolean {
    if (matches.length === 0) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((activeIndex + step + matches.length) % matches.length)
      return true
    }
    if ((e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) || e.key === 'Tab') {
      e.preventDefault()
      pick(matches[activeIndex])
      return true
    }
    return false
  }

  return {
    listId,
    prompts,
    matches,
    activeIndex,
    slashOpen,
    browsing,
    browseQuery,
    setActive,
    pick,
    handleListKey,
    setBrowseQuery(query: string) {
      setBrowseQuery(query)
      setActive(0)
    },
    toggleBrowsing() {
      setBrowsing((b) => !b)
      setBrowseQuery('')
      setActive(0)
    },
    close() {
      if (slashOpen) setDismissed(true)
      setBrowsing(false)
    },
    /** Call when the user edits the message. */
    onTextChange() {
      setActive(0)
    },
    /** For the message box while the `/` list is open. */
    handleTextareaKey(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
      if (!slashOpen) return false
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return true
      }
      return handleListKey(e)
    },
    textareaProps: slashOpen
      ? { 'aria-controls': listId, 'aria-activedescendant': `${listId}-${activeIndex}`, 'aria-autocomplete': 'list' as const }
      : {},
  }
}

export type PromptPickerState = ReturnType<typeof usePromptPicker>
