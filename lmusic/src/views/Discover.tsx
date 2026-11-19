import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSettings } from '../state/settings'
import { usePlayer } from '../state/player'
import { artistOf, norm } from '../utils'
import { useLibrary } from '../state/library'
import { searchOnline, spotifyLink, youtubeLink } from '../online/search'
import type { OnlineSong } from '../online/search'
import { aiSuggest } from '../ai/recommend'
import type { AiSuggestion } from '../ai/recommend'
import { aiReady } from '../ai/client'
import type { AiConfig, AiProvider } from '../ai/client'
import { tasteSummary } from '../recommend'
import { dbLoadSettings, dbSetSetting } from '../db/db'
import { LMusic } from '../native/lmusic'
import { IconPause, IconPlay, IconSearch, IconStar } from '../icons'

interface WishItem {
  title: string
  artist: string
  art: string
}

function parseWish(raw: string | undefined): WishItem[] {
  try {
    const v: unknown = JSON.parse(raw ?? '[]')
    return Array.isArray(v) ? (v as WishItem[]).filter((w) => w && typeof w.title === 'string') : []
  } catch {
    return []
  }
}

/** Busca música nueva en internet: vistas previas de 30 s y enlaces para escucharla completa. No descarga música. */
export function Discover({ initialQuery, similarTo, onClose }: { initialQuery: string; similarTo?: string; onClose: () => void }) {
  const { settings } = useSettings()
  const { tracks } = useLibrary()
  const { playQueue } = usePlayer()
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<OnlineSong[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<AiSuggestion[] | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState('')
  const [wish, setWish] = useState<WishItem[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const aiCfg: AiConfig = { provider: settings.aiProvider as AiProvider, key: settings.aiKey, model: settings.aiModel }
  const taste = useMemo(() => tasteSummary(tracks), [tracks])
  const local = useMemo(() => {
    const q = norm(query.trim())
    if (q.length < 2) return []
    return tracks.filter((t) => norm(`${t.title} ${t.artist} ${t.album} ${t.genre}`).includes(q)).slice(0, 8)
  }, [tracks, query])

  const stop = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    setPlayingId(null)
  }, [])

  const run = useCallback(
    async (q: string) => {
      const term = q.trim()
      if (!term) return
      stop()
      setBusy(true)
      setMsg('')
      setResults([])
      try {
        const r = await searchOnline(term)
        setResults(r)
        if (!r.length) setMsg('No encontré nada. Prueba con otro nombre o escribe también el artista.')
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'No pude conectar. Revisa tu internet.')
      } finally {
        setBusy(false)
      }
    },
    [stop],
  )

  useEffect(() => {
    if (initialQuery.trim()) void run(initialQuery)
  }, [initialQuery, run])

  useEffect(() => {
    void dbLoadSettings().then((raw) => setWish(parseWish(raw.wishlist)))
    return () => {
      audioRef.current?.pause()
    }
  }, [])

  const saveWish = (next: WishItem[]) => {
    setWish(next)
    void dbSetSetting('wishlist', JSON.stringify(next))
  }
  const inWish = (s: { title: string; artist: string }) => wish.some((w) => w.title === s.title && w.artist === s.artist)
  const toggleWish = (s: { title: string; artist: string; art?: string }) => {
    if (inWish(s)) saveWish(wish.filter((w) => !(w.title === s.title && w.artist === s.artist)))
    else saveWish([{ title: s.title, artist: s.artist, art: s.art ?? '' }, ...wish])
  }

  const preview = (s: OnlineSong) => {
    if (playingId === s.id) {
      stop()
      return
    }
    stop()
    void LMusic.pause().catch(() => {})
    const a = new Audio(s.previewUrl)
    a.onended = () => setPlayingId(null)
    a.onerror = () => {
      setPlayingId(null)
      setMsg('No pude reproducir la vista previa.')
    }
    audioRef.current = a
    setPlayingId(s.id)
    void a.play().catch(() => setPlayingId(null))
  }

  const askAi = async (seed?: string) => {
    setAiBusy(true)
    setAiMsg('')
    try {
      setSuggestions(await aiSuggest(aiCfg, seed ?? taste, 10))
    } catch (e) {
      setAiMsg(e instanceof Error ? e.message : 'Algo falló con la IA.')
    } finally {
      setAiBusy(false)
    }
  }

  // "Canciones parecidas a esta": se piden de una vez a la IA si está configurada
  useEffect(() => {
    if (similarTo && aiReady(aiCfg)) void askAi(similarTo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [similarTo])

  const searchFor = (title: string, artist: string) => {
    const q = `${title} ${artist}`.trim()
    setQuery(q)
    void run(q)
    window.scrollTo?.({ top: 0 })
  }

  return (
    <div className="discover">
      <header className="screen-head">
        <button className="link-btn" onClick={onClose}>
          ← Volver
        </button>
        <h1>Descubrir</h1>
      </header>

      <div className="search">
        <IconSearch size={18} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run(query)
          }}
          placeholder="Canción, artista o álbum de cualquier parte del mundo"
          aria-label="Buscar en internet"
        />
      </div>
      <div className="rhythm-row">
        <button className="chip solid" disabled={busy || !query.trim()} onClick={() => void run(query)}>
          {busy ? 'Buscando…' : 'Buscar en internet'}
        </button>
      </div>
      <p className="muted small">
        Aquí escuchas vistas previas de 30 segundos y abres la canción completa en YouTube o Spotify. LMusic no descarga música.
      </p>

      {msg && <p className="muted">{msg}</p>}
      {local.length > 0 && (
        <section className="entry-block">
          <h3>En tu biblioteca</h3>
          {local.map((t, i) => (
            <div key={t.id} className="dis-row">
              <span className="row-text">
                <span className="row-title">{t.title}</span>
                <span className="row-sub">{artistOf(t)}</span>
              </span>
              <button className="icon-btn" onClick={() => void playQueue(local, i, false)} aria-label="Reproducir">
                <IconPlay size={20} />
              </button>
            </div>
          ))}
        </section>
      )}
      {results.map((s) => (
        <div key={s.id} className="dis-item">
          <div className="dis-row">
            {s.art ? <img className="dis-art" src={s.art} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <span className="dis-art" />}
            <span className="row-text">
              <span className="row-title">{s.title}</span>
              <span className="row-sub">
                {s.artist}
                {s.album ? ` · ${s.album}` : ''}
              </span>
            </span>
            {s.previewUrl && (
              <button className="icon-btn" onClick={() => preview(s)} aria-label={playingId === s.id ? 'Detener la vista previa' : 'Escuchar 30 segundos'}>
                {playingId === s.id ? <IconPause size={20} /> : <IconPlay size={20} />}
              </button>
            )}
            <button className="icon-btn" onClick={() => toggleWish(s)} aria-label="Guardar en Por escuchar">
              <IconStar size={20} filled={inWish(s)} />
            </button>
          </div>
          <div className="dis-links">
            <a href={youtubeLink(s)} target="_blank" rel="noreferrer">
              Abrir en YouTube
            </a>
            <a href={spotifyLink(s)} target="_blank" rel="noreferrer">
              Abrir en Spotify
            </a>
          </div>
        </div>
      ))}

      <section className="entry-block">
        <h3>Sugerencias de la IA</h3>
        {aiReady(aiCfg) ? (
          <>
            <p className="muted small">Según lo que más escuchas en tu biblioteca.</p>
            <button className="chip" disabled={aiBusy} onClick={() => void askAi()}>
              {aiBusy ? 'Pensando…' : suggestions ? 'Pedir otras' : 'Pedir sugerencias'}
            </button>
            {aiMsg && <p className="muted">{aiMsg}</p>}
            {suggestions?.map((s) => (
              <button key={`${s.title}|${s.artist}`} className="ctx-row" onClick={() => searchFor(s.title, s.artist)}>
                <span className="ctx-line">
                  {s.title} — {s.artist}
                </span>
                {s.why && <span className="muted">{s.why} · toca para buscarla</span>}
              </button>
            ))}
          </>
        ) : (
          <p className="muted">Configura una IA en Ajustes (Gemini es gratis) para recibir sugerencias según tu gusto.</p>
        )}
      </section>

      <section className="entry-block">
        <h3>Por escuchar</h3>
        {wish.length === 0 && <p className="muted">Toca la ★ en un resultado para guardarlo aquí.</p>}
        {wish.map((w) => (
          <div key={`${w.title}|${w.artist}`} className="dis-row">
            {w.art ? <img className="dis-art" src={w.art} alt="" loading="lazy" /> : <span className="dis-art" />}
            <span className="row-text">
              <span className="row-title">{w.title}</span>
              <span className="row-sub">{w.artist}</span>
            </span>
            <button className="icon-btn" onClick={() => searchFor(w.title, w.artist)} aria-label="Buscar de nuevo">
              <IconSearch size={20} />
            </button>
            <button className="link-btn" onClick={() => toggleWish(w)}>
              Quitar
            </button>
          </div>
        ))}
      </section>
    </div>
  )
}
