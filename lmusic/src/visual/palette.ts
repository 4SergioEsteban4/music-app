/** Paleta completa a partir del color de la canción (matiz y saturación de la portada). */

export function parseHsl(c: string | null): { h: number; s: number; l: number } | null {
  if (!c) return null
  const m = c.match(/hsl\(\s*([\d.]+)[ ,]+([\d.]+)%[ ,]+([\d.]+)%/i)
  return m ? { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) } : null
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))]
}

export function inkFor(hex: string): string {
  const m = hex.replace('#', '')
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#14110c' : '#ffffff'
}

/** Variables CSS de toda la app, tintadas con el color de la canción. */
export function songPalette(h: number, s: number): Record<string, string> {
  const sat = Math.max(45, Math.min(90, s))
  const [r, g, b] = hslToRgb(h, 32, 8)
  return {
    '--bg': `hsl(${h} 32% 8%)`,
    '--bg-rgb': `${r}, ${g}, ${b}`,
    '--panel': `hsl(${h} 28% 12%)`,
    '--raise': `hsl(${h} 26% 17%)`,
    '--line': `hsl(${h} 24% 25%)`,
    '--text': `hsl(${h} 30% 95%)`,
    '--muted': `hsl(${h} 14% 68%)`,
    '--accent': `hsl(${h} ${sat}% 62%)`,
    '--accent-ink': `hsl(${h} 60% 9%)`,
    '--good': `hsl(${(h + 160) % 360} 65% 70%)`,
  }
}
