import { CapacitorHttp } from '@capacitor/core'
import type { Track } from '../types'
import { LMusic } from '../native/lmusic'
import { invalidateCover } from '../native/covers'
import { dbSetCoverOnline } from '../db/db'
import { cleanTitle } from '../lyrics/lrclib'
import { norm } from '../utils'

/** Busca la portada de una canción en internet (iTunes y Deezer, gratis y sin IA). */

async function getJson(url: string, params: Record<string, string>): Promise<unknown> {
  const r = await CapacitorHttp.get({
    url,
    params,
    headers: { Accept: 'application/json' },
    connectTimeout: 8000,
    readTimeout: 12000,
  })
  if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`)
  return typeof r.data === 'string' ? JSON.parse(r.data) : r.data
}

function parts(track: Track): { title: string; artist: string } {
  let title = track.title.trim()
  let artist = track.artist.trim()
  if (!artist) {
    const m = title.match(/^(.{2,60}?)\s[-–—]\s(.{2,})$/)
    if (m) {
      artist = m[1].trim()
      title = m[2].trim()
    }
  }
  return { title: cleanTitle(title) || title, artist }
}

const COMPILATION = /(greatest hits|best of|the very best|compilation|compilaci|éxitos|exitos|\bmix\b|\bhits\b|collection|essential|karaoke|tribute|ringtone|workout|party)/i

// compara sin paréntesis, "feat." ni signos
const base = (s: string) =>
  norm(s.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\b(feat|ft|featuring)\b.*$/i, ' '))
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const sameTitle = (a: string, b: string) => {
  const x = base(a)
  const y = base(b)
  if (!x || !y) return false
  if (x === y) return true
  const [s, l] = x.length < y.length ? [x, y] : [y, x]
  return l.includes(s) && s.length / l.length >= 0.6
}

const sameArtist = (a: string, b: string) => {
  const x = base(a)
  const y = base(b)
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x))
}

interface Cand {
  title: string
  artist: string
  album: string
  art: string
  ms: number
}

/** Elige la portada más segura: mismo título y artista, duración parecida y, de preferencia, del álbum de la canción. */
function choose(cands: Cand[], track: Track, title: string, artist: string): string | null {
  const ok = cands.filter(
    (c) =>
      c.art &&
      sameTitle(c.title, title) &&
      sameArtist(c.artist, artist) &&
      (!track.durationMs || !c.ms || Math.abs(c.ms - track.durationMs) <= 15000),
  )
  const score = (c: Cand) => (track.album && sameTitle(c.album, track.album) ? 2 : 0) + (COMPILATION.test(c.album) ? 0 : 1)
  ok.sort((a, b) => score(b) - score(a))
  return ok[0]?.art ?? null
}

async function fromItunes(track: Track, title: string, artist: string): Promise<string | null> {
  const data = (await getJson('https://itunes.apple.com/search', {
    term: `${artist} ${title}`.trim(),
    media: 'music',
    entity: 'song',
    limit: '15',
  })) as { results?: { trackName?: string; artistName?: string; collectionName?: string; artworkUrl100?: string; trackTimeMillis?: number }[] }
  const art = choose(
    (data.results ?? []).map((r) => ({
      title: r.trackName ?? '',
      artist: r.artistName ?? '',
      album: r.collectionName ?? '',
      art: r.artworkUrl100 ?? '',
      ms: r.trackTimeMillis ?? 0,
    })),
    track,
    title,
    artist,
  )
  return art ? art.replace(/\/\d+x\d+bb\./, '/1000x1000bb.') : null
}

async function fromDeezer(track: Track, title: string, artist: string): Promise<string | null> {
  const q = `artist:"${artist}" track:"${title}"`
  const data = (await getJson('https://api.deezer.com/search', { q, limit: '15' })) as {
    data?: { title?: string; duration?: number; artist?: { name?: string }; album?: { title?: string; cover_xl?: string; cover_big?: string } }[]
  }
  return choose(
    (data.data ?? []).map((r) => ({
      title: r.title ?? '',
      artist: r.artist?.name ?? '',
      album: r.album?.title ?? '',
      art: r.album?.cover_xl || r.album?.cover_big || '',
      ms: (r.duration ?? 0) * 1000,
    })),
    track,
    title,
    artist,
  )
}

export async function findCoverUrl(track: Track): Promise<string | null> {
  const { title, artist } = parts(track)
  // sin artista no hay forma segura de saber cuál es: mejor sin portada que una equivocada
  if (!artist) return null
  let lastError: unknown = null
  for (const source of [fromItunes, fromDeezer]) {
    try {
      const url = await source(track, title, artist)
      if (url) return url.replace(/^http:/, 'https:')
    } catch (e) {
      lastError = e
    }
  }
  if (lastError) throw lastError
  return null
}

/** Busca y guarda la portada de una canción. true si se encontró. Lanza error si no hubo conexión. */
export async function fetchOnlineCover(track: Track): Promise<boolean> {
  const url = await findCoverUrl(track)
  if (!url) {
    await dbSetCoverOnline(track.id, 'none')
    return false
  }
  await LMusic.saveCoverFromUrl({ id: track.id, url })
  await dbSetCoverOnline(track.id, 'found')
  invalidateCover(track.id)
  return true
}
