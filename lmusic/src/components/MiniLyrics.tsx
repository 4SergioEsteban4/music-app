import { useMemo } from 'react'
import type { Track } from '../types'
import { useProgress } from '../state/player'
import { activeLineIndex, parseLrc } from '../lyrics/lrc'
import { useTrackLyrics } from './LyricsView'

/** La línea que suena (y la siguiente) debajo de la portada, sin abrir la letra completa. */
export function MiniLyrics({ track }: { track: Track }) {
  const { data } = useTrackLyrics(track)
  const { positionMs } = useProgress()
  const lines = useMemo(() => (data?.synced ? parseLrc(data.synced) : []), [data?.synced])
  if (!lines.length) return null
  const i = activeLineIndex(lines, positionMs + (data?.offsetMs ?? 0) + 120)
  const cur = i >= 0 ? lines[i].text : ''
  const next = lines[i + 1]?.text ?? ''
  return (
    <div className="mini-lyrics">
      <p key={i} className="mini-cur">
        {cur || '♪'}
      </p>
      {next && <p className="mini-next">{next}</p>}
    </div>
  )
}
