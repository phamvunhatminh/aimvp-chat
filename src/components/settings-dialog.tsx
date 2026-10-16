import {
  DownloadIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  TrashIcon,
  UploadIcon,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ModelPicker } from '@/components/model-picker'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { connectOpenRouter } from '@/lib/connect'
import { formatCost } from '@/lib/format'
import { loadProvider, PROVIDER_IDS, PROVIDERS, ProviderError, type ProviderId } from '@/lib/providers'
import { fetchKeyInfo, type KeyInfo } from '@/lib/providers/openrouter'
import { deleteAllData, exportData, importData } from '@/lib/repo'
import { browserRecognition, canSpeakInBrowser, OPENAI_VOICES, resolveEngine, SPEECH_LANGUAGES } from '@/lib/speech'
import { cn } from '@/lib/utils'
import { usePrompts } from '@/hooks/use-data'
import { useSettings, type SpeechEngine, type Theme } from '@/stores/settings'
import { useStreams } from '@/stores/streams'
import { useUI } from '@/stores/ui'

export function SettingsDialog() {
  const open = useUI((s) => s.settingsOpen)
  const setOpen = useUI((s) => s.setSettingsOpen)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl gap-0 p-0">
        <DialogHeader className="border-b p-6 pb-4">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Everything here is saved in this browser only.</DialogDescription>
        </DialogHeader>
        <div className="divide-y">
          <ApiKeysSection />
          <DefaultsSection />
          <VoiceSection />
          <UsageSection />
          <AppearanceSection />
          <DataSection />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 p-6">
      <div>
        <h3 className="font-medium">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function maskKey(key: string) {
  return key.length > 12 ? `${key.slice(0, 7)}…${key.slice(-4)}` : '••••'
}

function ApiKeysSection() {
  return (
    <Section
      title="API keys"
      description="Add a key for each provider you want to use. Requests are billed to that provider account."
    >
      <div className="grid gap-3">
        {PROVIDER_IDS.map((provider) => (
          <ProviderKey key={provider} provider={provider} />
        ))}
      </div>
    </Section>
  )
}

function ProviderKey({ provider }: { provider: ProviderId }) {
  const apiKey = useSettings((s) => s.apiKeys[provider])
  const setApiKey = useSettings((s) => s.setApiKey)
  const [pasted, setPasted] = useState('')
  const [checking, setChecking] = useState(false)
  const { name, keyPlaceholder, keysUrl } = PROVIDERS[provider]

  async function save() {
    const key = pasted.trim()
    if (!key) return
    setChecking(true)
    try {
      await (await loadProvider(provider)).validateKey(key)
    } catch (err) {
      // Only reject keys the provider says are bad; a network hiccup shouldn't block saving.
      if (err instanceof ProviderError && err.status !== null && err.status < 500 && err.status !== 429) {
        toast.error(`That key was rejected by ${name}.`, { description: err.message })
        setChecking(false)
        return
      }
    }
    setChecking(false)
    setApiKey(provider, key)
    setPasted('')
    toast.success(`${name} key saved`)
  }

  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className={cn('size-2 shrink-0 rounded-full', apiKey ? 'bg-emerald-500' : 'bg-muted-foreground/30')} />
          {name}
          {apiKey && (
            <code className="truncate font-mono text-xs font-normal text-muted-foreground">{maskKey(apiKey)}</code>
          )}
        </div>
        {apiKey ? (
          <Button variant="outline" size="sm" onClick={() => setApiKey(provider, null)}>
            Remove
          </Button>
        ) : (
          <a
            href={keysUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Get a key
            <ExternalLinkIcon className="size-3" />
          </a>
        )}
      </div>

      {provider === 'openrouter' && apiKey && <OpenRouterCredits apiKey={apiKey} />}

      {!apiKey && (
        <>
          {provider === 'openrouter' && (
            <Button size="sm" className="justify-self-start" onClick={() => void connectOpenRouter()}>
              <KeyRoundIcon />
              Connect OpenRouter
            </Button>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <Input
              type="password"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={keyPlaceholder}
              autoComplete="off"
              spellCheck={false}
              aria-label={`${name} API key`}
            />
            <Button type="submit" variant="secondary" disabled={!pasted.trim() || checking}>
              {checking ? 'Checking…' : 'Save'}
            </Button>
          </form>
        </>
      )}
    </div>
  )
}

function OpenRouterCredits({ apiKey }: { apiKey: string }) {
  const [keyInfo, setKeyInfo] = useState<{ key: string; info: KeyInfo } | null>(null)
  const info = keyInfo && keyInfo.key === apiKey ? keyInfo.info : null

  useEffect(() => {
    const controller = new AbortController()
    fetchKeyInfo(apiKey, controller.signal).then((info) => setKeyInfo({ key: apiKey, info }), () => {})
    return () => controller.abort()
  }, [apiKey])

  if (!info) return null
  return (
    <p className="text-sm text-muted-foreground">
      Used {formatCost(info.usage)}
      {info.limit !== null ? ` of ${formatCost(info.limit)} limit` : ''}
    </p>
  )
}

function DefaultsSection() {
  const defaultModel = useSettings((s) => s.defaultModel)
  const setDefaultModel = useSettings((s) => s.setDefaultModel)
  const defaultSystemPrompt = useSettings((s) => s.defaultSystemPrompt)
  const setDefaultSystemPrompt = useSettings((s) => s.setDefaultSystemPrompt)
  const openPromptLibrary = useUI((s) => s.openPromptLibrary)
  const prompts = usePrompts()

  return (
    <Section title="New chats" description="Used when you start a new chat. Each chat can override them.">
      <div className="grid gap-2">
        <Label>Default model</Label>
        <ModelPicker variant="outline" value={defaultModel} onChange={setDefaultModel} className="w-full" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="default-system-prompt">Default system prompt</Label>
        <Textarea
          id="default-system-prompt"
          value={defaultSystemPrompt}
          onChange={(e) => setDefaultSystemPrompt(e.target.value)}
          placeholder="You are a helpful assistant…"
          className="min-h-24"
        />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0 text-sm">
          <div className="font-medium">Prompt library</div>
          <div className="text-muted-foreground">
            {prompts?.length ? `${prompts.length} saved` : 'Save prompts you reuse'} · type / to insert one
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => openPromptLibrary()}>
          Manage
        </Button>
      </div>
    </Section>
  )
}

const selectClass =
  'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

function VoiceSection() {
  const hasOpenAI = useSettings((s) => !!s.apiKeys.openai)
  const speechInput = useSettings((s) => s.speechInput)
  const speechOutput = useSettings((s) => s.speechOutput)
  const speechVoice = useSettings((s) => s.speechVoice)
  const speechLanguage = useSettings((s) => s.speechLanguage)
  const setSpeech = useSettings((s) => s.setSpeech)
  const readsWithOpenAI = resolveEngine(speechOutput, { browser: canSpeakInBrowser(), openai: hasOpenAI }) === 'openai'

  return (
    <Section
      title="Voice"
      description="Speak your messages with the mic button, and listen to replies. The browser's speech is free; OpenAI sounds more natural and is billed to your OpenAI key."
    >
      <EngineChoice
        label="Voice input"
        value={speechInput}
        onChange={(speechInput) => setSpeech({ speechInput })}
        browserSupported={!!browserRecognition()}
        hasOpenAI={hasOpenAI}
      />
      <EngineChoice
        label="Read aloud"
        value={speechOutput}
        onChange={(speechOutput) => setSpeech({ speechOutput })}
        browserSupported={canSpeakInBrowser()}
        hasOpenAI={hasOpenAI}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="speech-language">Language</Label>
          <select
            id="speech-language"
            value={speechLanguage}
            onChange={(e) => setSpeech({ speechLanguage: e.target.value })}
            className={selectClass}
          >
            <option value="">Same as browser</option>
            {SPEECH_LANGUAGES.map((l) => (
              <option key={l.tag} value={l.tag}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        {readsWithOpenAI && (
          <div className="grid gap-2">
            <Label htmlFor="speech-voice">OpenAI voice</Label>
            <select
              id="speech-voice"
              value={speechVoice}
              onChange={(e) => setSpeech({ speechVoice: e.target.value })}
              className={cn(selectClass, 'capitalize')}
            >
              {OPENAI_VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </Section>
  )
}

function EngineChoice({
  label,
  value,
  onChange,
  browserSupported,
  hasOpenAI,
}: {
  label: string
  value: SpeechEngine
  onChange: (engine: SpeechEngine) => void
  browserSupported: boolean
  hasOpenAI: boolean
}) {
  const id = useId()
  const options: { engine: SpeechEngine; name: string; note: string | null }[] = [
    { engine: 'browser', name: 'Browser', note: browserSupported ? null : 'Not supported here' },
    { engine: 'openai', name: 'OpenAI', note: hasOpenAI ? null : 'Needs an OpenAI key' },
  ]
  // Show what will actually be used when the saved choice isn't available.
  const effective = resolveEngine(value, { browser: browserSupported, openai: hasOpenAI })
  return (
    <div className="grid gap-2">
      <Label id={id}>{label}</Label>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby={id}>
        {options.map(({ engine, name, note }) => (
          <Button
            key={engine}
            variant="outline"
            role="radio"
            aria-checked={effective === engine}
            disabled={note !== null}
            onClick={() => onChange(engine)}
            className={cn('h-auto flex-col gap-0 py-2', effective === engine && 'border-foreground')}
          >
            {name}
            {note && <span className="text-xs font-normal text-muted-foreground">{note}</span>}
          </Button>
        ))}
      </div>
    </div>
  )
}

function UsageSection() {
  const showUsage = useSettings((s) => s.showUsageInSidebar)
  const budget = useSettings((s) => s.monthlyBudget)
  const setUsagePrefs = useSettings((s) => s.setUsagePrefs)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const navigate = useNavigate()
  const [budgetText, setBudgetText] = useState(budget === null ? '' : String(budget))

  function saveBudget(text: string) {
    const value = Number(text.replace(',', '.'))
    setUsagePrefs({ monthlyBudget: text.trim() && Number.isFinite(value) && value > 0 ? value : null })
  }

  return (
    <Section title="Usage" description="Spend, tokens and speed, worked out from your chats in this browser.">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="show-usage" className="font-normal">
          Show this month's usage in the sidebar
        </Label>
        <Switch id="show-usage" checked={showUsage} onCheckedChange={(on) => setUsagePrefs({ showUsageInSidebar: on })} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="monthly-budget">Monthly budget</Label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <Input
              id="monthly-budget"
              inputMode="decimal"
              value={budgetText}
              onChange={(e) => setBudgetText(e.target.value)}
              onBlur={(e) => saveBudget(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveBudget(e.currentTarget.value)}
              placeholder="None"
              className="w-32 pl-6"
            />
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setSettingsOpen(false)
            navigate('/usage')
          }}
        >
          Open usage dashboard
        </Button>
      </div>
    </Section>
  )
}

const themes: { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: 'system', label: 'System', icon: MonitorIcon },
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
]

function AppearanceSection() {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)

  return (
    <Section title="Appearance">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
        {themes.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            variant="outline"
            role="radio"
            aria-checked={theme === value}
            onClick={() => setTheme(value)}
            className={cn(theme === value && 'border-foreground')}
          >
            <Icon />
            {label}
          </Button>
        ))}
      </div>
    </Section>
  )
}

function DataSection() {
  const fileInput = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => {})
  }, [])

  async function handleExport() {
    const data = await exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aimvp-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImport(file: File) {
    try {
      const result = await importData(JSON.parse(await file.text()))
      const projects = result.projects ? `${result.projects} projects, ` : ''
      const prompts = result.prompts ? `, ${result.prompts} prompts` : ''
      toast.success(`Imported ${projects}${result.conversations} chats and ${result.messages} messages${prompts}`)
    } catch (err) {
      toast.error(err instanceof SyntaxError ? 'That file is not valid JSON.' : (err as Error).message)
    }
  }

  async function handleDeleteAll() {
    for (const controller of Object.values(useStreams.getState().controllers)) controller.abort()
    await deleteAllData()
    navigate('/')
    toast.success('All chats deleted')
  }

  return (
    <Section
      title="Your data"
      description={
        persisted === false
          ? 'Chats live in this browser. Export a backup now and then; installing aimvp as an app helps keep them safe.'
          : 'Chats live in this browser. Export a backup to move them to another device.'
      }
    >
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void handleExport()}>
          <DownloadIcon />
          Export
        </Button>
        <Button variant="outline" onClick={() => fileInput.current?.click()}>
          <UploadIcon />
          Import
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleImport(file)
            e.target.value = ''
          }}
        />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="text-destructive hover:text-destructive">
              <TrashIcon />
              Delete all chats
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete all chats?</AlertDialogTitle>
              <AlertDialogDescription>
                Every chat, project and saved prompt in this browser will be permanently deleted. Export first if you
                want a backup.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleDeleteAll()}>Delete all</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Section>
  )
}
