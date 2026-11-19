/** Palabra con apóstrofes internos (don't, I'm) y letras de cualquier idioma. */
export const WORD_RE = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu

export function normWord(w: string): string {
  return w.toLowerCase().replace(/’/g, "'")
}

export interface Piece {
  text: string
  isWord: boolean
}

export function splitWords(text: string): Piece[] {
  const out: Piece[] = []
  let last = 0
  for (const m of text.matchAll(WORD_RE)) {
    const i = m.index ?? 0
    if (i > last) out.push({ text: text.slice(last, i), isWord: false })
    out.push({ text: m[0], isWord: true })
    last = i + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), isWord: false })
  return out
}
