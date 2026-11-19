import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'
import type { Track } from '../types'
import { LMusic } from './lmusic'

/** Portadas reales: las extrae Android del propio mp3 (o de MediaStore) y las guarda en caché. */

const cache = new Map<string, string | null>()

interface Job {
  cancelled: boolean
  run: () => Promise<void>
}
const queue: Job[] = []
let active = 0
const MAX_PARALLEL = 2

function pump(): void {
  while (active < MAX_PARALLEL && queue.length) {
    // LIFO: lo último que pidió la pantalla es lo que el usuario está viendo ahora
    const job = queue.pop() as Job
    if (job.cancelled) continue
    active++
    void job.run()
  }
}

function loadCover(track: Track, size: number): { promise: Promise<string | null>; cancel: () => void } {
  const key = `${track.id}_${size}`
  if (cache.has(key)) return { promise: Promise.resolve(cache.get(key) ?? null), cancel: () => {} }
  const holder: { job: Job | null } = { job: null }
  const promise = new Promise<string | null>((resolve) => {
    const job: Job = {
      cancelled: false,
      run: async () => {
        try {
          const r = await LMusic.getCover({ id: track.id, uri: track.uri, size })
          const url = r.path ? Capacitor.convertFileSrc('file://' + r.path) : null
          cache.set(key, url)
          resolve(url)
        } catch {
          resolve(null)
        } finally {
          active--
          pump()
        }
      },
    }
    holder.job = job
    queue.push(job)
    pump()
  })
  return {
    promise,
    cancel: () => {
      if (holder.job) holder.job.cancelled = true
    },
  }
}

/** Olvida lo que se sabe de la portada de una canción (tras descargar una nueva). */
export function invalidateCover(trackId: number): void {
  for (const k of [...cache.keys()]) if (k.startsWith(`${trackId}_`)) cache.delete(k)
  coverVersion++
  for (const fn of listeners) fn()
}

let coverVersion = 0
const listeners = new Set<() => void>()

/** URL de la portada del tamaño pedido (160 listas, 720 reproductor, 2048 original), o null. */
export function useCover(track: Track | null, size: number): string | null {
  const key = track ? `${track.id}_${size}` : ''
  const [state, setState] = useState<{ key: string; url: string | null }>({ key: '', url: null })
  const [version, setVersion] = useState(coverVersion)
  const id = track?.id
  const uri = track?.uri

  useEffect(() => {
    const fn = () => setVersion(coverVersion)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])

  useEffect(() => {
    if (id === undefined || uri === undefined) return
    const req = loadCover({ id, uri } as Track, size)
    let alive = true
    void req.promise.then((url) => {
      if (alive) setState({ key: `${id}_${size}`, url })
    })
    return () => {
      alive = false
      req.cancel()
    }
  }, [id, uri, size, version])

  return state.key === key ? state.url : null
}

/* ---------- color dominante de la portada ---------- */

const colorCache = new Map<string, string>()

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return [h, s, l]
}

async function dominantColor(url: string): Promise<string | null> {
  const cached = colorCache.get(url)
  if (cached) return cached
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, 32, 32)
    const data = ctx.getImageData(0, 0, 32, 32).data
    const buckets = Array.from({ length: 12 }, () => ({ w: 0, h: 0, s: 0 }))
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
      if (l < 0.12 || l > 0.92) continue
      const w = s * (1 - Math.abs(2 * l - 1)) + 0.02
      const b = buckets[Math.min(11, Math.floor(h / 30))]
      b.w += w
      b.h += h * w
      b.s += s * w
    }
    const best = buckets.reduce((a, b) => (b.w > a.w ? b : a))
    if (best.w === 0) return null
    const h = Math.round(best.h / best.w)
    const s = Math.round(Math.max(40, Math.min(85, (best.s / best.w) * 100)))
    const color = `hsl(${h} ${s}% 60%)`
    colorCache.set(url, color)
    return color
  } catch {
    return null
  }
}

export function useCoverColor(url: string | null): string | null {
  const [state, setState] = useState<{ url: string | null; color: string | null }>({ url: null, color: null })
  useEffect(() => {
    if (!url) return
    let alive = true
    void dominantColor(url).then((color) => {
      if (alive) setState({ url, color })
    })
    return () => {
      alive = false
    }
  }, [url])
  return url && state.url === url ? state.color : null
}
