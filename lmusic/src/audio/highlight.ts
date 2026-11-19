import type { Track } from '../types'
import { LMusic } from '../native/lmusic'

export interface Highlight {
  startMs: number
  endMs: number
}

/**
 * Elige los tramos más intensos de la canción: los de mayor volumen sostenido (casi siempre los coros o el clímax),
 * sin contar la intro ni el final y sin que se pisen entre sí. Devuelve hasta `count`, en orden de aparición.
 */
export function pickHighlights(values: number[], stepMs: number, durationMs: number, count = 3, windowMs = 20000): Highlight[] {
  const n = values.length
  if (n < 4) return []
  const w = Math.max(2, Math.round(windowMs / stepMs))
  const top = Math.max(...values, 1e-9)
  const v = values.map((x) => Math.max(0, x) / top)
  const margin = Math.max(1, Math.floor(n * 0.06))
  const scores: number[] = []
  for (let i = 0; i + w <= n; i++) {
    let s = 0
    for (let j = 0; j < w; j++) s += v[i + j]
    scores[i] = s / w
  }
  const picked: number[] = []
  for (let k = 0; k < count; k++) {
    let best = -1
    let bestScore = -1
    for (let i = margin; i + w <= n - margin; i++) {
      if (picked.some((p) => Math.abs(p - i) < w)) continue
      if (scores[i] > bestScore) {
        bestScore = scores[i]
        best = i
      }
    }
    if (best < 0) break
    // los siguientes solo cuentan si son casi tan intensos como el mejor
    if (k > 0 && bestScore < 0.7 * scores[picked[0]]) break
    picked.push(best)
  }
  return picked.sort((a, b) => a - b).map((i) => ({ startMs: i * stepMs, endMs: Math.min(durationMs, (i + w) * stepMs) }))
}

export async function findHighlights(track: Track, count = 3): Promise<Highlight[]> {
  const r = await LMusic.analyzeEnergy({ uri: track.uri, durationMs: track.durationMs })
  return pickHighlights(r.values, r.stepMs, track.durationMs, count)
}
