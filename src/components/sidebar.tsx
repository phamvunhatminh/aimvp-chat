import { LoaderCircleIcon, MoreHorizontalIcon, PencilIcon, SearchIcon, SettingsIcon, SquarePenIcon, TrashIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router'
import { Logo } from '@/components/logo'
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useConversations } from '@/hooks/use-data'
import { stopStreaming } from '@/lib/chat'
import type { Conversation } from '@/lib/db'
import { deleteConversation, groupByDate, updateConversation } from '@/lib/repo'
import { cn } from '@/lib/utils'
import { useIsStreaming } from '@/stores/streams'
import { useUI } from '@/stores/ui'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const conversations = useConversations()
  const [query, setQuery] = useState('')
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = conversations ?? []
    return groupByDate(q ? list.filter((c) => c.title.toLowerCase().includes(q)) : list)
  }, [conversations, query])

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
        {conversations && groups.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {query ? 'No chats match your search.' : 'Your chats will appear here.'}
          </p>
        )}
        {groups.map((group) => (
          <section key={group.label}>
            <h3 className="px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground">{group.label}</h3>
            <ul>
              {group.items.map((c) => (
                <ConversationItem key={c.id} conversation={c} onNavigate={onNavigate} />
              ))}
            </ul>
          </section>
        ))}
      </nav>

      <div className="shrink-0 border-t p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => {
            onNavigate?.()
            setSettingsOpen(true)
          }}
        >
          <SettingsIcon />
          Settings
        </Button>
      </div>
    </div>
  )
}

function ConversationItem({ conversation, onNavigate }: { conversation: Conversation; onNavigate?: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [title, setTitle] = useState(conversation.title)
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
        className={({ isActive }) =>
          cn(
            'flex h-9 items-center gap-2 rounded-md pr-9 pl-2 text-sm hover:bg-accent',
            isActive && 'bg-accent font-medium',
          )
        }
      >
        <span className="truncate">{conversation.title}</span>
        {streaming && <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
      </NavLink>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-0.5 right-0.5 text-muted-foreground data-[state=open]:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
            aria-label={`Options for ${conversation.title}`}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setTitle(conversation.title)
              setRenaming(true)
            }}
          >
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent aria-describedby={undefined}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (title.trim()) void updateConversation(conversation.id, { title: title.trim() })
              setRenaming(false)
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename chat</DialogTitle>
            </DialogHeader>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus aria-label="Chat title" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
