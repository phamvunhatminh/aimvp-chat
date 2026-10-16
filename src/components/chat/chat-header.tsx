import { FileDownIcon, FolderIcon, MenuIcon, MoreHorizontalIcon, PrinterIcon, SquarePenIcon } from 'lucide-react'
import { Link } from 'react-router'
import { ModelPicker } from '@/components/model-picker'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { Project } from '@/lib/db'
import { cn } from '@/lib/utils'
import { useUI } from '@/stores/ui'
import { SystemPromptDialog } from './system-prompt-dialog'

export function ChatHeader({
  model,
  onModelChange,
  systemPrompt,
  onSystemPromptChange,
  project,
  onDownloadMarkdown,
  usageNote,
}: {
  model: string
  onModelChange: (model: string) => void
  systemPrompt: string
  onSystemPromptChange: (prompt: string) => void
  /** The project this chat belongs to (or will be created in). */
  project?: Project | null
  /** Set once the chat exists: enables the download menu. */
  onDownloadMarkdown?: () => void
  /** What this chat has used so far, e.g. "~$0.02 · 12k tokens". */
  usageNote?: string
}) {
  const setSidebarOpen = useUI((s) => s.setSidebarOpen)

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 px-2 sm:px-3 print:hidden">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open sidebar"
      >
        <MenuIcon />
      </Button>
      <ModelPicker
        value={model}
        onChange={onModelChange}
        className={cn(project ? 'max-w-[min(42vw,24rem)]' : 'max-w-[min(60vw,24rem)]')}
      />
      <div className="ml-auto flex min-w-0 items-center gap-1">
        {project && (
          <Link
            to={`/p/${project.id}`}
            className="flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            title={`Project: ${project.name}`}
          >
            <FolderIcon className="size-4 shrink-0" />
            <span className="max-w-24 truncate sm:max-w-48">{project.name}</span>
          </Link>
        )}
        <SystemPromptDialog value={systemPrompt} onSave={onSystemPromptChange} />
        {onDownloadMarkdown && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label="Chat options">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onDownloadMarkdown}>
                <FileDownIcon />
                Download as Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => window.print()}>
                <PrinterIcon />
                Print or save as PDF
              </DropdownMenuItem>
              {usageNote && (
                <p className="mt-1 border-t px-2 pt-2 pb-1 text-xs text-muted-foreground tabular-nums">
                  This chat: {usageNote}
                </p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button variant="ghost" size="icon" className="md:hidden" asChild>
          <Link to={project ? `/p/${project.id}` : '/'} aria-label="New chat">
            <SquarePenIcon />
          </Link>
        </Button>
      </div>
    </header>
  )
}
