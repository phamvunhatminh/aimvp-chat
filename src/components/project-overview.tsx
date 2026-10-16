import { FolderIcon, LoaderCircleIcon, PlusIcon, XIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileChip } from '@/components/chat/attachments'
import { PromptDialog } from '@/components/chat/system-prompt-dialog'
import { ProjectMenu } from '@/components/project-menu'
import { ConversationItem } from '@/components/sidebar'
import { Button } from '@/components/ui/button'
import { useConversations, useProjects } from '@/hooks/use-data'
import type { Attachment, Project } from '@/lib/db'
import { describeFile, DOCUMENT_ACCEPT, FileError, fileKind, prepareFile } from '@/lib/files'
import { estimateTokens, formatTokens } from '@/lib/format'
import { addProjectFiles, removeProjectFile, updateProject } from '@/lib/repo'

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

      <ProjectFiles project={project} />

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

/** Above this, every message in the project gets expensive (and small models run out of room). */
const LARGE_PROJECT_TOKENS = 100_000

/** Turns a dropped or picked file into a project file: documents only, kept as text. */
async function toProjectFile(file: File): Promise<Attachment> {
  if (fileKind(file) === 'image') {
    throw new FileError(`${file.name}: projects take documents. Attach images to a message instead.`)
  }
  const { attachment } = await prepareFile(file)
  if (!attachment.text.trim()) throw new FileError(`${file.name}: no text found in this file.`)
  return { ...attachment, blobId: null }
}

function ProjectFiles({ project }: { project: Project }) {
  const input = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState<string[]>([])
  const tokens = project.files.reduce((sum, f) => sum + estimateTokens(f.text), 0)

  async function add(files: File[]) {
    setReading((r) => [...r, ...files.map((f) => f.name)])
    const added = await Promise.all(
      files.map(async (file) => {
        try {
          return [await toProjectFile(file)]
        } catch (err) {
          toast.error(err instanceof FileError ? err.message : `${file.name} couldn't be added.`)
          return []
        } finally {
          setReading((r) => r.filter((name) => name !== file.name))
        }
      }),
    )
    if (added.flat().length) await addProjectFiles(project.id, added.flat())
  }

  return (
    <section className="mt-4 rounded-xl border p-4" aria-label="Project files">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Files</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.files.length
              ? `Sent with every message in this project, about ${formatTokens(tokens)} tokens.`
              : 'Documents the model should know in every chat here: briefs, notes, specs, data.'}
          </p>
          {tokens > LARGE_PROJECT_TOKENS && (
            <p className="mt-1 text-sm text-amber-600 dark:text-amber-500">
              That's a lot to send each time. Remove files you don't need, or use a model with a large context.
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => input.current?.click()}
          aria-label="Add files"
        >
          <PlusIcon />
          Add
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept={DOCUMENT_ACCEPT}
          className="hidden"
          aria-label="Add project files"
          onChange={(e) => {
            if (e.target.files) void add(Array.from(e.target.files))
            e.target.value = ''
          }}
        />
      </div>
      {(project.files.length > 0 || reading.length > 0) && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {project.files.map((f) => (
            <li key={f.id} className="relative">
              <FileChip
                name={f.name}
                detail={`${describeFile(f)} · ~${formatTokens(estimateTokens(f.text))} tokens`}
                mimeType={f.mimeType}
              />
              <button
                type="button"
                onClick={() => void removeProjectFile(project.id, f.id)}
                aria-label={`Remove ${f.name}`}
                className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
          {reading.map((name, i) => (
            <li key={`${name}-${i}`}>
              <FileChip name={name} detail="Reading…" mimeType="text/plain">
                <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
              </FileChip>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
