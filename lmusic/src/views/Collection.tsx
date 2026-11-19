import { useLibrary } from '../state/library'
import { usePlayer } from '../state/player'
import { TrackList } from '../components/TrackList'
import { IconBack, IconPlay, IconSearch, IconShuffle, IconTrash } from '../icons'
import { resolveCollection } from '../nav'
import type { CollectionRef } from '../nav'
import type { Track } from '../types'

interface Props {
  refr: CollectionRef
  onBack: () => void
  onMenu: (t: Track, playlistId?: number) => void
  /** buscar más música de este artista o género en internet */
  onDiscover?: (q: string) => void
}

export function Collection({ refr, onBack, onMenu, onDiscover }: Props) {
  const { tracks, byId, playlists, deletePlaylist, renamePlaylist } = useLibrary()
  const { playQueue, current, isPlaying } = usePlayer()
  const col = resolveCollection(refr, tracks, byId, playlists)

  const remove = async () => {
    if (col.playlistId === undefined) return
    if (window.confirm(`¿Eliminar la lista "${col.title}"? Las canciones no se borran.`)) {
      await deletePlaylist(col.playlistId)
      onBack()
    }
  }
  const rename = async () => {
    if (col.playlistId === undefined) return
    const n = window.prompt('Nuevo nombre de la lista', col.title)
    if (n && n.trim()) await renamePlaylist(col.playlistId, n)
  }

  return (
    <div className="screen overlay">
      <header className="screen-head">
        <button className="icon-btn" onClick={onBack} aria-label="Volver">
          <IconBack size={26} />
        </button>
        <div className="head-text">
          <h1 onClick={col.playlistId !== undefined ? () => void rename() : undefined}>{col.title}</h1>
          <span className="muted">{col.subtitle}</span>
        </div>
        {col.playlistId !== undefined && (
          <button className="icon-btn" onClick={() => void remove()} aria-label="Eliminar lista">
            <IconTrash size={22} />
          </button>
        )}
      </header>

      {col.tracks.length > 0 ? (
        <>
          <div className="play-row">
            <button className="chip solid" onClick={() => void playQueue(col.tracks, 0, false)}>
              <IconPlay size={16} /> Reproducir
            </button>
            <button
              className="chip"
              onClick={() => void playQueue(col.tracks, Math.floor(Math.random() * col.tracks.length), true)}
            >
              <IconShuffle size={16} /> Aleatorio
            </button>
            {(refr.kind === 'artist' || refr.kind === 'genre') && onDiscover && (
              <button className="chip" onClick={() => onDiscover(refr.key)}>
                <IconSearch size={16} /> Descubrir más
              </button>
            )}
          </div>
          <TrackList
            tracks={col.tracks}
            activeId={current?.id ?? null}
            playing={isPlaying}
            resetKey={JSON.stringify(refr)}
            onPlay={(i) => void playQueue(col.tracks, i, false)}
            onMenu={(t) => onMenu(t, col.playlistId)}
          />
        </>
      ) : (
        <p className="empty">Aquí todavía no hay canciones.</p>
      )}
    </div>
  )
}
