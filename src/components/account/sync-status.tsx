import { CloudAlertIcon, CloudCheckIcon, CloudOffIcon, LoaderCircleIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAccount } from '@/stores/account'

/** The current time, updated every `ms`. */
function useNow(ms: number) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

export function SyncIcon({ className }: { className?: string }) {
  const sync = useAccount((s) => s.sync)
  if (sync === 'syncing') return <LoaderCircleIcon className={cn('animate-spin', className)} />
  if (sync === 'offline') return <CloudOffIcon className={className} />
  if (sync === 'error') return <CloudAlertIcon className={cn('text-destructive', className)} />
  return <CloudCheckIcon className={className} />
}

/** "Synced 2 minutes ago", "Syncing…", or what went wrong. */
export function SyncStatus() {
  const { sync, syncError, lastSyncedAt } = useAccount()
  const now = useNow(30_000)
  let text = lastSyncedAt ? `Synced ${formatAgo(lastSyncedAt, now)}` : 'Waiting to sync'
  if (sync === 'syncing') text = 'Syncing…'
  if (sync === 'offline') text = "Offline. Changes will sync when you're back online."
  if (sync === 'error') text = `Couldn't sync: ${syncError}`

  return (
    <p role="status" className="flex min-w-0 items-center gap-2 text-sm">
      <SyncIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  )
}
