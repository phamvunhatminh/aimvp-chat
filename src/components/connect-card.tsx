import { KeyRoundIcon, ShieldCheckIcon } from 'lucide-react'
import { useState } from 'react'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { connectOpenRouter } from '@/lib/connect'
import { useUI } from '@/stores/ui'

/** First-run screen shown until the user connects an OpenRouter key. */
export function ConnectCard() {
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const [redirecting, setRedirecting] = useState(false)

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 text-center">
      <Logo className="size-12" />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Chat with any AI model</h1>
      <p className="mt-2 text-muted-foreground">
        One app for GPT, Claude, Gemini, Llama and hundreds more, using your own API keys.
      </p>
      <div className="mt-8 flex w-full flex-col gap-2 sm:w-auto">
        <Button
          size="lg"
          disabled={redirecting}
          onClick={() => {
            setRedirecting(true)
            void connectOpenRouter().finally(() => setRedirecting(false))
          }}
        >
          <KeyRoundIcon />
          Connect OpenRouter
        </Button>
        <Button variant="ghost" size="lg" onClick={() => setSettingsOpen(true)}>
          Use an OpenAI, Anthropic or Google key
        </Button>
      </div>
      <p className="mt-8 flex items-start gap-2 text-left text-xs text-muted-foreground">
        <ShieldCheckIcon className="size-4 shrink-0" />
        Your keys and chats are stored only in this browser. Messages go straight from your device to the AI
        provider; aimvp has no server that sees them.
      </p>
    </div>
  )
}
