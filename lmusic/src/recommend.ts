import type { Track } from './types'
import { artistOf, genreOf, norm } from './utils'

const unknown = (s: string) => !s || norm(s).includes('desconoc') || norm(s).includes('unknown')

function jitter(id: number, seed: number): number {
  const x = Math.sin(id * 12.9898 + seed * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/**
 * Canciones de tu biblioteca que probablemente quieras escuchar: parecidas (artista, género, álbum) a lo que más repites y a tus
 * favoritas, con preferencia por las que casi no has oído. Cambia un poco cada día y no repite más de 3 por artista.
 */
export function recommendTracks(tracks: Track[], limit = 12, now = Date.now()): Track[] {
  const heard = tracks.filter((t) => t.playCount > 0 || t.favorite)
  if (tracks.length < 10 || heard.length < 3) return []
  const artist = new Map<string, number>()
  const genre = new Map<string, number>()
  const album = new Map<string, number>()
  const add = (m: Map<string, number>, k: string, v: number) => {
    if (k) m.set(k, (m.get(k) ?? 0) + v)
  }
  for (const t of heard) {
    const recent = t.lastPlayed > 0 && now - t.lastPlayed < 14 * 86400000 ? 3 : 0
    const w = Math.min(t.playCount, 20) + (t.favorite ? 6 : 0) + recent
    add(artist, unknown(t.artist) ? '' : norm(artistOf(t)), w)
    add(genre, unknown(t.genre) ? '' : norm(genreOf(t)), w)
    add(album, unknown(t.album) ? '' : norm(t.album), w)
  }
  const max = (m: Map<string, number>) => Math.max(1, ...m.values())
  const aMax = max(artist)
  const gMax = max(genre)
  const bMax = max(album)
  const seed = Math.floor(now / 86400000)
  const scored = tracks
    .map((t) => {
      let s =
        (3 * (artist.get(norm(artistOf(t))) ?? 0)) / aMax +
        (2 * (genre.get(norm(genreOf(t))) ?? 0)) / gMax +
        (album.get(norm(t.album)) ?? 0) / bMax
      if (t.playCount === 0) s += 1.2
      else if (t.playCount <= 2) s += 0.6
      if (t.lastPlayed > 0 && now - t.lastPlayed < 36 * 3600000) s -= 2.5
      s += jitter(t.id, seed) * 0.7
      return { t, s }
    })
    .sort((x, y) => y.s - x.s)
  const per = new Map<string, number>()
  const out: Track[] = []
  for (const { t } of scored) {
    const k = norm(artistOf(t))
    const n = per.get(k) ?? 0
    if (n >= 3) continue
    per.set(k, n + 1)
    out.push(t)
    if (out.length >= limit) break
  }
  return out
}

/** Resumen corto de tu gusto musical, para pedirle sugerencias a la IA. */
export function tasteSummary(tracks: Track[]): string {
  const heard = tracks
    .filter((t) => t.playCount > 0 || t.favorite)
    .sort((a, b) => b.playCount + (b.favorite ? 6 : 0) - (a.playCount + (a.favorite ? 6 : 0)))
  const artists = [...new Set(heard.map((t) => artistOf(t)).filter((a) => !unknown(a)))].slice(0, 10)
  const genres = [...new Set(heard.map((t) => genreOf(t)).filter((g) => !unknown(g)))].slice(0, 5)
  const songs = heard.slice(0, 8).map((t) => `${t.title} - ${artistOf(t)}`)
  return `Artistas que más escucho: ${artists.join(', ') || 'sin datos'}. Géneros: ${genres.join(', ') || 'sin datos'}. Canciones que más repito: ${songs.join('; ') || 'sin datos'}.`
}
