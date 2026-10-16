import { formatCost, formatTokens } from '@/lib/format'
import type { ProviderId } from '@/lib/providers'

/** One colour per provider across the usage charts. */
export const PROVIDER_COLORS: Record<ProviderId, string> = {
  openrouter: 'bg-violet-500',
  openai: 'bg-emerald-500',
  anthropic: 'bg-orange-500',
  google: 'bg-sky-500',
}

export type UsageMetric = 'cost' | 'tokens'

export function formatMetric(value: number, metric: UsageMetric): string {
  return metric === 'cost' ? formatCost(value) : formatTokens(value)
}

export function bucketLabel(start: number, size: 'day' | 'month', long = false): string {
  return new Intl.DateTimeFormat(
    undefined,
    size === 'month'
      ? { month: 'short', year: 'numeric' }
      : long
        ? { weekday: 'short', month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric' },
  ).format(start)
}

/** "~$1.23" when part of the amount is an estimate. */
export function costText(cost: number, estimated: number): string {
  return `${estimated > 0 ? '~' : ''}${formatCost(cost)}`
}
