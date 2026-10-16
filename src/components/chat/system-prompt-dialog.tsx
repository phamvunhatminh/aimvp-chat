import { ScrollTextIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/** Edits a block of instructions: a chat's system prompt or a project's instructions. */
export function PromptDialog({
  value,
  onSave,
  title,
  description,
  trigger,
}: {
  value: string
  onSave: (prompt: string) => void
  title: string
  description: string
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value)
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="You are a helpful assistant…"
          className="min-h-40"
          autoFocus
          aria-label={title}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(draft)
              setOpen(false)
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SystemPromptDialog({ value, onSave }: { value: string; onSave: (prompt: string) => void }) {
  return (
    <PromptDialog
      value={value}
      onSave={onSave}
      title="System prompt"
      description="Instructions the model follows for this whole chat."
      trigger={
        <Button
          variant="ghost"
          size="icon"
          aria-label="System prompt"
          title="System prompt"
          className={cn(value.trim() ? 'text-foreground' : 'text-muted-foreground')}
        >
          <ScrollTextIcon />
        </Button>
      }
    />
  )
}
