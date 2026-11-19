import type { Playlist, Track } from './types'
import { albumOf, artistOf, genreOf, plural } from './utils'

export type CollectionRef =
  | { kind: 'artist' | 'album' | 'genre'; key: string }
  | { kind: 'recent' | 'top' | 'favorites' | 'history' }
  | { kind: 'playlist'; id: number }

export interface ResolvedCollection {
  title: string
  subtitle: string
  tracks: Track[]
  playlistId?: number
  /** true si el orden de la lista es el natural (no reordenar al buscar) */
  ordered: boolean
}

const byTitle = (a: Track, b: Track) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' })

export function recentTracks(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => b.dateAdded - a.dateAdded)
}
export function topTracks(tracks: Track[]): Track[] {
  return tracks
    .filter((t) => t.playCount > 0)
    .sort((a, b) => b.playCount - a.playCount || b.lastPlayed - a.lastPlayed)
}
export function historyTracks(tracks: Track[]): Track[] {
  return tracks.filter((t) => t.lastPlayed > 0).sort((a, b) => b.lastPlayed - a.lastPlayed)
}
export function favoriteTracks(tracks: Track[]): Track[] {
  return tracks.filter((t) => t.favorite).sort(byTitle)
}

export function resolveCollection(
  ref: CollectionRef,
  tracks: Track[],
  byId: Map<number, Track>,
  playlists: Playlist[],
): ResolvedCollection {
  const done = (title: string, list: Track[], extra?: Partial<ResolvedCollection>) => ({
    title,
    subtitle: plural(list.length, 'canción', 'canciones'),
    tracks: list,
    ordered: true,
    ...extra,
  })
  switch (ref.kind) {
    case 'artist':
      return done(
        ref.key,
        tracks
          .filter((t) => artistOf(t) === ref.key)
          .sort((a, b) => albumOf(a).localeCompare(albumOf(b)) || a.trackNo - b.trackNo || byTitle(a, b)),
      )
    case 'album':
      return done(
        ref.key,
        tracks.filter((t) => albumOf(t) === ref.key).sort((a, b) => a.trackNo - b.trackNo || byTitle(a, b)),
      )
    case 'genre':
      return done(ref.key, tracks.filter((t) => genreOf(t) === ref.key).sort(byTitle))
    case 'recent':
      return done('Últimas agregadas', recentTracks(tracks).slice(0, 200))
    case 'top':
      return done('Más reproducidas', topTracks(tracks).slice(0, 200))
    case 'history':
      return done('Escuchadas hace poco', historyTracks(tracks).slice(0, 200))
    case 'favorites':
      return done('Favoritas', favoriteTracks(tracks))
    case 'playlist': {
      const pl = playlists.find((p) => p.id === ref.id)
      const list = (pl?.trackIds ?? [])
        .map((id) => byId.get(id))
        .filter((t): t is Track => t !== undefined)
      return done(pl?.name ?? 'Lista', list, { playlistId: ref.id })
    }
  }
}
