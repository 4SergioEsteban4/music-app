import { CapacitorHttp } from '@capacitor/core'
import { norm } from '../utils'

export interface OnlineSong {
  id: string
  title: string
  artist: string
  album: string
  art: string
  previewUrl: string
  genre: string
  source: 'itunes' | 'deezer'
}

async function getJson(url: string): Promise<unknown> {
  const res = await CapacitorHttp.get({ url, headers: { Accept: 'application/json' }, connectTimeout: 8000, readTimeout: 8000 })
  if (res.status < 200 || res.status >= 300) throw new Error(`El servidor respondió ${res.status}`)
  return typeof res.data === 'string' ? JSON.parse(res.data) : res.data
}

async function itunes(q: string): Promise<OnlineSong[]> {
  const data = (await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=25`)) as {
    results?: Record<string, unknown>[]
  }
  return (data.results ?? [])
    .filter((r) => r.trackName)
    .map((r) => ({
      id: `it${String(r.trackId)}`,
      title: String(r.trackName),
      artist: String(r.artistName ?? ''),
      album: String(r.collectionName ?? ''),
      art: String(r.artworkUrl100 ?? '').replace('100x100', '300x300'),
      previewUrl: String(r.previewUrl ?? ''),
      genre: String(r.primaryGenreName ?? ''),
      source: 'itunes' as const,
    }))
}

async function deezer(q: string): Promise<OnlineSong[]> {
  const data = (await getJson(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=25`)) as {
    data?: { id: number; title: string; preview?: string; artist?: { name?: string }; album?: { title?: string; cover_medium?: string } }[]
  }
  return (data.data ?? []).map((r) => ({
    id: `dz${r.id}`,
    title: r.title,
    artist: r.artist?.name ?? '',
    album: r.album?.title ?? '',
    art: r.album?.cover_medium ?? '',
    previewUrl: r.preview ?? '',
    genre: '',
    source: 'deezer' as const,
  }))
}

/** Busca en dos catálogos públicos a la vez (iTunes y Deezer) y junta los resultados sin repetir. */
export async function searchOnline(query: string): Promise<OnlineSong[]> {
  const [a, b] = await Promise.allSettled([itunes(query), deezer(query)])
  if (a.status === 'rejected' && b.status === 'rejected') throw new Error('No pude conectar. Revisa tu internet.')
  const la = a.status === 'fulfilled' ? a.value : []
  const lb = b.status === 'fulfilled' ? b.value : []
  const mixed: OnlineSong[] = []
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i]) mixed.push(la[i])
    if (lb[i]) mixed.push(lb[i])
  }
  const seen = new Set<string>()
  return mixed.filter((s) => {
    const k = `${norm(s.title)}|${norm(s.artist)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export const youtubeLink = (s: { title: string; artist: string }) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${s.artist} ${s.title}`.trim())}`
export const spotifyLink = (s: { title: string; artist: string }) =>
  `https://open.spotify.com/search/${encodeURIComponent(`${s.artist} ${s.title}`.trim())}`
