import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { LibraryProvider, useLibrary } from './state/library'
import { SettingsProvider, useSettings } from './state/settings'
import { VocabProvider, useVocab } from './state/vocab'
import { PlayerProvider, usePlayer } from './state/player'
import { LMusic } from './native/lmusic'
import { useCover, useCoverColor } from './native/covers'
import { inkFor, parseHsl, songPalette } from './visual/palette'
import { Home } from './views/Home'
import { Library } from './views/Library'
import { Playlists } from './views/Playlists'
import { Words } from './views/Words'
import { Discover } from './views/Discover'
import { Toaster } from './components/Toaster'
import { setAiRetry } from './ai/client'
import { WordDetail } from './views/WordDetail'
import { Review } from './views/Review'
import { Settings } from './views/Settings'
import { MetaClean } from './views/MetaClean'
import { LyricsEditor } from './components/LyricsEditor'
import { Collection } from './views/Collection'
import { MiniPlayer } from './components/MiniPlayer'
import { NowPlaying } from './components/NowPlaying'
import { TrackMenu } from './components/TrackMenu'
import { WordSheet } from './components/WordSheet'
import { IconBook, IconHome, IconLibrary, IconList, IconSettings } from './icons'
import type { CollectionRef } from './nav'
import type { Track, WordTap } from './types'
import './App.css'

type Tab = 'home' | 'library' | 'playlists' | 'words' | 'settings'

const TABS: { id: Tab; label: string; icon: typeof IconHome }[] = [
  { id: 'home', label: 'Inicio', icon: IconHome },
  { id: 'library', label: 'Biblioteca', icon: IconLibrary },
  { id: 'playlists', label: 'Listas', icon: IconList },
  { id: 'words', label: 'Palabras', icon: IconBook },
  { id: 'settings', label: 'Ajustes', icon: IconSettings },
]

interface MenuState {
  track: Track
  playlistId?: number
}

function Shell() {
  const lib = useLibrary()
  const player = usePlayer()
  const { settings } = useSettings()
  const { dueCount } = useVocab()
  const [tab, setTab] = useState<Tab>('home')
  const [detail, setDetail] = useState<CollectionRef | null>(null)
  const [wordDetailId, setWordDetailId] = useState<number | null>(null)
  const [review, setReview] = useState(false)
  const [discover, setDiscover] = useState<{ query: string; similar?: string } | null>(null)
  const [nowOpen, setNowOpen] = useState(false)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [viewer, setViewer] = useState(false)
  const [rhythmOpen, setRhythmOpen] = useState(false)
  const [metaClean, setMetaClean] = useState(false)
  const [metaAuto, setMetaAuto] = useState(false)
  const [editorTrack, setEditorTrack] = useState<Track | null>(null)
  const [wordTap, setWordTap] = useState<WordTap | null>(null)
  const pausedByWord = useRef(false)

  const learning = settings.learningMode

  // Tema de color
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  // Color de acento según la portada de la canción que suena
  const coverForAccent = useCover(player.current, 160)
  const trackColor = useCoverColor(coverForAccent)
  useEffect(() => {
    const root = document.documentElement.style
    for (const v of ['--bg', '--bg-rgb', '--panel', '--raise', '--line', '--text', '--muted', '--accent', '--accent-ink', '--good']) {
      root.removeProperty(v)
    }
    const hsl = parseHsl(trackColor)
    if (settings.songPalette && hsl) {
      // toda la paleta toma el matiz de la portada de la canción
      for (const [k, v] of Object.entries(songPalette(hsl.h, hsl.s))) root.setProperty(k, v)
    } else if (settings.dynamicAccent && trackColor) {
      root.setProperty('--accent', trackColor)
      root.setProperty('--accent-ink', '#14110c')
    } else if (settings.accentColor) {
      root.setProperty('--accent', settings.accentColor)
      root.setProperty('--accent-ink', inkFor(settings.accentColor))
    }
  }, [settings.dynamicAccent, settings.songPalette, settings.accentColor, trackColor])
  const visibleTabs = TABS.filter((t) => t.id !== 'words' || learning)

  // Si se apaga el modo aprendizaje estando en Palabras, volver a Ajustes
  useEffect(() => {
    if (!learning && tab === 'words') setTab('settings')
  }, [learning, tab])

  const openWord = useCallback(
    (tap: WordTap) => {
      if (settings.pauseOnWordTap && player.isPlaying) {
        pausedByWord.current = true
        void LMusic.pause()
      }
      setWordTap(tap)
    },
    [settings.pauseOnWordTap, player.isPlaying],
  )

  const closeWord = useCallback(() => {
    setWordTap(null)
    if (pausedByWord.current) {
      pausedByWord.current = false
      void LMusic.play()
    }
  }, [])

  // Cuando hay una pantalla encima (artista, género, palabra…), las pestañas de abajo se ocultan: así no se puede
  // "bajar" hasta ver sus canciones, y al volver se recupera por dónde ibas.
  const overlayOpen = detail !== null || wordDetailId !== null
  const overlayRef = useRef(overlayOpen)
  overlayRef.current = overlayOpen
  const mainRef = useRef<HTMLElement>(null)
  const savedScroll = useRef(0)
  const wasOverlay = useRef(false)
  useLayoutEffect(() => {
    const el = mainRef.current
    if (el && wasOverlay.current && !overlayOpen) el.scrollTop = savedScroll.current
    wasOverlay.current = overlayOpen
  }, [overlayOpen])

  useEffect(() => {
    setAiRetry(settings.aiRetry)
  }, [settings.aiRetry])

  // estilo visual (easter egg de Inicio)
  useEffect(() => {
    document.documentElement.dataset.skin = settings.skin
  }, [settings.skin])

  const playAt = useCallback(
    async (trackId: number, timeMs: number) => {
      const t = lib.byId.get(trackId)
      if (!t) return
      await player.playQueue([t], 0, false)
      if (timeMs > 0) {
        const target = Math.max(0, timeMs - 1500)
        await LMusic.seekTo({ positionMs: target })
        // algunos mp3 tardan en aceptar el salto: se repite una vez
        window.setTimeout(() => void LMusic.seekTo({ positionMs: target }), 700)
      }
      setLyricsOpen(true)
      setNowOpen(true)
    },
    [lib.byId, player],
  )

  // Estado vivo para el botón "atrás" de Android
  const live = useRef({ tab, detail, wordDetailId, review, nowOpen, menu, viewer, wordTap, closeWord, rhythmOpen, metaClean, editorTrack, discover })
  live.current = { tab, detail, wordDetailId, review, nowOpen, menu, viewer, wordTap, closeWord, rhythmOpen, metaClean, editorTrack, discover }

  useEffect(() => {
    let remove: (() => void) | undefined
    let alive = true
    void CapApp.addListener('backButton', () => {
      const s = live.current
      if (s.wordTap) s.closeWord()
      else if (s.discover !== null) setDiscover(null)
      else if (s.editorTrack) setEditorTrack(null)
      else if (s.metaClean) setMetaClean(false)
      else if (s.rhythmOpen) setRhythmOpen(false)
      else if (s.menu) setMenu(null)
      else if (s.viewer) setViewer(false)
      else if (s.review) setReview(false)
      else if (s.nowOpen) setNowOpen(false)
      else if (s.wordDetailId !== null) setWordDetailId(null)
      else if (s.detail) setDetail(null)
      else if (s.tab !== 'home') setTab('home')
      else void CapApp.minimizeApp()
    }).then((h) => {
      if (alive) remove = () => void h.remove()
      else void h.remove()
    })
    return () => {
      alive = false
      remove?.()
    }
  }, [])

  // Aviso de error de reproducción (archivo borrado o dañado)
  const { lastError, clearError } = player
  useEffect(() => {
    if (!lastError) return
    const t = window.setTimeout(clearError, 4500)
    return () => window.clearTimeout(t)
  }, [lastError, clearError])

  const openMenu = useCallback((track: Track, playlistId?: number) => setMenu({ track, playlistId }), [])

  if (lib.status === 'loading') {
    return <div className="center">Preparando tu biblioteca…</div>
  }
  if (lib.status === 'error') {
    return (
      <div className="center">
        <h1>Algo falló al abrir la biblioteca</h1>
        <p className="muted">{lib.error}</p>
      </div>
    )
  }
  if (lib.status === 'needs-access') {
    return (
      <div className="center">
        <h1>LMusic necesita ver tu música</h1>
        <p className="muted">
          Para listar tus canciones y reproducirlas, permite el acceso a los archivos de audio. Todo se
          queda en tu teléfono.
        </p>
        <button className="big-btn" onClick={() => void lib.requestAccess()}>
          Permitir acceso a la música
        </button>
      </div>
    )
  }

  return (
    <div className={`app${settings.bgImage ? ' has-bg' : ''}`}>
      {settings.bgImage && (
        <>
          <div
            className="app-bg"
            style={{ backgroundImage: `url(${settings.bgImage})`, filter: `blur(${settings.bgBlur}px)` }}
          />
          <div className="app-dim" style={{ opacity: settings.bgDim / 100 }} />
        </>
      )}
      <main
        className="main"
        ref={mainRef}
        onScroll={(e) => {
          if (!overlayRef.current) savedScroll.current = e.currentTarget.scrollTop
        }}
      >
        <div hidden={tab !== 'home' || overlayOpen}>
          <Home onOpen={setDetail} onDiscover={() => setDiscover({ query: '' })} />
        </div>
        <div hidden={tab !== 'library' || overlayOpen}>
          <Library onOpen={setDetail} onMenu={(t) => openMenu(t)} onDiscover={(q) => setDiscover({ query: q })} />
        </div>
        <div hidden={tab !== 'playlists' || overlayOpen}>
          <Playlists onOpen={setDetail} />
        </div>
        {learning && (
          <div hidden={tab !== 'words' || overlayOpen}>
            <Words onOpenWord={setWordDetailId} onReview={() => setReview(true)} onPlayAt={(id, ms) => void playAt(id, ms)} />
          </div>
        )}
        <div hidden={tab !== 'settings' || overlayOpen}>
          <Settings
            onOpenMetaClean={(auto) => {
              setMetaAuto(!!auto)
              setMetaClean(true)
            }}
          />
        </div>
        {detail && <Collection refr={detail} onBack={() => setDetail(null)} onMenu={openMenu} onDiscover={(q) => setDiscover({ query: q })} />}
        {wordDetailId !== null && (
          <WordDetail id={wordDetailId} onBack={() => setWordDetailId(null)} onPlayAt={(id, ms) => void playAt(id, ms)} />
        )}
      </main>

      {lastError && (
        <div className="toast" role="alert">
          No se pudo reproducir una canción. Puede que el archivo ya no exista.
        </div>
      )}

      <div className="dock">
        <MiniPlayer onOpen={() => setNowOpen(true)} />
        <nav className="tabbar">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              className={t.id === tab ? 'on' : ''}
              onClick={() => {
                setTab(t.id)
                setDetail(null)
                setWordDetailId(null)
              }}
            >
              <span className="tab-icon">
                <t.icon size={22} />
                {t.id === 'words' && dueCount > 0 && <i className="badge">{dueCount > 99 ? '99+' : dueCount}</i>}
              </span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {nowOpen && player.current && (
        <NowPlaying
          onClose={() => {
            setViewer(false)
            setRhythmOpen(false)
            setNowOpen(false)
          }}
          viewerOpen={viewer}
          setViewerOpen={setViewer}
          lyricsOpen={lyricsOpen}
          setLyricsOpen={setLyricsOpen}
          onWord={openWord}
          rhythmOpen={rhythmOpen}
          setRhythmOpen={setRhythmOpen}
          onEditLyrics={setEditorTrack}
          onDiscover={(d) => {
            setNowOpen(false)
            setDiscover(d)
          }}
        />
      )}
      {review && <Review onClose={() => setReview(false)} />}
      {metaClean && <MetaClean autoStart={metaAuto} onClose={() => setMetaClean(false)} />}
      {editorTrack && <LyricsEditor track={editorTrack} onClose={() => setEditorTrack(null)} />}
      {menu && <TrackMenu track={menu.track} playlistId={menu.playlistId} onClose={() => setMenu(null)} />}
      {discover !== null && <Discover initialQuery={discover.query} similarTo={discover.similar} onClose={() => setDiscover(null)} />}
      <Toaster />
      {wordTap && <WordSheet tap={wordTap} onClose={closeWord} />}
    </div>
  )
}

export default function App() {
  return (
    <LibraryProvider>
      <SettingsProvider>
        <VocabProvider>
          <PlayerProvider>
            <Shell />
          </PlayerProvider>
        </VocabProvider>
      </SettingsProvider>
    </LibraryProvider>
  )
}
