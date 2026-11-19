import { useEffect, useMemo, useState } from 'react'
import { useLibrary } from '../state/library'
import { usePlayer } from '../state/player'
import { TrackList } from '../components/TrackList'
import { Cover } from '../components/Cover'
import { IconRefresh, IconSearch, IconTag } from '../icons'
import { SyncTagsSheet } from '../components/SyncTagsSheet'
import { dbSearchLyricTracks } from '../db/db'
import { albumOf, artistOf, genreOf, groupBy, norm, plural } from '../utils'
import type { CollectionRef } from '../nav'
import type { Track } from '../types'

type Seg = 'songs' | 'artists' | 'albums' | 'genres'
type Sort = 'title' | 'artist' | 'recent'

const SORTS: { id: Sort; label: string; hint: string }[] = [
  { id: 'title', label: 'Título', hint: 'De la A a la Z' },
  { id: 'artist', label: 'Artista', hint: 'Agrupadas por cantante' },
  { id: 'recent', label: 'Más recientes', hint: 'Lo último que agregaste' },
]

const SEGS: { id: Seg; label: string }[] = [
  { id: 'songs', label: 'Canciones' },
  { id: 'artists', label: 'Artistas' },
  { id: 'albums', label: 'Álbumes' },
  { id: 'genres', label: 'Géneros' },
]

interface Props {
  onOpen: (ref: CollectionRef) => void
  onMenu: (t: Track) => void
  /** buscar en internet (pantalla Descubrir) */
  onDiscover: (q: string) => void
}

export function Library({ onOpen, onMenu, onDiscover }: Props) {
  const { tracks, scanning, rescan, byId } = useLibrary()
  const { playQueue, current, isPlaying } = usePlayer()
  const [seg, setSeg] = useState<Seg>('songs')
  const [sort, setSort] = useState<Sort>('title')
  const [query, setQuery] = useState('')
  const [syncOpen, setSyncOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [lyricIds, setLyricIds] = useState<number[]>([])

  const q = norm(query.trim())

  // búsqueda dentro de las letras ya descargadas
  useEffect(() => {
    const text = query.trim()
    if (text.length < 3) {
      setLyricIds([])
      return
    }
    let alive = true
    const id = window.setTimeout(() => {
      void dbSearchLyricTracks(text).then((ids) => alive && setLyricIds(ids))
    }, 300)
    return () => {
      alive = false
      window.clearTimeout(id)
    }
  }, [query])

  const songs = useMemo(() => {
    const list = q
      ? tracks.filter((t) => norm(`${t.title} ${t.artist} ${t.album}`).includes(q))
      : [...tracks]
    const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' })
    if (sort === 'title') list.sort((a, b) => cmp(a.title, b.title))
    else if (sort === 'artist') list.sort((a, b) => cmp(artistOf(a), artistOf(b)) || cmp(a.title, b.title))
    else list.sort((a, b) => b.dateAdded - a.dateAdded)
    return list
  }, [tracks, q, sort])

  const lyricSongs = useMemo(() => {
    const have = new Set(songs.map((t) => t.id))
    return lyricIds.map((id) => byId.get(id)).filter((t): t is Track => !!t && !have.has(t.id))
  }, [lyricIds, songs, byId])

  const groups = useMemo(() => {
    if (seg === 'songs') return []
    const keyOf = seg === 'artists' ? artistOf : seg === 'albums' ? albumOf : genreOf
    const list = groupBy(tracks, keyOf).filter((g) => !q || norm(g.key).includes(q))
    // artistas y géneros: de los que tienen más canciones a los que tienen menos
    if (seg !== 'albums') list.sort((a, b) => b.tracks.length - a.tracks.length || a.key.localeCompare(b.key, 'es', { sensitivity: 'base' }))
    return list
  }, [tracks, seg, q])

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Biblioteca</h1>
        <button
          className={`icon-btn${scanning ? ' spin' : ''}`}
          onClick={() => void rescan()}
          aria-label="Buscar música nueva"
        >
          <IconRefresh size={22} />
        </button>
        <button className="icon-btn" onClick={() => setSyncOpen(true)} aria-label="Actualizar etiquetas y portadas">
          <IconTag size={22} />
        </button>
      </header>

      <div className="search">
        <IconSearch size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar canción, artista o álbum"
          aria-label="Buscar"
        />
      </div>

      <div className="seg">
        {SEGS.map((s) => (
          <button key={s.id} className={s.id === seg ? 'on' : ''} onClick={() => setSeg(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {seg === 'songs' ? (
        <>
          <div className="sort-row">
            <span className="muted">{plural(songs.length, 'canción', 'canciones')}</span>
            <div className="sort-menu">
              <button className="sort-trigger" onClick={() => setSortOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={sortOpen}>
                <span className="muted">Ordenar:</span>
                <strong>{SORTS.find((o) => o.id === sort)?.label}</strong>
                <span className={`sort-caret${sortOpen ? ' open' : ''}`}>▾</span>
              </button>
              {sortOpen && (
                <>
                  <div className="sort-backdrop" onClick={() => setSortOpen(false)} />
                  <div className="sort-pop" role="listbox">
                    {SORTS.map((o) => (
                      <button
                        key={o.id}
                        role="option"
                        aria-selected={sort === o.id}
                        className={`sort-opt${sort === o.id ? ' on' : ''}`}
                        onClick={() => {
                          setSort(o.id)
                          setSortOpen(false)
                        }}
                      >
                        <span>
                          {o.label}
                          <small>{o.hint}</small>
                        </span>
                        {sort === o.id && <span className="sort-check">✓</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          <TrackList
            tracks={songs}
            activeId={current?.id ?? null}
            playing={isPlaying}
            resetKey={`${sort}|${q}`}
            onPlay={(i) => void playQueue(songs, i, false)}
            onMenu={onMenu}
          />
          {!songs.length && <p className="empty">{q ? 'Nada coincide con tu búsqueda.' : 'Aún no hay canciones.'}</p>}
          {lyricSongs.length > 0 && (
            <>
              <div className="sort-row">
                <span className="muted">También aparece en las letras</span>
              </div>
              <TrackList
                tracks={lyricSongs}
                activeId={current?.id ?? null}
                playing={isPlaying}
                resetKey={`lyr|${q}`}
                onPlay={(i) => void playQueue(lyricSongs, i, false)}
                onMenu={onMenu}
              />
            </>
          )}
          {q && (
            <button className="big-btn" onClick={() => onDiscover(query.trim())}>
              <IconSearch size={18} />
              Buscar «{query.trim()}» en internet
            </button>
          )}
        </>
      ) : (
        <div className="track-list">
          {groups.map((g) => (
            <button
              key={g.key}
              className="row-main group-row"
              onClick={() => onOpen({ kind: seg === 'artists' ? 'artist' : seg === 'albums' ? 'album' : 'genre', key: g.key })}
            >
              <Cover track={g.tracks[0]} size={48} />
              <span className="row-text">
                <span className="row-title">{g.key}</span>
                <span className="row-sub">
                  {plural(g.tracks.length, 'canción', 'canciones')}
                  {seg === 'albums' ? ` · ${artistOf(g.tracks[0])}` : ''}
                </span>
              </span>
            </button>
          ))}
          {!groups.length && <p className="empty">Nada por mostrar.</p>}
        </div>
      )}
      {syncOpen && <SyncTagsSheet onClose={() => setSyncOpen(false)} />}
    </div>
  )
}
