import { useEffect, useRef, useState } from 'react'
import type { Track } from '../types'
import { usePlayer } from '../state/player'
import { useClock } from '../visual/clock'
import { loadLyrics, saveManualLyrics } from '../lyrics/service'
import { lrcToPlain } from '../lyrics/lrc'
import { IconBack, IconPause, IconPlay } from '../icons'
import { artistOf, fmtTime } from '../utils'

/** Los toques llegan un poco después de que empieza la línea: se compensa. */
const TAP_LATENCY_MS = 150

const stamp = (ms: number) => {
  const t = Math.max(0, Math.round(ms))
  const m = Math.floor(t / 60000)
  const s = Math.floor((t % 60000) / 1000)
  const cs = Math.floor((t % 1000) / 10)
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`
}

/** Editor para sincronizar una letra a mano: escuchas la canción y tocas cuando empieza cada línea. */
export function LyricsEditor({ track, onClose }: { track: Track; onClose: () => void }) {
  const player = usePlayer()
  const clock = useClock()
  const [step, setStep] = useState<'text' | 'sync' | 'done'>('text')
  const [text, setText] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [times, setTimes] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const loaded = useRef(false)

  // Empezar con la letra que ya haya (sin tiempos) para corregirla o volver a sincronizarla
  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    void loadLyrics(track)
      .then((d) => setText(d.plain || (d.synced ? lrcToPlain(d.synced) : '')))
      .catch(() => {})
  }, [track])

  const start = async () => {
    const ls = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (!ls.length) return
    setLines(ls)
    setTimes([])
    if (player.current?.id !== track.id) await player.playQueue([track], 0, false)
    await player.seek(0)
    if (!player.isPlaying) await player.toggle()
    setStep('sync')
  }

  const idx = times.length

  const mark = () => {
    if (idx >= lines.length) return
    const t = Math.max(0, clock() - TAP_LATENCY_MS)
    const next = [...times, t]
    setTimes(next)
    if (next.length === lines.length) setStep('done')
  }

  const undo = () => {
    if (!times.length) return
    const prev = times[times.length - 1]
    setTimes(times.slice(0, -1))
    if (step === 'done') setStep('sync')
    void player.seek(Math.max(0, prev - 2000))
  }

  const shiftAll = (delta: number) => setTimes((t) => t.map((x) => Math.max(0, x + delta)))

  const lrc = lines.map((l, i) => `${stamp(times[i] ?? 0)}${l}`).join('\n')

  const save = async () => {
    setSaving(true)
    try {
      await saveManualLyrics(track, lrc)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="review editor">
      <header className="screen-head">
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          <IconBack size={26} />
        </button>
        <div className="head-text">
          <h1>Sincronizar letra</h1>
          <span className="muted">
            {track.title} · {artistOf(track)}
          </span>
        </div>
      </header>

      {step === 'text' && (
        <div className="detail-body">
          <p className="muted">
            Pega o corrige la letra, una línea por renglón. Luego la canción empieza y tú tocas el botón justo cuando
            empieza cada línea.
          </p>
          <textarea
            className="lyrics-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Pega aquí la letra…"
          />
          <button className="big-btn" disabled={!text.trim()} onClick={() => void start()}>
            Empezar a sincronizar
          </button>
        </div>
      )}

      {step === 'sync' && (
        <div className="editor-sync">
          <p className="muted">
            Línea {Math.min(idx + 1, lines.length)} de {lines.length}
          </p>
          <div className="editor-lines">
            <p className="ed-prev">{idx > 0 ? lines[idx - 1] : ' '}</p>
            <p className="ed-cur">{lines[idx]}</p>
            <p className="ed-next">{lines[idx + 1] ?? ' '}</p>
          </div>
          <button className="mark-pad" onClick={mark}>
            Empieza esta línea
          </button>
          <div className="rhythm-row">
            <button className="chip" onClick={undo} disabled={!times.length}>
              Deshacer
            </button>
            <button className="chip" onClick={() => void player.seek(Math.max(0, clock() - 3000))}>
              −3 s
            </button>
            <button className="chip" onClick={() => void player.toggle()}>
              {player.isPlaying ? <IconPause size={16} /> : <IconPlay size={16} />}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="detail-body">
          <p>¡Listo! Revisa los tiempos y guarda.</p>
          <div className="rhythm-row">
            <button className="chip" onClick={() => shiftAll(-100)}>
              Todo −0.1 s
            </button>
            <button className="chip" onClick={() => shiftAll(100)}>
              Todo +0.1 s
            </button>
          </div>
          <div className="meta-list">
            {lines.map((l, i) => (
              <div key={i} className="ed-row">
                <span className="muted">{fmtTime(times[i] ?? 0)}</span>
                <span>{l}</span>
              </div>
            ))}
          </div>
          <div className="rhythm-row end">
            <button className="chip" onClick={() => setStep('text')}>
              Volver al texto
            </button>
            <button className="chip solid" disabled={saving} onClick={() => void save()}>
              {saving ? 'Guardando…' : 'Guardar letra'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
