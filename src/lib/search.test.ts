import { describe, expect, it } from 'vitest'
import { findMatch, foldText, searchableText } from './search'

describe('foldText', () => {
  it('drops case and accents, including Vietnamese đ', () => {
    expect(foldText('Đà Nẵng, Việt Nam')).toBe('da nang, viet nam')
    expect(foldText('Crème Brûlée')).toBe('creme brulee')
  })
})

describe('findMatch', () => {
  it('returns the original text around an accent-insensitive match', () => {
    expect(findMatch('Tôi yêu Hà Nội lắm', foldText('ha noi'))).toEqual({
      before: 'Tôi yêu ',
      match: 'Hà Nội',
      after: ' lắm',
    })
  })

  it('trims long text around the match with ellipses, on one line', () => {
    const text = `${'a '.repeat(50)}needle\n${'b '.repeat(100)}`
    const match = findMatch(text, 'needle', 10)!
    expect(match.before).toMatch(/^….{0,10}$/)
    expect(match.match).toBe('needle')
    expect(match.after).toMatch(/^ b.*…$/)
    expect(match.after.length).toBeLessThanOrEqual(21)
  })

  it('handles emoji before the match', () => {
    expect(findMatch('🎉🎉 party time', 'party')?.match).toBe('party')
  })

  it('returns null without a match', () => {
    expect(findMatch('hello', 'bye')).toBeNull()
    expect(findMatch('hello', '')).toBeNull()
  })
})

describe('searchableText', () => {
  it('drops markdown markup but keeps code and snake_case', () => {
    const markdown = '## Title\nHere is a **bold** _answer_ with [a link](https://x.y) and `code`.\n```ts\nconst my_var = 1\n```'
    expect(searchableText(markdown)).toBe('Title\nHere is a bold answer with a link and code.\n\nconst my_var = 1\n')
  })
})
