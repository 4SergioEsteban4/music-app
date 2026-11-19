import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Track } from '../types'
import { usePlayer, useProgress } from '../state/player'
import { applyLyricsRecord, loadLyrics, importLyricsText, onLyricsChanged, setLyricsOffset } from '../lyrics/service'
import { findByFragment } from '../lyrics/fragment'
import type { FragmentMatch } from '../lyrics/fragment'
import { aiReady } from '../ai/client'
import type { AiConfig, AiProvider } from '../ai/client'
import { useAudioInfo } from '../audio/analysis'
import { resolveLook } from '../visual/look'
import { IconTap } from '../icons'
import type { LyricsResult } from '../lyrics/service'
import { LyricsNetworkError } from '../lyrics/lrclib'
import { activeLineIndex, parseLrc } from '../lyrics/lrc'
import { artistOf } from '../utils'
import { normWord, splitWords } from '../learn/words'
import { useSettings } from '../state/settings'
import { useClock } from '../visual/clock'
import { LyricsMenu } from './LyricsMenu'
import { clearTranslation, translateSong } from '../lyrics/translate'

export interface WordHit {
  word: string
  line: string
  timeMs: number
}

type SavedMap = Map<string, 'saved' | 'hard'>

let longPressFired = false
let pressTimer = 0

function Words({
  text,
  timeMs,
  learning,
  saved,
  onWord,
  karaoke = false,
  seekMode = false,
  bloody = false,
}: {
  text: string
  timeMs: number
  learning: boolean
  saved: SavedMap
  onWord: (w: WordHit) => void
  karaoke?: boolean
  seekMode?: boolean
  /** con el efecto de sangre cada palabra va en su propio span para que de ahí escurra */
  bloody?: boolean
}) {
  if (!learning && !karaoke && !bloody) return <>{text}</>
  return (
    <>
      {splitWords(text).map((p, i) => {
        if (!p.isWord) return p.text
        const w = normWord(p.text)
        const st = learning ? saved.get(w) : undefined
        const cls = `${learning ? 'w' : ''}${st ? ` ${st}` : ''}${karaoke ? ' kw' : ''}${bloody ? ' bw' : ''}`.trim()
        return (
          <span
            key={i}
            className={cls}
            onClick={
              learning
                ? (e) => {
                    if (seekMode) {
                      // modo "saltar": el toque corto sube hasta la línea y salta; solo el toque largo traduce
                      if (longPressFired) {
                        e.stopPropagation()
                        longPressFired = false
                      }
                      return
                    }
                    e.stopPropagation()
                    onWord({ word: w, line: text, timeMs })
                  }
                : undefined
            }
            onPointerDown={
              learning && seekMode
                ? () => {
                    longPressFired = false
                    pressTimer = window.setTimeout(() => {
                      longPressFired = true
                      onWord({ word: w, line: text, timeMs })
                    }, 450)
                  }
                : undefined
            }
            onPointerUp={learning && seekMode ? () => window.clearTimeout(pressTimer) : undefined}
            onPointerCancel={learning && seekMode ? () => window.clearTimeout(pressTimer) : undefined}
            onPointerLeave={learning && seekMode ? () => window.clearTimeout(pressTimer) : undefined}
          >
            {p.text}
          </span>
        )
      })}
    </>
  )
}

/** La línea se resalta un poco antes de cantarse, así se siente "a tiempo". */
const LOOKAHEAD_MS = 120
const OFFSET_LIMIT_MS = 10000

interface LyricsState {
  loading: boolean
  error: 'offline' | 'server' | string | null
  detail: string
  data: LyricsResult | null
}

export function useTrackLyrics(track: Track) {
  const [state, setState] = useState<LyricsState>({ loading: true, error: null, detail: '', data: null })
  const [nonce, setNonce] = useState(0)
  const forceRef = useRef(false)
  const trackRef = useRef(track)
  trackRef.current = track

  useEffect(() => {
    let alive = true
    const force = forceRef.current
    forceRef.current = false
    setState({ loading: true, error: null, detail: '', data: null })
    loadLyrics(trackRef.current, { force })
      .then((data) => alive && setState({ loading: false, error: null, detail: '', data }))
      .catch((e: unknown) => {
        if (!alive) return
        const error = e instanceof LyricsNetworkError ? e.kind : e instanceof Error ? e.message : String(e)
        const detail = e instanceof LyricsNetworkError ? e.detail : ''
        setState({ loading: false, error, detail, data: null })
      })
    return () => {
      alive = false
    }
  }, [track.id, nonce])

  useEffect(
    () =>
      onLyricsChanged((id) => {
        if (id === trackRef.current.id) setNonce((n) => n + 1)
      }),
    [],
  )

  const reload = useCallback(() => {
    forceRef.current = true
    setNonce((n) => n + 1)
  }, [])

  const importText = useCallback(async (text: string) => {
    const data = await importLyricsText(trackRef.current, text)
    setState({ loading: false, error: null, detail: '', data })
  }, [])

  const shiftOffset = useCallback(async (delta: number) => {
    setState((s) => {
      if (!s.data) return s
      const next = Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, s.data.offsetMs + delta))
      void setLyricsOffset(trackRef.current.id, next)
      return { ...s, data: { ...s.data, offsetMs: next } }
    })
  }, [])

  return { ...state, reload, importText, shiftOffset }
}

interface ViewProps {
  track: Track
  learning: boolean
  saved: SavedMap
  onWord: (w: WordHit) => void
  onEdit: () => void
  menuOpen: boolean
  onMenuClose: () => void
  onOpenSettings: () => void
}

export function LyricsView({ track, learning, saved, onWord, onEdit, menuOpen, onMenuClose, onOpenSettings }: ViewProps) {
  const { positionMs } = useProgress()
  const { seek, isPlaying } = usePlayer()
  const { settings, update } = useSettings()
  const clock = useClock()
  const seekMode = settings.tapMode === 'seek'
  const { info: audioInfo } = useAudioInfo(track)
  const look = resolveLook(settings, track.genre, audioInfo?.bpm ?? 0)
  const bloody = look.lyricFx === 'blood' || settings.primeFx === 'blood'
  const style = look.style
  const cine = style === 'cinema' || style === 'epic'
  const { loading, error, detail, data, reload, importText, shiftOffset } = useTrackLyrics(track)
  const [fragOpen, setFragOpen] = useState(false)
  const [fragText, setFragText] = useState('')
  const [fragBusy, setFragBusy] = useState(false)
  const [fragMsg, setFragMsg] = useState('')
  const [fragResults, setFragResults] = useState<FragmentMatch[]>([])
  const aiCfg: AiConfig = { provider: settings.aiProvider as AiProvider, key: settings.aiKey, model: settings.aiModel }
  const fileRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([])
  // "Separada": el usuario movió la letra a mano; no vuelve sola, solo con el botón
  const [detached, setDetached] = useState(false)
  const touchY = useRef(0)

  const offset = data?.offsetMs ?? 0
  const lines = useMemo(() => (data?.synced ? parseLrc(data.synced) : []), [data?.synced])
  const idx = lines.length ? activeLineIndex(lines, positionMs + offset + LOOKAHEAD_MS) : -1
  const idxRef = useRef(idx)
  idxRef.current = idx
  const offsetRef = useRef(offset)
  offsetRef.current = offset

  // Al cambiar de canción, volver arriba
  useEffect(() => {
    boxRef.current?.scrollTo({ top: 0 })
    setDetached(false)
  }, [track.id])

  // Mantener la línea activa en el centro (salvo que el usuario esté desplazando a mano)
  useEffect(() => {
    if ((cine && !detached) || idx < 0 || detached) return
    const box = boxRef.current
    const el = lineRefs.current[idx]
    if (!box || !el) return
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' })
  }, [idx, cine, detached])

  // Karaoke: cada palabra de la línea activa se llena en su propio momento (estimado por su largo)
  useEffect(() => {
    if (style !== 'karaoke' || !lines.length) return
    let raf = 0
    let last = 0
    let plan: { idx: number; starts: number[]; ends: number[] } | null = null
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (t - last < 33) return
      last = t
      const i = idxRef.current
      const el = lineRefs.current[i]
      if (!el || i < 0) return
      const spans = el.querySelectorAll<HTMLElement>('.kw')
      if (!spans.length) return
      if (!plan || plan.idx !== i || plan.starts.length !== spans.length) {
        const l = lines[i]
        const next = lines[i + 1]
        const lineDur = Math.max(500, (next ? next.timeMs : l.timeMs + 5000) - l.timeMs)
        const sing = Math.min(lineDur * 0.92, spans.length * 550 + 500)
        const weights = Array.from(spans, (sp) => (sp.textContent ?? '').length + 2)
        const total = weights.reduce((a, b) => a + b, 0)
        const starts: number[] = []
        const ends: number[] = []
        let acc = 0
        for (const w of weights) {
          starts.push(l.timeMs + (sing * acc) / total)
          acc += w
          ends.push(l.timeMs + (sing * acc) / total)
        }
        plan = { idx: i, starts, ends }
      }
      const pos = clock() + offsetRef.current + LOOKAHEAD_MS
      spans.forEach((sp, j) => {
        const a = plan!.starts[j]
        const b = plan!.ends[j]
        const f = Math.min(1, Math.max(0, (pos - a) / Math.max(60, b - a)))
        sp.style.setProperty('--wf', `${(f * 100).toFixed(1)}%`)
      })
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [style, lines, clock])

  const scrollToActive = (smooth: boolean) => {
    const box = boxRef.current
    const el = lineRefs.current[idxRef.current]
    if (box && el) box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: smooth ? 'smooth' : 'auto' })
  }
  const onTouchStartBox = (e: React.TouchEvent) => {
    touchY.current = e.touches[0]?.clientY ?? 0
  }
  const onTouchMoveBox = (e: React.TouchEvent) => {
    if (Math.abs((e.touches[0]?.clientY ?? 0) - touchY.current) > 14) setDetached(true)
  }
  const onWheelBox = () => setDetached(true)
  const backToLyrics = () => {
    setDetached(false)
    window.setTimeout(() => scrollToActive(true), 0)
  }

  // Al soltarse la letra en modo Cine, colocarla de inmediato en la línea que suena
  useEffect(() => {
    if (detached && cine) scrollToActive(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detached, cine])

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    await importText(await f.text())
  }

  // traducción debajo de cada línea (con la IA; se guarda para no volver a pedirla)
  const [tr, setTr] = useState<string[] | null>(null)
  const [trMsg, setTrMsg] = useState('')
  const [trNonce, setTrNonce] = useState(0)
  const trTexts = useMemo(() => (lines.length ? lines.map((l) => l.text) : data?.plain ? data.plain.split('\n') : []), [lines, data?.plain])
  useEffect(() => {
    if (!settings.lyricTranslate || trTexts.length === 0) {
      setTr(null)
      setTrMsg('')
      return
    }
    let alive = true
    setTr(null)
    setTrMsg('Traduciendo la letra…')
    translateSong(
      { provider: settings.aiProvider as AiProvider, key: settings.aiKey, model: settings.aiModel },
      track.id,
      trTexts,
      settings.targetLang,
      settings.nativeLang,
    )
      .then((r) => {
        if (!alive) return
        setTr(r.lines.length ? r.lines : null)
        setTrMsg(r.message)
      })
      .catch((e) => {
        if (alive) setTrMsg(e instanceof Error ? e.message : 'No pude traducir la letra.')
      })
    return () => {
      alive = false
    }
  }, [settings.lyricTranslate, trTexts, track.id, settings.targetLang, settings.nativeLang, settings.aiProvider, settings.aiKey, settings.aiModel, trNonce])

  const retranslate = () => {
    void clearTranslation(track.id, settings.targetLang, settings.nativeLang, trTexts.length).then(() => setTrNonce((n) => n + 1))
  }

  const hidden = (
    <>
      <input ref={fileRef} type="file" accept=".lrc,.txt,text/plain" hidden onChange={(e) => void onFile(e)} />
      {menuOpen && (
        <LyricsMenu
          track={track}
          hasLyrics={!!data && data.status === 'found'}
          synced={lines.length > 0}
          offset={offset}
          shiftOffset={shiftOffset}
          onEdit={onEdit}
          onImportFile={() => fileRef.current?.click()}
          onOpenSettings={onOpenSettings}
          onRetranslate={retranslate}
          onClose={onMenuClose}
        />
      )}
    </>
  )
  const doFragment = async () => {
    setFragBusy(true)
    setFragMsg('')
    setFragResults([])
    try {
      const cfg = aiReady(aiCfg) ? aiCfg : null
      const res = await findByFragment(track, fragText.trim(), cfg)
      setFragResults(res)
      if (!res.length) {
        setFragMsg(
          cfg
            ? 'No encontré una canción con ese fragmento.'
            : 'No encontré la letra. Si configuras una IA en Ajustes, puedo intentar identificarla.',
        )
      }
    } catch (e) {
      setFragMsg(e instanceof Error ? e.message : 'Algo falló en la búsqueda.')
    } finally {
      setFragBusy(false)
    }
  }

  const actions = (
    <>
      <div className="lyrics-actions">
        <button className="chip" onClick={reload}>
          Buscar de nuevo
        </button>
        <button className="chip" onClick={() => fileRef.current?.click()}>
          Importar .lrc
        </button>
        <button className="chip" onClick={() => setFragOpen((v) => !v)}>
          Buscar por fragmento
        </button>
        <button className="chip" onClick={onEdit}>
          Escribir y sincronizar
        </button>
      </div>
      {fragOpen && (
        <div className="frag-panel">
          <p className="muted">
            Escribe una frase que se cante en la canción (útil si es un cover o el título está mal).
          </p>
          <textarea
            className="lyrics-text small"
            value={fragText}
            onChange={(e) => setFragText(e.target.value)}
            placeholder="Una frase de la letra…"
          />
          <button className="chip solid" disabled={fragBusy || fragText.trim().length < 8} onClick={() => void doFragment()}>
            {fragBusy ? 'Buscando…' : 'Buscar'}
          </button>
          {fragMsg && <p className="muted">{fragMsg}</p>}
          {fragResults.map((m) => (
            <button
              key={m.record.id}
              className="ctx-row"
              onClick={() => void applyLyricsRecord(track, m.record, 'fragmento')}
            >
              <span className="ctx-line">
                {m.record.trackName} — {m.record.artistName}
              </span>
              <span className="muted">
                {m.record.syncedLyrics ? 'Con tiempos' : 'Sin tiempos'} · encontrada con {m.via} · toca para usarla
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  )

  if (loading) {
    return (
      <div className="lyrics-panel">
        <p className="lyrics-msg">Buscando la letra…</p>
        {hidden}
      </div>
    )
  }

  if (error === 'offline') {
    return (
      <div className="lyrics-panel">
        <p className="lyrics-msg">
          No pude conectar con el servidor de letras. Revisa tu internet y vuelve a intentar.
          {detail ? ` (${detail})` : ''}
        </p>
        {actions}
        {hidden}
      </div>
    )
  }
  if (error === 'server') {
    return (
      <div className="lyrics-panel">
        <p className="lyrics-msg">
          El servidor de letras está ocupado en este momento. Inténtalo de nuevo en unos segundos.
          {detail ? ` (${detail})` : ''}
        </p>
        {actions}
        {hidden}
      </div>
    )
  }
  if (error) {
    return (
      <div className="lyrics-panel">
        <p className="lyrics-msg">Algo falló al buscar la letra: {error}</p>
        {actions}
        {hidden}
      </div>
    )
  }

  if (!data || data.status === 'none') {
    return (
      <div className="lyrics-panel">
        <p className="lyrics-msg">
          No encontré la letra de esta canción. Busqué “{track.title}” de {artistOf(track)}. Si el título o el
          artista están mal escritos, por eso puede fallar.
        </p>
        {actions}
        {hidden}
      </div>
    )
  }

  if (data.instrumental) {
    return (
      <div className="lyrics-panel">
        <p className="lyrics-msg">Esta canción es instrumental.</p>
        {hidden}
      </div>
    )
  }

  const synced = lines.length > 0
  return (
    <div
      className={`lyrics-panel style-${style} font-${look.font} anim-${look.anim} lfx-${look.lyricFx}${learning ? ' learning' : ''}`}
      style={{ '--lsz': settings.lyricSize / 100 } as CSSProperties}
    >
      <div
        className={`lyrics-box${cine && !detached ? ' no-scroll' : ''}`}
        ref={boxRef}
        onTouchStart={onTouchStartBox}
        onTouchMove={onTouchMoveBox}
        onWheel={onWheelBox}
      >
        {settings.lyricTranslate && trMsg && !tr && <p className="ly-tr-msg">{trMsg}</p>}
        {synced && cine && !detached ? (
          <div className="cine">
            {[idx - 1, idx, idx + 1].map((i, k) => {
              const l = lines[i]
              const text = l ? l.text || '♪' : ''
              if (k === 1) {
                return (
                  <Fragment key={`cur-${idx}`}>
                    <div className="cine-cur">
                      <span className="cine-beat">
                        {l && l.text ? (
                          <Words bloody={bloody} text={l.text} timeMs={l.timeMs} learning={learning} saved={saved} onWord={onWord} seekMode={seekMode} />
                        ) : (
                          '♪'
                        )}
                      </span>
                    </div>
                    {tr?.[idx] ? <div className="ly-tr">{tr[idx]}</div> : null}
                  </Fragment>
                )
              }
              return (
                <button
                  key={`side-${k}-${i}`}
                  className="cine-side"
                  disabled={!l}
                  onClick={() => l && void seek(Math.max(0, l.timeMs - offset))}
                >
                  {text}
                </button>
              )
            })}
          </div>
        ) : synced ? (
          <div className="lyrics-inner">
            {lines.map((l, i) => (
              <Fragment key={`${l.timeMs}-${i}`}>
              <button
                ref={(el) => {
                  lineRefs.current[i] = el
                }}
                className={`lyric-line${i === idx ? ' on' : ''}${i < idx ? ' past' : ''}`}
                aria-current={i === idx ? 'true' : undefined}
                onClick={() => void seek(Math.max(0, l.timeMs - offset))}
              >
                <span className="txt">
                  {l.text ? (
                    <Words bloody={bloody}
                      text={l.text}
                      timeMs={l.timeMs}
                      learning={learning}
                      saved={saved}
                      onWord={onWord}
                      karaoke={style === 'karaoke' && i === idx}
                      seekMode={seekMode}
                    />
                  ) : (
                    '♪'
                  )}
                </span>
              </button>
              {tr?.[i] ? <div className="ly-tr">{tr[i]}</div> : null}
              </Fragment>
            ))}
          </div>
        ) : (
          <div className="lyrics-inner">
            <div className="lyrics-plain">
              {data.plain.split('\n').map((ln, i) => (
                <p key={i}>
                  <Words bloody={bloody} text={ln} timeMs={0} learning={learning} saved={saved} onWord={onWord} seekMode={seekMode} />
                  {ln === '' ? '\u00a0' : ''}
                  {tr?.[i] ? <span className="ly-tr">{tr[i]}</span> : null}
                </p>
              ))}
            </div>
            <p className="lyrics-hint">Esta letra no tiene tiempos, así que no se mueve con la canción.</p>
          </div>
        )}
      </div>

      {detached && synced && (
        <button className="back-to-lyrics" onClick={backToLyrics}>
          Volver a la letra
        </button>
      )}

      <div className="lyrics-tools">
        {learning && (
          <button
            className="chip mini lang-swap"
            onClick={() => update({ targetLang: settings.nativeLang, nativeLang: settings.targetLang })}
            aria-label="Cambiar la dirección del aprendizaje"
            title="Cambiar la dirección del aprendizaje"
          >
            {settings.targetLang.toUpperCase()} → {settings.nativeLang.toUpperCase()}
          </button>
        )}
        {learning && (
          <button
            className={`icon-btn small tapmode${seekMode ? '' : ' on'}`}
            onClick={() => update({ tapMode: seekMode ? 'translate' : 'seek' })}
            aria-label={seekMode ? 'Tocar una palabra salta a esa parte' : 'Tocar una palabra la traduce'}
            title={seekMode ? 'Tocar salta' : 'Tocar traduce'}
          >
            <IconTap size={20} />
          </button>
        )}
        <span
          className={`eq${isPlaying && settings.saver < 2 ? ' on' : ''}`}
          title={data.source === 'file' ? 'Letra de un archivo' : data.source === 'manual' ? 'Letra hecha por ti' : 'Letra de internet'}
          aria-hidden="true"
        >
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
      {hidden}
    </div>
  )
}
