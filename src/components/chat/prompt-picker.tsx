import { SquareSlashIcon } from 'lucide-react'
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import type { PromptPickerState } from '@/hooks/use-prompt-picker'
import { cn } from '@/lib/utils'
import { useUI } from '@/stores/ui'

/** Shows the prompt list above `children` (the composer). */
export function PromptPicker({
  picker,
  textarea,
  buttonRef,
  children,
}: {
  picker: PromptPickerState
  textarea: RefObject<HTMLTextAreaElement | null>
  buttonRef: RefObject<HTMLButtonElement | null>
  children: ReactNode
}) {
  const openLibrary = useUI((s) => s.openPromptLibrary)
  const open = picker.slashOpen || picker.browsing

  return (
    <Popover open={open} onOpenChange={(next) => !next && picker.close()}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        side="top"
        sideOffset={8}
        className="w-[var(--radix-popper-anchor-width)] overflow-hidden rounded-xl p-0"
        // The `/` list leaves focus in the message box; the button's list focuses its search.
        onOpenAutoFocus={(e) => picker.slashOpen && e.preventDefault()}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          textarea.current?.focus()
        }}
        onFocusOutside={(e) => picker.slashOpen && e.preventDefault()}
        onPointerDownOutside={(e) => {
          if (buttonRef.current?.contains(e.target as Node)) e.preventDefault()
        }}
      >
        {picker.browsing && (
          <input
            value={picker.browseQuery}
            onChange={(e) => picker.setBrowseQuery(e.target.value)}
            onKeyDown={(e) => picker.handleListKey(e)}
            placeholder="Search prompts…"
            aria-label="Search prompts"
            aria-controls={picker.listId}
            aria-activedescendant={picker.matches.length ? `${picker.listId}-${picker.activeIndex}` : undefined}
            className="h-10 w-full border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        )}
        {picker.matches.length > 0 ? (
          <PromptOptions picker={picker} />
        ) : (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            {picker.prompts?.length ? 'No prompts match.' : 'No saved prompts yet.'}
          </p>
        )}
        <div className="border-t p-1">
          <button
            type="button"
            onClick={() => {
              picker.close()
              openLibrary()
            }}
            className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Manage prompts…
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function PromptOptions({ picker }: { picker: PromptPickerState }) {
  const list = useRef<HTMLUListElement>(null)
  const { listId, activeIndex } = picker

  useEffect(() => {
    list.current?.querySelector(`[id="${listId}-${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [listId, activeIndex])

  return (
    <ul ref={list} id={listId} role="listbox" aria-label="Saved prompts" className="max-h-64 overflow-y-auto p-1">
      {picker.matches.map((p, i) => (
        <li
          key={p.id}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={i === activeIndex}
          // Keep focus in the message box.
          onMouseDown={(e) => e.preventDefault()}
          onMouseMove={() => i !== activeIndex && picker.setActive(i)}
          onClick={() => picker.pick(p)}
          className={cn('cursor-pointer rounded-md px-2 py-1.5', i === activeIndex && 'bg-accent')}
        >
          <div className="truncate text-sm font-medium">{p.title}</div>
          <div className="truncate text-xs text-muted-foreground">{p.content}</div>
        </li>
      ))}
    </ul>
  )
}

/** The toolbar button that opens the prompt list. */
export function PromptButton({
  picker,
  buttonRef,
}: {
  picker: PromptPickerState
  buttonRef: RefObject<HTMLButtonElement | null>
}) {
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="icon"
      className="rounded-full text-muted-foreground hover:text-foreground"
      onClick={picker.toggleBrowsing}
      aria-label="Saved prompts"
      aria-expanded={picker.browsing}
      aria-haspopup="listbox"
      title="Saved prompts (type /)"
    >
      <SquareSlashIcon />
    </Button>
  )
}
