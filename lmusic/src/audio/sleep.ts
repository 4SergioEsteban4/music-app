import { useSyncExternalStore } from 'react'
import type { PluginListenerHandle } from '@capacitor/core'
import { LMusic } from '../native/lmusic'

export type SleepState = { kind: 'time'; at: number } | { kind: 'track' } | null

let state: SleepState = null
let timer = 0
let gen = 0
let handles: PluginListenerHandle[] = []
const subs = new Set<() => void>()
const notify = () => subs.forEach((fn) => fn())

function disarm() {
  gen++
  window.clearTimeout(timer)
  timer = 0
  for (const h of handles) void h.remove()
  handles = []
}

function finish() {
  disarm()
  state = null
  void LMusic.pause().catch(() => {})
  notify()
}

function keep(g: number, p: Promise<PluginListenerHandle>) {
  void p.then((h) => {
    if (g === gen && state) handles.push(h)
    else void h.remove()
  })
}

function arm() {
  disarm()
  if (!state) return
  const g = gen
  if (state.kind === 'time') timer = window.setTimeout(finish, Math.max(0, state.at - Date.now()))
  // los avisos del reproductor siguen llegando aunque el temporizador de la página se retrase
  keep(
    g,
    LMusic.addListener('progress', (p) => {
      if (!state) return
      if (state.kind === 'time' && Date.now() >= state.at) finish()
      else if (state.kind === 'track' && p.durationMs > 0 && p.durationMs - p.positionMs < 700) finish()
    }),
  )
  if (state.kind === 'track') keep(g, LMusic.addListener('transition', () => finish()))
}

export function startSleepMinutes(min: number): void {
  state = { kind: 'time', at: Date.now() + min * 60000 }
  arm()
  notify()
}

export function startSleepTrackEnd(): void {
  state = { kind: 'track' }
  arm()
  notify()
}

export function cancelSleep(): void {
  if (!state) return
  disarm()
  state = null
  notify()
}

export function useSleep(): SleepState {
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
