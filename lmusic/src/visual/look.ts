import { moodFor } from './mood'
import { effectsFor } from './genreFx'
import type { Fx } from './genreFx'

export interface LookSettings {
  lyricStyle: string
  lyricFont: string
  lyricAnim: string
  lyricFx: string
  fx: string
  /** modo ahorro de RAM: 0 apagado, 1 suave, 2 medio, 3 máximo */
  saver: number
}

export interface Look {
  style: string
  font: string
  anim: string
  lyricFx: string
  fx: Fx[]
}

type Auto = Pick<Look, 'style' | 'font' | 'anim' | 'lyricFx'>

const BY_GENRE: [RegExp, Auto][] = [
  [/(metal)/, { style: 'epic', font: 'metal', anim: 'stamp', lyricFx: 'blood' }],
  [/(hard ?rock|punk|hardcore)/, { style: 'epic', font: 'bebas', anim: 'stamp', lyricFx: 'electric' }],
  [/(rock|alternativ|grunge|indie)/, { style: 'cinema', font: 'bebas', anim: 'glitch', lyricFx: 'electric' }],
  [/(electr|dance|house|techno|edm|trance|dubstep|club)/, { style: 'epic', font: 'orbitron', anim: 'flicker', lyricFx: 'neon' }],
  [/(hip|rap|trap|drill)/, { style: 'cinema', font: 'marker', anim: 'stamp', lyricFx: 'gold' }],
  [/(reggaet|urban|dembow|latin|salsa|cumbia|merengue|bachata|champeta|vallenat)/, { style: 'karaoke', font: 'bebas', anim: 'bounce', lyricFx: 'fire' }],
  [/(pop|k-?pop|disco)/, { style: 'karaoke', font: 'system', anim: 'rise', lyricFx: 'neon' }],
  [/(r&b|rnb|soul|funk|reggae|ska)/, { style: 'classic', font: 'pacifico', anim: 'slide', lyricFx: 'gold' }],
  [/(jazz|blues)/, { style: 'classic', font: 'typewriter', anim: 'fade', lyricFx: 'gold' }],
  [/(clasic|classic|orquest)/, { style: 'cinema', font: 'cinzel', anim: 'fade', lyricFx: 'gold' }],
  [/(ambient|chill|lofi|lo-fi|new age)/, { style: 'classic', font: 'system', anim: 'fade', lyricFx: 'ice' }],
  [/(folk|acoust|country|bolero|balada|ballad)/, { style: 'classic', font: 'pacifico', anim: 'fade', lyricFx: 'none' }],
]

function autoFor(genre: string, bpm: number): Auto {
  const g = genre.toLowerCase()
  for (const [re, a] of BY_GENRE) if (re.test(g)) return a
  const e = moodFor(genre, bpm).energy
  if (e > 0.8) return { style: 'cinema', font: 'bebas', anim: 'zoom', lyricFx: 'electric' }
  if (e > 0.6) return { style: 'karaoke', font: 'system', anim: 'rise', lyricFx: 'neon' }
  return { style: 'classic', font: 'system', anim: 'fade', lyricFx: 'none' }
}

const HEAVY_FX: Fx[] = ['bloodsmoke', 'lasers', 'lightning']
const MID_FX: Fx[] = ['lights', 'rings', 'sparks']
const HEAVY_LYRIC = ['fire', 'neon', 'glitch', 'blood']
const MID_LYRIC = ['ice', 'gold']
const HEAVY_ANIM = ['glitch', 'flicker']
const HEAVY_ALBUM = ['rainbow', 'glitch', 'shock']

/** Efecto de la letra permitido según el nivel de ahorro (lo más pesado se bloquea primero). */
export function saverLyricFx(fx: string, saver: number): string {
  if (saver <= 0) return fx
  if (saver >= 3) return 'none'
  if (HEAVY_LYRIC.includes(fx)) return 'none'
  if (saver >= 2 && MID_LYRIC.includes(fx)) return 'none'
  return fx
}

/** Efecto de la portada permitido según el nivel de ahorro; si no se permite, se usa `fallback`. */
export function saverAlbum(fx: string, saver: number, fallback: string): string {
  if (fx === 'none' || saver <= 0) return fx
  if (saver >= 3) return fallback
  if (HEAVY_ALBUM.includes(fx)) return fallback
  if (saver >= 2 && fx !== 'pulse' && fx !== 'bounce') return fallback
  return fx
}

/** Combina lo que eligió el usuario con lo automático (según género y ritmo) y aplica el modo ahorro de RAM. */
export function resolveLook(s: LookSettings, genre: string, bpm: number): Look {
  const a = autoFor(genre, bpm)
  const saver = s.saver
  let anim = s.lyricAnim === 'auto' ? a.anim : s.lyricAnim
  if (saver >= 3) anim = 'none'
  else if (saver >= 2 && HEAVY_ANIM.includes(anim)) anim = 'fade'
  let fx = effectsFor(s.fx, genre, bpm)
  if (saver >= 3) fx = []
  else {
    if (saver >= 1) fx = fx.filter((f) => !HEAVY_FX.includes(f))
    if (saver >= 2) fx = fx.filter((f) => !MID_FX.includes(f))
  }
  return {
    style: s.lyricStyle === 'auto' ? a.style : s.lyricStyle,
    font: s.lyricFont === 'auto' ? a.font : s.lyricFont,
    anim,
    lyricFx: saverLyricFx(s.lyricFx === 'auto' ? a.lyricFx : s.lyricFx, saver),
    fx,
  }
}
