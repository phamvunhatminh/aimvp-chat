import { CheckIcon, FolderIcon, FolderMinusIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Conversation, Project } from '@/lib/db'
import { createProject, updateConversation } from '@/lib/repo'
import { cn } from '@/lib/utils'

/** Files a chat under a project (or a new one), or takes it out of its project. */
export function MoveToProjectDialog({
  conversation,
  projects,
  open,
  onOpenChange,
}: {
  conversation: Conversation
  projects: Project[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')

  async function moveTo(projectId: string | null) {
    await updateConversation(conversation.id, { projectId })
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setName('')
        onOpenChange(next)
      }}
    >
      <DialogContent aria-describedby={undefined} className="gap-3">
        <DialogHeader>
          <DialogTitle>Move to project</DialogTitle>
        </DialogHeader>

        {(projects.length > 0 || conversation.projectId) && (
          <ul className="-mx-2 max-h-64 overflow-y-auto" aria-label="Projects">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => void moveTo(p.id)}
                  className={cn(
                    'flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent',
                    p.id === conversation.projectId && 'font-medium',
                  )}
                >
                  <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.id === conversation.projectId && <CheckIcon className="size-4 shrink-0" />}
                </button>
              </li>
            ))}
            {conversation.projectId && (
              <li>
                <button
                  type="button"
                  onClick={() => void moveTo(null)}
                  className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent"
                >
                  <FolderMinusIcon className="size-4 shrink-0" />
                  Remove from project
                </button>
              </li>
            )}
          </ul>
        )}

        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name.trim()) return
            await moveTo((await createProject({ name })).id)
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New project name"
            aria-label="New project name"
            autoFocus={projects.length === 0}
          />
          <Button type="submit" variant="secondary" disabled={!name.trim()}>
            Create
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
