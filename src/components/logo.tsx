import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" className={cn('size-6', className)}>
      <rect width="512" height="512" rx="112" className="fill-foreground" />
      <path
        d="M240 104c10 84 48 122 132 132-84 10-122 48-132 132-10-84-48-122-132-132 84-10 122-48 132-132z"
        className="fill-background"
      />
      <circle cx="364" cy="364" r="30" className="fill-background" opacity=".55" />
    </svg>
  )
}
