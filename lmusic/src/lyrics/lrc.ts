export interface LrcLine {
  timeMs: number
  text: string
}

// [mm:ss], [mm:ss.x], [mm:ss.xx], [mm:ss.xxx]
const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
// Marcas de palabra del formato "enhanced": <mm:ss.xx>
const WORD_STAMP = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g

export function parseLrc(raw: string): LrcLine[] {
  const out: LrcLine[] = []
  for (const line of raw.split(/\r?\n/)) {
    const stamps = [...line.matchAll(STAMP)]
    if (!stamps.length) continue // etiquetas [ar:], [ti:]… y líneas sin tiempo
    const text = line.replace(STAMP, '').replace(WORD_STAMP, '').trim()
    for (const m of stamps) {
      const frac = m[3] ? Number((m[3] + '00').slice(0, 3)) : 0
      out.push({ timeMs: Number(m[1]) * 60000 + Number(m[2]) * 1000 + frac, text })
    }
  }
  out.sort((a, b) => a.timeMs - b.timeMs)
  // colapsar silencios consecutivos
  return out.filter((l, i) => !(l.text === '' && i > 0 && out[i - 1].text === ''))
}

export function isSyncedLrc(raw: string): boolean {
  return parseLrc(raw).filter((l) => l.text !== '').length >= 2
}

/** Quita las marcas de tiempo para quedarse con el texto plano. */
export function lrcToPlain(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(STAMP, '').replace(WORD_STAMP, '').trim())
    .filter((l, i, arr) => !(l === '' && (i === 0 || arr[i - 1] === '')))
    .filter((l) => !/^\[[a-z]{2,}:.*\]$/i.test(l))
    .join('\n')
    .trim()
}

/** Índice de la última línea cuyo tiempo ya pasó, o -1 si aún no empieza. */
export function activeLineIndex(lines: LrcLine[], posMs: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].timeMs <= posMs) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
