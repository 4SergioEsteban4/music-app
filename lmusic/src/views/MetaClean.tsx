import { useEffect, useMemo, useRef, useState } from 'react'
import { useLibrary } from '../state/library'
import { useSettings } from '../state/settings'
import { IconBack } from '../icons'
import { needsReview, suggestFromRules } from '../meta/clean'
import type { MetaFields } from '../meta/clean'
import { lookupMeta } from '../meta/online'
import { aiFillMeta } from '../meta/ai'
import { aiReady } from '../ai/client'
import type { AiConfig, AiProvider } from '../ai/client'
import type { Track } from '../types'

interface Suggestion {
  track: Track
  fields: MetaFields
  source: string
  confidence: 'alta' | 'media' | 'baja'
  accepted: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const LABEL: Record<keyof MetaFields, string> = { title: 'Título', artist: 'Artista', album: 'Álbum', genre: 'Género' }

/** Solo se rellenan campos vacíos y se limpia el título; nunca se pisa un artista o álbum ya escrito. */
function merge(t: Track, ...parts: MetaFields[]): MetaFields {
  const out: MetaFields = {}
  for (const p of parts) {
    if (p.title && p.title !== t.title && (!out.title || p === parts[0])) out.title = p.title
    if (p.artist && !t.artist && !out.artist) out.artist = p.artist
    if (p.album && !t.album && !out.album) out.album = p.album
    if (p.genre && !t.genre && !out.genre) out.genre = p.genre
  }
  return out
}

export function MetaClean({ onClose, autoStart = false }: { onClose: () => void; autoStart?: boolean }) {
  const { tracks, updateMeta } = useLibrary()
  const { settings } = useSettings()
  const aiCfg: AiConfig = { provider: settings.aiProvider as AiProvider, key: settings.aiKey, model: settings.aiModel }
  const canAi = aiReady(aiCfg)

  const [useOnline, setUseOnline] = useState(true)
  const [useAi, setUseAi] = useState(canAi)
  const [phase, setPhase] = useState<'idle' | 'running' | 'review' | 'done'>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' })
  const [items, setItems] = useState<Suggestion[]>([])
  const [message, setMessage] = useState('')
  const cancel = useRef(false)

  const candidates = useMemo(() => tracks.filter(needsReview), [tracks])

  const run = async () => {
    cancel.current = false
    setPhase('running')
    setMessage('')
    const found: Suggestion[] = []
    const needAi: Suggestion[] = []
    let netFails = 0
    const list = candidates
    setProgress({ done: 0, total: list.length, label: 'Limpiando y buscando en internet' })

    for (let i = 0; i < list.length; i++) {
      if (cancel.current) break
      const t = list[i]
      const rules = suggestFromRules(t)
      let online: MetaFields = {}
      let conf: Suggestion['confidence'] = Object.keys(rules).length ? 'media' : 'baja'
      let source = Object.keys(rules).length ? 'reglas' : ''
      if (useOnline && (!t.album || !t.genre || !t.artist)) {
        try {
          const q = await lookupMeta(rules.title ?? t.title, rules.artist ?? t.artist)
          netFails = 0
          if (q) {
            online = { album: q.album, genre: q.genre, artist: q.artist, title: q.title }
            conf = q.exact ? 'alta' : 'media'
            source = 'internet'
          }
          await sleep(220)
        } catch {
          if (++netFails >= 5) {
            setMessage('Se perdió la conexión. Se muestran las sugerencias encontradas hasta ahora.')
            break
          }
        }
      }
      // las reglas mandan en el título; internet completa artista, álbum y género
      const fields = merge(t, rules, online)
      const s: Suggestion = { track: t, fields, source, confidence: conf, accepted: conf !== 'baja' }
      if (Object.keys(fields).length) found.push(s)
      if (useAi && canAi && (!fields.genre && !t.genre)) needAi.push(s)
      if (i % 4 === 0) setProgress({ done: i + 1, total: list.length, label: 'Limpiando y buscando en internet' })
    }

    // La IA completa lo que quedó sin género (en grupos de 15)
    if (useAi && canAi && needAi.length && !cancel.current) {
      for (let i = 0; i < needAi.length; i += 15) {
        if (cancel.current) break
        const chunk = needAi.slice(i, i + 15)
        setProgress({ done: i, total: needAi.length, label: 'Consultando a la IA' })
        try {
          const res = await aiFillMeta(
            aiCfg,
            chunk.map((s) => ({
              id: s.track.id,
              fileName: s.track.fileName,
              title: s.fields.title ?? s.track.title,
              artist: s.fields.artist ?? s.track.artist,
              album: s.fields.album ?? s.track.album,
              genre: s.track.genre,
            })),
          )
          for (const s of chunk) {
            const ai = res.get(s.track.id)
            if (!ai) continue
            const extra = merge(s.track, s.fields, ai)
            const already = found.includes(s)
            s.fields = extra
            if (!s.source) s.source = 'IA'
            else if (!s.source.includes('IA')) s.source += ' + IA'
            if (Object.keys(extra).length && !already) found.push(s)
          }
        } catch (e) {
          setMessage(e instanceof Error ? `La IA falló: ${e.message}` : 'La IA falló.')
          break
        }
      }
    }

    setItems(found)
    setPhase(found.length ? 'review' : 'done')
    if (!found.length) setMessage((m) => m || 'No encontré cambios que proponer.')
  }

  const started = useRef(false)
  useEffect(() => {
    if (autoStart && !started.current && candidates.length > 0) {
      started.current = true
      void run()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, candidates.length])

  const toggle = (id: number) =>
    setItems((prev) => prev.map((s) => (s.track.id === id ? { ...s, accepted: !s.accepted } : s)))

  const acceptedCount = items.filter((s) => s.accepted).length

  const apply = async () => {
    const updates = items
      .filter((s) => s.accepted)
      .map((s) => ({ id: s.track.id, patch: s.fields }))
    await updateMeta(updates)
    setMessage(`Listo: actualicé ${updates.length} canciones.`)
    setItems([])
    setPhase('done')
  }

  return (
    <div className="review">
      <header className="screen-head">
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          <IconBack size={26} />
        </button>
        <div className="head-text">
          <h1>Limpiar etiquetas</h1>
          <span className="muted">Los cambios se guardan en LMusic, no en tus archivos</span>
        </div>
      </header>

      {phase === 'idle' && (
        <div className="detail-body">
          <p>
            Encontré <strong>{candidates.length}</strong> canciones con datos incompletos o desordenados (sin artista,
            álbum o género, o con el título como nombre de archivo).
          </p>
          <label className="switch-row">
            <span>Buscar álbum y género en internet</span>
            <input type="checkbox" className="switch" checked={useOnline} onChange={(e) => setUseOnline(e.target.checked)} />
          </label>
          <label className="switch-row">
            <span>Completar con IA lo que falte {canAi ? '' : '(configúrala en Ajustes)'}</span>
            <input
              type="checkbox"
              className="switch"
              checked={useAi && canAi}
              disabled={!canAi}
              onChange={(e) => setUseAi(e.target.checked)}
            />
          </label>
          <p className="muted">
            Antes de cambiar algo vas a ver cada propuesta y eliges cuáles aplicar. Solo se rellenan campos vacíos y se
            limpian títulos; no se reemplaza un artista o álbum que ya esté escrito.
          </p>
          <button className="big-btn" disabled={candidates.length === 0} onClick={() => void run()}>
            Buscar sugerencias
          </button>
        </div>
      )}

      {phase === 'running' && (
        <div className="detail-body">
          <p>{progress.label}…</p>
          <div className="progress">
            <div
              className="progress-fill"
              style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
            />
          </div>
          <p className="muted">
            {progress.done} de {progress.total}
          </p>
          <button className="chip" onClick={() => (cancel.current = true)}>
            Parar y ver lo encontrado
          </button>
        </div>
      )}

      {phase === 'review' && (
        <>
          <div className="play-row">
            <button className="chip solid" disabled={acceptedCount === 0} onClick={() => void apply()}>
              Aplicar {acceptedCount}
            </button>
            <button
              className="chip"
              onClick={() => setItems((p) => p.map((s) => ({ ...s, accepted: s.confidence === 'alta' })))}
            >
              Solo confianza alta
            </button>
            <button className="chip" onClick={() => setItems((p) => p.map((s) => ({ ...s, accepted: true })))}>
              Todas
            </button>
          </div>
          {message && <p className="muted pad-x">{message}</p>}
          <div className="meta-list">
            {items.map((s) => (
              <label key={s.track.id} className={`meta-item${s.accepted ? ' on' : ''}`}>
                <input type="checkbox" checked={s.accepted} onChange={() => toggle(s.track.id)} />
                <span className="meta-body">
                  <span className="row-title">{s.track.title || s.track.fileName}</span>
                  {(Object.keys(s.fields) as (keyof MetaFields)[]).map((k) => (
                    <span key={k} className="meta-change">
                      {LABEL[k]}: <s>{s.track[k] || 'vacío'}</s> → <b>{s.fields[k]}</b>
                    </span>
                  ))}
                  <span className="muted small">
                    Confianza {s.confidence} · {s.source || 'sin fuente'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      {phase === 'done' && (
        <div className="detail-body">
          <p>{message}</p>
          <button className="big-btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
      )}
    </div>
  )
}
