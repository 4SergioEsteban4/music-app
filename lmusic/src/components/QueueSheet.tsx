import { useEffect, useRef, useState } from 'react'
import { usePlayer } from '../state/player'
import { Cover } from './Cover'
import { artistOf } from '../utils'

const WINDOW = 150
const ROW = 56 // alto de cada fila (igual que en el CSS)

/** Cola de reproducción. Mantén pulsada una canción para levantarla y arrastrarla a otro lugar. */
export function QueueSheet({ onClose }: { onClose: () => void }) {
  const { queue, current, playQueue, moveInQueue } = usePlayer()
  const curRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const [grab, setGrab] = useState<{ from: number; to: number } | null>(null)
  const grabRef = useRef<{ from: number; to: number; startY: number } | null>(null)
  const pending = useRef<{ i: number; y: number } | null>(null)
  const timer = useRef(0)
  const skipClick = useRef(false)

  const curIdx = queue.findIndex((t) => t.id === current?.id)
  const start = Math.max(0, curIdx - 10)
  const shown = queue.slice(start, start + WINDOW)
  const startRef = useRef(start)
  startRef.current = start
  const lenRef = useRef(shown.length)
  lenRef.current = shown.length
  const moveRef = useRef(moveInQueue)
  moveRef.current = moveInQueue

  useEffect(() => {
    curRef.current?.scrollIntoView({ block: 'center' })
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const clear = () => {
      window.clearTimeout(timer.current)
      pending.current = null
    }
    const move = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0
      const g = grabRef.current
      if (g) {
        e.preventDefault() // mientras se arrastra, la lista no se desplaza
        const to = Math.max(0, Math.min(lenRef.current - 1, g.from + Math.round((y - g.startY) / ROW)))
        if (to !== g.to) {
          g.to = to
          setGrab({ from: g.from, to })
        }
        const sh = sheetRef.current
        if (sh) {
          const r = sh.getBoundingClientRect()
          if (y < r.top + 70) sh.scrollTop -= 10
          else if (y > r.bottom - 70) sh.scrollTop += 10
        }
      } else if (pending.current && Math.abs(y - pending.current.y) > 10) {
        clear()
      }
    }
    const end = () => {
      clear()
      const g = grabRef.current
      grabRef.current = null
      if (!g) return
      skipClick.current = true
      window.setTimeout(() => {
        skipClick.current = false
      }, 300)
      setGrab(null)
      if (g.to !== g.from) void moveRef.current(startRef.current + g.from, startRef.current + g.to)
    }
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      window.clearTimeout(timer.current)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [])

  const order = shown.map((_, k) => k)
  if (grab) {
    const [m] = order.splice(grab.from, 1)
    order.splice(grab.to, 0, m)
  }

  return (
    <div className="sheet-backdrop top" onClick={onClose}>
      <div className="sheet" ref={sheetRef} onClick={(e) => e.stopPropagation()}>
        <h2>Cola de reproducción</h2>
        <p className="muted">
          {queue.length ? `${queue.length} canciones. Mantén pulsada una para moverla.` : 'La cola está vacía.'}
        </p>
        <div ref={listRef}>
          {order.map((k) => {
            const t = shown[k]
            const i = start + k
            const on = i === curIdx
            return (
              <div
                key={`${t.id}-${k}`}
                ref={on ? curRef : undefined}
                role="button"
                tabIndex={0}
                className={`queue-row${on ? ' on' : ''}${grab && grab.from === k ? ' grabbed' : ''}`}
                onTouchStart={(e) => {
                  const y = e.touches[0].clientY
                  pending.current = { i: k, y }
                  window.clearTimeout(timer.current)
                  timer.current = window.setTimeout(() => {
                    if (!pending.current) return
                    grabRef.current = { from: k, to: k, startY: pending.current.y }
                    setGrab({ from: k, to: k })
                    navigator.vibrate?.(15)
                  }, 400)
                }}
                onClick={() => {
                  if (skipClick.current) return
                  void playQueue(queue, i)
                }}
              >
                <Cover track={t} size={40} />
                <span className="row-text">
                  <span className="row-title">{t.title}</span>
                  <span className="row-sub">{artistOf(t)}</span>
                </span>
                <span className="queue-n">{on ? '▶' : i + 1}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
