export interface Track {
  id: number
  uri: string
  title: string
  artist: string
  album: string
  genre: string
  trackNo: number
  durationMs: number
  dateAdded: number // segundos (MediaStore)
  size: number
  playCount: number
  lastPlayed: number // ms desde epoch, 0 = nunca
  favorite: boolean
  metaEdited: boolean
  fileName: string
}

export interface Playlist {
  id: number
  name: string
  trackIds: number[]
}

export type RepeatMode = 'off' | 'all' | 'one'

export interface Word {
  id: number
  word: string
  lang: string
  translation: string
  difficult: boolean
  createdAt: number
  ease: number
  intervalDays: number
  reps: number
  lapses: number
  dueAt: number // ms; 0 = nueva (pendiente ya)
  lastReviewed: number
}

export interface ContextRow {
  id: number
  trackId: number
  line: string
  timeMs: number
  createdAt: number
  /** explicación de la IA guardada para esta línea ('' si no hay) */
  aiNote: string
}

/** Dónde se tocó una palabra: canción, línea y minuto. */
export interface WordTap {
  word: string
  line: string
  trackId: number
  timeMs: number
}
