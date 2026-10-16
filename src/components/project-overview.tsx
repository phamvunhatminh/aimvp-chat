import { FolderIcon } from 'lucide-react'
import { PromptDialog } from '@/components/chat/system-prompt-dialog'
import { ProjectMenu } from '@/components/project-menu'
import { ConversationItem } from '@/components/sidebar'
import { Button } from '@/components/ui/button'
import { useConversations, useProjects } from '@/hooks/use-data'
import type { Project } from '@/lib/db'
import { updateProject } from '@/lib/repo'

/** The project page: its instructions and chats, above a composer that starts a chat in it. */
export function ProjectOverview({ project }: { project: Project }) {
  const conversations = useConversations()
  const projects = useProjects()
  const chats = conversations?.filter((c) => c.projectId === project.id) ?? []

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-8">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FolderIcon className="size-5" />
        </div>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
        <ProjectMenu project={project} />
      </div>

      <section className="mt-6 flex items-start justify-between gap-4 rounded-xl border p-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Instructions</h2>
          <p className="mt-1 line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">
            {project.instructions.trim() ||
              'Tell the model how to help with this project: background, tone, or rules to follow in every chat.'}
          </p>
        </div>
        <PromptDialog
          value={project.instructions}
          onSave={(instructions) => void updateProject(project.id, { instructions })}
          title="Project instructions"
          description="Sent with every chat in this project, before each chat's own system prompt."
          trigger={
            <Button variant="outline" size="sm" className="shrink-0">
              {project.instructions.trim() ? 'Edit' : 'Add'}
            </Button>
          }
        />
      </section>

      <section className="mt-8" aria-label="Chats in this project">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Chats</h2>
        {chats.length === 0 ? (
          <p className="text-sm text-muted-foreground">No chats yet. Send a message below to start one.</p>
        ) : (
          <ul className="rounded-xl border p-1">
            {chats.map((c) => (
              <ConversationItem key={c.id} conversation={c} projects={projects ?? []} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
