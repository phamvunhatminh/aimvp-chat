import {
  ActivityIcon,
  ChartColumnIcon,
  CoinsIcon,
  ExternalLinkIcon,
  GlobeIcon,
  ImageIcon,
  TimerIcon,
  WalletIcon,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { SidebarToggle } from '@/components/sidebar-toggle'
import { BarChart, Meter } from '@/components/usage/charts'
import { costText, formatMetric, PROVIDER_COLORS, type UsageMetric } from '@/components/usage/shared'
import { Button } from '@/components/ui/button'
import { useUsage } from '@/hooks/use-usage'
import { formatCost, formatTokens } from '@/lib/format'
import { isProviderId, parseModelRef } from '@/lib/providers'
import { fetchKeyInfo, type KeyInfo } from '@/lib/providers/openrouter'
import { USAGE_PERIODS, type UsagePeriod, type UsageRow, type UsageStats } from '@/lib/usage'
import { cn } from '@/lib/utils'
import { useModelName } from '@/stores/models'
import { useSettings } from '@/stores/settings'

const PERIOD_KEY = 'aimvp.usage-period'

function readPeriod(): UsagePeriod {
  try {
    const saved = localStorage.getItem(PERIOD_KEY)
    if (USAGE_PERIODS.some((p) => p.value === saved)) return saved as UsagePeriod
  } catch {
    // Storage unavailable: use the default.
  }
  return 'month'
}

export function UsagePage() {
  const [period, setPeriod] = useState<UsagePeriod>(readPeriod)
  const [metric, setMetric] = useState<UsageMetric>('cost')
  const stats = useUsage(period)

  useEffect(() => {
    document.title = 'Usage'
  }, [])

  function choosePeriod(next: UsagePeriod) {
    setPeriod(next)
    try {
      localStorage.setItem(PERIOD_KEY, next)
    } catch {
      // Not remembered; that's fine.
    }
  }

  // With no prices known at all, tokens tell the story better than $0.
  const shownMetric: UsageMetric = stats && stats.totals.cost === 0 && stats.totals.replies > 0 ? 'tokens' : metric

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1 px-2 sm:px-3">
        <SidebarToggle />
        <h1 className="px-2 text-base font-semibold">Usage</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 pt-2 pb-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {stats ? periodText(stats) : '\u00a0'}
            </p>
            <Segmented
              label="Period"
              value={period}
              onChange={choosePeriod}
              options={USAGE_PERIODS}
            />
          </div>

          {stats && stats.totals.replies === 0 ? (
            <EmptyUsage />
          ) : stats ? (
            <>
              <Kpis stats={stats} period={period} />

              <Card
                title={shownMetric === 'cost' ? `Spend per ${stats.bucketSize}` : `Tokens per ${stats.bucketSize}`}
                action={
                  stats.totals.cost > 0 && (
                    <Segmented
                      label="Chart shows"
                      value={metric}
                      onChange={setMetric}
                      options={[
                        { value: 'cost', label: 'Spend' },
                        { value: 'tokens', label: 'Tokens' },
                      ]}
                      small
                    />
                  )
                }
              >
                <BarChart buckets={stats.buckets} size={stats.bucketSize} metric={shownMetric} />
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="By provider">
                  <ProviderBar rows={stats.byProvider} metric={shownMetric} />
                  <Breakdown
                    rows={stats.byProvider}
                    metric={shownMetric}
                    dot={(r) => (isProviderId(r.key) ? PROVIDER_COLORS[r.key] : 'bg-muted-foreground')}
                  />
                </Card>
                <Card title="By model">
                  <Breakdown
                    rows={stats.byModel.slice(0, 8)}
                    metric={shownMetric}
                    dot={(r) => PROVIDER_COLORS[parseModelRef(r.key).provider]}
                    label={(r) => <ModelLabel modelRef={r.key} />}
                  />
                  {stats.byModel.length > 8 && (
                    <p className="mt-2 text-xs text-muted-foreground">and {stats.byModel.length - 8} more</p>
                  )}
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="By project">
                  <Breakdown rows={stats.byProject} metric={shownMetric} />
                </Card>
                <Card title="Top chats">
                  {stats.topChats.length ? (
                    <Breakdown
                      rows={stats.topChats}
                      metric={shownMetric}
                      label={(r) => (
                        <Link to={`/c/${r.key}`} className="truncate hover:underline">
                          {r.label}
                        </Link>
                      )}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">The chats from this period were deleted.</p>
                  )}
                </Card>
              </div>
            </>
          ) : null}

          <OpenRouterKeyCard />

          <p className="text-xs leading-5 text-muted-foreground">
            OpenRouter reports what each reply cost. For OpenAI, Anthropic and Gemini keys, amounts marked ~ are
            estimates from OpenRouter's list prices and leave out web search fees; check each provider's console for
            your bill. Everything here is worked out in this browser from your chat history.
          </p>
        </div>
      </div>
    </div>
  )
}

function periodText(stats: UsageStats) {
  const format = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${format.format(stats.start)} – today`
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  small,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  small?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground',
            small ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
            value === o.value && 'bg-background text-foreground shadow-sm',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border p-4 sm:p-5" aria-label={title}>
      <div className="mb-4 flex min-h-6 items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Kpi({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: LucideIcon
  label: string
  value: string
  children?: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border p-4" aria-label={label}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-2 truncate text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 grid gap-2 text-xs text-muted-foreground">{children}</div>
    </section>
  )
}

function Kpis({ stats, period }: { stats: UsageStats; period: UsagePeriod }) {
  const budget = useSettings((s) => s.monthlyBudget)
  const { totals } = stats
  const tokens = totals.promptTokens + totals.completionTokens

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi icon={WalletIcon} label="Spend" value={costText(totals.cost, totals.estimatedCost)}>
        {totals.estimatedCost > 0 && <span>{formatCost(totals.estimatedCost)} of it estimated</span>}
        {totals.unpriced > 0 && <span>{totals.unpriced} replies without a known price</span>}
        {budget !== null && period === 'month' && (
          <>
            <Meter value={totals.cost} max={budget} label="Monthly budget used" />
            <span>
              {Math.round((totals.cost / budget) * 100)}% of your {formatCost(budget)} budget
            </span>
          </>
        )}
      </Kpi>
      <Kpi icon={CoinsIcon} label="Tokens" value={formatTokens(tokens)}>
        <span>
          {formatTokens(totals.promptTokens)} in · {formatTokens(totals.completionTokens)} out
        </span>
        {totals.cachedTokens > 0 && <span>{formatTokens(totals.cachedTokens)} of the input read from cache</span>}
        {tokens > 0 && (
          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="bg-primary/40" style={{ width: `${(totals.promptTokens / tokens) * 100}%` }} />
            <div className="bg-primary" style={{ width: `${(totals.completionTokens / tokens) * 100}%` }} />
          </div>
        )}
      </Kpi>
      <Kpi
        icon={ActivityIcon}
        label="Activity"
        value={`${totals.replies.toLocaleString()} ${totals.replies === 1 ? 'reply' : 'replies'}`}
      >
        <span>
          {totals.chats.toLocaleString()} {totals.chats === 1 ? 'chat' : 'chats'} · {totals.messages.toLocaleString()}{' '}
          sent
        </span>
        {(totals.images > 0 || totals.webSearches > 0) && (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {totals.images > 0 && (
              <span className="inline-flex items-center gap-1">
                <ImageIcon className="size-3" />
                {totals.images} {totals.images === 1 ? 'image' : 'images'}
              </span>
            )}
            {totals.webSearches > 0 && (
              <span className="inline-flex items-center gap-1">
                <GlobeIcon className="size-3" />
                {totals.webSearches} {totals.webSearches === 1 ? 'search' : 'searches'}
              </span>
            )}
          </span>
        )}
      </Kpi>
      <Kpi
        icon={TimerIcon}
        label="Speed"
        value={totals.firstTokenMs === null ? '—' : `${(totals.firstTokenMs / 1000).toFixed(1)} s`}
      >
        {totals.firstTokenMs === null ? (
          <span>Measured for new replies from now on</span>
        ) : (
          <>
            <span>average wait for the first word</span>
            {totals.tokensPerSecond !== null && <span>then {Math.round(totals.tokensPerSecond)} tokens/s</span>}
          </>
        )}
      </Kpi>
    </div>
  )
}

const rowValue = (r: UsageRow, metric: UsageMetric) => (metric === 'cost' ? r.cost : r.promptTokens + r.completionTokens)

/** Rows with a share bar each, largest first. */
function Breakdown({
  rows,
  metric,
  dot,
  label,
}: {
  rows: UsageRow[]
  metric: UsageMetric
  dot?: (row: UsageRow) => string
  label?: (row: UsageRow) => ReactNode
}) {
  const max = Math.max(...rows.map((r) => rowValue(r, metric)), 0)
  return (
    <ul className="grid gap-3">
      {rows.map((r) => {
        const value = rowValue(r, metric)
        return (
          <li key={r.key} className="grid gap-1.5">
            <div className="flex items-center gap-2 text-sm">
              {dot && <span className={cn('size-2 shrink-0 rounded-full', dot(r))} />}
              <span className="flex min-w-0 flex-1 truncate">{label ? label(r) : r.label}</span>
              <span
                className="shrink-0 font-medium tabular-nums"
                title={metric === 'cost' && r.cost === 0 && r.unpriced ? 'No known price for these replies' : undefined}
              >
                {metric !== 'cost'
                  ? formatMetric(value, metric)
                  : r.cost === 0 && r.unpriced
                    ? '—'
                    : costText(r.cost, r.estimatedCost)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full', dot ? dot(r) : 'bg-primary/70')}
                  style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }}
                />
              </div>
              <span className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {metric === 'cost'
                  ? `${formatTokens(r.promptTokens + r.completionTokens)} tokens`
                  : `${r.replies} ${r.replies === 1 ? 'reply' : 'replies'}`}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Each provider's share, as one stacked bar. */
function ProviderBar({ rows, metric }: { rows: UsageRow[]; metric: UsageMetric }) {
  const total = rows.reduce((sum, r) => sum + rowValue(r, metric), 0)
  if (total === 0 || rows.length < 2) return null
  return (
    <div className="mb-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
      {rows.map((r) => (
        <div
          key={r.key}
          className={isProviderId(r.key) ? PROVIDER_COLORS[r.key] : 'bg-muted-foreground'}
          style={{ width: `${(rowValue(r, metric) / total) * 100}%` }}
        />
      ))}
    </div>
  )
}

function ModelLabel({ modelRef }: { modelRef: string }) {
  const name = useModelName(modelRef)
  return (
    <span className="truncate" title={modelRef}>
      {name}
    </span>
  )
}

function EmptyUsage() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <ChartColumnIcon className="size-6 text-muted-foreground" />
      </div>
      <h2 className="font-medium">No usage in this period</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Spend, tokens and speed show up here as you chat. Pick a longer period to see older chats.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to="/">Start a chat</Link>
      </Button>
    </div>
  )
}

/** What the OpenRouter key has used, against its limit. */
function OpenRouterKeyCard() {
  const apiKey = useSettings((s) => s.apiKeys.openrouter)
  const [info, setInfo] = useState<{ key: string; info: KeyInfo } | null>(null)

  useEffect(() => {
    if (!apiKey) return
    const controller = new AbortController()
    fetchKeyInfo(apiKey, controller.signal).then((i) => setInfo({ key: apiKey, info: i }), () => {})
    return () => controller.abort()
  }, [apiKey])

  const key = apiKey && info?.key === apiKey ? info.info : null
  if (!key) return null
  return (
    <Card
      title="OpenRouter key"
      action={
        <a
          href="https://openrouter.ai/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Manage
          <ExternalLinkIcon className="size-3" />
        </a>
      }
    >
      <div className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span>
            <span className="text-lg font-semibold tabular-nums">{formatCost(key.usage)}</span>{' '}
            <span className="text-muted-foreground">used on this key, all time</span>
          </span>
          <span className="text-muted-foreground">
            {key.limit !== null
              ? `${formatCost(Math.max(0, key.limit - key.usage))} left of ${formatCost(key.limit)}`
              : 'No spending limit'}
          </span>
        </div>
        {key.limit !== null && <Meter value={key.usage} max={key.limit} label="OpenRouter key limit used" />}
      </div>
    </Card>
  )
}
