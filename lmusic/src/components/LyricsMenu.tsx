import { useState } from 'react'
import type { Track } from '../types'
import { useSettings } from '../state/settings'
import { applyLyricsRecord, deleteLyrics } from '../lyrics/service'
import { LyricsNetworkError, searchLrclib } from '../lyrics/lrclib'
import type { LrclibRecord } from '../lyrics/lrclib'
import { findByFragment } from '../lyrics/fragment'
import type { FragmentMatch } from '../lyrics/fragment'
import { aiReady } from '../ai/client'
import type { AiConfig, AiProvider } from '../ai/client'
import { fmtTime } from '../utils'
import { IconBook, IconSearch, IconSliders, IconSync, IconTextSize, IconTrash } from '../icons'

interface Props {
  track: Track
  hasLyrics: boolean
  synced: boolean
  offset: number
  shiftOffset: (delta: number) => Promise<void>
  onEdit: () => void
  onImportFile: () => void
  onOpenSettings: () => void
  onRetranslate: () => void
  onClose: () => void
}

type Mode = 'main' | 'sync' | 'size' | 'find'

const SIZES: [number, string][] = [
  [85, 'Pequeña'],
  [100, 'Normal'],
  [125, 'Grande'],
  [150, 'Muy grande'],
  [175, 'Enorme'],
  [200, 'Máximo'],
]

/** Menú de los 3 puntitos cuando la letra está abierta. */
export function LyricsMenu({ track, hasLyrics, synced, offset, shiftOffset, onEdit, onImportFile, onOpenSettings, onRetranslate, onClose }: Props) {
  const { settings, update } = useSettings()
  const [mode, setMode] = useState<Mode>('main')
  const [confirmDel, setConfirmDel] = useState(false)
  const [title, setTitle] = useState(track.title)
  const [artist, setArtist] = useState(track.artist)
  const [results, setResults] = useState<LrclibRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [frag, setFrag] = useState('')
  const [fragResults, setFragResults] = useState<FragmentMatch[]>([])

  const search = async () => {
    setBusy(true)
    setMsg('')
    setResults([])
    try {
      const r = await searchLrclib(title, artist)
      setResults(r)
      if (!r.length) setMsg('No hay resultados. Prueba cambiando el título o el artista.')
    } catch (e) {
      setMsg(
        e instanceof LyricsNetworkError && e.kind === 'server'
          ? 'El servidor de letras está ocupado. Inténtalo de nuevo en unos segundos.'
          : 'No pude conectar. Revisa tu internet.',
      )
    } finally {
      setBusy(false)
    }
  }
  const searchFragment = async () => {
    setBusy(true)
    setMsg('')
    setFragResults([])
    try {
      const aiCfg: AiConfig = { provider: settings.aiProvider as AiProvider, key: settings.aiKey, model: settings.aiModel }
      const res = await findByFragment(track, frag.trim(), aiReady(aiCfg) ? aiCfg : null)
      setFragResults(res)
      if (!res.length) setMsg('No encontré una canción con ese fragmento.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Algo falló en la búsqueda.')
    } finally {
      setBusy(false)
    }
  }
  const useRecord = async (rec: LrclibRecord, source: string) => {
    await applyLyricsRecord(track, rec, source)
    onClose()
  }
  const openWeb = () => {
    const q = encodeURIComponent(`${title} ${artist} letra`.trim())
    window.open(`https://www.google.com/search?q=${q}`, '_blank')
  }

  return (
    <div className={`sheet-backdrop top${mode === 'sync' ? ' clear' : ''}`} onClick={mode === 'sync' ? undefined : onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {mode === 'main' && (
          <div className="sheet-actions">
            <button className="mi" onClick={onOpenSettings}>
              <IconSliders size={20} />
              <span>Configuración de la letra</span>
            </button>
            <button className="mi" disabled={!synced} onClick={() => setMode('sync')}>
              <IconSync size={20} />
              <span>Sincronizar letra{!synced ? ' (esta letra no tiene tiempos)' : ''}</span>
            </button>
            <button className="mi" onClick={() => setMode('size')}>
              <IconTextSize size={20} />
              <span>Tamaño de la letra · {settings.lyricSize}%</span>
            </button>
            <button className="mi" onClick={() => update({ lyricTranslate: !settings.lyricTranslate })}>
              <IconBook size={20} />
              <span>Traducción debajo de la letra · {settings.lyricTranslate ? 'Sí' : 'No'}</span>
            </button>
            {settings.lyricTranslate && (
              <button
                className="mi"
                onClick={() => {
                  onRetranslate()
                  onClose()
                }}
              >
                <IconSync size={20} />
                <span>Volver a traducir esta canción</span>
              </button>
            )}
            <button className="mi" onClick={() => setMode('find')}>
              <IconSearch size={20} />
              <span>Buscar letra correcta</span>
            </button>
            {hasLyrics && (
              <button
                className={`mi${confirmDel ? ' danger' : ''}`}
                onClick={async () => {
                  if (!confirmDel) {
                    setConfirmDel(true)
                    return
                  }
                  await deleteLyrics(track)
                  onClose()
                }}
              >
                <IconTrash size={20} />
                <span>{confirmDel ? 'Toca otra vez para eliminar la letra' : 'Eliminar letra'}</span>
              </button>
            )}
          </div>
        )}

        {mode === 'sync' && (
          <>
            <h2>Sincronizar letra</h2>
            <p className="muted">Si la letra va adelantada, usa −. Si va atrasada, usa +.</p>
            <div className="sync-big">
              {offset > 0 ? '+' : ''}
              {(offset / 1000).toFixed(2)} s
            </div>
            <div className="rhythm-row">
              <button className="chip" onClick={() => void shiftOffset(-250)}>−0.25</button>
              <button className="chip" onClick={() => void shiftOffset(-50)}>−0.05</button>
              <button className="chip" onClick={() => void shiftOffset(50)}>+0.05</button>
              <button className="chip" onClick={() => void shiftOffset(250)}>+0.25</button>
            </div>
            <div className="rhythm-row end">
              <button className="chip" disabled={offset === 0} onClick={() => void shiftOffset(-offset)}>
                Restablecer
              </button>
              <button className="chip solid" onClick={() => setMode('main')}>
                Listo
              </button>
            </div>
          </>
        )}

        {mode === 'size' && (
          <>
            <h2>Tamaño de la letra</h2>
            <div className="rhythm-row">
              {SIZES.map(([v, name]) => (
                <button key={v} className={`chip${settings.lyricSize === v ? ' solid' : ''}`} onClick={() => update({ lyricSize: v })}>
                  {name}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Ajuste fino: {settings.lyricSize}%</span>
              <input type="range" min={70} max={200} step={5} value={settings.lyricSize} onChange={(e) => update({ lyricSize: Number(e.target.value) })} />
            </label>
            <div className="rhythm-row end">
              <button className="chip solid" onClick={() => setMode('main')}>
                Listo
              </button>
            </div>
          </>
        )}

        {mode === 'find' && (
          <>
            <h2>Buscar letra correcta</h2>
            <label className="field">
              <span>Título</span>
              <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span>Artista</span>
              <input className="text-input" value={artist} onChange={(e) => setArtist(e.target.value)} />
            </label>
            <div className="rhythm-row">
              <button className="chip solid" disabled={busy || !title.trim()} onClick={() => void search()}>
                {busy ? 'Buscando…' : 'Ver opciones en biblioteca'}
              </button>
              <button className="chip" onClick={openWeb}>
                Buscar en internet
              </button>
            </div>
            {msg && <p className="muted">{msg}</p>}
            {results.map((r) => (
              <button key={r.id} className="ctx-row" onClick={() => void useRecord(r, 'lrclib')}>
                <span className="ctx-line">
                  {r.trackName} — {r.artistName}
                </span>
                <span className="muted">
                  {r.syncedLyrics ? 'Con tiempos' : r.plainLyrics ? 'Sin tiempos' : 'Instrumental'} · dura {fmtTime(r.duration * 1000)} (tu archivo{' '}
                  {fmtTime(track.durationMs)}) · toca para usarla
                </span>
              </button>
            ))}

            <p className="muted">¿La encontraste en internet? Cópiala y pégala aquí para guardarla.</p>
            <div className="rhythm-row">
              <button
                className="chip"
                onClick={() => {
                  onEdit()
                  onClose()
                }}
              >
                Pegar la letra que copié
              </button>
              <button
                className="chip"
                onClick={() => {
                  onImportFile()
                  onClose()
                }}
              >
                Importar .lrc / .txt
              </button>
            </div>

            <p className="muted">O escribe una frase que se cante (útil si es un cover o el título está mal).</p>
            <textarea className="lyrics-text small" value={frag} onChange={(e) => setFrag(e.target.value)} placeholder="Una frase de la letra…" />
            <div className="rhythm-row">
              <button className="chip" disabled={busy || frag.trim().length < 8} onClick={() => void searchFragment()}>
                Buscar por fragmento
              </button>
            </div>
            {fragResults.map((m) => (
              <button key={m.record.id} className="ctx-row" onClick={() => void useRecord(m.record, 'fragmento')}>
                <span className="ctx-line">
                  {m.record.trackName} — {m.record.artistName}
                </span>
                <span className="muted">{m.record.syncedLyrics ? 'Con tiempos' : 'Sin tiempos'} · toca para usarla</span>
              </button>
            ))}
            <div className="rhythm-row end">
              <button className="chip solid" onClick={() => setMode('main')}>
                Volver
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
