import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useCover, useCoverColor } from '../native/covers'
import { LyricsView } from './LyricsView'
import type { WordHit } from './LyricsView'
import { useSettings } from '../state/settings'
import { useVocab } from '../state/vocab'
import { useAudioInfo } from '../audio/analysis'
import { BeatDriver } from './BeatDriver'
import { ParticleField } from './ParticleField'
import { RhythmSheet } from './RhythmSheet'
import { resolveLook, saverAlbum, saverLyricFx } from '../visual/look'
import { PrimeDriver } from './PrimeDriver'
import { PrimeSheet } from './PrimeSheet'
import { MiniLyrics } from './MiniLyrics'
import { setStar, toggleStar, useStar } from '../audio/star'
import { TrackMenu } from './TrackMenu'
import { QueueSheet } from './QueueSheet'
import { SleepSheet } from './SleepSheet'
import { SpeedSheet } from './SpeedSheet'
import { DriveMode } from './DriveMode'
import { LyricSettingsSheet } from './LyricSettingsSheet'
import { usePrime } from '../audio/prime'
import { genreArt } from '../visual/genreArt'
import { THEMES } from '../themes'
import { usePlayer, useProgress } from '../state/player'
import { useLibrary } from '../state/library'
import { Cover } from './Cover'
import {
  IconDown,
  IconHeart,
  IconMore,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconStar,
} from '../icons'
import { albumOf, artistOf, fmtTime } from '../utils'
import type { Track, WordTap } from '../types'

interface Props {
  onClose: () => void
  viewerOpen: boolean
  setViewerOpen: (open: boolean) => void
  lyricsOpen: boolean
  setLyricsOpen: (open: boolean) => void
  onWord: (tap: WordTap) => void
  rhythmOpen: boolean
  setRhythmOpen: (open: boolean) => void
  onEditLyrics: (t: Track) => void
  onDiscover: (d: { query: string; similar?: string }) => void
}

export function NowPlaying({
  onClose,
  viewerOpen,
  setViewerOpen,
  lyricsOpen,
  setLyricsOpen,
  onWord,
  rhythmOpen,
  setRhythmOpen,
  onEditLyrics,
  onDiscover,
}: Props) {
  const p = usePlayer()
  const { positionMs, durationMs } = useProgress()
  const { toggleFavorite } = useLibrary()
  const [drag, setDrag] = useState<number | null>(null)
  const dragRef = useRef<number | null>(null)
  const { settings } = useSettings()
  const { words } = useVocab()
  const saved = useMemo(
    () =>
      new Map<string, 'saved' | 'hard'>(
        words.filter((w) => w.lang === settings.targetLang).map((w) => [w.word, w.difficult ? 'hard' : 'saved']),
      ),
    [words, settings.targetLang],
  )
  const t = p.current
  const bigUrl = useCover(t, 720)
  const origUrl = useCover(viewerOpen ? t : null, 2048)
  const tint = useCoverColor(bigUrl)
  const nowRef = useRef<HTMLDivElement>(null)
  const { info } = useAudioInfo(t)
  const moments = usePrime(t?.id)
  const [primeOpen, setPrimeOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [lyricsMenuOpen, setLyricsMenuOpen] = useState(false)
  const [sheet, setSheet] = useState<'lyricset' | 'sleep' | 'speed' | 'queue' | 'drive' | null>(null)
  const hasTrack = !!t
  // Star mode "al instante": se enciende con la ★ y se apaga solo al cambiar de canción
  const starOn = useStar()
  const tid = t?.id
  useEffect(() => {
    setStar(false)
    return () => setStar(false)
  }, [tid])
  const starTimer = useRef(0)
  const starLong = useRef(false)
  // efecto de la portada a voluntad: se pone como clase en la raíz (sin tocar el className de React)
  useEffect(() => {
    const el = nowRef.current
    if (!el) return
    for (const c of Array.from(el.classList)) if (c.startsWith('cfx-')) el.classList.remove(c)
    const fx = saverAlbum(settings.coverFx, settings.saver, 'none')
    if (['pulse', 'bounce', 'rainbow', 'glitch', 'shock'].includes(fx)) el.classList.add(`cfx-${fx}`)
  }, [settings.coverFx, settings.saver, hasTrack])
  if (!t) return null

  const art = genreArt(t.genre, `${albumOf(t)}|${artistOf(t)}`)
  const themeAccent = settings.accentColor || (THEMES.find((x) => x.id === settings.theme)?.swatch[1] ?? '#f2a93b')
  const accentColor = settings.dynamicAccent && tint ? tint : themeAccent
  const useThemeBg = settings.nowBg === 'theme'
  const bgStyle: CSSProperties = useThemeBg
    ? {}
    : bigUrl
      ? { backgroundImage: `url(${bigUrl})` }
      : { backgroundImage: `linear-gradient(160deg, hsl(${art.hue} 38% 20%), hsl(${art.hue} 30% 8%))` }
  const nowStyle = (settings.dynamicAccent && tint ? { '--tint': tint } : {}) as CSSProperties
  const saver = settings.saver
  const look = resolveLook(settings, t.genre, info?.bpm ?? 0)
  const effects = look.fx
  // Star mode: la letra y la portada se vuelven más extremas
  const primeLyricFx = saverLyricFx(settings.primeFx === 'auto' ? (look.lyricFx === 'none' ? 'electric' : look.lyricFx) : settings.primeFx, saver)
  const ALBUM_BY_FX: Record<string, string> = { electric: 'shock', blood: 'bounce', fire: 'pulse', ice: 'rainbow', neon: 'glitch', glitch: 'glitch', gold: 'pulse', shock: 'shock', none: 'pulse' }
  const primeAlbum = saverAlbum(
    ['pulse', 'bounce', 'rainbow', 'glitch', 'shock'].includes(settings.primeAlbum) ? settings.primeAlbum : (ALBUM_BY_FX[look.lyricFx] ?? 'pulse'),
    saver,
    'pulse',
  )
  // ★ : un toque enciende el Star mode (o abre la hoja si se eligió "solo en mis partes"); mantener pulsado abre la hoja
  const starPress = {
    onPointerDown: () => {
      starLong.current = false
      window.clearTimeout(starTimer.current)
      starTimer.current = window.setTimeout(() => {
        starLong.current = true
        setPrimeOpen(true)
      }, 450)
    },
    onPointerUp: () => window.clearTimeout(starTimer.current),
    onPointerLeave: () => window.clearTimeout(starTimer.current),
    onPointerCancel: () => window.clearTimeout(starTimer.current),
    onClick: () => {
      if (starLong.current) {
        starLong.current = false
        return
      }
      if (settings.starMode === 'instant') toggleStar()
      else setPrimeOpen(true)
    },
  }

  const shown = drag ?? positionMs
  const pct = durationMs > 0 ? Math.min(100, (shown / durationMs) * 100) : 0
  // El deslizador de Android a veces cancela el evento "pointerup": se confirma con varios eventos
  const commit = () => {
    const target = dragRef.current
    if (target === null) return
    dragRef.current = null
    setDrag(null)
    void p.seek(target)
  }

  return (
    <div className="now" role="dialog" aria-label="Reproduciendo" style={nowStyle} ref={nowRef}>
      <BeatDriver rootRef={nowRef} info={info} genre={t.genre} enabled={settings.beatFx && saver < 3} />
      <PrimeDriver
        rootRef={nowRef}
        moments={moments}
        enabled={settings.primeOn && saver < 3}
        force={starOn && settings.starMode === 'instant'}
        lyricFx={primeLyricFx}
        album={primeAlbum}
      />
      <div className={`now-bg${useThemeBg ? ' theme' : ''}`} style={bgStyle} />
      <div className="now-shade" />
      <div className="now-prime-vig" />
      <ParticleField enabled={settings.particles && saver < 3} tint={accentColor} effects={effects} />
      <div className="now-top">
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          <IconDown size={26} />
        </button>
        <span className="now-top-title">Reproduciendo</span>
        <button className="icon-btn" onClick={() => (lyricsOpen ? setLyricsMenuOpen(true) : setMenuOpen(true))} aria-label="Más opciones">
          <span key={lyricsOpen ? 'lyr' : 'alb'} className="dots-pop">
            <IconMore size={22} />
          </span>
        </button>
      </div>

      {lyricsOpen ? (
        <div className="now-lyrics">
          <LyricsView
            track={t}
            learning={settings.learningMode}
            saved={saved}
            onWord={(w: WordHit) => onWord({ ...w, trackId: t.id })}
            onEdit={() => onEditLyrics(t)}
            menuOpen={lyricsMenuOpen}
            onMenuClose={() => setLyricsMenuOpen(false)}
            onOpenSettings={() => {
              setLyricsMenuOpen(false)
              setSheet('lyricset')
            }}
          />
        </div>
      ) : (
        <div className="now-cover">
          <button className="cover-btn" onClick={() => setViewerOpen(true)} aria-label="Ver portada completa">
            <span className="cover-glow" />
            <Cover track={t} size={Math.min(window.innerWidth - 64, 360)} />
          </button>
          {settings.lyricsUnderCover && <MiniLyrics track={t} />}
        </div>
      )}

      <div className="now-info">
        <div className="now-info-text">
          <h1>{t.title}</h1>
          <p>
            {artistOf(t)}
            {t.album ? ` — ${albumOf(t)}` : ''}
          </p>
        </div>
        <button
          className={`icon-btn${t.favorite ? ' on' : ''}`}
          onClick={() => void toggleFavorite(t.id)}
          aria-label="Favorita"
        >
          <IconHeart size={24} filled={t.favorite} />
        </button>
      </div>

      <div className="seek">
        <input
          type="range"
          min={0}
          max={Math.max(1, durationMs)}
          step={100}
          value={shown}
          style={{ '--p': `${pct}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value)
            dragRef.current = v
            setDrag(v)
          }}
          onPointerUp={commit}
          onPointerCancel={commit}
          onTouchEnd={commit}
          onMouseUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          aria-label="Posición"
        />
        <div className="seek-times">
          <span>{fmtTime(shown)}</span>
          <span>{fmtTime(durationMs)}</span>
        </div>
      </div>

      <div className="controls">
        <button className={`icon-btn${p.shuffle ? ' on' : ''}`} onClick={() => void p.toggleShuffle()} aria-label="Aleatorio">
          <IconShuffle size={22} />
        </button>
        <button className="icon-btn" onClick={() => void p.previous()} aria-label="Anterior">
          <IconPrev size={30} />
        </button>
        <button className="play-btn" onClick={() => void p.toggle()} aria-label={p.isPlaying ? 'Pausar' : 'Reproducir'}>
          {p.isPlaying ? <IconPause size={32} /> : <IconPlay size={32} />}
        </button>
        <button className="icon-btn" onClick={() => void p.next()} aria-label="Siguiente">
          <IconNext size={30} />
        </button>
        <button
          className={`icon-btn${p.repeat !== 'off' ? ' on' : ''}`}
          onClick={() => void p.cycleRepeat()}
          aria-label="Repetir"
        >
          {p.repeat === 'one' ? <IconRepeatOne size={22} /> : <IconRepeat size={22} />}
        </button>
      </div>

      <div className="now-extra">
        <button className={`chip${lyricsOpen ? ' solid' : ''}`} onClick={() => setLyricsOpen(!lyricsOpen)}>
          Letra
        </button>
        <button className="chip" onClick={() => setSheet('queue')}>
          Cola
        </button>
        {settings.primeOn && saver < 3 && (
          <button
            className={`chip mini${(settings.starMode === 'instant' ? starOn : moments.length > 0) ? ' solid' : ''}`}
            {...starPress}
            aria-label="Star mode"
            title="Star mode (mantén pulsado para marcar tus partes favoritas)"
          >
            <IconStar size={16} filled={settings.starMode === 'instant' ? starOn : moments.length > 0} />
          </button>
        )}
      </div>

      {primeOpen && <PrimeSheet track={t} onClose={() => setPrimeOpen(false)} />}
      {rhythmOpen && <RhythmSheet track={t} info={info} onClose={() => setRhythmOpen(false)} />}
      {menuOpen && (
        <TrackMenu
          track={t}
          variant="now"
          onClose={() => setMenuOpen(false)}
          onAction={(a) => {
            setMenuOpen(false)
            if (a === 'rhythm') setRhythmOpen(true)
            else if (a === 'discoverArtist') onDiscover({ query: t.artist || t.title })
            else if (a === 'discoverGenre') onDiscover({ query: t.genre })
            else if (a === 'discoverAlbum') onDiscover({ query: `${t.album} ${t.artist}`.trim() })
            else if (a === 'discoverSimilar') {
              onDiscover({
                query: t.artist || t.title,
                similar: `Quiero canciones parecidas a "${t.title}" de ${t.artist || 'un artista desconocido'}${t.genre ? ` (género ${t.genre})` : ''}.`,
              })
            } else setSheet(a)
          }}
        />
      )}
      {sheet === 'lyricset' && <LyricSettingsSheet onClose={() => setSheet(null)} />}
      {sheet === 'sleep' && <SleepSheet onClose={() => setSheet(null)} />}
      {sheet === 'speed' && <SpeedSheet onClose={() => setSheet(null)} />}
      {sheet === 'queue' && <QueueSheet onClose={() => setSheet(null)} />}
      {sheet === 'drive' && <DriveMode onClose={() => setSheet(null)} />}

      {viewerOpen && (
        <div className="viewer" onClick={() => setViewerOpen(false)} role="dialog" aria-label="Portada">
          {origUrl || bigUrl ? (
            <img src={origUrl ?? bigUrl ?? ''} alt={`Portada de ${t.album || t.title}`} />
          ) : (
            <p className="muted">Esta canción no tiene portada guardada.</p>
          )}
        </div>
      )}
    </div>
  )
}
