import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { AudioInfo } from '../db/db'
import { useClock } from '../visual/clock'
import { usePlayer } from '../state/player'
import { moodFor } from '../visual/mood'

/** Estado compartido del ritmo: lo leen las partículas y lo escribe este componente. */
export const beatState = { pulse: 0, energy: 0.5, bpm: 0, prime: 0 }

interface Props {
  rootRef: RefObject<HTMLElement | null>
  info: AudioInfo | null
  genre: string
  enabled: boolean
}

/**
 * Calcula en cada cuadro cuánto "late" la canción (0 a 1) y lo publica como la variable CSS --beat.
 * Con BPM conocido el latido cae en los pulsos reales; sin él, una respiración suave.
 */
export function BeatDriver({ rootRef, info, genre, enabled }: Props) {
  const clock = useClock()
  const { isPlaying } = usePlayer()
  const playingRef = useRef(isPlaying)
  playingRef.current = isPlaying

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    if (!enabled) {
      el.style.setProperty('--beat', '0')
      beatState.pulse = 0
      return
    }
    const bpm = info?.bpm ?? 0
    const mood = moodFor(genre, bpm)
    // la confianza del análisis baja la fuerza si el ritmo no es claro
    const trust = info && bpm > 0 ? Math.min(1, Math.max(0.35, info.confidence / 3)) : 0.3
    const amp = (0.35 + 0.65 * mood.energy) * trust
    beatState.energy = mood.energy
    beatState.bpm = bpm

    let raf = 0
    let last = 0
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (t - last < 50) return // ~20 cuadros por segundo
      last = t
      let pulse = 0
      if (playingRef.current) {
        const pos = clock()
        if (bpm > 0 && info) {
          const period = 60000 / bpm
          const phase = ((((pos - info.offsetMs) % period) + period) % period) / period
          pulse = Math.exp(-phase * 4.5) * amp
        } else {
          pulse = (0.5 + 0.5 * Math.sin((pos / 1000) * Math.PI)) * 0.3 * amp
        }
      }
      beatState.pulse = pulse
      el.style.setProperty('--beat', pulse.toFixed(3))
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      el.style.setProperty('--beat', '0')
      beatState.pulse = 0
    }
  }, [rootRef, info, genre, enabled, clock])

  return null
}
