import { useState } from 'react'
import type { Track } from '../types'
import type { AudioInfo } from '../db/db'
import { ensureAudioInfo, saveAudioInfo } from '../audio/analysis'
import { useClock } from '../visual/clock'

/** Los toques suelen llegar un poco después del pulso real. */
const TAP_LATENCY_MS = 60

function sourceText(info: AudioInfo | null): string {
  if (!info) return 'Sin analizar todavía.'
  if (info.source === 'tag') return 'El BPM viene de la etiqueta del archivo; el pulso se calculó del audio.'
  if (info.source === 'analysis') return 'Calculado analizando el audio.'
  if (info.source === 'manual') return 'Ajustado por ti.'
  if (info.source.startsWith('failed')) return `No se pudo analizar (${info.source.replace(/^failed:?\s*/, '') || 'error'}). Puedes marcar el ritmo tú mismo.`
  return info.source
}

export function RhythmSheet({ track, info, onClose }: { track: Track; info: AudioInfo | null; onClose: () => void }) {
  const clock = useClock()
  const [taps, setTaps] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const bpm = info?.bpm ?? 0
  const offset = info?.offsetMs ?? 0

  const save = (patch: Partial<AudioInfo>) =>
    saveAudioInfo(track, {
      bpm,
      offsetMs: offset,
      confidence: info?.confidence ?? 3,
      source: 'manual',
      ...patch,
    })

  const setBpm = (b: number) => {
    if (b < 40 || b > 240) return
    void save({ bpm: Math.round(b * 100) / 100 })
  }
  const shift = (delta: number) => {
    if (bpm <= 0) return
    const period = 60000 / bpm
    void save({ offsetMs: Math.round((((offset + delta) % period) + period) % period) })
  }

  const tap = () => setTaps((t) => [...t.slice(-15), clock()])

  const applyTaps = () => {
    if (taps.length < 4) return
    const diffs = taps
      .slice(1)
      .map((t, i) => t - taps[i])
      .filter((d) => d > 250 && d < 1500)
    let b = bpm
    if (diffs.length >= 5 || bpm <= 0) {
      const sorted = [...diffs].sort((x, y) => x - y)
      const med = sorted[Math.floor(sorted.length / 2)]
      if (med) {
        const est = 60000 / med
        if (bpm <= 0 || Math.abs(est - bpm) / bpm > 0.08) b = est
      }
    }
    if (b <= 0) return
    const T = 60000 / b
    let sx = 0
    let sy = 0
    for (const p of taps) {
      const ang = (2 * Math.PI * ((((p - TAP_LATENCY_MS) % T) + T) % T)) / T
      sx += Math.cos(ang)
      sy += Math.sin(ang)
    }
    const off = ((((Math.atan2(sy, sx) / (2 * Math.PI)) * T) % T) + T) % T
    void save({ bpm: Math.round(b * 100) / 100, offsetMs: Math.round(off), confidence: Math.max(info?.confidence ?? 0, 3) })
    setTaps([])
  }

  const reanalyze = async () => {
    setBusy(true)
    try {
      await ensureAudioInfo(track, { force: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop top" onClick={onClose}>
      <div className="sheet rhythm" onClick={(e) => e.stopPropagation()}>
        <div className="rhythm-top">
          <div>
            <h2>Ritmo</h2>
            <p className="muted">{sourceText(info)}</p>
          </div>
          <span className="beat-dot" aria-hidden="true" />
        </div>

        <div className="bpm-big">{bpm > 0 ? bpm.toFixed(1) : '—'} <small>BPM</small></div>

        <div className="rhythm-row">
          <button className="chip" disabled={bpm <= 0} onClick={() => setBpm(bpm / 2)}>½×</button>
          <button className="chip" disabled={bpm <= 0} onClick={() => setBpm(bpm - 0.5)}>−0.5</button>
          <button className="chip" disabled={bpm <= 0} onClick={() => setBpm(bpm + 0.5)}>+0.5</button>
          <button className="chip" disabled={bpm <= 0} onClick={() => setBpm(bpm * 2)}>2×</button>
        </div>
        <p className="muted small">Si el latido va el doble o la mitad de rápido que la música, usa ½× o 2×.</p>

        <h3 className="sub">Cuándo cae el pulso</h3>
        <div className="rhythm-row">
          <button className="chip" disabled={bpm <= 0} onClick={() => shift(-20)}>−20 ms</button>
          <span className="muted">{Math.round(offset)} ms</span>
          <button className="chip" disabled={bpm <= 0} onClick={() => shift(20)}>+20 ms</button>
        </div>
        <p className="muted small">Si el latido llega tarde, usa −; si llega antes de tiempo, usa +.</p>

        <h3 className="sub">Marcar el pulso tú mismo</h3>
        <button className="tap-pad" onClick={tap}>
          Toca aquí al ritmo{taps.length > 0 ? ` · ${taps.length}` : ''}
        </button>
        <div className="rhythm-row">
          <button className="chip solid" disabled={taps.length < 4} onClick={applyTaps}>Aplicar</button>
          <button className="chip" disabled={taps.length === 0} onClick={() => setTaps([])}>Borrar toques</button>
        </div>

        <div className="rhythm-row end">
          <button className="chip" disabled={busy} onClick={() => void reanalyze()}>
            {busy ? 'Analizando…' : 'Volver a analizar'}
          </button>
          <button className="chip solid" onClick={onClose}>Listo</button>
        </div>
      </div>
    </div>
  )
}
