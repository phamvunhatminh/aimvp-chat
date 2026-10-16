import { formatCost, formatTokens } from '@/lib/format'
import { PROVIDER_IDS, PROVIDERS } from '@/lib/providers'
import type { UsageBucket } from '@/lib/usage'
import { cn } from '@/lib/utils'
import { bucketLabel, formatMetric, PROVIDER_COLORS, type UsageMetric } from './shared'

/** Columns per day or month, stacked by provider, with a tooltip on hover. */
export function BarChart({
  buckets,
  size,
  metric,
}: {
  buckets: UsageBucket[]
  size: 'day' | 'month'
  metric: UsageMetric
}) {
  const values = buckets.map((b) => b[metric])
  const max = Math.max(...values, 0)
  const total = values.reduce((a, b) => a + b, 0)
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6))
  const providers = PROVIDER_IDS.filter((p) => buckets.some((b) => (b.byProvider[p]?.[metric] ?? 0) > 0))

  return (
    <figure className="grid gap-3">
      <div className="relative h-44">
        {/* Gridlines at the max and half of it. */}
        {[0, 0.5, 1].map((f) => (
          <div key={f} className="absolute inset-x-0 border-t border-dashed" style={{ bottom: `${f * 100}%` }}>
            {f > 0 && max > 0 && (
              <span className="absolute -top-2.5 left-0 bg-background pr-1 text-[10px] text-muted-foreground tabular-nums">
                {formatMetric(max * f, metric)}
              </span>
            )}
          </div>
        ))}
        <div
          className="absolute inset-0 flex items-end gap-[2px] pl-12 sm:gap-1"
          role="img"
          aria-label={`${formatMetric(total, metric)} in total, ${formatMetric(max, metric)} at the most in one ${size}`}
        >
          {buckets.map((b, i) => {
            const value = values[i]
            return (
              <div key={b.start} className="group relative flex h-full min-w-0 flex-1 items-end">
                {value > 0 ? (
                  <div
                    className="flex w-full flex-col-reverse overflow-hidden rounded-t-[4px] transition-opacity group-hover:opacity-80"
                    style={{ height: `max(${(value / max) * 100}%, 3px)` }}
                  >
                    {providers.map((p) => {
                      const part = b.byProvider[p]?.[metric] ?? 0
                      return part > 0 ? (
                        <div key={p} className={PROVIDER_COLORS[p]} style={{ height: `${(part / value) * 100}%` }} />
                      ) : null
                    })}
                  </div>
                ) : (
                  <div className="h-[3px] w-full rounded-t-[2px] bg-muted" />
                )}
                <div
                  className={cn(
                    'pointer-events-none absolute bottom-full z-10 mb-2 hidden min-w-40 rounded-lg border bg-popover px-2.5 py-2 text-xs whitespace-nowrap shadow-md group-hover:block',
                    // Keep the tooltips of the outer bars inside the chart.
                    i < buckets.length / 4 ? 'left-0' : i >= (buckets.length * 3) / 4 ? 'right-0' : 'left-1/2 -translate-x-1/2',
                  )}
                >
                  <div className="font-medium">{bucketLabel(b.start, size, true)}</div>
                  <div className="text-muted-foreground tabular-nums">
                    {formatCost(b.cost)} · {formatTokens(b.tokens)} tokens · {b.replies} {b.replies === 1 ? 'reply' : 'replies'}
                  </div>
                  {providers.some((p) => b.byProvider[p]) && (
                    <ul className="mt-1.5 grid gap-0.5 border-t pt-1.5">
                      {providers.map((p) =>
                        b.byProvider[p] ? (
                          <li key={p} className="flex items-center gap-1.5">
                            <span className={cn('size-2 rounded-full', PROVIDER_COLORS[p])} />
                            <span className="flex-1">{PROVIDERS[p].name}</span>
                            <span className="tabular-nums">{formatMetric(b.byProvider[p][metric], metric)}</span>
                          </li>
                        ) : null,
                      )}
                    </ul>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <figcaption className="grid gap-3">
        <div className="flex gap-[2px] pl-12 text-[10px] text-muted-foreground sm:gap-1" aria-hidden>
          {buckets.map((b, i) => (
            <span key={b.start} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
              {i % labelEvery === 0 ? bucketLabel(b.start, size) : ''}
            </span>
          ))}
        </div>
        {providers.length > 1 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Providers">
            {providers.map((p) => (
              <li key={p} className="flex items-center gap-1.5">
                <span className={cn('size-2 rounded-full', PROVIDER_COLORS[p])} />
                {PROVIDERS[p].name}
              </li>
            ))}
          </ul>
        )}
      </figcaption>
    </figure>
  )
}

/** A tiny bar chart for the sidebar. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(...values, 0)
  return (
    <div className={cn('flex h-7 items-end gap-px', className)} aria-hidden>
      {values.map((v, i) => (
        <div
          key={i}
          className={cn('min-w-0 flex-1 rounded-[1px]', v > 0 ? 'bg-primary/70' : 'bg-muted')}
          style={{ height: v > 0 && max > 0 ? `max(${(v / max) * 100}%, 2px)` : '2px' }}
        />
      ))}
    </div>
  )
}

/** Progress toward a limit, turning amber near it and red past it. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? value / max : 0
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value * 100) / 100}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width]',
          ratio >= 1 ? 'bg-red-500' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-emerald-500',
        )}
        style={{ width: `${Math.min(ratio, 1) * 100}%` }}
      />
    </div>
  )
}
