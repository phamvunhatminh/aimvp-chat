import { describe, expect, it } from 'vitest'
import { canonicalModelId, costOf, makePriceLookup } from './pricing'

const catalog = [
  { id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5', pricing: { prompt: '0.000005', completion: '0.000025' } },
  { id: 'openai/gpt-5', name: 'GPT-5', pricing: { prompt: '0.00000125', completion: '0.00001' } },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', pricing: { prompt: '0.0000003', completion: '0.0000025' } },
  { id: 'openrouter/auto', name: 'Auto', pricing: { prompt: '-1', completion: '-1' } },
]

describe('makePriceLookup', () => {
  const price = makePriceLookup(catalog)

  it('finds OpenRouter models and the same models at their makers', () => {
    expect(price('openrouter', 'openai/gpt-5')).toEqual({ prompt: 0.00000125, completion: 0.00001 })
    expect(price('anthropic', 'claude-opus-5-5')).toEqual({ prompt: 0.000005, completion: 0.000025 })
    expect(price('openai', 'gpt-5')?.completion).toBe(0.00001)
    expect(price('google', 'gemini-2.5-flash')?.prompt).toBe(0.0000003)
  })

  it('knows nothing of variable or unknown prices', () => {
    expect(price('openrouter', 'openrouter/auto')).toBeNull()
    expect(price('openai', 'gpt-unknown')).toBeNull()
  })

  it('ignores date suffixes and dots', () => {
    expect(canonicalModelId('claude-opus-4-1-20250805')).toBe(canonicalModelId('claude-opus-4.1'))
  })
})

describe('costOf', () => {
  it('prices cached input at the cache rate', () => {
    const usage = { promptTokens: 10_000, completionTokens: 100, cachedTokens: 9_000, cacheWriteTokens: 500 }
    // Listed cache prices win; otherwise reads cost a tenth of input and writes a quarter more.
    expect(costOf(usage, { prompt: 1e-6, completion: 1e-5, cacheRead: 2e-7, cacheWrite: 1e-6 })?.cost).toBeCloseTo(
      500 * 1e-6 + 9_000 * 2e-7 + 500 * 1e-6 + 100 * 1e-5,
    )
    expect(costOf(usage, { prompt: 1e-6, completion: 1e-5 })?.cost).toBeCloseTo(
      500 * 1e-6 + 9_000 * 1e-7 + 500 * 1.25e-6 + 100 * 1e-5,
    )
  })

  it('prefers the exact cost and otherwise estimates', () => {
    expect(costOf({ promptTokens: 10, completionTokens: 5, cost: 0.5 }, null)).toEqual({ cost: 0.5, estimated: false })
    expect(costOf({ promptTokens: 1000, completionTokens: 100 }, { prompt: 0.001, completion: 0.01 })).toEqual({
      cost: 2,
      estimated: true,
    })
    expect(costOf({ promptTokens: 1, completionTokens: 1 }, null)).toBeNull()
  })
})
