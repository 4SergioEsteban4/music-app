import { CapacitorHttp } from '@capacitor/core'
import { norm } from '../utils'

const BASE = 'https://lrclib.net/api'
const HEADERS = { 'Lrclib-Client': 'LMusic v0.1', Accept: 'application/json' }

export interface LrclibRecord {
  id: number
  trackName: string
  artistName: string
  albumName: string
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

export interface LyricsQuery {
  title: string
  artist: string
  album: string
  durationMs: number
}

/**
 * Fallo al consultar el servidor (NO significa que la letra no exista).
 * kind = 'offline' (no se pudo conectar) o 'server' (el servidor está ocupado o falló).
 */
export class LyricsNetworkError extends Error {
  kind: 'offline' | 'server' = 'offline'
  detail = ''
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function netError(kind: 'offline' | 'server', message: string, detail: string): LyricsNetworkError {
  const e = new LyricsNetworkError(message)
  e.kind = kind
  e.detail = detail
  return e
}

async function api(path: string, params: Record<string, string>, attempt = 0): Promise<unknown> {
  let res
  try {
    res = await CapacitorHttp.get({
      url: BASE + path,
      params,
      headers: HEADERS,
      connectTimeout: 10000,
      readTimeout: 15000,
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw netError('offline', 'No se pudo conectar', detail)
  }
  if (res.status === 404) return null
  if (res.status >= 200 && res.status < 300) {
    try {
      return typeof res.data === 'string' ? JSON.parse(res.data) : res.data
    } catch {
      throw netError('server', 'Respuesta inválida del servidor de letras', 'JSON inválido')
    }
  }
  // Demasiadas consultas seguidas o servidor caído: se espera y se reintenta
  if (res.status === 429 || res.status >= 500) {
    if (attempt < 3) {
      const ra = Number(res.headers?.['Retry-After'] ?? res.headers?.['retry-after'] ?? 0)
      await sleep(ra > 0 ? Math.min(ra, 20) * 1000 : [1500, 3500, 7000][attempt])
      return api(path, params, attempt + 1)
    }
    throw netError('server', 'El servidor de letras está ocupado', `HTTP ${res.status}`)
  }
  // Otro error 4xx: la consulta no sirve para esta canción; equivale a "no encontrada"
  return null
}

/* ---------- limpieza del título ---------- */

const JUNK =
  /\s*[([][^)\]]*\b(official|oficial|lyric|lyrics|letra|video|vídeo|audio|visualizer|hd|4k|remaster(ed)?|live|en vivo|feat\.?|ft\.?|with)\b[^)\]]*[)\]]/gi

export function cleanTitle(s: string): string {
  return s.replace(JUNK, '').replace(/\s+/g, ' ').trim()
}

function splitArtistFromTitle(title: string): { title: string; artist: string } | null {
  const m = title.match(/^(.{2,60}?)\s[-–—]\s(.{2,})$/)
  return m ? { artist: m[1].trim(), title: m[2].trim() } : null
}

/* ---------- elegir el mejor resultado ---------- */

function titleMatches(candidate: string, wanted: string): boolean {
  const a = norm(cleanTitle(candidate))
  const b = norm(wanted)
  return a === b || a.includes(b) || b.includes(a)
}

function score(c: LrclibRecord, q: LyricsQuery): number {
  if (!titleMatches(c.trackName, q.title)) return -Infinity
  const hasText = !!(c.syncedLyrics || c.plainLyrics) || c.instrumental
  if (!hasText) return -Infinity
  let s = 0
  if (c.syncedLyrics) s += 3
  if (q.durationMs > 0) {
    const diff = Math.abs(c.duration - q.durationMs / 1000)
    if (diff > 8) return -Infinity // versión distinta: la letra quedaría desfasada
    s += diff <= 3 ? 3 : diff <= 6 ? 1 : -2
  }
  if (q.artist && norm(c.artistName).includes(norm(q.artist))) s += 2
  if (norm(cleanTitle(c.trackName)) === norm(q.title)) s += 1
  return s
}

function pickBest(cands: LrclibRecord[], q: LyricsQuery): LrclibRecord | null {
  let best: LrclibRecord | null = null
  let bestScore = -Infinity
  for (const c of cands) {
    const s = score(c, q)
    if (s > bestScore) {
      best = c
      bestScore = s
    }
  }
  return best
}

const isRecord = (v: unknown): v is LrclibRecord =>
  typeof v === 'object' && v !== null && 'trackName' in v

/** Lista de letras candidatas en LRCLIB para que el usuario elija la correcta (primero las que tienen tiempos). */
export async function searchLrclib(title: string, artist: string): Promise<LrclibRecord[]> {
  const params: Record<string, string> = {}
  if (title.trim()) params.track_name = title.trim()
  if (artist.trim()) params.artist_name = artist.trim()
  if (!params.track_name) return []
  const res = await api('/search', params)
  if (!Array.isArray(res)) return []
  return res
    .filter(isRecord)
    .filter((r) => r.syncedLyrics || r.plainLyrics || r.instrumental)
    .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics))
    .slice(0, 20)
}

/**
 * Busca la letra de una canción en LRCLIB (sin IA).
 * Devuelve null si no hay nada; lanza LyricsNetworkError si no se pudo consultar.
 */
export async function findLyrics(input: LyricsQuery): Promise<LrclibRecord | null> {
  let title = input.title.trim()
  let artist = input.artist.trim()
  if (!artist) {
    const split = splitArtistFromTitle(title)
    if (split) {
      title = split.title
      artist = split.artist
    }
  }
  const cleaned = cleanTitle(title) || title
  const q: LyricsQuery = { ...input, title: cleaned, artist }
  const dur = input.durationMs > 0 ? String(Math.round(input.durationMs / 1000)) : ''

  let fallback: LrclibRecord | null = null
  const consider = (r: LrclibRecord | null): LrclibRecord | null => {
    if (!r) return null
    if (r.syncedLyrics || r.instrumental) return r
    if (r.plainLyrics && !fallback) fallback = r
    return null
  }

  // 1) Coincidencia exacta por título + artista (+ álbum y duración)
  if (artist) {
    const params: Record<string, string> = { track_name: title, artist_name: artist }
    if (input.album) params.album_name = input.album
    if (dur) params.duration = dur
    const exact = await api('/get', params)
    if (isRecord(exact)) {
      const hit = consider(exact)
      if (hit) return hit
    }
    // 2) Igual, pero con el título limpio y sin álbum
    if (cleaned !== title || input.album) {
      const p2: Record<string, string> = { track_name: cleaned, artist_name: artist }
      if (dur) p2.duration = dur
      const again = await api('/get', p2)
      if (isRecord(again)) {
        const hit = consider(again)
        if (hit) return hit
      }
    }
  }

  // 3) Búsqueda amplia
  const sp: Record<string, string> = artist
    ? { track_name: cleaned, artist_name: artist }
    : { q: cleaned }
  const found = await api('/search', sp)
  if (Array.isArray(found)) {
    const best = pickBest(found.filter(isRecord), q)
    if (best) {
      const hit = consider(best)
      if (hit) return hit
    }
  }

  // 4) Último intento: texto libre con título y artista (cubre covers con otro artista)
  if (artist) {
    const free = await api('/search', { q: `${cleaned} ${artist}` })
    if (Array.isArray(free)) {
      const best = pickBest(free.filter(isRecord), q)
      if (best) {
        const hit = consider(best)
        if (hit) return hit
      }
    }
  }

  return fallback
}
