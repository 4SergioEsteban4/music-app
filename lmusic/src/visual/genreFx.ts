import { moodFor } from './mood'

export type Fx = 'lights' | 'lightning' | 'lasers' | 'rings' | 'sparks' | 'stars' | 'notes' | 'fireflies' | 'snow' | 'bloodsmoke'

export const FX_CHOICES: { id: string; name: string }[] = [
  { id: 'none', name: 'Ninguno' },
  { id: 'auto', name: 'Automático (según el género)' },
  { id: 'bloodsmoke', name: 'Humo de sangre' },
  { id: 'lightning', name: 'Rayos' },
  { id: 'snow', name: 'Nieve' },
  { id: 'lasers', name: 'Láseres' },
  { id: 'rings', name: 'Ondas' },
  { id: 'sparks', name: 'Chispas de fuego' },
  { id: 'stars', name: 'Estrellas' },
  { id: 'notes', name: 'Notas musicales' },
  { id: 'fireflies', name: 'Luciérnagas' },
  { id: 'lights', name: 'Luces' },
]

const BY_GENRE: [RegExp, Fx[]][] = [
  [/(metal)/, ['lightning', 'bloodsmoke']],
  [/(hard ?rock|punk|hardcore)/, ['lightning', 'sparks']],
  [/(rock|alternativ|grunge|indie)/, ['lightning', 'lights']],
  [/(electr|dance|house|techno|edm|trance|dubstep|club)/, ['lasers', 'rings']],
  [/(hip|rap|trap|drill)/, ['rings', 'lights']],
  [/(reggaet|urban|dembow|latin|salsa|cumbia|merengue|bachata|champeta|vallenat)/, ['sparks', 'stars']],
  [/(pop|k-?pop|disco)/, ['stars', 'lights']],
  [/(r&b|rnb|soul|funk|reggae|ska)/, ['notes', 'lights']],
  [/(ambient|chill|lofi|lo-fi|new age)/, ['snow', 'fireflies']],
  [/(jazz|blues|clasic|classic|orquest|instrumental)/, ['notes', 'fireflies']],
  [/(folk|acoust|country|bolero|balada|ballad)/, ['fireflies', 'notes']],
]

const ALL_FX: string[] = ['lights', 'lightning', 'lasers', 'rings', 'sparks', 'stars', 'notes', 'fireflies', 'snow', 'bloodsmoke']

/** Efecto de fondo según la elección del usuario (uno solo), o el automático según género y ritmo. */
export function effectsFor(choice: string, genre: string, bpm: number): Fx[] {
  const one = choice.split(',')[0] // por si quedó guardada una lista de una versión anterior
  if (one === 'none') return []
  if (ALL_FX.includes(one)) return [one as Fx]
  const g = genre.toLowerCase()
  for (const [re, fx] of BY_GENRE) if (re.test(g)) return fx
  const e = moodFor(genre, bpm).energy
  if (e > 0.82) return ['lasers', 'sparks']
  if (e > 0.62) return ['stars', 'lights']
  return ['fireflies', 'notes']
}
