import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PluginListenerHandle } from '@capacitor/core'
import type { RepeatMode, Track } from '../types'
import { LMusic } from '../native/lmusic'
import type { NativeState } from '../native/lmusic'
import { useLibrary } from './library'
import { resetLoopState } from '../audio/loop'

interface PlayerValue {
  isPlaying: boolean
  current: Track | null
  queue: Track[]
  shuffle: boolean
  repeat: RepeatMode
  speed: number
  lastError: string | null
  playQueue: (tracks: Track[], index?: number, shuffle?: boolean) => Promise<void>
  /** Cambia de lugar una canción de la cola (sin cortar la reproducción). */
  moveInQueue: (from: number, to: number) => Promise<void>
  toggle: () => Promise<void>
  next: () => Promise<void>
  previous: () => Promise<void>
  seek: (ms: number) => Promise<void>
  toggleShuffle: () => Promise<void>
  cycleRepeat: () => Promise<void>
  setSpeed: (speed: number) => Promise<void>
  clearError: () => void
}

interface ProgressValue {
  positionMs: number
  durationMs: number
}

const PlayerCtx = createContext<PlayerValue | null>(null)
const ProgressCtx = createContext<ProgressValue>({ positionMs: 0, durationMs: 0 })

export function usePlayer(): PlayerValue {
  const v = useContext(PlayerCtx)
  if (!v) throw new Error('usePlayer fuera de PlayerProvider')
  return v
}
export const useProgress = () => useContext(ProgressCtx)

const REPEAT_ORDER: RepeatMode[] = ['off', 'all', 'one']

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { byId, recordPlay } = useLibrary()
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [queueIds, setQueueIds] = useState<number[]>([])
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<RepeatMode>('off')
  const [speed, setSpeedState] = useState(1)
  const [progress, setProgress] = useState<ProgressValue>({ positionMs: 0, durationMs: 0 })
  const [lastError, setLastError] = useState<string | null>(null)

  const currentIdRef = useRef<number | null>(null)
  const countedRef = useRef(false)
  const recordPlayRef = useRef(recordPlay)
  recordPlayRef.current = recordPlay

  const applyState = useCallback((s: NativeState) => {
    if (!s.ready) return
    if (s.isPlaying !== undefined) setIsPlaying(s.isPlaying)
    if (s.mediaId !== undefined) {
      const id = s.mediaId === '' ? null : Number(s.mediaId)
      currentIdRef.current = id
      setCurrentId(id)
    }
    if (s.shuffle !== undefined) setShuffle(s.shuffle)
    if (s.repeat !== undefined) setRepeat(s.repeat)
    if (s.speed !== undefined) setSpeedState(s.speed)
    if (s.durationMs !== undefined || s.positionMs !== undefined) {
      setProgress((p) => ({
        positionMs: s.positionMs ?? p.positionMs,
        durationMs: s.durationMs ?? p.durationMs,
      }))
    }
  }, [])

  useEffect(() => {
    let alive = true
    const handles: PluginListenerHandle[] = []
    const keep = (h: PluginListenerHandle) => {
      if (alive) handles.push(h)
      else void h.remove()
    }
    ;(async () => {
      keep(await LMusic.addListener('state', applyState))
      keep(
        await LMusic.addListener('progress', (p) => {
          setProgress({ positionMs: p.positionMs, durationMs: p.durationMs })
          const id = currentIdRef.current
          if (id !== null && !countedRef.current && p.positionMs >= Math.min(30000, p.durationMs / 2)) {
            countedRef.current = true
            void recordPlayRef.current(id)
          }
        }),
      )
      keep(
        await LMusic.addListener('transition', () => {
          countedRef.current = false
          resetLoopState()
        }),
      )
      keep(await LMusic.addListener('error', (e) => setLastError(e.message)))
      // Si la app se reabre con el servicio aún reproduciendo, recuperar la cola.
      const st = await LMusic.getState()
      if (!alive) return
      applyState(st)
      if (st.queue) setQueueIds(st.queue.map(Number))
      if ((st.positionMs ?? 0) >= 30000) countedRef.current = true
    })().catch((e) => setLastError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
      handles.forEach((h) => void h.remove())
    }
  }, [applyState])

  const playQueue = useCallback(async (tracks: Track[], index = 0, wantShuffle?: boolean) => {
    if (!tracks.length) return
    countedRef.current = false
    if (wantShuffle !== undefined) await LMusic.setShuffle({ enabled: wantShuffle })
    setQueueIds(tracks.map((t) => t.id))
    await LMusic.setQueue({
      tracks: tracks.map((t) => ({
        id: t.id,
        uri: t.uri,
        title: t.title,
        artist: t.artist,
        album: t.album,
      })),
      startIndex: index,
      play: true,
    })
  }, [])

  const moveInQueue = useCallback(async (from: number, to: number) => {
    if (from === to) return
    setQueueIds((ids) => {
      if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids
      const next = ids.slice()
      const [x] = next.splice(from, 1)
      next.splice(to, 0, x)
      return next
    })
    await LMusic.moveQueueItem({ from, to })
  }, [])

  const toggle = useCallback(async () => {
    if (isPlaying) await LMusic.pause()
    else await LMusic.play()
  }, [isPlaying])

  const next = useCallback(() => LMusic.next(), [])
  const previous = useCallback(() => LMusic.previous(), [])

  const seek = useCallback(async (ms: number) => {
    setProgress((p) => ({ ...p, positionMs: ms }))
    await LMusic.seekTo({ positionMs: Math.round(ms) })
  }, [])

  const toggleShuffle = useCallback(async () => {
    await LMusic.setShuffle({ enabled: !shuffle })
  }, [shuffle])

  const cycleRepeat = useCallback(async () => {
    const nextMode = REPEAT_ORDER[(REPEAT_ORDER.indexOf(repeat) + 1) % REPEAT_ORDER.length]
    await LMusic.setRepeat({ mode: nextMode })
  }, [repeat])

  const setSpeed = useCallback(async (v: number) => {
    await LMusic.setSpeed({ speed: v })
  }, [])

  const clearError = useCallback(() => setLastError(null), [])

  const current = currentId !== null ? (byId.get(currentId) ?? null) : null
  const queue = useMemo(
    () => queueIds.map((id) => byId.get(id)).filter((t): t is Track => t !== undefined),
    [queueIds, byId],
  )

  const value = useMemo<PlayerValue>(
    () => ({
      isPlaying,
      current,
      queue,
      shuffle,
      repeat,
      speed,
      lastError,
      playQueue,
      moveInQueue,
      toggle,
      next,
      previous,
      seek,
      toggleShuffle,
      cycleRepeat,
      setSpeed,
      clearError,
    }),
    [
      isPlaying,
      current,
      queue,
      shuffle,
      repeat,
      speed,
      lastError,
      playQueue,
      moveInQueue,
      toggle,
      next,
      previous,
      seek,
      toggleShuffle,
      cycleRepeat,
      setSpeed,
      clearError,
    ],
  )
  return (
    <PlayerCtx.Provider value={value}>
      <ProgressCtx.Provider value={progress}>{children}</ProgressCtx.Provider>
    </PlayerCtx.Provider>
  )
}
