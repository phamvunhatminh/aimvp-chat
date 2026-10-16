import { MenuIcon, SquarePenIcon } from 'lucide-react'
import { Link } from 'react-router'
import { ModelPicker } from '@/components/model-picker'
import { Button } from '@/components/ui/button'
import { useUI } from '@/stores/ui'
import { SystemPromptDialog } from './system-prompt-dialog'

export function ChatHeader({
  model,
  onModelChange,
  systemPrompt,
  onSystemPromptChange,
}: {
  model: string
  onModelChange: (model: string) => void
  systemPrompt: string
  onSystemPromptChange: (prompt: string) => void
}) {
  const setSidebarOpen = useUI((s) => s.setSidebarOpen)

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 px-2 sm:px-3">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open sidebar"
      >
        <MenuIcon />
      </Button>
      <ModelPicker value={model} onChange={onModelChange} className="max-w-[min(60vw,24rem)]" />
      <div className="ml-auto flex items-center gap-1">
        <SystemPromptDialog value={systemPrompt} onSave={onSystemPromptChange} />
        <Button variant="ghost" size="icon" className="md:hidden" asChild>
          <Link to="/" aria-label="New chat">
            <SquarePenIcon />
          </Link>
        </Button>
      </div>
    </header>
  )
}
