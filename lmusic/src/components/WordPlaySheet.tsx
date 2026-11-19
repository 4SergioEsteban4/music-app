import { useEffect, useState } from 'react'
import { useVocab } from '../state/vocab'
import { useLibrary } from '../state/library'
import { artistOf, fmtTime, norm } from '../utils'
import { loadLyrics } from '../lyrics/service'
import { parseLrc } from '../lyrics/lrc'
import type { ContextRow } from '../types'
import { IconBook, IconPlay } from '../icons'

/** Al tocar una palabra guardada: reproducir la canción o ir justo a la parte donde la viste. */
export function WordPlaySheet({
  word,
  onClose,
  onDetail,
  onPlayAt,
}: {
  word: { id: number; word: string }
  onClose: () => void
  onDetail: () => void
  onPlayAt: (trackId: number, timeMs: number) => void
}) {
  const { getContexts } = useVocab()
  const { byId } = useLibrary()
  const [rows, setRows] = useState<ContextRow[] | null>(null)
  useEffect(() => {
    let alive = true
    void getContexts(word.id).then((c) => alive && setRows(c))
    return () => {
      alive = false
    }
  }, [word.id, getContexts])

  // si no se guardó el minuto, se busca la frase en la letra sincronizada para saltar justo ahí
  const [times, setTimes] = useState<Record<number, number>>({})
  useEffect(() => {
    let alive = true
    void (async () => {
      const out: Record<number, number> = {}
      for (const r of rows ?? []) {
        if (r.timeMs > 0 || !r.line) continue
        const t = byId.get(r.trackId)
        if (!t) continue
        try {
          const l = await loadLyrics(t)
          if (!l.synced) continue
          const target = norm(r.line)
          const lines = parseLrc(l.synced)
          const hit =
            lines.find((x) => norm(x.text) === target) ??
            lines.find((x) => norm(x.text).length > 2 && (norm(x.text).includes(target) || target.includes(norm(x.text))))
          if (hit) out[r.id] = hit.timeMs
        } catch {
          // sin letra guardada
        }
      }
      if (alive) setTimes(out)
    })()
    return () => {
      alive = false
    }
  }, [rows, byId])
  const timeOf = (r: ContextRow) => (r.timeMs > 0 ? r.timeMs : (times[r.id] ?? 0))

  const valid = (rows ?? []).filter((r) => byId.has(r.trackId)).sort((a, b) => b.createdAt - a.createdAt)
  const first = valid[0]
  const firstTrack = first ? byId.get(first.trackId) : undefined
  const play = (trackId: number, ms: number) => {
    onPlayAt(trackId, ms)
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{word.word}</h2>
        {rows === null && <p className="muted">Buscando dónde la viste…</p>}
        {rows !== null && valid.length === 0 && <p className="muted">No tengo guardada la canción donde viste esta palabra.</p>}
        <div className="sheet-actions">
          {firstTrack && first && (
            <button className="mi" onClick={() => play(first.trackId, 0)}>
              <IconPlay size={20} />
              <span>
                Reproducir la canción
                <small className="mi-sub">
                  {firstTrack.title} — {artistOf(firstTrack)}
                </small>
              </span>
            </button>
          )}
          {valid.map((r) => {
            const t = byId.get(r.trackId)
            return (
              <button key={r.id} className="mi" onClick={() => play(r.trackId, timeOf(r))}>
                <IconPlay size={20} />
                <span>
                  Reproducir la parte donde dice «{word.word}»
                  <small className="mi-sub">
                    {r.line ? `“${r.line}” · ` : ''}
                    {valid.length > 1 && t ? `${t.title} · ` : ''}
                    {timeOf(r) > 0 ? fmtTime(timeOf(r)) : ''}
                  </small>
                </span>
              </button>
            )
          })}
          <button className="mi" onClick={onDetail}>
            <IconBook size={20} />
            <span>Ver el detalle de la palabra</span>
          </button>
        </div>
      </div>
    </div>
  )
}
