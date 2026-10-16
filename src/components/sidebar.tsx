import {
  ChartColumnIcon,
  FolderIcon,
  FolderInputIcon,
  FolderPlusIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  TrashIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router'
import { Logo } from '@/components/logo'
import { NameDialog } from '@/components/name-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useChatSearch, useConversations, useProjects } from '@/hooks/use-data'
import { stopStreaming } from '@/lib/chat'
import type { Conversation, Project } from '@/lib/db'
import { createProject, deleteConversation, groupByDate, updateConversation } from '@/lib/repo'
import type { TextMatch } from '@/lib/search'
import { cn } from '@/lib/utils'
import { useIsStreaming } from '@/stores/streams'
import { useUI } from '@/stores/ui'
import { UsageWidget } from '@/components/usage/usage-widget'
import { useSettings } from '@/stores/settings'
import { MoveToProjectDialog } from './move-to-project-dialog'
import { ProjectMenu } from './project-menu'

const rowClass = 'flex h-9 items-center gap-2 rounded-md pr-9 pl-2 text-sm hover:bg-accent'
const rowMenuClass =
  'absolute top-0.5 right-0.5 text-muted-foreground data-[state=open]:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const conversations = useConversations()
  const projects = useProjects()
  const [query, setQuery] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const showUsage = useSettings((s) => s.showUsageInSidebar)
  const { id: activeId } = useParams()
  const navigate = useNavigate()
  const activeProjectId = conversations?.find((c) => c.id === activeId)?.projectId ?? null

  const searching = query.trim() !== ''
  // Chats filed in a project live on the project's page.
  const groups = useMemo(() => groupByDate((conversations ?? []).filter((c) => !c.projectId)), [conversations])

  return (
    <div className="flex h-full flex-col pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <Link to="/" onClick={onNavigate} className="flex items-center gap-2 rounded-md px-1 font-semibold">
          <Logo />
          aimvp
        </Link>
        <Button variant="ghost" size="icon" asChild>
          <Link to="/" onClick={onNavigate} aria-label="New chat" title="New chat">
            <SquarePenIcon />
          </Link>
        </Button>
      </div>

      <div className="relative px-3 pb-2">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          className="bg-background pl-8"
        />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Chat history">
        {searching && <SearchResults query={query} onNavigate={onNavigate} />}
        {!searching && (
          <section aria-label="Projects">
            <div className="flex items-center justify-between pt-2 pr-0.5 pb-1 pl-2">
              <h3 className="text-xs font-medium text-muted-foreground">Projects</h3>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-7 text-muted-foreground"
                onClick={() => setCreatingProject(true)}
                aria-label="New project"
                title="New project"
              >
                <PlusIcon />
              </Button>
            </div>
            <ul>
              {projects?.map((p) => (
                <ProjectItem key={p.id} project={p} highlighted={p.id === activeProjectId} onNavigate={onNavigate} />
              ))}
            </ul>
            {projects?.length === 0 && (
              <button
                type="button"
                onClick={() => setCreatingProject(true)}
                className={cn(rowClass, 'w-full pr-2 text-muted-foreground')}
              >
                <FolderPlusIcon className="size-4 shrink-0" />
                New project
              </button>
            )}
          </section>
        )}

        {!searching && conversations && groups.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {projects?.length ? 'Chats outside projects appear here.' : 'Your chats will appear here.'}
          </p>
        )}
        {!searching &&
          groups.map((group) => (
            <section key={group.label}>
              <h3 className="px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground">{group.label}</h3>
              <ul>
                {group.items.map((c) => (
                  <ConversationItem key={c.id} conversation={c} projects={projects ?? []} onNavigate={onNavigate} />
                ))}
              </ul>
            </section>
          ))}
      </nav>

      {showUsage && <UsageWidget onNavigate={onNavigate} />}
      <div className="flex shrink-0 gap-1 border-t p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <Button
          variant="ghost"
          className="flex-1 justify-start"
          onClick={() => {
            onNavigate?.()
            setSettingsOpen(true)
          }}
        >
          <SettingsIcon />
          Settings
        </Button>
        <Button variant="ghost" size="icon" className="text-muted-foreground" asChild>
          <NavLink to="/usage" onClick={onNavigate} aria-label="Usage" title="Usage">
            <ChartColumnIcon />
          </NavLink>
        </Button>
      </div>

      <NameDialog
        open={creatingProject}
        onOpenChange={setCreatingProject}
        title="New project"
        label="Project name"
        placeholder="e.g. Marketing plan"
        submitLabel="Create"
        onSubmit={async (name) => {
          const project = await createProject({ name })
          onNavigate?.()
          navigate(`/p/${project.id}`)
        }}
      />
    </div>
  )
}

/** `value`, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** Chats whose title or messages match, with the matching text. */
function SearchResults({ query, onNavigate }: { query: string; onNavigate?: () => void }) {
  const debounced = useDebounced(query.trim(), 150)
  const results = useChatSearch(debounced)
  if (!results || !debounced) return null
  if (results.length === 0) {
    return <p className="px-2 py-6 text-center text-sm text-muted-foreground">No chats match your search.</p>
  }
  return (
    <section aria-label="Search results">
      <ul className="pt-1">
        {results.map(({ conversation, title, message }) => (
          <li key={conversation.id}>
            <NavLink
              to={`/c/${conversation.id}${message ? `?m=${message.id}` : ''}`}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn('grid gap-0.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent', isActive && 'bg-accent')
              }
            >
              <span className="truncate font-medium">{title ? <Highlight match={title} /> : conversation.title}</span>
              {message && !(title && sameText(message.match, conversation.title)) && (
                <span className="line-clamp-2 text-xs break-words text-muted-foreground">
                  <Highlight match={message.match} />
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A chat titled after its first message would otherwise show the same text twice. */
const sameText = (m: TextMatch, text: string) => `${m.before}${m.match}${m.after}` === text

function Highlight({ match }: { match: TextMatch }) {
  return (
    <>
      {match.before}
      <mark className="rounded-sm bg-amber-200/80 text-foreground dark:bg-amber-400/30">{match.match}</mark>
      {match.after}
    </>
  )
}

function ProjectItem({
  project,
  highlighted,
  onNavigate,
}: {
  project: Project
  /** The open chat belongs to this project. */
  highlighted: boolean
  onNavigate?: () => void
}) {
  return (
    <li className="group relative">
      <NavLink
        to={`/p/${project.id}`}
        onClick={onNavigate}
        className={({ isActive }) => cn(rowClass, (isActive || highlighted) && 'bg-accent font-medium')}
      >
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{project.name}</span>
      </NavLink>
      <ProjectMenu project={project} triggerClassName={rowMenuClass} />
    </li>
  )
}

export function ConversationItem({
  conversation,
  projects,
  onNavigate,
}: {
  conversation: Conversation
  projects: Project[]
  onNavigate?: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [moving, setMoving] = useState(false)
  const streaming = useIsStreaming(conversation.id)
  const { id: activeId } = useParams()
  const navigate = useNavigate()

  async function remove() {
    stopStreaming(conversation.id)
    await deleteConversation(conversation.id)
    if (activeId === conversation.id) navigate('/')
  }

  return (
    <li className="group relative">
      <NavLink
        to={`/c/${conversation.id}`}
        onClick={onNavigate}
        className={({ isActive }) => cn(rowClass, isActive && 'bg-accent font-medium')}
      >
        <span className="truncate">{conversation.title}</span>
        {streaming && <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
      </NavLink>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className={rowMenuClass} aria-label={`Options for ${conversation.title}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMoving(true)}>
            <FolderInputIcon />
            Move to project…
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename chat"
        label="Chat title"
        initialValue={conversation.title}
        onSubmit={(title) => void updateConversation(conversation.id, { title })}
      />

      <MoveToProjectDialog conversation={conversation} projects={projects} open={moving} onOpenChange={setMoving} />

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{conversation.title}” will be permanently deleted from this browser.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
