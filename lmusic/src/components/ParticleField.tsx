import { useEffect, useRef } from 'react'
import { beatState } from './BeatDriver'
import type { Fx } from '../visual/genreFx'

const W = 360
const H = 640
const rnd = (a: number, b: number) => a + Math.random() * (b - a)

interface Dot {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  a: number
  life: number
  max: number
}
interface Bolt {
  pts: [number, number][]
  branch: [number, number][]
  life: number
}

function makeBolt(): Bolt {
  const pts: [number, number][] = []
  let x = rnd(50, W - 50)
  let y = 0
  const bottom = H * rnd(0.55, 0.95)
  while (y < bottom) {
    pts.push([x, y])
    y += rnd(26, 46)
    x += rnd(-30, 30)
  }
  const at = pts[Math.floor(pts.length * rnd(0.3, 0.7))] ?? [x, y]
  const branch: [number, number][] = [at]
  let bx = at[0]
  let by = at[1]
  for (let i = 0; i < 3; i++) {
    bx += rnd(10, 36) * (Math.random() < 0.5 ? -1 : 1)
    by += rnd(24, 40)
    branch.push([bx, by])
  }
  return { pts, branch, life: 0.28 }
}

/** Imagen suave de humo rojo oscuro; se dibuja estirada, así que cuesta muy poco. */
function makeSmokeSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')
  if (g) {
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64)
    grad.addColorStop(0, 'rgba(170,14,28,0.55)')
    grad.addColorStop(0.5, 'rgba(110,6,18,0.25)')
    grad.addColorStop(1, 'rgba(60,0,8,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
  }
  return c
}

const LASER_COLORS = ['#ff3df0', '#3df0ff', '#b6ff3d', '#ffb13d']

/** Efectos de fondo que reaccionan al ritmo: luces, rayos, láseres, ondas, chispas, estrellas, notas, luciérnagas. */
export function ParticleField({ enabled, tint, effects }: { enabled: boolean; tint: string; effects: Fx[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const key = effects.join(',')

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !enabled) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = W
    canvas.height = H
    const has = (f: Fx) => effects.includes(f)

    const lights: Dot[] = has('lights')
      ? Array.from({ length: 30 }, () => ({
          x: rnd(0, W), y: rnd(0, H), vx: rnd(-6, 6), vy: rnd(10, 30), r: rnd(1.5, 4.5), a: rnd(0.25, 0.8), life: 0, max: 0,
        }))
      : []
    const stars = has('stars')
      ? Array.from({ length: 22 }, () => ({ x: rnd(10, W - 10), y: rnd(10, H - 10), r: rnd(3, 8), ph: rnd(0, 6.28), sp: rnd(1, 3) }))
      : []
    const flies = has('fireflies')
      ? Array.from({ length: 20 }, () => ({ x: rnd(0, W), y: rnd(0, H), ph: rnd(0, 6.28), sp: rnd(0.3, 0.9), r: rnd(1.5, 3) }))
      : []
    const flakes = has('snow')
      ? Array.from({ length: 40 }, () => ({ x: rnd(0, W), y: rnd(0, H), vy: rnd(18, 48), r: rnd(1.2, 3.2), sw: rnd(0, 6.28) }))
      : []
    const smokeSprite = has('bloodsmoke') ? makeSmokeSprite() : null
    const smoke = smokeSprite
      ? Array.from({ length: 7 }, () => ({ x: rnd(0, W), y: rnd(H * 0.4, H), r: rnd(90, 150), vy: rnd(8, 18), vx: rnd(-6, 6), a: rnd(0.25, 0.5), ph: rnd(0, 6.28) }))
      : []
    const notes: (Dot & { ch: string; sw: number })[] = []
    let sparks: Dot[] = []
    let bolts: Bolt[] = []
    let rings: { life: number }[] = []
    let flash = 0
    let prevPulse = 0
    let spawnAcc = 0
    let noteAcc = 0

    const onBeat = () => {
      const e = beatState.energy
      if (has('lightning') && Math.random() < 0.35 + e * 0.65 + beatState.prime * 0.4) {
        bolts.push(makeBolt())
        flash = 0.2
      }
      if (has('rings')) rings.push({ life: 0 })
      if (has('sparks')) {
        for (let i = 0; i < 10; i++) {
          sparks.push({ x: rnd(0, W), y: H, vx: rnd(-30, 30), vy: rnd(90, 220), r: rnd(1.5, 3.2), a: 1, life: 0, max: rnd(0.8, 1.6) })
        }
      }
      if (has('notes') && notes.length < 14) {
        notes.push({ x: rnd(20, W - 20), y: H + 10, vx: 0, vy: rnd(24, 48), r: rnd(18, 30), a: 0.5, life: 0, max: 0, ch: Math.random() < 0.5 ? '♪' : '♫', sw: rnd(0, 6.28) })
      }
    }

    let raf = 0
    let last = 0
    let clock = 0
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (t - last < 33) return
      const dt = Math.min(0.1, (t - last) / 1000)
      last = t
      clock += dt
      const pulse = beatState.pulse
      const energy = beatState.energy
      if (pulse > 0.55 && prevPulse <= 0.55) onBeat()
      prevPulse = pulse

      ctx.clearRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'lighter'

      // humo de sangre
      if (smokeSprite) {
        ctx.globalCompositeOperation = 'source-over'
        for (const s of smoke) {
          s.y -= s.vy * (0.6 + energy * 1.2 + pulse * 1.5) * dt
          s.x += (s.vx + Math.sin(clock * 0.4 + s.ph) * 8) * dt
          if (s.y < -s.r) {
            s.y = H + s.r
            s.x = rnd(0, W)
          }
          ctx.globalAlpha = Math.min(0.8, s.a * (0.7 + pulse * 0.8))
          const d = s.r * 2 * (1 + pulse * 0.15)
          ctx.drawImage(smokeSprite, s.x - d / 2, s.y - d / 2, d, d)
        }
        ctx.globalCompositeOperation = 'lighter'
      }

      // luces que suben
      if (lights.length) {
        const speed = 0.6 + energy * 1.4 + pulse * 1.6
        ctx.fillStyle = tint
        for (const p of lights) {
          p.y -= p.vy * speed * dt
          p.x += p.vx * dt
          if (p.y < -10) {
            p.y = H + 10
            p.x = rnd(0, W)
          }
          ctx.globalAlpha = Math.min(1, p.a * (0.55 + pulse * 0.9))
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r * (1 + pulse * 0.7), 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // nieve
      if (flakes.length) {
        ctx.fillStyle = '#e8f6ff'
        for (const f of flakes) {
          f.y += f.vy * dt * (0.6 + energy)
          f.x += Math.sin(clock * 0.9 + f.sw) * 14 * dt
          if (f.y > H + 6) {
            f.y = -6
            f.x = rnd(0, W)
          }
          ctx.globalAlpha = 0.55 + pulse * 0.4
          ctx.beginPath()
          ctx.arc(f.x, f.y, f.r * (1 + pulse * 0.5), 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // chispas de fuego
      if (has('sparks')) {
        spawnAcc += dt * (4 + energy * 16) * (1 + beatState.prime * 1.5)
        while (spawnAcc >= 1) {
          spawnAcc -= 1
          sparks.push({ x: rnd(0, W), y: H, vx: rnd(-20, 20), vy: rnd(60, 150), r: rnd(1, 2.4), a: 1, life: 0, max: rnd(1, 2) })
        }
        sparks = sparks.filter((p) => (p.life += dt) < p.max)
        for (const p of sparks) {
          p.y -= p.vy * dt
          p.x += p.vx * dt + Math.sin(p.life * 8 + p.x) * 0.4
          const k = 1 - p.life / p.max
          ctx.globalAlpha = k
          ctx.fillStyle = k > 0.55 ? '#ffd24a' : '#ff6a1f'
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r * (0.6 + k), 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // estrellas
      if (stars.length) {
        ctx.fillStyle = '#ffffff'
        for (const s of stars) {
          const tw = 0.5 + 0.5 * Math.sin(clock * s.sp + s.ph)
          const r = s.r * (0.5 + tw * 0.6) * (1 + pulse * 0.9)
          ctx.globalAlpha = 0.25 + tw * 0.55
          ctx.beginPath()
          for (let i = 0; i < 8; i++) {
            const ang = (i * Math.PI) / 4
            const rr = i % 2 === 0 ? r : r * 0.28
            const px = s.x + Math.cos(ang) * rr
            const py = s.y + Math.sin(ang) * rr
            if (i === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          }
          ctx.closePath()
          ctx.fill()
        }
      }

      // luciérnagas
      if (flies.length) {
        ctx.fillStyle = tint
        for (const f of flies) {
          f.x += Math.cos(f.ph + clock * f.sp) * 14 * dt
          f.y += Math.sin(f.ph * 1.7 + clock * f.sp * 0.8) * 14 * dt
          const tw = 0.4 + 0.6 * Math.abs(Math.sin(clock * f.sp * 1.6 + f.ph))
          ctx.globalAlpha = 0.14 * tw
          ctx.beginPath()
          ctx.arc(f.x, f.y, f.r * 4 * (1 + pulse * 0.5), 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 0.85 * tw
          ctx.beginPath()
          ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // notas musicales
      if (has('notes')) {
        noteAcc += dt
        if (noteAcc > 1.6 && notes.length < 14) {
          noteAcc = 0
          notes.push({ x: rnd(20, W - 20), y: H + 10, vx: 0, vy: rnd(18, 38), r: rnd(18, 30), a: 0.45, life: 0, max: 0, ch: Math.random() < 0.5 ? '♪' : '♫', sw: rnd(0, 6.28) })
        }
        ctx.fillStyle = tint
        for (let i = notes.length - 1; i >= 0; i--) {
          const n = notes[i]
          n.y -= n.vy * (0.7 + energy) * dt
          if (n.y < -30) {
            notes.splice(i, 1)
            continue
          }
          ctx.globalAlpha = Math.min(0.7, n.a * (0.7 + pulse * 0.8))
          ctx.font = `${Math.round(n.r * (1 + pulse * 0.25))}px sans-serif`
          ctx.fillText(n.ch, n.x + Math.sin(clock * 1.3 + n.sw) * 14, n.y)
        }
      }

      // ondas
      if (rings.length) {
        rings = rings.filter((r) => (r.life += dt) < 1.1)
        ctx.strokeStyle = tint
        for (const r of rings) {
          const k = r.life / 1.1
          ctx.globalAlpha = (1 - k) * 0.7
          ctx.lineWidth = 3 + (1 - k) * 3
          ctx.beginPath()
          ctx.arc(W / 2, H * 0.4, 30 + k * 280, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // láseres
      if (has('lasers')) {
        const a = 0.18 + pulse * 0.6
        for (let i = 0; i < 4; i++) {
          const fromLeft = i % 2 === 0
          const ox = fromLeft ? 0 : W
          const base = fromLeft ? 0.5 : Math.PI - 0.5
          const ang = base + Math.sin(clock * (0.7 + energy) + i * 1.7) * 0.55 * (fromLeft ? 1 : -1)
          const dx = Math.cos(ang) * 900
          const dy = Math.sin(ang) * 900
          const color = i === 0 ? tint : LASER_COLORS[i % LASER_COLORS.length]
          ctx.strokeStyle = color
          ctx.globalAlpha = a * 0.35
          ctx.lineWidth = 9
          ctx.beginPath()
          ctx.moveTo(ox, -10)
          ctx.lineTo(ox + dx, -10 + dy)
          ctx.stroke()
          ctx.globalAlpha = a
          ctx.lineWidth = 2.2
          ctx.beginPath()
          ctx.moveTo(ox, -10)
          ctx.lineTo(ox + dx, -10 + dy)
          ctx.stroke()
        }
      }

      // rayos
      if (bolts.length) {
        bolts = bolts.filter((b) => (b.life -= dt) > 0)
        ctx.lineJoin = 'round'
        for (const b of bolts) {
          const k = Math.min(1, b.life / 0.28)
          for (const [path, w] of [[b.pts, 1] as const, [b.branch, 0.6] as const]) {
            ctx.beginPath()
            path.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
            ctx.strokeStyle = tint
            ctx.globalAlpha = k * 0.35
            ctx.lineWidth = 9 * w
            ctx.stroke()
            ctx.strokeStyle = '#eaf2ff'
            ctx.globalAlpha = k
            ctx.lineWidth = 2.4 * w
            ctx.stroke()
          }
        }
      }
      if (flash > 0.01) {
        ctx.globalAlpha = 1
        ctx.fillStyle = `rgba(220,230,255,${flash.toFixed(3)})`
        ctx.fillRect(0, 0, W, H)
        flash *= 0.82
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tint, key])

  if (!enabled) return null
  return <canvas ref={ref} className="now-particles" aria-hidden="true" />
}
