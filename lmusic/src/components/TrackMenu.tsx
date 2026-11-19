import { useRef, useState } from 'react'
import type { Track } from '../types'
import { useLibrary } from '../state/library'
import { Cover } from './Cover'
import { fetchOnlineCover } from '../covers/online'
import { clearCustomCover, setCustomCover } from '../covers/custom'
import { restoreFileOriginals, writeTagsToFiles } from '../files/writeTags'
import { artistOf } from '../utils'
import { usePlayer } from '../state/player'
import { useSleep } from '../audio/sleep'
import { IconSearch, IconCar, IconChevron, IconEyeOff, IconGauge, IconImage, IconMetronome, IconMoon, IconSliders, IconTag, IconTrash } from '../icons'
import { LMusic } from '../native/lmusic'
import { deleteTrackFile } from '../files/deleteTrack'

export type NowAction =
  | 'lyricset'
  | 'sleep'
  | 'speed'
  | 'drive'
  | 'rhythm'
  | 'discoverArtist'
  | 'discoverGenre'
  | 'discoverAlbum'
  | 'discoverSimilar'

interface Props {
  track: Track
  playlistId?: number
  /** 'now' = menú de los 3 puntitos de Reproduciendo */
  variant?: 'list' | 'now'
  onAction?: (a: NowAction) => void
  onClose: () => void
}

export function TrackMenu({ track, playlistId, variant = 'list', onAction, onClose }: Props) {
  const lib = useLibrary()
  const { speed, queue, playQueue } = usePlayer()
  const sleep = useSleep()
  const [openGroup, setOpenGroup] = useState<'cover' | 'tags' | 'discover' | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const sleepLabel = sleep ? (sleep.kind === 'time' ? ` · ${Math.max(1, Math.ceil((sleep.at - Date.now()) / 60000))} min` : ' · al terminar la canción') : ''
  const [mode, setMode] = useState<'main' | 'pick' | 'edit'>('main')
  const [form, setForm] = useState({ title: '', artist: '', album: '', genre: '' })
  const [name, setName] = useState('')
  const [coverMsg, setCoverMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const scopeRef = useRef<'song' | 'album'>('song')
  // el contexto puede haber cambiado la canción (p. ej. favorita): usar la versión viva
  const live = lib.byId.get(track.id) ?? track

  const addTo = async (pid: number) => {
    await lib.addToPlaylist(pid, [track.id])
    onClose()
  }
  const searchCover = async () => {
    setCoverMsg('Buscando portada…')
    try {
      const ok = await fetchOnlineCover(live)
      setCoverMsg(ok ? 'Portada guardada.' : 'No encontré una portada para esta canción.')
    } catch {
      setCoverMsg('No pude conectar. Revisa tu internet.')
    }
  }
  const albumIds = live.album ? lib.tracks.filter((t) => t.album === live.album).map((t) => t.id) : [live.id]

  const chooseCover = (scope: 'song' | 'album') => {
    scopeRef.current = scope
    fileRef.current?.click()
  }
  const onCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setCoverMsg('Guardando portada…')
    try {
      const ids = scopeRef.current === 'album' ? albumIds : [live.id]
      await setCustomCover(ids, f)
      setCoverMsg(ids.length > 1 ? `Portada aplicada a ${ids.length} canciones.` : 'Portada guardada.')
    } catch {
      setCoverMsg('No pude usar esa imagen. Prueba con otra.')
    }
  }
  const writeToFile = async () => {
    setCoverMsg('Esperando el permiso del sistema…')
    try {
      const r = await writeTagsToFiles([live], true)
      setCoverMsg(r.ok ? 'Etiquetas y portada guardadas en el archivo.' : `No se pudo: ${r.failed[0]?.message ?? 'error'}`)
    } catch (e) {
      setCoverMsg(e instanceof Error ? e.message : 'No se pudo escribir en el archivo.')
    }
  }
  const restoreFile = async () => {
    setCoverMsg('Esperando el permiso del sistema…')
    try {
      const r = await restoreFileOriginals([live])
      setCoverMsg(r.ok ? 'Archivo restaurado a su original.' : `No se pudo: ${r.failed[0]?.message ?? 'error'}`)
    } catch (e) {
      setCoverMsg(e instanceof Error ? e.message : 'No se pudo restaurar.')
    }
  }
  const deleteFile = async () => {
    if (!confirmDel) {
      setConfirmDel(true)
      return
    }
    setCoverMsg('Esperando la confirmación del sistema…')
    try {
      const idx = queue.findIndex((x) => x.id === live.id)
      await deleteTrackFile(live)
      const rest = queue.filter((x) => x.id !== live.id)
      if (rest.length) await playQueue(rest, Math.min(Math.max(idx, 0), rest.length - 1))
      else await LMusic.pause()
      await lib.rescan()
      onClose()
    } catch (e) {
      setConfirmDel(false)
      setCoverMsg(e instanceof Error ? e.message : 'No se pudo eliminar el archivo.')
    }
  }
  const resetCover = async () => {
    await clearCustomCover(scopeRef.current === 'album' ? albumIds : [live.id])
    setCoverMsg('Se quitó la portada propia.')
  }
  const createAndAdd = async () => {
    if (!name.trim()) return
    const id = await lib.createPlaylist(name)
    await addTo(id)
  }

  return (
    <div className={`sheet-backdrop${variant === 'now' ? ' top' : ''}`} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <Cover track={live} size={48} />
          <span className="row-text">
            <span className="row-title">{live.title}</span>
            <span className="row-sub">{artistOf(live)}</span>
          </span>
        </div>

        {mode === 'edit' ? (
          <div className="sheet-actions">
            {(['title', 'artist', 'album', 'genre'] as const).map((k) => (
              <label key={k} className="field">
                <span>{{ title: 'Título', artist: 'Artista', album: 'Álbum', genre: 'Género' }[k]}</span>
                <input
                  className="text-input"
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </label>
            ))}
            <div className="rhythm-row end">
              <button
                className="chip"
                onClick={async () => {
                  await lib.revertMeta([live.id])
                  onClose()
                }}
              >
                Restaurar original
              </button>
              <button
                className="chip solid"
                disabled={!form.title.trim()}
                onClick={async () => {
                  await lib.updateMeta([
                    {
                      id: live.id,
                      patch: {
                        title: form.title.trim(),
                        artist: form.artist.trim(),
                        album: form.album.trim(),
                        genre: form.genre.trim(),
                      },
                    },
                  ])
                  onClose()
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        ) : mode === 'main' && variant === 'now' ? (
          <div className="sheet-actions">
            {coverMsg && <p className="muted menu-msg">{coverMsg}</p>}
            <button className="mi group-head" onClick={() => setOpenGroup(openGroup === 'discover' ? null : 'discover')} aria-expanded={openGroup === 'discover'}>
              <IconSearch size={20} />
              <span className="grow">Descubrir más</span>
              <span className={`group-chev${openGroup === 'discover' ? ' open' : ''}`}>
                <IconChevron size={18} />
              </span>
            </button>
            {openGroup === 'discover' && (
              <div className="sub-actions">
                {live.artist && <button onClick={() => onAction?.('discoverArtist')}>Más de {live.artist}</button>}
                {live.genre && <button onClick={() => onAction?.('discoverGenre')}>Más del género {live.genre}</button>}
                {live.album && <button onClick={() => onAction?.('discoverAlbum')}>Más de este álbum</button>}
                <button onClick={() => onAction?.('discoverSimilar')}>Canciones parecidas a esta</button>
              </div>
            )}
            <button className="mi" onClick={() => onAction?.('lyricset')}>
              <IconSliders size={20} />
              <span>Configuración de la letra</span>
            </button>
            <button className="mi" onClick={() => onAction?.('sleep')}>
              <IconMoon size={20} />
              <span>Temporizador para dormir{sleepLabel}</span>
            </button>
            <button className="mi group-head" onClick={() => setOpenGroup(openGroup === 'cover' ? null : 'cover')} aria-expanded={openGroup === 'cover'}>
              <IconImage size={20} />
              <span className="grow">Portada</span>
              <span className={`group-chev${openGroup === 'cover' ? ' open' : ''}`}>
                <IconChevron size={18} />
              </span>
            </button>
            {openGroup === 'cover' && (
              <div className="sub-actions">
                <button onClick={() => chooseCover('song')}>Elegir imagen</button>
                {albumIds.length > 1 && <button onClick={() => chooseCover('album')}>Elegir imagen para todo el álbum ({albumIds.length})</button>}
                <button onClick={() => void searchCover()}>Buscar en internet</button>
                <button
                  onClick={() => {
                    scopeRef.current = 'song'
                    void resetCover()
                  }}
                >
                  Quitar mi portada (volver a la original)
                </button>
              </div>
            )}
            <button className="mi group-head" onClick={() => setOpenGroup(openGroup === 'tags' ? null : 'tags')} aria-expanded={openGroup === 'tags'}>
              <IconTag size={20} />
              <span className="grow">Etiquetas</span>
              <span className={`group-chev${openGroup === 'tags' ? ' open' : ''}`}>
                <IconChevron size={18} />
              </span>
            </button>
            {openGroup === 'tags' && (
              <div className="sub-actions">
                <button
                  onClick={() => {
                    setForm({ title: live.title, artist: live.artist, album: live.album, genre: live.genre })
                    setMode('edit')
                  }}
                >
                  Editar etiquetas
                </button>
                <button onClick={() => void writeToFile()}>Guardar etiquetas y portada en el archivo original</button>
                <button onClick={() => void restoreFile()}>Restaurar el archivo original</button>
              </div>
            )}
            <button className="mi" onClick={() => onAction?.('speed')}>
              <IconGauge size={20} />
              <span>Velocidad de reproducción · {speed.toFixed(2)}×</span>
            </button>
            <button className="mi" onClick={() => onAction?.('drive')}>
              <IconCar size={20} />
              <span>Modo conducción</span>
            </button>
            <button className="mi" onClick={() => onAction?.('rhythm')}>
              <IconMetronome size={20} />
              <span>Ajustar ritmo</span>
            </button>
            <button
              className="mi"
              onClick={async () => {
                await lib.hideTrack(live.id)
                onClose()
              }}
            >
              <IconEyeOff size={20} />
              <span>Ocultar canción</span>
            </button>
            <button className="mi danger" onClick={() => void deleteFile()}>
              <IconTrash size={20} />
              <span>{confirmDel ? 'Toca otra vez: se borra el archivo para siempre' : 'Eliminar del dispositivo'}</span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onCoverFile(e)} />
          </div>
        ) : mode === 'main' ? (
          <div className="sheet-actions">
            <button
              onClick={async () => {
                await lib.toggleFavorite(live.id)
                onClose()
              }}
            >
              {live.favorite ? 'Quitar de favoritas' : 'Agregar a favoritas'}
            </button>
            <button onClick={() => setMode('pick')}>Agregar a una lista</button>
            <button
              onClick={() => {
                setForm({ title: live.title, artist: live.artist, album: live.album, genre: live.genre })
                setMode('edit')
              }}
            >
              Editar título, artista, álbum y género
            </button>
            <button onClick={() => chooseCover('song')}>Cambiar portada (elegir imagen)</button>
            {albumIds.length > 1 && (
              <button onClick={() => chooseCover('album')}>Cambiar portada de todo el álbum ({albumIds.length})</button>
            )}
            <button onClick={() => void searchCover()}>Buscar portada en internet</button>
            <button
              onClick={() => {
                scopeRef.current = 'song'
                void resetCover()
              }}
            >
              Quitar mi portada (volver a la original)
            </button>
            <button onClick={() => void writeToFile()}>Guardar etiquetas y portada en el archivo original</button>
            <button onClick={() => void restoreFile()}>Restaurar el archivo original (si guardaste copia)</button>
            {coverMsg && <p className="muted menu-msg">{coverMsg}</p>}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onCoverFile(e)} />
            {playlistId !== undefined && (
              <button
                onClick={async () => {
                  await lib.removeFromPlaylist(playlistId, live.id)
                  onClose()
                }}
              >
                Quitar de esta lista
              </button>
            )}
          </div>
        ) : (
          <div className="sheet-actions">
            <div className="new-list">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre de la lista nueva"
                maxLength={60}
              />
              <button className="chip solid" disabled={!name.trim()} onClick={() => void createAndAdd()}>
                Crear
              </button>
            </div>
            {lib.playlists.map((pl) => (
              <button key={pl.id} onClick={() => void addTo(pl.id)}>
                {pl.name}
                {pl.trackIds.includes(live.id) ? ' (ya está)' : ''}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
