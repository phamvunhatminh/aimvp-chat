import { DownloadIcon, ExternalLinkIcon, KeyRoundIcon, MonitorIcon, MoonIcon, SunIcon, TrashIcon, UploadIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { connectOpenRouter } from '@/lib/connect'
import { fetchKeyInfo, formatCost, OpenRouterError, type KeyInfo } from '@/lib/openrouter'
import { deleteAllData, exportData, importData } from '@/lib/repo'
import { cn } from '@/lib/utils'
import { useSettings, type Theme } from '@/stores/settings'
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
          <AccountSection />
          <DefaultsSection />
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
  return key.length > 12 ? `${key.slice(0, 8)}…${key.slice(-4)}` : '••••'
}

function AccountSection() {
  const apiKey = useSettings((s) => s.apiKey)
  const setApiKey = useSettings((s) => s.setApiKey)
  const [keyInfo, setKeyInfo] = useState<{ key: string; info: KeyInfo } | null>(null)
  const info = keyInfo && keyInfo.key === apiKey ? keyInfo.info : null
  const [pasted, setPasted] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!apiKey) return
    const controller = new AbortController()
    fetchKeyInfo(apiKey, controller.signal).then((info) => setKeyInfo({ key: apiKey, info }), () => {})
    return () => controller.abort()
  }, [apiKey])

  async function savePastedKey() {
    const key = pasted.trim()
    if (!key) return
    setChecking(true)
    try {
      await fetchKeyInfo(key)
    } catch (err) {
      // Only reject keys OpenRouter says are bad; a network hiccup shouldn't block saving.
      if (err instanceof OpenRouterError && err.status !== null && err.status < 500) {
        toast.error('That key was rejected by OpenRouter.')
        setChecking(false)
        return
      }
    }
    setChecking(false)
    setApiKey(key)
    setPasted('')
    toast.success('OpenRouter key saved')
  }

  if (apiKey) {
    return (
      <Section title="OpenRouter" description="Requests are billed to your OpenRouter account.">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <span className="size-2 rounded-full bg-emerald-500" />
              Connected
              <code className="truncate font-mono text-xs font-normal text-muted-foreground">{maskKey(apiKey)}</code>
            </div>
            {info && (
              <p className="mt-1 text-muted-foreground">
                Used {formatCost(info.usage)}
                {info.limit !== null ? ` of ${formatCost(info.limit)} limit` : ''}
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setApiKey(null)}>
            Disconnect
          </Button>
        </div>
        <a
          href="https://openrouter.ai/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Manage limits or revoke keys on OpenRouter
          <ExternalLinkIcon className="size-3.5" />
        </a>
      </Section>
    )
  }

  return (
    <Section title="OpenRouter" description="Connect your account, or paste a key from openrouter.ai/settings/keys.">
      <Button className="justify-self-start" onClick={() => void connectOpenRouter()}>
        <KeyRoundIcon />
        Connect OpenRouter
      </Button>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void savePastedKey()
        }}
      >
        <Input
          type="password"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="sk-or-v1-…"
          autoComplete="off"
          spellCheck={false}
          aria-label="OpenRouter API key"
        />
        <Button type="submit" variant="secondary" disabled={!pasted.trim() || checking}>
          {checking ? 'Checking…' : 'Save'}
        </Button>
      </form>
    </Section>
  )
}

function DefaultsSection() {
  const defaultModel = useSettings((s) => s.defaultModel)
  const setDefaultModel = useSettings((s) => s.setDefaultModel)
  const defaultSystemPrompt = useSettings((s) => s.defaultSystemPrompt)
  const setDefaultSystemPrompt = useSettings((s) => s.setDefaultSystemPrompt)

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
      toast.success(`Imported ${result.conversations} chats and ${result.messages} messages`)
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
                Every chat in this browser will be permanently deleted. Export first if you want a backup.
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
