import { toast } from 'sonner'
import { startOpenRouterAuth } from './oauth'

export async function connectOpenRouter(): Promise<void> {
  try {
    await startOpenRouterAuth()
  } catch {
    toast.error('Could not start the OpenRouter sign-in.')
  }
}
