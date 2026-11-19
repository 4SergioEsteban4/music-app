import { useSyncExternalStore } from 'react'
import type { Track } from '../types'
import { findHighlights } from './highlight'
import { addPrime } from './prime'
import { showToast } from '../state/toast'
import { fmtTime } from '../utils'

export interface HlJob {
  status: 'running' | 'done' | 'error'
  message: string
}

const jobs = new Map<number, HlJob>()
const subs = new Set<() => void>()
const set = (id: number, j: HlJob) => {
  jobs.set(id, j)
  subs.forEach((fn) => fn())
}

/** Busca los momentos más intensos en segundo plano: se puede cerrar la hoja y seguir usando la app. */
export function startHighlightJob(track: Track, count = 3): void {
  if (jobs.get(track.id)?.status === 'running') return
  set(track.id, { status: 'running', message: 'Escuchando la canción para encontrar sus momentos más intensos…' })
  void (async () => {
    try {
      const hs = await findHighlights(track, count)
      if (!hs.length) {
        const m = `No encontré momentos claros en «${track.title}».`
        set(track.id, { status: 'error', message: m })
        showToast(m)
        return
      }
      for (let i = 0; i < hs.length; i++) await addPrime(track.id, hs[i].startMs, hs[i].endMs, i === 0 ? 5 : 4)
      const m = `Listo: ${hs.length} momentos intensos en «${track.title}» (${hs.map((h) => fmtTime(h.startMs)).join(', ')}).`
      set(track.id, { status: 'done', message: m })
      showToast(m)
    } catch (e) {
      const m = e instanceof Error ? e.message : 'No se pudo analizar la canción.'
      set(track.id, { status: 'error', message: m })
      showToast(m)
    }
  })()
}

export function useHighlightJob(trackId: number): HlJob | undefined {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    () => jobs.get(trackId),
  )
}
