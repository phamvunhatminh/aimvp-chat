import { Command } from 'cmdk'
import { CheckIcon, ChevronDownIcon, SearchIcon, StarIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatPricing } from '@/lib/format'
import {
  isProviderId,
  parseModelRef,
  PROVIDERS,
  toModelRef,
  type ModelInfo,
  type ProviderId,
} from '@/lib/providers'
import { cn } from '@/lib/utils'
import { useModelCatalog, useModelGroups, useModelName } from '@/stores/models'
import { useSettings } from '@/stores/settings'

interface PickerItem {
  ref: string
  provider: ProviderId
  model: Pick<ModelInfo, 'id' | 'name' | 'pricing'>
}

/** A typed `provider:model` or OpenRouter `vendor/model` id the list doesn't have. */
function customRef(text: string): string | null {
  const colon = text.indexOf(':')
  if (colon > 0 && isProviderId(text.slice(0, colon)) && text.length > colon + 1) return text
  return /^[\w.-]+\/[\w.:-]+$/.test(text) ? toModelRef('openrouter', text) : null
}

export function ModelPicker({
  value,
  onChange,
  variant = 'ghost',
  className,
}: {
  /** Model reference, `provider:model-id`. */
  value: string
  onChange: (ref: string) => void
  variant?: 'ghost' | 'outline'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const groups = useModelGroups()
  const byProvider = useModelCatalog((s) => s.byProvider)
  const favorites = useSettings((s) => s.favoriteModels)
  const currentName = useModelName(value)
  const showProvider = groups.length > 1 || parseModelRef(value).provider !== groups[0]?.provider

  const known = useMemo(
    () => new Set(groups.flatMap((g) => g.models.map((m) => toModelRef(g.provider, m.id)))),
    [groups],
  )
  const favoriteItems: PickerItem[] = favorites.map((ref) => {
    const { provider, model } = parseModelRef(ref)
    const info = byProvider[provider]?.models.find((m) => m.id === model)
    return { ref, provider, model: info ?? { id: model, name: model } }
  })
  const typed = customRef(search.trim())
  const custom = typed && !known.has(typed) ? parseModelRef(typed) : null
  const loading = groups.some((g) => g.loading && g.models.length === 0)
  const errors = groups.filter((g) => g.error && g.models.length === 0)

  function select(ref: string) {
    onChange(ref)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          className={cn('min-w-0 justify-between gap-1 px-2.5', variant === 'ghost' && 'text-base font-semibold', className)}
        >
          <span className="truncate">{currentName}</span>
          {showProvider && (
            <span className="hidden shrink-0 text-xs font-normal text-muted-foreground sm:inline">
              {PROVIDERS[parseModelRef(value).provider].name}
            </span>
          )}
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-1rem))] p-0">
        <Command
          loop
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
        >
          <div className="flex items-center gap-2 border-b px-3">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search models…"
              className="h-11 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
            />
          </div>
          <Command.List className="max-h-[min(60dvh,26rem)] overflow-y-auto overscroll-contain p-1">
            {loading ? (
              <Command.Loading>
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">Loading models…</div>
              </Command.Loading>
            ) : (
              <Command.Empty className="px-2 py-6 text-center text-sm text-muted-foreground">No models found.</Command.Empty>
            )}
            {errors.map((g) => (
              <p key={g.provider} className="px-2 py-1.5 text-xs text-destructive">
                {PROVIDERS[g.provider].name}: {g.error}
              </p>
            ))}
            {custom && (
              <Command.Group heading="Custom">
                <ModelItem
                  item={{ ref: typed!, provider: custom.provider, model: { id: custom.model, name: `Use "${custom.model}"` } }}
                  value={value}
                  showProvider
                  onSelect={select}
                />
              </Command.Group>
            )}
            {favoriteItems.length > 0 && (
              <Command.Group heading="Favorites">
                {favoriteItems.map((item) => (
                  <ModelItem
                    key={item.ref}
                    itemValue={`favorite ${item.ref}`}
                    item={item}
                    value={value}
                    showProvider
                    onSelect={select}
                  />
                ))}
              </Command.Group>
            )}
            {groups.map((g) => (
              <Command.Group key={g.provider} heading={PROVIDERS[g.provider].name}>
                {g.models.map((m) => (
                  <ModelItem
                    key={m.id}
                    item={{ ref: toModelRef(g.provider, m.id), provider: g.provider, model: m }}
                    value={value}
                    onSelect={select}
                  />
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ModelItem({
  item,
  value,
  itemValue = item.ref,
  showProvider = false,
  onSelect,
}: {
  item: PickerItem
  value: string
  itemValue?: string
  showProvider?: boolean
  onSelect: (ref: string) => void
}) {
  const favorite = useSettings((s) => s.favoriteModels.includes(item.ref))
  const toggleFavorite = useSettings((s) => s.toggleFavoriteModel)
  const providerName = PROVIDERS[item.provider].name
  const details = [showProvider ? providerName : null, item.model.id !== item.model.name ? item.model.id : null, formatPricing(item.model)]
    .filter(Boolean)
    .join(' · ')

  return (
    <Command.Item
      value={itemValue}
      keywords={[item.model.name, item.model.id, providerName]}
      onSelect={() => onSelect(item.ref)}
      className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[selected=true]:bg-accent"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate">{item.model.name}</span>
          {item.ref === value && <CheckIcon className="size-3.5 shrink-0" />}
        </div>
        {details && <div className="truncate text-xs text-muted-foreground">{details}</div>}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggleFavorite(item.ref)
        }}
        aria-label={favorite ? `Remove ${item.model.name} from favorites` : `Add ${item.model.name} to favorites`}
        className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
      >
        <StarIcon className={cn('size-4', favorite && 'fill-amber-400 text-amber-400')} />
      </button>
    </Command.Item>
  )
}
