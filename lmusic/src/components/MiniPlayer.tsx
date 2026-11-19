import { usePlayer, useProgress } from '../state/player'
import { Cover } from './Cover'
import { IconNext, IconPause, IconPlay } from '../icons'
import { artistOf } from '../utils'

export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const { current, isPlaying, toggle, next } = usePlayer()
  const { positionMs, durationMs } = useProgress()
  if (!current) return null
  const pct = durationMs > 0 ? Math.min(100, (positionMs / durationMs) * 100) : 0
  return (
    <div className="mini">
      <div className="mini-bar">
        <div className="mini-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <button className="mini-main" onClick={onOpen}>
        <Cover track={current} size={44} />
        <span className="row-text">
          <span className="row-title">{current.title}</span>
          <span className="row-sub">{artistOf(current)}</span>
        </span>
      </button>
      <button className="icon-btn" onClick={() => void toggle()} aria-label={isPlaying ? 'Pausar' : 'Reproducir'}>
        {isPlaying ? <IconPause size={24} /> : <IconPlay size={24} />}
      </button>
      <button className="icon-btn" onClick={() => void next()} aria-label="Siguiente">
        <IconNext size={22} />
      </button>
    </div>
  )
}
