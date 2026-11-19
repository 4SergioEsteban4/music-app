import { useEffect } from 'react'
import { usePlayer, useProgress } from '../state/player'
import { IconNext, IconPause, IconPlay, IconPrev } from '../icons'
import { artistOf, fmtTime } from '../utils'

/** Pantalla con botones enormes para usar la música sin mirar mucho (mantiene la pantalla encendida). */
export function DriveMode({ onClose }: { onClose: () => void }) {
  const p = usePlayer()
  const { positionMs, durationMs } = useProgress()
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    void (async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null
      } catch {
        // sin soporte: la pantalla se apaga como siempre
      }
    })()
    return () => {
      void lock?.release()
    }
  }, [])
  const pct = durationMs > 0 ? Math.min(100, (positionMs / durationMs) * 100) : 0

  return (
    <div className="drive" role="dialog" aria-label="Modo conducción">
      <button className="drive-exit" onClick={onClose}>
        Salir
      </button>
      <div className="drive-info">
        <h1>{p.current?.title ?? '—'}</h1>
        <p>{p.current ? artistOf(p.current) : ''}</p>
      </div>
      <div>
        <div className="drive-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="drive-times">
          <span>{fmtTime(positionMs)}</span>
          <span>{fmtTime(durationMs)}</span>
        </div>
      </div>
      <div className="drive-btns">
        <button onClick={() => void p.previous()} aria-label="Anterior">
          <IconPrev size={64} />
        </button>
        <button className="main" onClick={() => void p.toggle()} aria-label={p.isPlaying ? 'Pausar' : 'Reproducir'}>
          {p.isPlaying ? <IconPause size={80} /> : <IconPlay size={80} />}
        </button>
        <button onClick={() => void p.next()} aria-label="Siguiente">
          <IconNext size={64} />
        </button>
      </div>
    </div>
  )
}
