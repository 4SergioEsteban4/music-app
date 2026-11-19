import { useSyncExternalStore } from 'react'

export interface ToastMsg {
  id: number
  text: string
}

let current: ToastMsg | null = null
let timer = 0
const subs = new Set<() => void>()
const notify = () => subs.forEach((fn) => fn())

/** Aviso corto que se ve en cualquier pantalla (por ejemplo, cuando termina algo que corría de fondo). */
export function showToast(text: string, ms = 4000): void {
  current = { id: Date.now(), text }
  notify()
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    current = null
    notify()
  }, ms)
}

export function useToast(): ToastMsg | null {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    () => current,
  )
}
