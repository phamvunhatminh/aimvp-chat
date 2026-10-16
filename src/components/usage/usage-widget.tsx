import { NavLink } from 'react-router'
import { useUsage } from '@/hooks/use-usage'
import { formatCost, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSettings } from '@/stores/settings'
import { Meter, Sparkline } from './charts'
import { costText } from './shared'

/** This month's spend at a glance, at the foot of the sidebar; opens the dashboard. */
export function UsageWidget({ onNavigate }: { onNavigate?: () => void }) {
  const stats = useUsage('month')
  const budget = useSettings((s) => s.monthlyBudget)
  // Nothing to show until the first reply of the month.
  if (!stats || stats.totals.replies === 0) return null
  const { totals } = stats
  const tokens = totals.promptTokens + totals.completionTokens
  // Without known prices, spend would read $0; show tokens instead.
  const byTokens = totals.cost === 0 && tokens > 0

  return (
    <NavLink
      to="/usage"
      onClick={onNavigate}
      aria-label="Usage this month"
      className={({ isActive }) =>
        cn(
          'mx-2 mb-2 grid gap-1.5 rounded-xl border bg-background p-3 transition-colors hover:bg-accent/60',
          isActive && 'border-ring/50',
        )
      }
    >
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>This month</span>
        <span className="tabular-nums">{byTokens ? `${totals.replies} replies` : `${formatTokens(tokens)} tokens`}</span>
      </div>
      <div className="flex items-baseline gap-1 tabular-nums">
        <span className="text-lg leading-none font-semibold">
          {byTokens ? `${formatTokens(tokens)} tokens` : costText(totals.cost, totals.estimatedCost)}
        </span>
        {budget !== null && !byTokens && <span className="text-xs text-muted-foreground">/ {formatCost(budget)}</span>}
      </div>
      <Sparkline values={stats.buckets.map((b) => (byTokens ? b.tokens : b.cost))} />
      {budget !== null && !byTokens && <Meter value={totals.cost} max={budget} label="Monthly budget used" />}
    </NavLink>
  )
}
