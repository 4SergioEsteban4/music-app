import type { Track } from './types'

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function norm(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

export const UNKNOWN_ARTIST = 'Artista desconocido'
export const UNKNOWN_ALBUM = 'Álbum desconocido'
export const UNKNOWN_GENRE = 'Sin género'

export const artistOf = (t: Track) => t.artist || UNKNOWN_ARTIST
export const albumOf = (t: Track) => t.album || UNKNOWN_ALBUM
export const genreOf = (t: Track) => t.genre || UNKNOWN_GENRE

export function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface Group {
  key: string
  tracks: Track[]
}

export function groupBy(tracks: Track[], keyOf: (t: Track) => string): Group[] {
  const map = new Map<string, Track[]>()
  for (const t of tracks) {
    const k = keyOf(t)
    const arr = map.get(k)
    if (arr) arr.push(t)
    else map.set(k, [t])
  }
  return [...map.entries()]
    .map(([key, ts]) => ({ key, tracks: ts }))
    .sort((a, b) => a.key.localeCompare(b.key, 'es', { sensitivity: 'base' }))
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
