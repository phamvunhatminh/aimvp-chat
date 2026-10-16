import type { Conversation, Message } from './db'
import { parseModelRef, PROVIDERS } from './providers'

export function modelLabel(ref: string): string {
  const { provider, model } = parseModelRef(ref)
  return `${model} · ${PROVIDERS[provider].name}`
}

/** A chat as a Markdown document; attachments are listed by name. */
export function conversationToMarkdown(conversation: Conversation, messages: Message[], at = new Date()): string {
  const lines = [`# ${conversation.title}`, '', `_${modelLabel(conversation.model)} · exported ${at.toISOString().slice(0, 10)} from aimvp_`]
  for (const m of messages) {
    if (m.role === 'assistant' && m.status === 'error' && !m.content) continue
    lines.push('', m.role === 'user' ? '## You' : `## Assistant${m.model ? ` (${modelLabel(m.model)})` : ''}`, '')
    const files = m.attachments ?? []
    if (files.length) lines.push(files.map((a) => `📎 ${a.name}`).join('  \n'), '')
    if (m.content) lines.push(m.content)
    if (m.sources?.length) {
      lines.push('', 'Sources:', ...m.sources.map((s, i) => `${i + 1}. [${s.title.replace(/[[\]]/g, '')}](${s.url})`))
    }
  }
  return `${lines.join('\n').trim()}\n`
}

const EXTENSIONS: Record<string, string> = {
  typescript: 'ts', ts: 'ts', tsx: 'tsx', javascript: 'js', js: 'js', jsx: 'jsx', python: 'py', py: 'py',
  json: 'json', html: 'html', xml: 'xml', css: 'css', scss: 'scss', bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh',
  sql: 'sql', go: 'go', rust: 'rs', rs: 'rs', java: 'java', kotlin: 'kt', swift: 'swift', c: 'c', cpp: 'cpp',
  'c++': 'cpp', csharp: 'cs', cs: 'cs', ruby: 'rb', rb: 'rb', php: 'php', markdown: 'md', md: 'md', yaml: 'yml',
  yml: 'yml', toml: 'toml', dockerfile: 'Dockerfile', diff: 'diff', graphql: 'graphql', lua: 'lua', dart: 'dart',
}

/** A filename for a code block in `language`, e.g. `snippet.py`. */
export function codeFilename(language: string | null): string {
  const ext = EXTENSIONS[(language ?? '').toLowerCase()]
  if (ext === 'Dockerfile') return 'Dockerfile'
  return `snippet.${ext ?? 'txt'}`
}

/** A safe filename from a chat title. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60)
  return slug || 'chat'
}
