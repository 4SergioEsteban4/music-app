import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Playlist, Track } from '../types'
import { LMusic } from '../native/lmusic'
import type { MetaPatch } from '../db/db'
import {
  dbAddToPlaylist,
  dbCreatePlaylist,
  dbDeletePlaylist,
  dbRecordPlay,
  dbRemoveFromPlaylist,
  dbRenamePlaylist,
  dbSetFavorite,
  dbLoadSettings,
  dbSetSetting,
  dbUpdateTrackMeta,
  dbRevertTrackMeta,
  loadPlaylists,
  loadTracks,
  openDb,
  syncScanned,
} from '../db/db'

export type LibraryStatus = 'loading' | 'needs-access' | 'ready' | 'error'

interface LibraryValue {
  status: LibraryStatus
  scanning: boolean
  error: string | null
  tracks: Track[]
  byId: Map<number, Track>
  hiddenTracks: Track[]
  hideTrack: (id: number) => Promise<void>
  unhideTrack: (id: number) => Promise<void>
  playlists: Playlist[]
  requestAccess: () => Promise<void>
  rescan: () => Promise<void>
  toggleFavorite: (id: number) => Promise<void>
  recordPlay: (id: number) => Promise<void>
  createPlaylist: (name: string) => Promise<number>
  renamePlaylist: (id: number, name: string) => Promise<void>
  deletePlaylist: (id: number) => Promise<void>
  addToPlaylist: (playlistId: number, trackIds: number[]) => Promise<void>
  removeFromPlaylist: (playlistId: number, trackId: number) => Promise<void>
  updateMeta: (updates: { id: number; patch: MetaPatch }[]) => Promise<void>
  revertMeta: (ids: number[]) => Promise<void>
  reloadAll: () => Promise<void>
}

const Ctx = createContext<LibraryValue | null>(null)

export function useLibrary(): LibraryValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLibrary fuera de LibraryProvider')
  return v
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LibraryStatus>('loading')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const playlistsRef = useRef<Playlist[]>([])
  playlistsRef.current = playlists
  const scanningRef = useRef(false)

  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])

  // canciones ocultas: siguen existiendo (el reproductor las encuentra por id) pero no salen en las listas
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set())
  const hiddenRef = useRef(hiddenIds)
  hiddenRef.current = hiddenIds
  const visibleTracks = useMemo(() => (hiddenIds.size ? tracks.filter((t) => !hiddenIds.has(t.id)) : tracks), [tracks, hiddenIds])
  const hiddenTracks = useMemo(() => tracks.filter((t) => hiddenIds.has(t.id)), [tracks, hiddenIds])
  const saveHidden = useCallback(async (next: Set<number>) => {
    setHiddenIds(next)
    await dbSetSetting('hiddenTracks', [...next].join(','))
  }, [])
  const hideTrack = useCallback((id: number) => saveHidden(new Set(hiddenRef.current).add(id)), [saveHidden])
  const unhideTrack = useCallback(
    (id: number) => {
      const next = new Set(hiddenRef.current)
      next.delete(id)
      return saveHidden(next)
    },
    [saveHidden],
  )

  const scan = useCallback(async () => {
    if (scanningRef.current) return
    scanningRef.current = true
    setScanning(true)
    try {
      const { tracks: scanned } = await LMusic.scanLibrary()
      await syncScanned(scanned)
      setTracks(await loadTracks())
    } catch (e) {
      setError(msg(e))
    } finally {
      scanningRef.current = false
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        await openDb()
        const [cached, lists, raw] = await Promise.all([loadTracks(), loadPlaylists(), dbLoadSettings()])
        if (!alive) return
        setTracks(cached)
        setHiddenIds(new Set((raw.hiddenTracks ?? '').split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0)))
        setPlaylists(lists)
        const access = await LMusic.checkAccess()
        if (!alive) return
        if (access.audio) {
          setStatus('ready')
          void scan()
        } else {
          setStatus('needs-access')
        }
      } catch (e) {
        if (!alive) return
        setError(msg(e))
        setStatus('error')
      }
    })()
    return () => {
      alive = false
    }
  }, [scan])

  const requestAccess = useCallback(async () => {
    const access = await LMusic.requestAccess()
    if (access.audio) {
      setStatus('ready')
      await scan()
    } else {
      setStatus('needs-access')
    }
  }, [scan])

  const toggleFavorite = useCallback(
    async (id: number) => {
      const t = byId.get(id)
      if (!t) return
      const value = !t.favorite
      await dbSetFavorite(id, value)
      setTracks((prev) => prev.map((x) => (x.id === id ? { ...x, favorite: value } : x)))
    },
    [byId],
  )

  const recordPlay = useCallback(async (id: number) => {
    const at = Date.now()
    await dbRecordPlay(id, at)
    setTracks((prev) =>
      prev.map((x) => (x.id === id ? { ...x, playCount: x.playCount + 1, lastPlayed: at } : x)),
    )
  }, [])

  const createPlaylist = useCallback(async (name: string) => {
    const id = await dbCreatePlaylist(name.trim())
    const created = { id, name: name.trim(), trackIds: [] as number[] }
    playlistsRef.current = [created, ...playlistsRef.current]
    setPlaylists((prev) => [created, ...prev])
    return id
  }, [])

  const renamePlaylist = useCallback(async (id: number, name: string) => {
    await dbRenamePlaylist(id, name.trim())
    setPlaylists((prev) => prev.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)))
  }, [])

  const deletePlaylist = useCallback(async (id: number) => {
    await dbDeletePlaylist(id)
    setPlaylists((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const addToPlaylist = useCallback(async (playlistId: number, trackIds: number[]) => {
    const pl = playlistsRef.current.find((p) => p.id === playlistId)
    if (!pl) return
    const fresh = trackIds.filter((id) => !pl.trackIds.includes(id))
    if (!fresh.length) return
    await dbAddToPlaylist(playlistId, fresh, pl.trackIds.length)
    playlistsRef.current = playlistsRef.current.map((p) =>
      p.id === playlistId ? { ...p, trackIds: [...p.trackIds, ...fresh] } : p,
    )
    setPlaylists((prev) =>
      prev.map((p) => (p.id === playlistId ? { ...p, trackIds: [...p.trackIds, ...fresh] } : p)),
    )
  }, [])

  const removeFromPlaylist = useCallback(async (playlistId: number, trackId: number) => {
    await dbRemoveFromPlaylist(playlistId, trackId)
    setPlaylists((prev) =>
      prev.map((p) =>
        p.id === playlistId ? { ...p, trackIds: p.trackIds.filter((i) => i !== trackId) } : p,
      ),
    )
  }, [])

  const updateMeta = useCallback(async (updates: { id: number; patch: MetaPatch }[]) => {
    for (const u of updates) await dbUpdateTrackMeta(u.id, u.patch)
    const map = new Map(updates.map((u) => [u.id, u.patch]))
    setTracks((prev) =>
      prev.map((t) => {
        const patch = map.get(t.id)
        return patch ? { ...t, ...patch, metaEdited: true } : t
      }),
    )
  }, [])

  const revertMeta = useCallback(
    async (ids: number[]) => {
      await dbRevertTrackMeta(ids)
      await scan()
    },
    [scan],
  )

  const reloadAll = useCallback(async () => {
    setTracks(await loadTracks())
    setPlaylists(await loadPlaylists())
  }, [])

  const value: LibraryValue = {
    status,
    scanning,
    error,
    tracks: visibleTracks,
    byId,
    hiddenTracks,
    hideTrack,
    unhideTrack,
    playlists,
    requestAccess,
    rescan: scan,
    toggleFavorite,
    recordPlay,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    updateMeta,
    revertMeta,
    reloadAll,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
