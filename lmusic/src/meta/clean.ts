import type { Track } from '../types'

export interface MetaFields {
  title?: string
  artist?: string
  album?: string
  genre?: string
}

export const GENRES = [
  'Rock', 'Pop', 'Hip hop', 'Reggaetón', 'Electrónica', 'Metal', 'Jazz', 'Clásica', 'R&B', 'Folk',
  'Latino', 'Blues', 'Reggae', 'Country', 'Indie', 'Alternativo', 'Salsa', 'Cumbia', 'Otro',
]

const SMALL = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'to', 'in', 'on', 'at', 'for', 'de', 'la', 'el', 'y', 'en', 'del', 'los', 'las'])

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/** Pasa a "Título" los textos TODOS EN MAYÚSCULAS o todo en minúsculas; deja en paz los demás. */
function fixCase(s: string): string {
  const letters = s.replace(/[^\p{L}]/gu, '')
  if (letters.length < 4) return s
  const upper = letters === letters.toUpperCase()
  const lower = letters === letters.toLowerCase()
  return upper || lower ? titleCase(s) : s
}

const WEBSITE = /^(www\.)?[\w-]+\.(com|net|org|io|me|co|cc|to|app)\s*[-–—_:|]*\s*/i
const JUNK =
  /\s*[([][^)\]]*\b(official|oficial|lyric|lyrics|letra|video|vídeo|audio|visualizer|hd|hq|4k|remaster(ed)?|live|en vivo|explicit|clean|mv|m\/v)\b[^)\]]*[)\]]/gi

const JUNK_TEST = new RegExp(JUNK.source, 'i')

export function cleanText(s: string): string {
  return fixCase(
    s
      .replace(/\.(mp3|m4a|wav|flac|ogg|opus|aac)$/i, '')
      .replace(WEBSITE, '')
      .replace(/_/g, ' ')
      .replace(JUNK, '')
      .replace(/\s*[-–—]\s*(topic|official video|lyrics?|letra)\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

/** ¿El título parece un nombre de archivo sin limpiar? */
export function looksDirty(title: string): boolean {
  return /^\d{1,3}[\s._-]+\S/.test(title) || /_/.test(title) || WEBSITE.test(title) || JUNK_TEST.test(title) || /\s[-–—]\s/.test(title)
}

export function needsReview(t: Track): boolean {
  return !t.artist || !t.album || !t.genre || looksDirty(t.title)
}

/** Título y artista deducidos del título y del nombre del archivo, sin internet. */
export function parseNames(t: Track): { title: string; artist: string } {
  let raw = looksDirty(t.title) || !t.title ? t.title : t.title
  if (!raw && t.fileName) raw = t.fileName
  raw = raw.replace(/^\d{1,3}[\s._-]+(?=\S)/, '')
  let title = cleanText(raw)
  let artist = t.artist
  const m = title.match(/^(.{2,60}?)\s[-–—]\s(.{2,})$/)
  if (m && !t.artist) {
    artist = cleanText(m[1])
    title = cleanText(m[2])
  } else if (m && t.artist && m[1].toLowerCase().includes(t.artist.toLowerCase())) {
    title = cleanText(m[2])
  }
  return { title, artist }
}

/** Sugerencia basada solo en reglas: rellena el artista vacío y limpia el título. */
export function suggestFromRules(t: Track): MetaFields {
  const { title, artist } = parseNames(t)
  const out: MetaFields = {}
  if (title && title !== t.title) out.title = title
  if (artist && artist !== t.artist) out.artist = artist
  return out
}

const GENRE_MAP: [RegExp, string][] = [
  [/(reggaet|dembow|urbano|urban)/i, 'Reggaetón'],
  [/(hip.?hop|rap|trap)/i, 'Hip hop'],
  [/(electr|dance|house|techno|edm|trance|dubstep)/i, 'Electrónica'],
  [/(metal|punk|hardcore)/i, 'Metal'],
  [/(alternativ)/i, 'Alternativo'],
  [/(indie)/i, 'Indie'],
  [/(rock)/i, 'Rock'],
  [/(pop|k-?pop)/i, 'Pop'],
  [/(r&b|rnb|soul|funk)/i, 'R&B'],
  [/(jazz)/i, 'Jazz'],
  [/(clasic|classic)/i, 'Clásica'],
  [/(salsa)/i, 'Salsa'],
  [/(cumbia|vallenat|merengue|bachata|champeta)/i, 'Cumbia'],
  [/(latin|latino)/i, 'Latino'],
  [/(reggae|ska)/i, 'Reggae'],
  [/(blues)/i, 'Blues'],
  [/(country)/i, 'Country'],
  [/(folk|acoust|singer)/i, 'Folk'],
]

/** Lleva el género que devuelve un servicio (en inglés) a las categorías de LMusic. */
export function normGenre(g: string): string {
  const s = g.trim()
  if (!s) return ''
  for (const [re, name] of GENRE_MAP) if (re.test(s)) return name
  return GENRES.find((x) => x.toLowerCase() === s.toLowerCase()) ?? s
}
