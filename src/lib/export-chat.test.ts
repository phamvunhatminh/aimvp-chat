import { describe, expect, it } from 'vitest'
import type { Conversation, Message } from './db'
import { codeFilename, conversationToMarkdown, slugify } from './export-chat'

const conversation = { title: 'Trip plan', model: 'openai:gpt-5' } as Conversation
const msg = (m: Partial<Message>) => ({ attachments: [], status: 'done', ...m }) as Message

describe('conversationToMarkdown', () => {
  it('writes a heading per message with attachments and models', () => {
    const md = conversationToMarkdown(
      conversation,
      [
        msg({ role: 'user', content: 'Plan a trip', attachments: [{ name: 'map.jpg' } as Message['attachments'][0]] }),
        msg({ role: 'assistant', content: '**Day 1**', model: 'anthropic:claude-opus-5-5' }),
        msg({ role: 'assistant', content: '', status: 'error' }),
      ],
      new Date('2026-10-16T00:00:00Z'),
    )
    expect(md).toBe(
      [
        '# Trip plan',
        '',
        '_gpt-5 · OpenAI · exported 2026-10-16_',
        '',
        '## You',
        '',
        '📎 map.jpg',
        '',
        'Plan a trip',
        '',
        '## Assistant (claude-opus-5-5 · Anthropic)',
        '',
        '**Day 1**',
        '',
      ].join('\n'),
    )
  })
})

describe('filenames', () => {
  it('maps code languages to extensions', () => {
    expect(codeFilename('python')).toBe('snippet.py')
    expect(codeFilename('TSX')).toBe('snippet.tsx')
    expect(codeFilename('dockerfile')).toBe('Dockerfile')
    expect(codeFilename(null)).toBe('snippet.txt')
  })

  it('slugifies titles, including Vietnamese', () => {
    expect(slugify('Kế hoạch đi Đà Lạt!')).toBe('ke-hoach-di-da-lat')
    expect(slugify('???')).toBe('chat')
  })
})
