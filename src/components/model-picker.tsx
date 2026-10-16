import { Command } from 'cmdk'
import { CheckIcon, ChevronDownIcon, SearchIcon, StarIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useModels } from '@/hooks/use-models'
import { formatPricing, type ORModel } from '@/lib/openrouter'
import { cn } from '@/lib/utils'
import { useSettings } from '@/stores/settings'

type PickerModel = Pick<ORModel, 'id' | 'name' | 'pricing'>

export function ModelPicker({
  value,
  onChange,
  variant = 'ghost',
  className,
}: {
  value: string
  onChange: (model: string) => void
  variant?: 'ghost' | 'outline'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { models, loading, error } = useModels()
  const favorites = useSettings((s) => s.favoriteModels)

  const sorted = useMemo(() => [...models].sort((a, b) => a.name.localeCompare(b.name)), [models])
  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models])
  const favoriteModels: PickerModel[] = favorites.map((id) => byId.get(id) ?? { id, name: id })
  const current = byId.get(value)
  // Lets users pick a model id that is missing from the list (or when the list failed to load).
  const customId = search.trim()
  const showCustom = /^[\w.-]+\/[\w.:-]+$/.test(customId) && !byId.has(customId)

  function select(id: string) {
    onChange(id)
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
          <span className="truncate">{current?.name ?? value}</span>
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
            {loading && models.length === 0 ? (
              <Command.Loading>
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">Loading models…</div>
              </Command.Loading>
            ) : (
              <Command.Empty className="px-2 py-6 text-center text-sm text-muted-foreground">
                {error ?? 'No models found.'}
              </Command.Empty>
            )}
            {showCustom && (
              <Command.Group heading="Custom">
                <ModelItem model={{ id: customId, name: `Use "${customId}"` }} value={value} onSelect={select} />
              </Command.Group>
            )}
            {favoriteModels.length > 0 && (
              <Command.Group heading="Favorites">
                {favoriteModels.map((m) => (
                  <ModelItem key={m.id} itemValue={`favorite ${m.id}`} model={m} value={value} onSelect={select} />
                ))}
              </Command.Group>
            )}
            <Command.Group heading="All models">
              {sorted.map((m) => (
                <ModelItem key={m.id} model={m} value={value} onSelect={select} />
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ModelItem({
  model,
  value,
  itemValue = model.id,
  onSelect,
}: {
  model: PickerModel
  value: string
  itemValue?: string
  onSelect: (id: string) => void
}) {
  const favorite = useSettings((s) => s.favoriteModels.includes(model.id))
  const toggleFavorite = useSettings((s) => s.toggleFavoriteModel)
  const pricing = formatPricing(model)

  return (
    <Command.Item
      value={itemValue}
      keywords={[model.name, model.id]}
      onSelect={() => onSelect(model.id)}
      className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[selected=true]:bg-accent"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate">{model.name}</span>
          {model.id === value && <CheckIcon className="size-3.5 shrink-0" />}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {model.id}
          {pricing && ` · ${pricing}`}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggleFavorite(model.id)
        }}
        aria-label={favorite ? `Remove ${model.name} from favorites` : `Add ${model.name} to favorites`}
        className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
      >
        <StarIcon className={cn('size-4', favorite && 'fill-amber-400 text-amber-400')} />
      </button>
    </Command.Item>
  )
}
