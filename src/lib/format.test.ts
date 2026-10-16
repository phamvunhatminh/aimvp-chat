import { describe, expect, it } from 'vitest'
import { formatCost, formatPricing } from './format'

describe('formatPricing', () => {
  it('formats per-million prices', () => {
    expect(formatPricing({ pricing: { prompt: '0.000003', completion: '0.000015' } })).toBe('$3 / $15 per 1M')
    expect(formatPricing({ pricing: { prompt: '0.00000015', completion: '0.0000006' } })).toBe('$0.15 / $0.6 per 1M')
  })

  it('labels free models and hides variable or missing pricing', () => {
    expect(formatPricing({ pricing: { prompt: '0', completion: '0' } })).toBe('Free')
    expect(formatPricing({ pricing: { prompt: '-1', completion: '-1' } })).toBeNull()
    expect(formatPricing({})).toBeNull()
  })
})

describe('formatCost', () => {
  it('keeps small costs readable', () => {
    expect(formatCost(0)).toBe('$0')
    expect(formatCost(0.00042)).toBe('$0.0004')
    expect(formatCost(1.234)).toBe('$1.23')
  })
})
