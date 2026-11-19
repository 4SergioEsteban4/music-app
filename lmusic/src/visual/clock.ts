import { useRef } from 'react'
import { usePlayer, useProgress } from '../state/player'

/**
 * Posición de reproducción "suave": el reproductor avisa 5 veces por segundo,
 * y entre aviso y aviso se interpola con el reloj para animar a 30-60 cuadros.
 */
export function useClock(): () => number {
  const { positionMs } = useProgress()
  const { isPlaying, speed } = usePlayer()
  const sync = useRef({ pos: 0, t: 0, playing: false, speed: 1 })
  sync.current = { pos: positionMs, t: performance.now(), playing: isPlaying, speed }
  const getRef = useRef(() => {
    const s = sync.current
    return s.playing ? s.pos + (performance.now() - s.t) * s.speed : s.pos
  })
  return getRef.current
}
