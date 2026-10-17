import { LogInIcon } from 'lucide-react'
import { Avatar } from '@/components/account/avatar'
import { SyncIcon } from '@/components/account/sync-status'
import { Button } from '@/components/ui/button'
import { useAccount } from '@/stores/account'
import { useUI } from '@/stores/ui'

/** The sidebar's account slot: who is signed in, and whether sync is in trouble; or a way to sign in. */
export function AccountButton({ onNavigate }: { onNavigate?: () => void }) {
  const status = useAccount((s) => s.status)
  const user = useAccount((s) => s.user)
  const sync = useAccount((s) => s.sync)
  const openSettings = useUI((s) => s.openSettings)
  const setSignInOpen = useUI((s) => s.setSignInOpen)

  if (status === 'loading') return <div className="flex-1" />

  if (status !== 'signed-in' || !user) {
    return (
      <Button
        variant="ghost"
        className="flex-1 justify-start"
        onClick={() => {
          onNavigate?.()
          setSignInOpen(true)
        }}
      >
        <LogInIcon />
        Sign in
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      className="min-w-0 flex-1 justify-start gap-2.5 px-2"
      aria-label={`Account: ${user.name}`}
      title={user.email}
      onClick={() => {
        onNavigate?.()
        openSettings('account')
      }}
    >
      <Avatar user={user} className="size-6" />
      <span className="truncate">{user.name}</span>
      {(sync === 'offline' || sync === 'error') && <SyncIcon className="ml-auto text-muted-foreground" />}
    </Button>
  )
}
