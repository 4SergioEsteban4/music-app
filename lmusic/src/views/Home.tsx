import { useMemo } from 'react'
import { useLibrary } from '../state/library'
import { usePlayer } from '../state/player'
import { Shelf } from '../components/Shelf'
import { favoriteTracks, historyTracks, recentTracks, topTracks } from '../nav'
import type { CollectionRef } from '../nav'
import { IconSearch, IconShuffle } from '../icons'
import { recommendTracks } from '../recommend'
import { useSettings } from '../state/settings'
import { SKINS } from '../skins'
import { showToast } from '../state/toast'
import type { Track } from '../types'

interface Props {
  onOpen: (ref: CollectionRef) => void
  onDiscover: () => void
}

export function Home({ onOpen, onDiscover }: Props) {
  const { settings, update } = useSettings()
  // easter egg: cambia el estilo de toda la app
  const cycleSkin = () => {
    const i = SKINS.findIndex((k) => k.id === settings.skin)
    const next = SKINS[(i + 1) % SKINS.length]
    update({ skin: next.id })
    showToast(`Estilo: ${next.name}`, 1800)
  }
  const { tracks, scanning } = useLibrary()
  const { playQueue } = usePlayer()

  const shelves = useMemo(
    () => ({
      recent: recentTracks(tracks).slice(0, 12),
      top: topTracks(tracks).slice(0, 12),
      history: historyTracks(tracks).slice(0, 12),
      favs: favoriteTracks(tracks).slice(0, 12),
      rec: recommendTracks(tracks, 12),
    }),
    [tracks],
  )

  const playFrom = (list: Track[]) => (i: number) => void playQueue(list, i, false)
  const shuffleAll = () => {
    if (!tracks.length) return
    void playQueue(tracks, Math.floor(Math.random() * tracks.length), true)
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>LMusic</h1>
        <button className="egg" onClick={cycleSkin} aria-label="Cambiar el estilo de la app">
          ✦
        </button>
        {scanning && <span className="muted">Buscando música…</span>}
      </header>

      {tracks.length > 0 ? (
        <>
          <div className="home-cards">
            <button className="home-card shuffle" onClick={shuffleAll}>
              <span className="hc-ico">
                <IconShuffle size={22} />
              </span>
              <span className="hc-text">
                <strong>Aleatorio</strong>
                <small>Toda mi música</small>
              </span>
            </button>
            <button className="home-card discover" onClick={onDiscover}>
              <span className="hc-ico">
                <IconSearch size={22} />
              </span>
              <span className="hc-text">
                <strong>Descubrir</strong>
                <small>Música nueva</small>
              </span>
            </button>
          </div>
          <Shelf title="Recomendadas para ti" tracks={shelves.rec} onPlay={playFrom(shelves.rec)} />
          <Shelf
            title="Últimas agregadas"
            tracks={shelves.recent}
            onSeeAll={() => onOpen({ kind: 'recent' })}
            onPlay={playFrom(shelves.recent)}
          />
          <Shelf
            title="Más reproducidas"
            tracks={shelves.top}
            onSeeAll={() => onOpen({ kind: 'top' })}
            onPlay={playFrom(shelves.top)}
          />
          <Shelf
            title="Escuchadas hace poco"
            tracks={shelves.history}
            onSeeAll={() => onOpen({ kind: 'history' })}
            onPlay={playFrom(shelves.history)}
          />
          <Shelf
            title="Favoritas"
            tracks={shelves.favs}
            onSeeAll={() => onOpen({ kind: 'favorites' })}
            onPlay={playFrom(shelves.favs)}
          />
        </>
      ) : (
        !scanning && (
          <p className="empty">
            No encontré canciones en el teléfono. Copia tus mp3 a la carpeta Música y toca el botón de
            actualizar en la pestaña Biblioteca.
          </p>
        )
      )}
    </div>
  )
}
