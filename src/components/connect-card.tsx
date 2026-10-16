import { KeyRoundIcon, ShieldCheckIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { connectOpenRouter } from '@/lib/connect'
import { useUI } from '@/stores/ui'

/** First-run screen shown until the user connects an OpenRouter key. */
export function ConnectCard() {
  const openSettings = useUI((s) => s.openSettings)
  const [redirecting, setRedirecting] = useState(false)

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 text-center">
      <h1 className="text-[1.75rem] font-semibold tracking-tight sm:text-[2rem]">Chat with any AI model</h1>
      <p className="mt-3 text-muted-foreground">
        One place for GPT, Claude, Gemini, Llama and hundreds more, using your own API keys.
      </p>
      <ul className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground" aria-label="Providers">
        {['OpenRouter', 'OpenAI', 'Anthropic', 'Google Gemini'].map((name) => (
          <li key={name} className="rounded-full border px-3 py-1">
            {name}
          </li>
        ))}
      </ul>
      <div className="mt-8 flex w-full flex-col gap-2 sm:w-auto">
        <Button
          size="lg"
          className="rounded-full"
          disabled={redirecting}
          onClick={() => {
            setRedirecting(true)
            void connectOpenRouter().finally(() => setRedirecting(false))
          }}
        >
          <KeyRoundIcon />
          Connect OpenRouter
        </Button>
        <Button variant="ghost" size="lg" className="rounded-full" onClick={() => openSettings('keys')}>
          Use an OpenAI, Anthropic or Google key
        </Button>
      </div>
      <p className="mt-8 flex items-start gap-2 text-left text-xs text-muted-foreground">
        <ShieldCheckIcon className="size-4 shrink-0" />
        Your keys and chats are stored only in this browser. Messages go straight from your device to the AI
        provider, with no server in between.
      </p>
    </div>
  )
}
