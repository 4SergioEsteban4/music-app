import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { PrimeMoment } from '../audio/prime'
import { useClock } from '../visual/clock'
import { usePlayer } from '../state/player'
import { beatState } from './BeatDriver'

interface Props {
  rootRef: RefObject<HTMLElement | null>
  moments: PrimeMoment[]
  enabled: boolean
  /** Star mode encendido al instante (se activó tocando la estrella) */
  force: boolean
  /** efecto de la letra mientras dura el Star mode (ya resuelto) */
  lyricFx: string
  /** efecto de la portada (ya resuelto) */
  album: string
}

/**
 * Detecta cuándo la canción entra en un momento Star (o cuándo se encendió a mano) y publica --prime (0 a 1, con subida
 * y bajada suaves), --pi (intensidad por estrellas), --wob y --hue. Los efectos los dibuja el CSS a partir de eso.
 */
export function PrimeDriver({ rootRef, moments, enabled, force, lyricFx, album }: Props) {
  const clock = useClock()
  const { isPlaying } = usePlayer()
  const playing = useRef(isPlaying)
  playing.current = isPlaying
  const forceRef = useRef(force)
  forceRef.current = force

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const reset = () => {
      el.style.setProperty('--prime', '0')
      el.classList.remove('prime-on', `pfx-${lyricFx}`, `pal-${album}`)
      beatState.prime = 0
    }
    if (!enabled) {
      reset()
      return
    }
    let raf = 0
    let last = 0
    let p = 0
    let pi = 0.6
    const t0 = performance.now()
    el.classList.add(`pal-${album}`)
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (t - last < 50) return
      last = t
      const m = playing.current ? moments.find((x) => {
        const pos = clock()
        return pos >= x.startMs && pos < x.endMs
      }) : undefined
      const forced = playing.current && forceRef.current
      const active = !!m || forced
      if (!active && p === 0) return // en reposo no se escribe nada
      if (m) pi = m.stars / 5
      else if (forced) pi = 0.85
      p += ((active ? 1 : 0) - p) * 0.14
      if (p < 0.01) p = 0
      const on = p > 0.02
      if (on !== el.classList.contains('prime-on')) {
        el.classList.toggle('prime-on', on)
        el.classList.toggle(`pfx-${lyricFx}`, on)
      }
      const sec = (t - t0) / 1000
      el.style.setProperty('--prime', p.toFixed(3))
      el.style.setProperty('--pi', pi.toFixed(2))
      el.style.setProperty('--wob', Math.sin(sec * (6 + pi * 6)).toFixed(3))
      el.style.setProperty('--hue', String(Math.round((sec * (40 + pi * 120)) % 360)))
      beatState.prime = p * pi
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      reset()
    }
  }, [rootRef, moments, enabled, lyricFx, album, clock])

  return null
}
