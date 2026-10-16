import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo } from 'react'
import { makePriceLookup, type PriceLookup } from '@/lib/pricing'
import { computeUsage, loadUsageData, periodStart, type UsagePeriod } from '@/lib/usage'
import { ensureModels, useModelCatalog } from '@/stores/models'
import { useSettings } from '@/stores/settings'

/** Prices from OpenRouter's public model list, loaded on first use. */
export function usePriceLookup(): PriceLookup {
  const openrouterKey = useSettings((s) => s.apiKeys.openrouter ?? null)
  const models = useModelCatalog((s) => s.byProvider.openrouter?.models)
  useEffect(() => {
    void ensureModels('openrouter', openrouterKey)
  }, [openrouterKey])
  return useMemo(() => makePriceLookup(models ?? []), [models])
}

/** Usage stats for a period, kept current as replies arrive. */
export function useUsage(period: UsagePeriod) {
  const price = usePriceLookup()
  const start = periodStart(period)
  const data = useLiveQuery(() => loadUsageData(start), [start])
  return useMemo(() => (data ? computeUsage({ ...data, start, price }) : undefined), [data, start, price])
}
