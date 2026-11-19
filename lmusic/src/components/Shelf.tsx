import type { Track } from '../types'
import { Cover } from './Cover'
import { artistOf } from '../utils'

interface Props {
  title: string
  tracks: Track[]
  onSeeAll?: () => void
  onPlay: (index: number) => void
}

export function Shelf({ title, tracks, onSeeAll, onPlay }: Props) {
  if (!tracks.length) return null
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2>{title}</h2>
        {onSeeAll && (
          <button className="link-btn" onClick={onSeeAll}>
            Ver todo
          </button>
        )}
      </div>
      <div className="shelf-row">
        {tracks.slice(0, 12).map((t, i) => (
          <button key={t.id} className="card" onClick={() => onPlay(i)}>
            <Cover track={t} size={128} />
            <span className="card-title">{t.title}</span>
            <span className="card-sub">{artistOf(t)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
