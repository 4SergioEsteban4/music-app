import { useState } from 'react'
import { useLibrary } from '../state/library'
import { Cover } from '../components/Cover'
import { IconPlus } from '../icons'
import { plural } from '../utils'
import type { CollectionRef } from '../nav'

export function Playlists({ onOpen }: { onOpen: (ref: CollectionRef) => void }) {
  const { playlists, byId, createPlaylist } = useLibrary()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const create = async () => {
    if (!name.trim()) return
    const id = await createPlaylist(name)
    setName('')
    setCreating(false)
    onOpen({ kind: 'playlist', id })
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Listas</h1>
        <button className="icon-btn" onClick={() => setCreating((v) => !v)} aria-label="Nueva lista">
          <IconPlus size={24} />
        </button>
      </header>

      {creating && (
        <div className="new-list pad">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            placeholder="Nombre de la lista"
            maxLength={60}
          />
          <button className="chip solid" disabled={!name.trim()} onClick={() => void create()}>
            Crear
          </button>
        </div>
      )}

      <div className="track-list">
        <button className="row-main group-row" onClick={() => onOpen({ kind: 'favorites' })}>
          <Cover track={null} size={48} />
          <span className="row-text">
            <span className="row-title">Favoritas</span>
            <span className="row-sub">Tus canciones con corazón</span>
          </span>
        </button>
        {playlists.map((pl) => (
          <button key={pl.id} className="row-main group-row" onClick={() => onOpen({ kind: 'playlist', id: pl.id })}>
            <Cover track={byId.get(pl.trackIds[0]) ?? null} size={48} />
            <span className="row-text">
              <span className="row-title">{pl.name}</span>
              <span className="row-sub">{plural(pl.trackIds.length, 'canción', 'canciones')}</span>
            </span>
          </button>
        ))}
      </div>
      {!playlists.length && !creating && (
        <p className="empty">Crea tu primera lista con el botón + o desde el menú de cualquier canción.</p>
      )}
    </div>
  )
}
