import { describe, expect, it } from 'vitest'
import type { SavedPrompt } from './db'
import { filterPrompts, insertPrompt } from './prompts'

const prompt = (title: string, content: string) => ({ id: title, title, content }) as SavedPrompt

describe('filterPrompts', () => {
  const prompts = [prompt('Email reply', 'Write a polite answer'), prompt('Tóm tắt', 'Summarize this'), prompt('Polish', 'Fix grammar')]

  it('matches titles first, then content, ignoring accents', () => {
    expect(filterPrompts(prompts, 'pol').map((p) => p.title)).toEqual(['Polish', 'Email reply'])
    expect(filterPrompts(prompts, 'tom tat').map((p) => p.title)).toEqual(['Tóm tắt'])
    expect(filterPrompts(prompts, '')).toHaveLength(3)
  })
})

describe('insertPrompt', () => {
  it('replaces the text and selects the first blank', () => {
    expect(insertPrompt('/tr', [3, 3], 'Translate to {{language}}: {{text}}', true)).toEqual({
      text: 'Translate to {{language}}: {{text}}',
      select: [13, 25],
    })
  })

  it('inserts at the cursor and puts the cursor after a prompt without blanks', () => {
    expect(insertPrompt('Hello world', [6, 6], 'big ', false)).toEqual({ text: 'Hello big world', select: [10, 10] })
  })
})
