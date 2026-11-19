import { useEffect, useMemo, useRef, useState } from 'react'
import { CapacitorHttp } from '@capacitor/core'
import { useLibrary } from '../state/library'
import { useSettings } from '../state/settings'
import { useVocab } from '../state/vocab'
import { dbAudioIndex, dbClearCoverOnline, dbCoverOnlineIndex, dbLyricsIndex } from '../db/db'
import { clearCustomCover } from '../covers/custom'
import { ensureAudioInfo } from '../audio/analysis'
import { loadLyrics } from '../lyrics/service'
import { LyricsNetworkError } from '../lyrics/lrclib'
import { LANGS } from '../learn/dictionary'
import { LMusic } from '../native/lmusic'
import { fetchOnlineCover } from '../covers/online'
import { FX_CHOICES } from '../visual/genreFx'
import { ACCENTS, AUTO_OPTION, LYRIC_ANIMS, LYRIC_FONTS, LYRIC_FX, LYRIC_STYLES, PRIME_ALBUM, COVER_FX, THEMES } from '../themes'
import { AI_PROVIDERS, aiAsk, aiReady } from '../ai/client'
import type { AiConfig, AiProvider } from '../ai/client'
import { buildBackup, parseBackup, restoreBackup, summarize } from '../backup/backup'
import type { BackupData, BackupSummary } from '../backup/backup'
import { needsReview } from '../meta/clean'
import { restoreFileOriginals, writeTagsToFiles } from '../files/writeTags'
import { Picker, Section, Toggle } from '../components/ui'
import type { PickOption } from '../components/ui'

interface Job {
  running: boolean
  label: string
  done: number
  total: number
  message: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Reduce la imagen elegida para que no pese en la base de datos del teléfono. */
async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * k))
    c.height = Math.max(1, Math.round(img.naturalHeight * k))
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('Sin canvas')
    ctx.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.82)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function Progress({ job, onStop }: { job: Job; onStop: () => void }) {
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0
  return (
    <div className="job">
      <p>
        <strong>{job.label}</strong>
      </p>
      <div className="progress">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="muted">
        {job.done} de {job.total}
      </p>
      <button className="chip" onClick={onStop}>
        Detener
      </button>
    </div>
  )
}

// "Ninguno" siempre va de primero, luego "Automático"
const withAuto = (list: { id: string; name: string }[]): PickOption[] => [
  ...list.filter((o) => o.id === 'none'),
  AUTO_OPTION,
  ...list.filter((o) => o.id !== 'none'),
]

const STAR_MODES: PickOption[] = [
  { id: 'instant', name: 'Se enciende al instante' },
  { id: 'moments', name: 'Solo en las partes que marqué' },
]

const SCOPES: PickOption[] = [
  { id: 'edited', name: 'Solo las canciones que edité' },
  { id: 'all', name: 'Toda la biblioteca' },
]

const BATCHES: PickOption[] = [
  { id: '50', name: '50 canciones por tanda' },
  { id: '100', name: '100 canciones por tanda' },
  { id: '250', name: '250 canciones por tanda' },
  { id: '0', name: 'Todas de una vez' },
]

const SAVERS: PickOption[] = [
  { id: '0', name: 'Apagado (todo activado)' },
  { id: '1', name: 'Suave' },
  { id: '2', name: 'Medio' },
  { id: '3', name: 'Máximo' },
]

const DIAG: { name: string; url: string; params: Record<string, string> }[] = [
  { name: 'Letras', url: 'https://lrclib.net/api/get', params: { track_name: 'Creep', artist_name: 'Radiohead' } },
  { name: 'Diccionario en inglés', url: 'https://api.dictionaryapi.dev/api/v2/entries/en/hello', params: {} },
  { name: 'Traductor', url: 'https://api.mymemory.translated.net/get', params: { q: 'hello', langpair: 'en|es' } },
  { name: 'Significados (Wiktionary)', url: 'https://es.wiktionary.org/w/api.php', params: { action: 'query', meta: 'siteinfo', format: 'json' } },
  { name: 'Portadas y etiquetas (Deezer)', url: 'https://api.deezer.com/search', params: { q: 'radiohead creep', limit: '1' } },
  { name: 'Portadas y etiquetas (iTunes)', url: 'https://itunes.apple.com/search', params: { term: 'radiohead creep', limit: '1' } },
]

export function Settings({ onOpenMetaClean }: { onOpenMetaClean: (autoStart?: boolean) => void }) {
  const lib = useLibrary()
  const { tracks } = lib
  const vocab = useVocab()
  const { settings, update, reload: reloadSettings } = useSettings()
  const aiCfg: AiConfig = { provider: settings.aiProvider as AiProvider, key: settings.aiKey, model: settings.aiModel }

  const [lyricsIdx, setLyricsIdx] = useState<Map<number, 'found' | 'none'>>(new Map())
  const [audioIdx, setAudioIdx] = useState<Map<number, number>>(new Map())
  const [coverIdx, setCoverIdx] = useState<Map<number, 'found' | 'none'>>(new Map())
  const [what, setWhat] = useState({ lyrics: true, bpm: true, covers: true, tags: true })
  const [job, setJob] = useState<Job | null>(null)
  const cancelRef = useRef(false)
  const bgFileRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const [bgError, setBgError] = useState('')
  const [diag, setDiag] = useState<{ name: string; ok: boolean; text: string }[] | null>(null)
  const [diagBusy, setDiagBusy] = useState(false)
  const [aiTest, setAiTest] = useState('')
  const [bkOpts, setBkOpts] = useState({ allLyrics: false, includeBg: false })
  const [bkMsg, setBkMsg] = useState('')
  const [pending, setPending] = useState<{ data: BackupData; summary: BackupSummary } | null>(null)
  const [bkBusy, setBkBusy] = useState(false)
  const [fileCover, setFileCover] = useState(true)
  const [fileScope, setFileScope] = useState<'edited' | 'all'>('all')
  const [replaceCovers, setReplaceCovers] = useState(false)
  const [batch, setBatch] = useState('100')
  const [fileMsg, setFileMsg] = useState('')
  const [fileBusy, setFileBusy] = useState(false)

  const reload = async () => {
    setLyricsIdx(await dbLyricsIndex())
    setAudioIdx(await dbAudioIndex())
    setCoverIdx(await dbCoverOnlineIndex())
  }
  useEffect(() => {
    void reload()
  }, [tracks.length])

  const stats = useMemo(() => {
    let lyr = 0
    let lyrNone = 0
    let bpm = 0
    let bpmFail = 0
    let cov = 0
    for (const t of tracks) {
      const l = lyricsIdx.get(t.id)
      if (l === 'found') lyr++
      else if (l === 'none') lyrNone++
      const b = audioIdx.get(t.id)
      if (b !== undefined) {
        if (b > 0) bpm++
        else bpmFail++
      }
      if (coverIdx.get(t.id) === 'found') cov++
    }
    const tagsPending = tracks.filter(needsReview).length
    const pendingTracks = tracks.filter((t) => (what.lyrics && !lyricsIdx.has(t.id)) || (what.bpm && !audioIdx.has(t.id))).length
    return { lyr, lyrNone, bpm, bpmFail, cov, tagsPending, pendingTracks, retry: lyrNone + bpmFail, edited: tracks.filter((t) => t.metaEdited).length }
  }, [tracks, lyricsIdx, audioIdx, coverIdx, what])

  /** Un solo proceso: letras, BPM, portadas y etiquetas, según lo que marques. */
  const runAnalysis = async (retry: boolean) => {
    cancelRef.current = false
    let message = ''
    const doLyricsBpm = what.lyrics || what.bpm
    const limit = Number(batch) > 0 ? Number(batch) : Infinity
    const pending = tracks.filter((t) => {
      const needL = what.lyrics && (retry ? lyricsIdx.get(t.id) === 'none' : !lyricsIdx.has(t.id))
      const needB = what.bpm && (retry ? audioIdx.get(t.id) === 0 : !audioIdx.has(t.id))
      return needL || needB
    })
    // por partes: solo esta tanda; para seguir, se vuelve a pulsar y continúa donde quedó
    const list = pending.slice(0, limit)

    // --- Fase 1: letras (internet) y BPM (audio del teléfono), a la vez por canción ---
    if (doLyricsBpm && list.length) {
      let done = 0
      let found = 0
      let offlineFails = 0
      let pauses = 0
      setJob({ running: true, label: 'Letras y BPM', done, total: list.length, message: '' })
      for (const t of list) {
        if (cancelRef.current) break
        const needL = what.lyrics && (retry ? lyricsIdx.get(t.id) === 'none' : !lyricsIdx.has(t.id))
        const needB = what.bpm && (retry ? audioIdx.get(t.id) === 0 : !audioIdx.has(t.id))
        const lyricsTask = async () => {
          if (!needL) return null
          try {
            return await loadLyrics(t, { force: retry })
          } catch (e) {
            if (e instanceof LyricsNetworkError && e.kind === 'server') {
              await sleep(6000) // servidor ocupado: esperar y probar una vez más
              return await loadLyrics(t, { force: retry })
            }
            throw e
          }
        }
        let [lyr] = await Promise.allSettled([lyricsTask(), needB ? ensureAudioInfo(t, { force: retry }) : Promise.resolve(null)])
        if (lyr.status === 'rejected' && lyr.reason instanceof LyricsNetworkError && lyr.reason.kind === 'offline') {
          // sin conexión: se espera un momento y se prueba otra vez antes de rendirse
          setJob({ running: true, label: 'Letras y BPM', done, total: list.length, message: 'Sin conexión… esperando para reintentar' })
          await sleep(5000)
          const again = await Promise.allSettled([lyricsTask()])
          lyr = again[0]
        }
        if (lyr.status === 'fulfilled') {
          offlineFails = 0
          if (lyr.value?.status === 'found') found++
        } else if (lyr.reason instanceof LyricsNetworkError && lyr.reason.kind === 'offline' && ++offlineFails >= 3) {
          if (++pauses >= 3) {
            message = `Se perdió la conexión (${lyr.reason.detail || 'sin detalle'}). Lo que falta se retoma al volver a pulsar.`
            break
          }
          setJob({ running: true, label: 'Letras y BPM', done, total: list.length, message: 'Sin conexión: pausa de 20 s…' })
          await sleep(20000)
          offlineFails = 0
        }
        done++
        setJob({ running: true, label: 'Letras y BPM', done, total: list.length, message: '' })
        if (needL) await sleep(350) // sin saturar el servidor gratuito de letras
      }
      if (!message && !cancelRef.current) {
        const left = pending.length - done
        message = `Letras y BPM: ${done} canciones revisadas, letra en ${found}.${left > 0 ? ` Quedan ${left}: vuelve a pulsar para seguir con la siguiente tanda.` : ''}`
      }
      await reload()
    }

    // --- Fase 2: portadas desde internet para las que no la traen ---
    if (what.covers && !cancelRef.current && !message.startsWith('Se perdió')) {
      let done = 0
      let had = 0
      let got = 0
      let fails = 0
      let coverPauses = 0
      let fetched = 0
      setJob({ running: true, label: 'Portadas', done, total: tracks.length, message: '' })
      for (const t of tracks) {
        if (cancelRef.current) break
        done++
        try {
          const r = await LMusic.getCover({ id: t.id, uri: t.uri, size: 160 })
          const prev = coverIdx.get(t.id)
          // una portada que pusiste tú a mano se respeta siempre
          const manual = !!r.path && r.path.includes('/files/covers/') && prev !== 'found'
          const tried = prev === 'found' || (prev === 'none' && !retry)
          if (r.path && (!replaceCovers || manual)) {
            had++
          } else if (!tried) {
            if (fetched >= limit) {
              message += ` Portadas: hice ${fetched} en esta tanda; vuelve a pulsar para seguir.`
              break
            }
            fetched++
            if (await fetchOnlineCover(t)) got++
            fails = 0
            await sleep(250)
          }
        } catch {
          if (++fails >= 4) {
            if (++coverPauses >= 3) {
              message += ' Portadas: se perdió la conexión. Vuelve a pulsar para retomar.'
              break
            }
            setJob({ running: true, label: 'Portadas', done, total: tracks.length, message: 'Sin conexión: pausa de 20 s…' })
            await sleep(20000)
            fails = 0
          }
        }
        if (done % 5 === 0 || done === tracks.length) setJob({ running: true, label: 'Portadas', done, total: tracks.length, message: '' })
      }
      if (!cancelRef.current) message += replaceCovers ? ` Portadas: ${got} reemplazadas o nuevas, ${had} se dejaron como estaban.` : ` Portadas: ${had} ya tenían y encontré ${got} nuevas.`
      await reload()
    }

    if (cancelRef.current) message = 'Detenido.'
    setJob({ running: false, label: '', done: 0, total: 0, message: message.trim() || 'No había nada pendiente.' })

    // --- Fase 3: etiquetas (se revisan antes de aplicar) ---
    if (what.tags && !cancelRef.current) onOpenMetaClean(true)
  }

  // quita las portadas bajadas de internet (no las que pusiste tú) para poder volver a buscarlas con la coincidencia mejorada
  const clearOnlineCovers = async () => {
    const ids = tracks.filter((t) => coverIdx.get(t.id) === 'found').map((t) => t.id)
    if (!ids.length) {
      setJob({ running: false, label: '', done: 0, total: 0, message: 'No hay portadas de internet para quitar.' })
      return
    }
    await clearCustomCover(ids)
    await dbClearCoverOnline()
    await reload()
    setJob({ running: false, label: '', done: 0, total: 0, message: `Quité ${ids.length} portadas de internet; volvió la original de cada canción.` })
  }

  const runDiagnostics = async () => {
    setDiagBusy(true)
    const out: { name: string; ok: boolean; text: string }[] = []
    for (const d of DIAG) {
      const t0 = performance.now()
      try {
        const r = await CapacitorHttp.get({ url: d.url, params: d.params, connectTimeout: 8000, readTimeout: 10000 })
        const ms = Math.round(performance.now() - t0)
        out.push({ name: d.name, ok: r.status >= 200 && r.status < 500, text: `HTTP ${r.status} · ${ms} ms` })
      } catch (e) {
        out.push({ name: d.name, ok: false, text: e instanceof Error ? e.message : String(e) })
      }
      setDiag([...out])
    }
    setDiagBusy(false)
  }

  const pickBackground = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      setBgError('')
      update({ bgImage: await shrinkImage(f) })
    } catch {
      setBgError('No pude leer esa imagen. Prueba con otra.')
    }
  }

  const testAi = async () => {
    setAiTest('Probando…')
    try {
      const r = await aiAsk(aiCfg, 'Responde con una sola palabra.', 'Di: listo')
      setAiTest(`Funciona. Respuesta: ${r.slice(0, 60)}`)
    } catch (e) {
      setAiTest(e instanceof Error ? e.message : 'No funcionó.')
    }
  }

  const exportBackup = async () => {
    setBkBusy(true)
    setBkMsg('Preparando el respaldo…')
    try {
      const text = await buildBackup(lib.tracks, lib.playlists, bkOpts)
      const name = `lmusic-respaldo-${new Date().toISOString().slice(0, 10)}.json`
      const r = await LMusic.saveBackup({ name, text })
      setBkMsg(`Respaldo guardado en ${r.path}`)
    } catch (e) {
      setBkMsg(e instanceof Error ? e.message : 'No se pudo guardar el respaldo.')
    } finally {
      setBkBusy(false)
    }
  }

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const data = parseBackup(await f.text())
      setPending({ data, summary: summarize(data, lib.tracks) })
      setBkMsg('')
    } catch (err) {
      setPending(null)
      setBkMsg(err instanceof Error ? err.message : 'No pude leer el archivo.')
    }
  }

  const confirmImport = async () => {
    if (!pending) return
    setBkBusy(true)
    setBkMsg('Importando…')
    try {
      const { missing } = await restoreBackup(pending.data, {
        tracks: lib.tracks,
        playlists: lib.playlists,
        createPlaylist: lib.createPlaylist,
        addToPlaylist: lib.addToPlaylist,
        updateMeta: lib.updateMeta,
      })
      await Promise.all([lib.reloadAll(), vocab.reload(), reloadSettings()])
      await reload()
      setBkMsg(
        `Listo. Se restauró todo lo que se pudo${missing > 0 ? `; ${missing} referencias a canciones que no están en este teléfono se omitieron` : ''}.`,
      )
      setPending(null)
    } catch (err) {
      setBkMsg(err instanceof Error ? err.message : 'Algo falló al importar.')
    } finally {
      setBkBusy(false)
    }
  }

  const writeEdited = async () => {
    const list = fileScope === 'all' ? tracks : tracks.filter((t) => t.metaEdited)
    if (!list.length) return
    setFileBusy(true)
    setFileMsg('Esperando el permiso del sistema…')
    try {
      const r = await writeTagsToFiles(list, fileCover, (d, n) => setFileMsg(`Escribiendo… ${d} de ${n}`), { keepOriginal: settings.keepBackups })
      setFileMsg(
        `Listo: ${r.ok} archivos actualizados${r.failed.length ? `, ${r.failed.length} con error (${r.failed.slice(0, 3).map((x) => x.message).join('; ')})` : ''}.${settings.keepBackups ? ' Los originales se guardan 30 días.' : ''}`,
      )
      await lib.rescan()
    } catch (e) {
      setFileMsg(e instanceof Error ? e.message : 'No se pudo escribir en los archivos.')
    } finally {
      setFileBusy(false)
    }
  }

  const restoreEdited = async () => {
    const list = fileScope === 'all' ? tracks : tracks.filter((t) => t.metaEdited)
    if (!list.length) return
    setFileBusy(true)
    setFileMsg('Esperando el permiso del sistema…')
    try {
      const r = await restoreFileOriginals(list)
      setFileMsg(`Restauré ${r.ok} archivos${r.failed.length ? `; ${r.failed.length} sin copia disponible` : ''}.`)
    } catch (e) {
      setFileMsg(e instanceof Error ? e.message : 'No se pudo restaurar.')
    } finally {
      setFileBusy(false)
    }
  }

  const freeBackups = async () => {
    setFileBusy(true)
    try {
      const r = await LMusic.clearOriginals()
      setFileMsg(r.files ? `Listo: borré ${r.files} copias y liberé ${(r.freedBytes / 1048576).toFixed(0)} MB.` : 'No había copias guardadas.')
    } catch (e) {
      setFileMsg(e instanceof Error ? e.message : 'No se pudo liberar el espacio.')
    } finally {
      setFileBusy(false)
    }
  }

  const fontFamily = LYRIC_FONTS.find((f) => f.id === settings.lyricFont)?.family ?? 'inherit'
  const sameLang = settings.nativeLang === settings.targetLang
  const allAuto = () => update({ lyricStyle: 'auto', lyricFont: 'auto', lyricAnim: 'auto', lyricFx: 'auto', fx: 'auto', primeFx: 'auto', primeAlbum: 'auto' })

  const fxBgOptions: PickOption[] = withAuto(FX_CHOICES.filter((x) => x.id !== 'auto').map((x) => ({ id: x.id, name: x.name })))

  const fontOptions: PickOption[] = [
    AUTO_OPTION,
    ...LYRIC_FONTS.map((f) => ({ id: f.id, name: f.name, style: { fontFamily: f.family } })),
  ]
  const fxOptions: PickOption[] = withAuto(LYRIC_FX.map((f) => ({ id: f.id, name: `${f.glyph}  ${f.name}` })))
  const primeFxOptions: PickOption[] = [AUTO_OPTION, ...LYRIC_FX.filter((f) => f.id !== 'none').map((f) => ({ id: f.id, name: `${f.glyph}  ${f.name}` }))]
  const langOptions: PickOption[] = LANGS.map((l) => ({ id: l.code, name: l.name }))
  const themeLabel = THEMES.find((t) => t.id === settings.theme)?.name ?? ''

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Ajustes</h1>
      </header>

      <div className="acc-list">
        <Section
          title="Analizar y ordenar mi biblioteca"
          summary={`${stats.lyr} letras · ${stats.bpm} BPM · ${stats.tagsPending} por ordenar`}
          defaultOpen
        >
          <p className="muted">
            Un solo botón revisa tus canciones. Elige qué incluir. Todo queda guardado en el teléfono y después se usa
            sin conexión.
          </p>
          <div className="chips-row">
            {(
              [
                ['lyrics', 'Letras'],
                ['bpm', 'BPM'],
                ['covers', 'Portadas'],
                ['tags', 'Etiquetas'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                className={`chip${what[k] ? ' solid' : ''}`}
                aria-pressed={what[k]}
                onClick={() => setWhat({ ...what, [k]: !what[k] })}
              >
                {label}
              </button>
            ))}
          </div>
          <Picker label="Análisis por partes" value={batch} options={BATCHES} onChange={setBatch} />
          {what.covers && (
            <Toggle
              label="Portadas: reemplazar también las que ya tienen (las que pusiste tú a mano se respetan)"
              checked={replaceCovers}
              onChange={setReplaceCovers}
            />
          )}
          {what.covers && (
            <div className="rhythm-row">
              <button className="chip" disabled={!!job?.running} onClick={() => void clearOnlineCovers()}>
                Quitar las portadas bajadas de internet
              </button>
            </div>
          )}
          <div className="stat-grid">
            <div>
              <strong>{stats.lyr}</strong>
              <span>letras ({stats.lyrNone} sin encontrar)</span>
            </div>
            <div>
              <strong>{stats.bpm}</strong>
              <span>BPM ({stats.bpmFail} sin resultado)</span>
            </div>
            <div>
              <strong>{stats.cov}</strong>
              <span>portadas de internet</span>
            </div>
            <div>
              <strong>{stats.tagsPending}</strong>
              <span>con etiquetas por ordenar</span>
            </div>
          </div>
          {job?.running ? (
            <Progress job={job} onStop={() => (cancelRef.current = true)} />
          ) : (
            <div className="settings-actions row">
              <button className="chip solid" disabled={!Object.values(what).some(Boolean)} onClick={() => void runAnalysis(false)}>
                Analizar todo
              </button>
              <button className="chip" disabled={stats.retry === 0} onClick={() => void runAnalysis(true)}>
                Reintentar lo que falló ({stats.retry})
              </button>
            </div>
          )}
          {job && !job.running && job.message && <p className="muted">{job.message}</p>}

          <h3 className="sub">Probar la conexión</h3>
          <p className="muted">Si algo dice que no hay conexión con el wifi encendido, esto muestra qué servicio falla y por qué.</p>
          <div className="settings-actions row">
            <button className="chip" disabled={diagBusy} onClick={() => void runDiagnostics()}>
              {diagBusy ? 'Probando…' : 'Probar servicios'}
            </button>
          </div>
          {diag && (
            <ul className="diag">
              {diag.map((d) => (
                <li key={d.name} className={d.ok ? 'ok' : 'bad'}>
                  <span>{d.ok ? '✓' : '✗'}</span>
                  <span>
                    {d.name}
                    <small>{d.text}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="sub">Etiquetas y archivos</h3>
          <p className="muted">
            Ordena títulos, artista, álbum y género con reglas, internet y (si la configuraste) IA. Antes de cambiar algo eliges qué
            aplicar. Los cambios viven en LMusic; puedes guardarlos también dentro de tus mp3.
          </p>
          <div className="settings-actions row">
            <button className="chip solid" onClick={() => onOpenMetaClean(false)}>
              Limpiar etiquetas
            </button>
          </div>
          <h3 className="sub">Guardar en los archivos originales</h3>
          <p className="muted">
            Escribe título, artista, álbum y género de las canciones que editaste ({stats.edited}) dentro de cada mp3. Android te pide
            permiso. Por defecto no se guardan copias del original (así no ocupa espacio). Si quieres poder restaurar, activa la copia abajo.
          </p>
          <Picker label="Qué guardar" value={fileScope} options={SCOPES} onChange={(id) => setFileScope(id === 'all' ? 'all' : 'edited')} />
          {fileScope === 'all' && (
            <p className="muted">
              Se guardan las etiquetas de TODAS tus canciones ({tracks.length}) con un solo permiso del sistema. Se reescribe
              cada archivo con las etiquetas que ves en la app.
            </p>
          )}
          <Toggle label="Incluir también la portada" checked={fileCover} onChange={setFileCover} />
          <Toggle label="Guardar copia del original por 30 días (ocupa espacio)" checked={settings.keepBackups} onChange={(v) => update({ keepBackups: v })} />
          <div className="settings-actions row">
            <button className="chip solid" disabled={fileBusy || (fileScope === 'all' ? tracks.length : stats.edited) === 0} onClick={() => void writeEdited()}>
              Actualizar todas las etiquetas
            </button>
            <button className="chip" disabled={fileBusy || (fileScope === 'all' ? tracks.length : stats.edited) === 0} onClick={() => void restoreEdited()}>
              Restaurar originales
            </button>
            <button className="chip" disabled={fileBusy} onClick={() => void freeBackups()}>
              Liberar espacio de copias
            </button>
          </div>
          {fileMsg && <p className="muted">{fileMsg}</p>}
        </Section>

        <Section title="Apariencia" summary={`Tema ${themeLabel}`}>
          <Picker
            label="Tema"
            value={settings.theme}
            options={THEMES.map((t) => ({ id: t.id, name: t.name }))}
            onChange={(id) => update({ theme: id })}
          />
          <h3 className="sub">Color de acento</h3>
          <div className="swatches">
            <button
              className={`sw none${settings.accentColor === '' ? ' on' : ''}`}
              onClick={() => update({ accentColor: '' })}
              aria-label="Usar el color del tema"
              title="Color del tema"
            >
              ∅
            </button>
            {ACCENTS.map((c) => (
              <button
                key={c}
                className={`sw${settings.accentColor === c ? ' on' : ''}`}
                style={{ background: c }}
                onClick={() => update({ accentColor: c })}
                aria-label={`Acento ${c}`}
              />
            ))}
            <label className="sw custom" title="Elegir cualquier color">
              <input type="color" value={settings.accentColor || '#f2a93b'} onChange={(e) => update({ accentColor: e.target.value })} />
              +
            </label>
          </div>
          <Toggle label="Acento según la canción" checked={settings.dynamicAccent} onChange={(v) => update({ dynamicAccent: v })} />
          <Toggle label="Paleta completa según la canción" checked={settings.songPalette} onChange={(v) => update({ songPalette: v })} />
          <Picker
            label="Fondo del reproductor"
            value={settings.nowBg}
            options={[
              { id: 'cover', name: 'Portada difuminada' },
              { id: 'theme', name: 'Colores del tema' },
            ]}
            onChange={(id) => update({ nowBg: id })}
          />
          <h3 className="sub">Fondo de la app</h3>
          {settings.bgImage && <img className="bg-preview" src={settings.bgImage} alt="Vista previa del fondo" />}
          <div className="settings-actions row">
            <button className="chip solid" onClick={() => bgFileRef.current?.click()}>
              {settings.bgImage ? 'Cambiar imagen' : 'Elegir imagen'}
            </button>
            {settings.bgImage && (
              <button className="chip" onClick={() => update({ bgImage: '' })}>
                Quitar
              </button>
            )}
          </div>
          <input ref={bgFileRef} type="file" accept="image/*" hidden onChange={(e) => void pickBackground(e)} />
          {bgError && <p className="muted">{bgError}</p>}
          {settings.bgImage && (
            <>
              <label className="field">
                <span>Difuminado: {settings.bgBlur}</span>
                <input type="range" min={0} max={30} value={settings.bgBlur} onChange={(e) => update({ bgBlur: Number(e.target.value) })} />
              </label>
              <label className="field">
                <span>Oscurecer: {settings.bgDim}%</span>
                <input type="range" min={20} max={90} value={settings.bgDim} onChange={(e) => update({ bgDim: Number(e.target.value) })} />
              </label>
            </>
          )}
        </Section>

        <Section title="Letra y efectos" summary="Estilo, tipografía, animaciones, fondo y ★ prime">
          <div className="settings-actions row">
            <button className="chip solid" onClick={allAuto}>
              Todo automático según el género
            </button>
          </div>
          <Picker label="Estilo" value={settings.lyricStyle} options={withAuto(LYRIC_STYLES.map((l) => ({ id: l.id, name: l.name })))} onChange={(id) => update({ lyricStyle: id })} />
          <Picker label="Tipo de letra" value={settings.lyricFont} options={fontOptions} onChange={(id) => update({ lyricFont: id })} />
          <p className="font-sample" style={{ fontFamily }}>
            Así se verá tu letra
          </p>
          <label className="field">
            <span>Tamaño de la letra: {settings.lyricSize}%</span>
            <input type="range" min={70} max={200} step={5} value={settings.lyricSize} onChange={(e) => update({ lyricSize: Number(e.target.value) })} />
          </label>
          <Toggle label="Mostrar la letra debajo de la portada" checked={settings.lyricsUnderCover} onChange={(v) => update({ lyricsUnderCover: v })} />
          <Picker label="Animación de entrada" value={settings.lyricAnim} options={withAuto(LYRIC_ANIMS)} onChange={(id) => update({ lyricAnim: id })} />
          <Picker label="Efecto de la letra" value={settings.lyricFx} options={fxOptions} onChange={(id) => update({ lyricFx: id })} />
          <Picker label="Efecto de fondo" value={settings.fx} options={fxBgOptions} onChange={(id) => update({ fx: id })} />
          <Picker label="Efecto de la portada" value={settings.coverFx} options={COVER_FX} onChange={(id) => update({ coverFx: id })} />
          <Toggle label="Mostrar efectos de fondo" checked={settings.particles} onChange={(v) => update({ particles: v })} />
          <Toggle label="Latidos al ritmo de la canción" checked={settings.beatFx} onChange={(v) => update({ beatFx: v })} />
          <p className="muted">
            En automático, cada género tiene su propio look: metal con sangre y rayos, rock con electricidad, electrónica con neón y
            láseres, reggaetón con fuego… Si el teléfono va lento, apaga los efectos.
          </p>
          <p>
            <strong>★ Star mode</strong>
          </p>
          <p className="muted">
            Toca la ★ en Reproduciendo y la letra y la portada hacen cosas locas al instante (vuelve a tocarla para apagarlo). Si
            mantienes pulsada la ★ puedes marcar tus partes favoritas, con 1 a 5 estrellas de intensidad.
          </p>
          <Toggle label="Activar Star mode" checked={settings.primeOn} onChange={(v) => update({ primeOn: v })} />
          <Picker label="Al tocar la ★" value={settings.starMode} options={STAR_MODES} onChange={(id) => update({ starMode: id })} />
          <Picker label="Efecto de la letra" value={settings.primeFx} options={primeFxOptions} onChange={(id) => update({ primeFx: id })} />
          <Picker label="Efecto de la portada" value={settings.primeAlbum} options={withAuto(PRIME_ALBUM)} onChange={(id) => update({ primeAlbum: id })} />
        </Section>

        <Section title="Modo ahorro de RAM" summary={settings.saver ? SAVERS[settings.saver]?.name : 'Apagado'}>
          <p className="muted">
            Si el teléfono se pone lento, sube el nivel: se bloquean primero las animaciones que más lag dan y, al subir, también las
            que dan menos.
          </p>
          <Picker label="Nivel de ahorro" value={String(settings.saver)} options={SAVERS} onChange={(id) => update({ saver: Number(id) })} />
          <p className="muted">
            <strong>Suave:</strong> sin rayos, láseres ni humo de sangre; sin letra de fuego, neón, glitch ni sangre; sin
            arcoíris, glitch ni electrochoque en la portada.
            <br />
            <strong>Medio:</strong> además sin luces, ondas ni chispas; sin efectos de hielo ni oro; solo latido y rebote en la
            portada.
            <br />
            <strong>Máximo:</strong> sin efectos de fondo, de letra ni de portada, sin animación de entrada, sin latidos y sin Star
            mode.
          </p>
        </Section>

        <Section title="Canciones ocultas" summary={lib.hiddenTracks.length ? `${lib.hiddenTracks.length} ocultas` : 'Ninguna'}>
          {lib.hiddenTracks.length === 0 ? (
            <p className="muted">No has ocultado ninguna canción. Para ocultar una: Reproduciendo → ⋮ → Ocultar canción.</p>
          ) : (
            lib.hiddenTracks.map((t) => (
              <div key={t.id} className="prime-row">
                <span className="row-text">
                  <span className="row-title">{t.title}</span>
                  <span className="row-sub">{t.artist}</span>
                </span>
                <button className="chip" onClick={() => void lib.unhideTrack(t.id)}>
                  Mostrar
                </button>
              </div>
            ))
          )}
        </Section>

        <Section title="Modo aprendizaje" summary={settings.learningMode ? 'Activado' : 'Apagado'}>
          <p className="muted">
            Toca una palabra de la letra para ver su significado, guárdala y repásala con tarjetas. Al activarlo aparece la pestaña
            Palabras.
          </p>
          <Toggle label="Activar modo aprendizaje" checked={settings.learningMode} onChange={(v) => update({ learningMode: v })} />
          {settings.learningMode && (
            <>
              <div className="field">
                <span>Qué quiero aprender</span>
                <div className="rhythm-row">
                  <button
                    className={`chip${settings.targetLang === 'en' && settings.nativeLang === 'es' ? ' solid' : ''}`}
                    onClick={() => update({ targetLang: 'en', nativeLang: 'es' })}
                  >
                    Inglés (canciones en inglés, significado en español)
                  </button>
                  <button
                    className={`chip${settings.targetLang === 'es' && settings.nativeLang === 'en' ? ' solid' : ''}`}
                    onClick={() => update({ targetLang: 'es', nativeLang: 'en' })}
                  >
                    Español (canciones en español, significado en inglés)
                  </button>
                  <button className="chip" onClick={() => update({ targetLang: settings.nativeLang, nativeLang: settings.targetLang })}>
                    ⇄ Intercambiar
                  </button>
                </div>
              </div>
              <Picker label="Idioma de las canciones" value={settings.targetLang} options={langOptions} onChange={(id) => update({ targetLang: id })} />
              <Picker label="Mi idioma" value={settings.nativeLang} options={langOptions} onChange={(id) => update({ nativeLang: id })} />
              {sameLang && <p className="muted">Elige dos idiomas distintos para que la traducción tenga sentido.</p>}
              {!sameLang && settings.nativeLang !== 'es' && (
                <p className="muted">
                  Los significados por categoría están completos en español. En otros idiomas verás traducciones y definiciones básicas.
                </p>
              )}
              <Toggle label="Pausar la música al tocar una palabra" checked={settings.pauseOnWordTap} onChange={(v) => update({ pauseOnWordTap: v })} />
              <p className="muted">
                Los significados se buscan por internet la primera vez y después se ven sin conexión. En la letra, el botón de la mano
                elige si tocar una palabra la traduce o salta a esa parte.
              </p>
            </>
          )}
        </Section>

        <Section title="IA (opcional)" summary={settings.aiProvider === 'none' ? 'Sin IA' : AI_PROVIDERS.find((p) => p.id === settings.aiProvider)?.name}>
          <p className="muted">
            Sirve para completar géneros y artistas, explicar una palabra dentro de la frase e identificar una canción por un fragmento.
            Usa tu propia clave; se guarda solo en este teléfono y no sale en los respaldos.
          </p>
          <Picker
            label="Proveedor"
            value={settings.aiProvider}
            options={AI_PROVIDERS.map((p) => ({ id: p.id, name: p.name }))}
            onChange={(id) => update({ aiProvider: id, aiModel: AI_PROVIDERS.find((p) => p.id === id)?.model ?? '' })}
          />
          {settings.aiProvider === 'gemini' && (
            <Toggle
              label="Si Gemini está saturado (error 503), reintentar solo y probar otro modelo"
              checked={settings.aiRetry}
              onChange={(v) => update({ aiRetry: v })}
            />
          )}
          <p className="muted">
            <strong>Gemini (Google): gratis.</strong> La clave se saca en Google AI Studio sin tarjeta; tiene límites por minuto y por
            día, y en el plan gratis Google puede usar lo que envíes para mejorar sus productos.
            <br />
            <strong>Claude (Anthropic): de pago.</strong> La API no tiene plan gratis permanente: al crear la cuenta a veces dan un
            crédito pequeño de prueba y después se recarga saldo.
            <br />
            <strong>ChatGPT (OpenAI): de pago.</strong> La API necesita saldo prepagado (desde unos 5 USD). Ojo: una suscripción de
            ChatGPT Plus o Claude Pro no incluye la API.
          </p>
          {settings.aiProvider !== 'none' && (
            <>
              <label className="field">
                <span>Clave de API</span>
                <input className="text-input" type="password" autoComplete="off" value={settings.aiKey} onChange={(e) => update({ aiKey: e.target.value })} placeholder="Pega tu clave" />
              </label>
              <label className="field">
                <span>Modelo</span>
                <input className="text-input" value={settings.aiModel} onChange={(e) => update({ aiModel: e.target.value })} placeholder="Nombre del modelo" />
              </label>
              <div className="settings-actions row">
                <button className="chip" disabled={!aiReady(aiCfg)} onClick={() => void testAi()}>
                  Probar conexión
                </button>
              </div>
              {aiTest && <p className="muted">{aiTest}</p>}
            </>
          )}
        </Section>


        <Section title="Respaldo de la configuración">
          <p className="muted">
            Guarda tus listas (mixes), favoritas, más escuchadas, etiquetas editadas, palabras, partes del Star mode, letras propias, BPM y
            ajustes en un archivo (Descargas/LMusic). Las canciones se reconocen por nombre de archivo, así que sirve aunque cambies de
            teléfono. No incluye los mp3 ni las portadas.
          </p>
          <Toggle label="Incluir todas las letras (archivo más grande)" checked={bkOpts.allLyrics} onChange={(v) => setBkOpts({ ...bkOpts, allLyrics: v })} />
          <Toggle label="Incluir mi fondo personalizado" checked={bkOpts.includeBg} onChange={(v) => setBkOpts({ ...bkOpts, includeBg: v })} />
          <div className="settings-actions row">
            <button className="chip solid" disabled={bkBusy} onClick={() => void exportBackup()}>
              Exportar respaldo
            </button>
            <button className="chip" disabled={bkBusy} onClick={() => importRef.current?.click()}>
              Importar respaldo
            </button>
          </div>
          <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(e) => void onImportFile(e)} />
          {pending && (
            <div className="frag-panel">
              <p>
                Respaldo del {pending.data.exportedAt.slice(0, 10) || 'archivo'}: {pending.summary.playlists} listas, {pending.summary.words}{' '}
                palabras, {pending.summary.lyrics} letras propias. Encontré{' '}
                <strong>
                  {pending.summary.tracksMatched} de {pending.summary.tracksInFile}
                </strong>{' '}
                canciones en este teléfono.
              </p>
              <div className="settings-actions row">
                <button className="chip solid" disabled={bkBusy} onClick={() => void confirmImport()}>
                  Importar
                </button>
                <button className="chip" onClick={() => setPending(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {bkMsg && <p className="muted">{bkMsg}</p>}
        </Section>
      </div>
    </div>
  )
}
