import { useSyncExternalStore } from 'react'
import { LMusic } from '../native/lmusic'

export interface LoopState {
  start: number
  end: number
  kind: 'ab' | 'line'
}

let state: LoopState | null = null
const subs = new Set<() => void>()
const notify = () => subs.forEach((fn) => fn())

/** Repite un tramo de la canción actual (el bucle lo ejecuta Android, así no se pierde con la pantalla apagada). */
export function startLoop(start: number, end: number, kind: LoopState['kind']): void {
  state = { start, end, kind }
  void LMusic.setLoop({ startMs: Math.round(start), endMs: Math.round(end) }).catch(() => {})
  notify()
}

export function stopLoop(): void {
  if (!state) return
  state = null
  void LMusic.clearLoop().catch(() => {})
  notify()
}

/** Para cuando Android ya apagó el bucle por su cuenta (cambio de canción). */
export function resetLoopState(): void {
  if (!state) return
  state = null
  notify()
}

export function useLoop(): LoopState | null {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    () => state,
  )
}
