import { useEffect, useRef, useState } from 'react'
import type { Track } from '../types'
import { Cover } from './Cover'
import { IconHeart, IconMore } from '../icons'
import { artistOf, fmtTime } from '../utils'

interface RowProps {
  track: Track
  active: boolean
  playing: boolean
  onPlay: () => void
  onMenu: () => void
}

function TrackRow({ track, active, playing, onPlay, onMenu }: RowProps) {
  return (
    <div className={`row${active ? ' active' : ''}`}>
      <button className="row-main" onClick={onPlay}>
        <Cover track={track} size={48} />
        <span className="row-text">
          <span className="row-title">{track.title}</span>
          <span className="row-sub">
            {active && playing ? 'Sonando · ' : ''}
            {artistOf(track)}
          </span>
        </span>
        {track.favorite && (
          <span className="row-fav">
            <IconHeart size={14} filled />
          </span>
        )}
        <span className="row-time">{fmtTime(track.durationMs)}</span>
      </button>
      <button className="icon-btn" onClick={onMenu} aria-label="Más opciones">
        <IconMore size={20} />
      </button>
    </div>
  )
}

interface Props {
  tracks: Track[]
  activeId: number | null
  playing: boolean
  onPlay: (index: number) => void
  onMenu: (t: Track) => void
  /** cambia cuando hay que volver a empezar la paginación (búsqueda, orden…) */
  resetKey?: string
}

const STEP = 120

/** Lista paginada: pinta por tandas para que miles de canciones no frenen un teléfono modesto. */
export function TrackList({ tracks, activeId, playing, onPlay, onMenu, resetKey }: Props) {
  const [limit, setLimit] = useState(STEP)
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLimit(STEP)
  }, [resetKey])

  useEffect(() => {
    const el = sentinel.current
    if (!el || limit >= tracks.length) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + STEP)
      },
      { rootMargin: '800px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [limit, tracks.length])

  if (!tracks.length) return null
  return (
    <div className="track-list">
      {tracks.slice(0, limit).map((t, i) => (
        <TrackRow
          key={t.id}
          track={t}
          active={t.id === activeId}
          playing={playing}
          onPlay={() => onPlay(i)}
          onMenu={() => onMenu(t)}
        />
      ))}
      {limit < tracks.length && <div ref={sentinel} className="sentinel" />}
    </div>
  )
}
