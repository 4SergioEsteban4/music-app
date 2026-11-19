import { CapacitorHttp } from '@capacitor/core'
import type { Track } from '../types'
import { norm } from '../utils'
import { aiAsk, parseJsonArray } from '../ai/client'
import type { AiConfig } from '../ai/client'
import { findLyrics } from './lrclib'
import type { LrclibRecord } from './lrclib'

export interface FragmentMatch {
  record: LrclibRecord
  via: 'LRCLIB' | 'IA'
}

const words = (s: string) => norm(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1)

/** Qué tanto de las palabras del fragmento aparece (en orden aproximado) dentro de una letra. */
function coverage(fragment: string, lyrics: string): number {
  const f = words(fragment)
  if (f.length < 3) return 0
  const text = ' ' + words(lyrics).join(' ') + ' '
  const phrase = ' ' + f.join(' ') + ' '
  if (text.includes(phrase)) return 1
  const hits = f.filter((w) => text.includes(` ${w} `)).length
  return hits / f.length
}

/**
 * Busca una canción por un trozo de su letra (útil para covers con título raro).
 * 1) Prueba en LRCLIB. 2) Si hay IA configurada, le pregunta qué canción es y busca esa en LRCLIB.
 */
export async function findByFragment(_track: Track, fragment: string, ai: AiConfig | null): Promise<FragmentMatch[]> {
  const out: FragmentMatch[] = []
  const seen = new Set<number>()

  try {
    const r = await CapacitorHttp.get({
      url: 'https://lrclib.net/api/search',
      params: { q: fragment.slice(0, 120) },
      headers: { 'Lrclib-Client': 'LMusic v0.1', Accept: 'application/json' },
      connectTimeout: 10000,
      readTimeout: 15000,
    })
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
    if (r.status >= 200 && r.status < 300 && Array.isArray(data)) {
      for (const rec of data as LrclibRecord[]) {
        const text = `${rec.plainLyrics ?? ''}\n${rec.syncedLyrics ?? ''}`
        if (coverage(fragment, text) >= 0.8 && (rec.syncedLyrics || rec.plainLyrics) && !seen.has(rec.id)) {
          seen.add(rec.id)
          out.push({ record: rec, via: 'LRCLIB' })
        }
      }
    }
  } catch {
    // sin conexión: se intenta con la IA, que también la necesita; el error se verá abajo
  }

  if (out.length === 0 && ai) {
    const text = await aiAsk(
      ai,
      'Eres un experto en música. Identificas canciones a partir de un fragmento de su letra. ' +
        'Responde SOLO con un arreglo JSON de hasta 3 candidatos, del más probable al menos: ' +
        '[{"title":"","artist":""}]. Si no la reconoces, responde [].',
      `Fragmento: "${fragment}"`,
    )
    const cands = parseJsonArray<{ title?: string; artist?: string }>(text).slice(0, 3)
    for (const c of cands) {
      if (!c.title) continue
      const rec = await findLyrics({
        title: c.title,
        artist: c.artist ?? '',
        album: '',
        durationMs: 0, // en un cover la duración no tiene por qué coincidir
      })
      if (rec && !seen.has(rec.id)) {
        seen.add(rec.id)
        out.push({ record: rec, via: 'IA' })
      }
    }
  }
  return out
}
