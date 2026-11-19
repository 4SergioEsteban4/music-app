export interface Mood {
  /** 0 = tranquilo, 1 = muy intenso: escala los pulsos y la velocidad de las partículas */
  energy: number
}

const GENRE_ENERGY: [RegExp, number][] = [
  [/(metal|hard ?rock|punk|hardcore|thrash)/, 0.95],
  [/(electr|dance|house|techno|edm|trance|dubstep|drum|club)/, 0.95],
  [/(rock|alternativ|grunge|indie)/, 0.8],
  [/(hip|rap|trap|drill)/, 0.8],
  [/(reggaet|urban|dembow|latin|salsa|cumbia|merengue|bachata|champeta|vallenat)/, 0.85],
  [/(pop|k-?pop|disco)/, 0.7],
  [/(r&b|rnb|soul|funk|reggae|ska)/, 0.6],
  [/(jazz|blues|clasic|classic|ambient|instrumental|folk|acoust|bolero|balada|ballad|lofi|lo-fi|chill|new age)/, 0.3],
]

/** Intensidad según el género (si se conoce) y el tempo. */
export function moodFor(genre: string, bpm: number): Mood {
  const g = genre.toLowerCase()
  let fromGenre: number | null = null
  for (const [re, e] of GENRE_ENERGY) {
    if (re.test(g)) {
      fromGenre = e
      break
    }
  }
  const fromBpm = bpm > 0 ? Math.min(1, Math.max(0.2, (bpm - 60) / 110)) : null
  if (fromGenre !== null && fromBpm !== null) return { energy: fromGenre * 0.6 + fromBpm * 0.4 }
  return { energy: fromGenre ?? fromBpm ?? 0.55 }
}
