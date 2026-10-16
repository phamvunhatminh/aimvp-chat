import type { ProviderId } from './types'

export interface ProviderMeta {
  id: ProviderId
  name: string
  keyPlaceholder: string
  keysUrl: string
  billingHint: string
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    keyPlaceholder: 'sk-or-v1-…',
    keysUrl: 'https://openrouter.ai/settings/keys',
    billingHint: 'Add credits at openrouter.ai/settings/credits.',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    keyPlaceholder: 'sk-…',
    keysUrl: 'https://platform.openai.com/api-keys',
    billingHint: 'Check billing at platform.openai.com.',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    keyPlaceholder: 'sk-ant-…',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    billingHint: 'Add credits in the Anthropic Console.',
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    keyPlaceholder: 'AIza…',
    keysUrl: 'https://aistudio.google.com/apikey',
    billingHint: 'Check your quota in Google AI Studio.',
  },
}
