import { useState } from 'react'
import type { AccountUser } from '@/stores/account'
import { cn } from '@/lib/utils'

/** The profile picture from Google or GitHub, or the name's first letter. */
export function Avatar({ user, className }: { user: AccountUser; className?: string }) {
  const [failed, setFailed] = useState(false)
  const base = cn('size-7 shrink-0 rounded-full', className)
  if (user.avatarUrl && !failed) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn(base, 'object-cover')}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cn(base, 'grid place-items-center bg-primary text-xs font-medium text-primary-foreground uppercase')}
    >
      {(user.name || user.email).slice(0, 1)}
    </span>
  )
}
