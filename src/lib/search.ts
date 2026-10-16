const foldedChars = new Map<string, string>()

/** One character, lowercased and without accents; Vietnamese đ becomes d. */
function foldChar(ch: string): string {
  let folded = foldedChars.get(ch)
  if (folded === undefined) {
    folded = ch.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd')
    foldedChars.set(ch, folded)
  }
  return folded
}

/** Folds text for matching, with each folded position's index in the original. */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = ''
  const map: number[] = []
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)!)
    const f = foldChar(ch)
    for (let k = 0; k < f.length; k++) map.push(i)
    folded += f
    i += ch.length
  }
  return { folded, map }
}

/** Lowercase, without accents: "Việt Nam" → "viet nam". */
export function foldText(text: string): string {
  return foldWithMap(text).folded
}

/** Markdown without its markup, so "**bold** text" is found by "bold text". Code is kept. */
export function searchableText(markdown: string): string {
  return markdown
    .replace(/^\s*(`{3,}|~{3,}).*$/gm, '') // code fences, keeping the code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links and images: their text
    .replace(/^\s{0,3}(#{1,6}|>)\s+/gm, '') // headings, quotes
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/(^|\W)[*_](?=\S)|(?<=\S)[*_](?=\W|$)/g, '$1') // *italics*, keeping snake_case
}

/** A match in some text, with up to `radius` characters of context on each side. */
export interface TextMatch {
  before: string
  match: string
  after: string
}

/** Finds a folded query in text, ignoring case and accents. */
export function findMatch(text: string, foldedQuery: string, radius = 40): TextMatch | null {
  if (!foldedQuery) return null
  const { folded, map } = foldWithMap(text)
  const at = folded.indexOf(foldedQuery)
  if (at < 0) return null
  const start = map[at]
  const endAt = at + foldedQuery.length
  const end = endAt < map.length ? map[endAt] : text.length
  const from = Math.max(0, start - radius)
  const to = Math.min(text.length, end + radius * 2)
  const clean = (s: string) => s.replace(/\s+/g, ' ')
  return {
    before: (from > 0 ? '…' : '') + clean(text.slice(from, start)).trimStart(),
    match: text.slice(start, end),
    after: clean(text.slice(end, to)).trimEnd() + (to < text.length ? '…' : ''),
  }
}
