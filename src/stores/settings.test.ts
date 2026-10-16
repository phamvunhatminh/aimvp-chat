import { describe, expect, it } from 'vitest'
import { connectedProviders, migrateSettings } from './settings'

describe('migrateSettings', () => {
  it('moves the v1 OpenRouter key and model ids to the v2 shape', () => {
    expect(
      migrateSettings(
        {
          apiKey: 'sk-or-old',
          defaultModel: 'openrouter/auto',
          favoriteModels: ['anthropic/claude-x', 'openai:gpt-5'],
          theme: 'dark',
        },
        1,
      ),
    ).toEqual({
      apiKeys: { openrouter: 'sk-or-old' },
      defaultModel: 'openrouter:openrouter/auto',
      favoriteModels: ['openrouter:anthropic/claude-x', 'openai:gpt-5'],
      theme: 'dark',
    })
  })

  it('handles a v1 state without a key', () => {
    expect(migrateSettings({ apiKey: null, theme: 'light' }, 1)).toEqual({ apiKeys: {}, theme: 'light' })
  })
})

describe('connectedProviders', () => {
  it('lists providers with keys in display order', () => {
    expect(connectedProviders({ google: 'g', openrouter: 'o', anthropic: '' })).toEqual(['openrouter', 'google'])
  })
})
