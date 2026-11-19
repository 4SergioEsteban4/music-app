import { CapacitorHttp } from '@capacitor/core'
import { norm } from '../utils'
import { normGenre } from './clean'

export interface OnlineMeta {
  title: string
  artist: string
  album: string
  genre: string
  /** true si coinciden título y artista (no solo el título) */
  exact: boolean
}

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

const similar = (a: string, b: string) => {
  const x = norm(a)
  const y = norm(b)
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x))
}

async function fromDeezer(title: string, artist: string): Promise<OnlineMeta | null> {
  const q = artist ? `artist:"${artist}" track:"${title}"` : `track:"${title}"`
  const data = (await getJson('https://api.deezer.com/search', { q, limit: '6' })) as {
    data?: { title?: string; artist?: { name?: string }; album?: { id?: number; title?: string } }[]
  }
  for (const r of data.data ?? []) {
    if (!r.title || !similar(r.title, title)) continue
    const artistOk = !artist || (!!r.artist?.name && similar(r.artist.name, artist))
    if (artist && !artistOk) continue
    let genre = ''
    if (r.album?.id) {
      try {
        const alb = (await getJson(`https://api.deezer.com/album/${r.album.id}`, {})) as {
          genres?: { data?: { name?: string }[] }
        }
        genre = normGenre(alb.genres?.data?.[0]?.name ?? '')
      } catch {
        // sin género: se intentará con otra fuente
      }
    }
    return {
      title: r.title,
      artist: r.artist?.name ?? artist,
      album: r.album?.title ?? '',
      genre,
      exact: !!artist && artistOk,
    }
  }
  return null
}

async function fromItunes(title: string, artist: string): Promise<OnlineMeta | null> {
  const data = (await getJson('https://itunes.apple.com/search', {
    term: `${artist} ${title}`.trim(),
    media: 'music',
    entity: 'song',
    limit: '6',
  })) as {
    results?: { trackName?: string; artistName?: string; collectionName?: string; primaryGenreName?: string }[]
  }
  for (const r of data.results ?? []) {
    if (!r.trackName || !similar(r.trackName, title)) continue
    if (artist && r.artistName && !similar(r.artistName, artist)) continue
    return {
      title: r.trackName,
      artist: r.artistName ?? artist,
      album: r.collectionName ?? '',
      genre: normGenre(r.primaryGenreName ?? ''),
      exact: !!artist,
    }
  }
  return null
}

/** Busca en internet álbum y género (y corrige nombres). Deezer primero; iTunes si no hay resultado. */
export async function lookupMeta(title: string, artist: string): Promise<OnlineMeta | null> {
  let found: OnlineMeta | null = null
  let lastError: unknown = null
  try {
    found = await fromDeezer(title, artist)
  } catch (e) {
    lastError = e
  }
  if (!found || !found.genre) {
    try {
      const it = await fromItunes(title, artist)
      if (it) found = found ? { ...found, genre: found.genre || it.genre, album: found.album || it.album } : it
    } catch (e) {
      lastError = e
    }
  }
  if (!found && lastError) throw lastError
  return found
}
