import { hash } from '../utils'

export interface GenreArt {
  hue: number
  glyph: string
}

const ART: [RegExp, GenreArt][] = [
  [/(metal|hard ?rock|punk|hardcore)/, { hue: 2, glyph: '⚡' }],
  [/(rock|alternativ|grunge|indie)/, { hue: 18, glyph: '🎸' }],
  [/(electr|dance|house|techno|edm|trance|dubstep|club)/, { hue: 268, glyph: '🎧' }],
  [/(hip|rap|trap|drill)/, { hue: 44, glyph: '🎤' }],
  [/(reggaet|urban|dembow|latin|salsa|cumbia|merengue|bachata|champeta|vallenat)/, { hue: 8, glyph: '🔥' }],
  [/(pop|k-?pop|disco)/, { hue: 322, glyph: '✨' }],
  [/(r&b|rnb|soul|funk|reggae|ska)/, { hue: 30, glyph: '🎷' }],
  [/(jazz|blues)/, { hue: 215, glyph: '🎷' }],
  [/(clasic|classic|orquest)/, { hue: 48, glyph: '🎻' }],
  [/(ambient|chill|lofi|lo-fi|new age|instrumental)/, { hue: 190, glyph: '🌙' }],
  [/(folk|acoust|country|bolero|balada|ballad)/, { hue: 95, glyph: '🌿' }],
]

/** Imagen por defecto cuando una canción no tiene portada: color y símbolo según el género. */
export function genreArt(genre: string, fallbackSeed: string): GenreArt {
  const g = genre.toLowerCase()
  for (const [re, art] of ART) if (re.test(g)) return art
  return { hue: hash(fallbackSeed) % 360, glyph: '♪' }
}
