import { ChevronLeftIcon, PlusIcon, SquareSlashIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { usePrompts } from '@/hooks/use-data'
import { createPrompt, deletePrompt, updatePrompt } from '@/lib/repo'
import { useUI, type PromptDraft } from '@/stores/ui'

/** Saved prompts: list, write, edit and delete them. */
export function PromptLibraryDialog() {
  const { open, editing } = useUI((s) => s.promptLibrary)
  const close = useUI((s) => s.closePromptLibrary)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-xl">
        {editing ? <PromptEditor draft={editing} /> : <PromptList />}
      </DialogContent>
    </Dialog>
  )
}

function PromptList() {
  const prompts = usePrompts()
  const setEditing = useUI((s) => s.setPromptEditing)

  return (
    <>
      <DialogHeader>
        <DialogTitle>Prompt library</DialogTitle>
        <DialogDescription>
          Type <kbd className="rounded border px-1 font-mono text-xs">/</kbd> in the message box to use a saved prompt.
        </DialogDescription>
      </DialogHeader>
      <Button className="justify-self-start" onClick={() => setEditing({ id: null, title: '', content: '' })}>
        <PlusIcon />
        New prompt
      </Button>
      {prompts?.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
          <SquareSlashIcon className="size-6" />
          <p>
            Save prompts you use often, like “Summarize this for a 10-year-old” or “Translate to {'{{language}}'}”.
          </p>
        </div>
      )}
      {!!prompts?.length && (
        <ul className="-mx-2 grid gap-0.5" aria-label="Saved prompts">
          {prompts.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setEditing({ id: p.id, title: p.title, content: p.content })}
                className="grid w-full gap-0.5 rounded-lg px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="truncate text-sm font-medium">{p.title}</span>
                <span className="truncate text-xs text-muted-foreground">{p.content}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function PromptEditor({ draft }: { draft: PromptDraft }) {
  const setEditing = useUI((s) => s.setPromptEditing)
  const update = (patch: Partial<PromptDraft>) => setEditing({ ...draft, ...patch })
  const canSave = draft.title.trim() !== '' && draft.content.trim() !== ''

  async function save() {
    if (!canSave) return
    const fields = { title: draft.title.trim(), content: draft.content }
    if (draft.id) await updatePrompt(draft.id, fields)
    else await createPrompt(fields)
    toast.success(draft.id ? 'Prompt saved' : 'Prompt added to your library')
    setEditing(null)
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-ml-2"
            onClick={() => setEditing(null)}
            aria-label="Back to prompts"
          >
            <ChevronLeftIcon />
          </Button>
          {draft.id ? 'Edit prompt' : 'New prompt'}
        </DialogTitle>
        <DialogDescription>
          Write <code className="font-mono text-xs">{'{{blanks}}'}</code> for parts to fill in; the first one is
          selected when you insert the prompt.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="prompt-title">Title</Label>
        <Input
          id="prompt-title"
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="Summarize"
          autoFocus={!draft.title}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="prompt-content">Prompt</Label>
        <Textarea
          id="prompt-content"
          value={draft.content}
          onChange={(e) => update({ content: e.target.value })}
          placeholder="Summarize the text below in {{number}} bullet points:"
          className="min-h-40"
          autoFocus={!!draft.title}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {draft.id && <DeletePromptButton id={draft.id} onDeleted={() => setEditing(null)} />}
        <Button type="button" variant="outline" className="ml-auto" onClick={() => setEditing(null)}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          Save
        </Button>
      </div>
    </form>
  )
}

function DeletePromptButton({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" className="text-destructive hover:text-destructive">
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this prompt?</AlertDialogTitle>
          <AlertDialogDescription>It will be removed from your prompt library.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void deletePrompt(id)
              onDeleted()
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
