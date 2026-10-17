import { LoaderCircleIcon, LogOutIcon, RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Avatar } from '@/components/account/avatar'
import { SignInForm } from '@/components/account/sign-in-form'
import { SIGN_IN_PITCH, SIGN_IN_TITLES, type SignInMode } from '@/components/account/sign-in-mode'
import { SyncStatus } from '@/components/account/sync-status'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { signOut, syncNow } from '@/lib/account'
import { useAccount } from '@/stores/account'
import { useStreams } from '@/stores/streams'
import { useUI } from '@/stores/ui'

/** Settings → Account: sign in, or who is signed in and how sync is going. */
export function AccountSection() {
  const status = useAccount((s) => s.status)
  const user = useAccount((s) => s.user)
  const syncing = useAccount((s) => s.sync === 'syncing')
  const [mode, setMode] = useState<SignInMode>('sign-in')

  if (status === 'loading') {
    return (
      <div className="grid place-items-center p-10">
        <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" aria-label="Loading account" />
      </div>
    )
  }

  if (status !== 'signed-in' || !user) {
    return (
      <section className="grid gap-4 p-5 sm:p-6">
        <div>
          <h3 className="font-semibold">{SIGN_IN_TITLES[mode]}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{SIGN_IN_PITCH}</p>
        </div>
        <div className="max-w-sm">
          <SignInForm mode={mode} onModeChange={setMode} />
        </div>
      </section>
    )
  }

  return (
    <section className="grid gap-5 p-5 sm:p-6">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar user={user} className="size-10 text-base" />
        <div className="min-w-0">
          <p className="truncate font-medium">{user.name}</p>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        </div>
      </div>
      <div className="grid gap-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SyncStatus />
          <Button
            variant="outline"
            size="sm"
            disabled={syncing}
            onClick={() => void syncNow().catch(() => {})}
          >
            <RefreshCwIcon />
            Sync now
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Chats, projects, saved prompts, files and preferences sync with this account. API keys and the default model
          stay in this browser.
        </p>
      </div>
      <div>
        <SignOutButton />
      </div>
    </section>
  )
}

function SignOutButton() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const navigate = useNavigate()

  async function confirm() {
    setBusy(true)
    try {
      for (const controller of Object.values(useStreams.getState().controllers)) controller.abort()
      await signOut({ force: failed !== null })
      setOpen(false)
      useUI.getState().setSettingsOpen(false)
      navigate('/')
      toast.success('Signed out')
    } catch (err) {
      setFailed((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setFailed(null)
      }}
    >
      <Button variant="outline" onClick={() => setOpen(true)}>
        <LogOutIcon />
        Sign out
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out?</AlertDialogTitle>
          <AlertDialogDescription>
            {failed
              ? `Your latest changes couldn't be sent to your account (${failed}). Signing out now loses them.`
              : 'Your chats stay in your account and are removed from this browser. Your API keys stay here.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant={failed ? 'destructive' : 'default'} disabled={busy} onClick={() => void confirm()}>
            {busy && <LoaderCircleIcon className="animate-spin" />}
            {failed ? 'Sign out anyway' : 'Sign out'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
