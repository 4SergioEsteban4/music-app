import { useEffect, useState } from 'react'
import { cancelSleep, startSleepMinutes, startSleepTrackEnd, useSleep } from '../audio/sleep'

const MINUTES = [10, 15, 30, 45, 60, 90]

export function SleepSheet({ onClose }: { onClose: () => void }) {
  const sleep = useSleep()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 15000)
    return () => window.clearInterval(id)
  }, [])
  const left = sleep?.kind === 'time' ? Math.max(1, Math.ceil((sleep.at - Date.now()) / 60000)) : 0

  return (
    <div className="sheet-backdrop top" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Temporizador para dormir</h2>
        <p className="muted">
          {!sleep
            ? 'La música se pausa sola cuando se cumpla el tiempo.'
            : sleep.kind === 'time'
              ? `Se pausará en ${left} min.`
              : 'Se pausará al terminar esta canción.'}
        </p>
        <div className="rhythm-row">
          {MINUTES.map((m) => (
            <button
              key={m}
              className="chip"
              onClick={() => {
                startSleepMinutes(m)
                onClose()
              }}
            >
              {m} min
            </button>
          ))}
          <button
            className="chip"
            onClick={() => {
              startSleepTrackEnd()
              onClose()
            }}
          >
            Al terminar la canción
          </button>
        </div>
        <div className="rhythm-row end">
          {sleep && (
            <button
              className="chip"
              onClick={() => {
                cancelSleep()
                onClose()
              }}
            >
              Cancelar temporizador
            </button>
          )}
          <button className="chip solid" onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>
  )
}
