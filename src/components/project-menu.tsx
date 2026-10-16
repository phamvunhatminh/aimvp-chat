import { MoreHorizontalIcon, PencilIcon, TrashIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
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
import type { Project } from '@/lib/db'
import { deleteProject, updateProject } from '@/lib/repo'

/** Rename / delete menu for a project, used in the sidebar and on the project page. */
export function ProjectMenu({ project, triggerClassName }: { project: Project; triggerClassName?: string }) {
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { projectId: openProjectId } = useParams()
  const navigate = useNavigate()

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className={triggerClassName}
            aria-label={`Options for project ${project.name}`}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <PencilIcon />
            Rename
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
        title="Rename project"
        label="Project name"
        initialValue={project.name}
        onSubmit={(name) => void updateProject(project.id, { name })}
      />

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              “{project.name}” and its instructions will be deleted. Its chats are kept and move back to your chat list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await deleteProject(project.id)
                if (openProjectId === project.id) navigate('/')
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
