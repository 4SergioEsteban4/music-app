import { useSyncExternalStore } from 'react'

let on = false
const subs = new Set<() => void>()

export function setStar(v: boolean): void {
  if (on === v) return
  on = v
  subs.forEach((fn) => fn())
}

export function toggleStar(): void {
  setStar(!on)
}

/** ¿Está encendido el Star mode "al instante" (el que se activa tocando la estrella)? */
export function useStar(): boolean {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    () => on,
  )
}
