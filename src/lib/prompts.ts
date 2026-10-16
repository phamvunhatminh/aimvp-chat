import type { SavedPrompt } from './db'
import { foldText } from './search'

/** Prompts matching a query, title matches first. */
export function filterPrompts(prompts: SavedPrompt[], query: string): SavedPrompt[] {
  const q = foldText(query.trim())
  if (!q) return prompts
  const inTitle = prompts.filter((p) => foldText(p.title).includes(q))
  const inContent = prompts.filter((p) => !inTitle.includes(p) && foldText(p.content).includes(q))
  return [...inTitle, ...inContent]
}

/**
 * Puts a prompt into the message box, replacing everything or just the selection,
 * and returns the range to select next: its first `{{blank}}`, else the end of it.
 */
export function insertPrompt(
  text: string,
  [start, end]: [number, number],
  content: string,
  replaceAll: boolean,
): { text: string; select: [number, number] } {
  const before = replaceAll ? '' : text.slice(0, start)
  const after = replaceAll ? '' : text.slice(end)
  const at = before.length
  const blank = /\{\{[^{}\n]*\}\}/.exec(content)
  return {
    text: before + content + after,
    select: blank ? [at + blank.index, at + blank.index + blank[0].length] : [at + content.length, at + content.length],
  }
}
