import { aiAsk, aiReady, parseJsonArray } from '../ai/client'
import type { AiConfig } from '../ai/client'
import { dbCacheGet, dbCacheSet } from '../db/db'
import { LANGS } from '../learn/dictionary'

const langName = (code: string) => LANGS.find((l) => l.code === code)?.name ?? code
const BATCH = 40
const keyOf = (trackId: number, from: string, to: string, n: number) => `lt2:${trackId}:${from}:${to}:${n}`

export interface TranslateResult {
  lines: string[]
  message: string
}

/** Olvida la traducción guardada de una canción para poder pedirla otra vez. */
export async function clearTranslation(trackId: number, from: string, to: string, n: number): Promise<void> {
  await dbCacheSet(keyOf(trackId, from, to, n), '')
}

/**
 * Traduce la letra con la IA y la guarda para no volver a pedirla. Cada línea viaja con su número, así una línea que la IA
 * junte o se salte no corre las demás; las que ya están en tu idioma (o son solo sonidos) quedan vacías.
 */
export async function translateSong(cfg: AiConfig, trackId: number, texts: string[], from: string, to: string): Promise<TranslateResult> {
  if (from === to) return { lines: [], message: 'Las canciones y tu idioma son el mismo: elige idiomas distintos en Ajustes para traducir.' }
  const key = keyOf(trackId, from, to, texts.length)
  const cached = await dbCacheGet(key)
  if (cached) {
    try {
      const arr = JSON.parse(cached) as string[]
      if (Array.isArray(arr) && arr.length === texts.length) return { lines: arr, message: '' }
    } catch {
      // se vuelve a traducir
    }
  }
  if (!aiReady(cfg)) return { lines: [], message: 'Para traducir la letra configura una IA en Ajustes (Gemini es gratis).' }

  const items = texts.map((t, i) => ({ i, t: t.trim() })).filter((x) => x.t && x.t !== '♪')
  const res = new Map<number, string>()
  for (let s = 0; s < items.length; s += BATCH) {
    const chunk = items.slice(s, s + BATCH)
    const reply = await aiAsk(
      cfg,
      'Eres traductor de letras de canciones. Responde SOLO con un arreglo JSON, sin texto extra ni bloques de código.',
      `Traduce al ${langName(to)} cada línea de esta canción. Si una línea ya está en ${langName(to)}, o son solo sonidos (ah, oh, la la), ` +
        'devuelve "" (cadena vacía) en "t". Que suene natural, no literal. ' +
        'Recibes un arreglo de objetos {"i": número, "t": texto}. Devuelve un objeto {"i", "t"} por cada línea recibida, con el mismo "i".\n\n' +
        JSON.stringify(chunk),
    )
    const arr = parseJsonArray<unknown>(reply)
    arr.forEach((x, k) => {
      if (x && typeof x === 'object') {
        const o = x as { i?: unknown; t?: unknown }
        if (typeof o.i === 'number' && typeof o.t === 'string') res.set(o.i, o.t)
      } else if (typeof x === 'string' && chunk[k]) {
        res.set(chunk[k].i, x)
      }
    })
  }
  const out = texts.map((_, i) => res.get(i) ?? '')
  await dbCacheSet(key, JSON.stringify(out))
  return { lines: out, message: '' }
}
