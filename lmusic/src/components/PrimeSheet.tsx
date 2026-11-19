import { useState } from 'react'
import type { Track } from '../types'
import { addPrime, removePrime, setPrimeStars, usePrime } from '../audio/prime'
import { useClock } from '../visual/clock'
import { usePlayer } from '../state/player'
import { IconStar } from '../icons'
import { fmtTime } from '../utils'
import { startHighlightJob, useHighlightJob } from '../audio/highlightJob'

/** Hoja para marcar las partes favoritas de la canción (momentos prime) y elegir su intensidad. */
export function PrimeSheet({ track, onClose }: { track: Track; onClose: () => void }) {
  const moments = usePrime(track.id)
  const clock = useClock()
  const { seek } = usePlayer()
  const [start, setStart] = useState<number | null>(null)
  const job = useHighlightJob(track.id)

  const mark = () => {
    const now = clock()
    if (start === null) {
      setStart(now)
    } else {
      if (now > start + 500) void addPrime(track.id, start, now, 4)
      setStart(null)
    }
  }

  return (
    <div className="sheet-backdrop top" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Star mode · mis partes favoritas</h2>
        <p className="muted">
          Marca tus partes favoritas de esta canción. Cuando suenen, entra el Star mode (la letra y la portada hacen cosas locas), más fuerte cuantas más estrellas le pongas. Para encenderlo al instante toca la ★ de la pantalla.
        </p>

        <div className="rhythm-row">
          <button className="chip solid" disabled={job?.status === 'running'} onClick={() => startHighlightJob(track, 3)}>
            {job?.status === 'running' ? 'Analizando…' : '✨ Marcar los momentos más intensos'}
          </button>
        </div>
        {job && <p className="muted">{job.status === 'running' ? `${job.message} Puedes darle a Listo y seguir usando la app: te aviso cuando termine.` : job.message}</p>}

        <div className="rhythm-row">
          <button className={`chip${start !== null ? ' solid' : ''}`} onClick={mark}>
            {start === null ? 'Marcar inicio aquí' : `Inicio ${fmtTime(start)} → marcar fin aquí`}
          </button>
          {start !== null && (
            <button className="chip" onClick={() => setStart(null)}>
              Cancelar
            </button>
          )}
        </div>

        {moments.length === 0 && <p className="muted">Aún no marcaste ninguno en esta canción.</p>}
        {moments.map((m) => (
          <div key={m.id} className="prime-row">
            <button className="prime-time" onClick={() => void seek(Math.max(0, m.startMs - 2000))}>
              {fmtTime(m.startMs)} – {fmtTime(m.endMs)}
            </button>
            <span className="stars" role="group" aria-label="Intensidad">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={`star${n <= m.stars ? ' on' : ''}`}
                  onClick={() => void setPrimeStars(track.id, m.id, n)}
                  aria-label={`${n} estrellas`}
                >
                  <IconStar size={22} filled={n <= m.stars} />
                </button>
              ))}
            </span>
            <button className="link-btn" onClick={() => void removePrime(track.id, m.id)}>
              Quitar
            </button>
          </div>
        ))}

        <div className="rhythm-row end">
          <button className="chip solid" onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>
  )
}
