import { aiAsk, parseJsonArray } from '../ai/client'
import type { AiConfig } from '../ai/client'
import { GENRES } from './clean'
import type { MetaFields } from './clean'

export interface AiItem {
  id: number
  fileName: string
  title: string
  artist: string
  album: string
  genre: string
}

interface AiRow {
  id: number
  title?: string
  artist?: string
  album?: string
  genre?: string
}

/** Pide a la IA que complete título, artista, álbum y género de hasta ~15 canciones a la vez. */
export async function aiFillMeta(cfg: AiConfig, items: AiItem[]): Promise<Map<number, MetaFields>> {
  const system =
    'Eres un experto en música. Recibes canciones con el nombre del archivo y etiquetas actuales, que pueden estar ' +
    'vacías o mal escritas. Para cada una devuelve el título y artista correctos si la reconoces, el álbum si lo ' +
    `sabes, y SIEMPRE un género de esta lista: ${GENRES.join(', ')}. Si no la reconoces, deja title y artist ` +
    'como estaban y elige el género más probable por el nombre; si no hay forma, usa "Otro". ' +
    'Responde SOLO con un arreglo JSON, sin texto extra: [{"id":1,"title":"","artist":"","album":"","genre":""}]'
  const text = await aiAsk(cfg, system, JSON.stringify(items))
  const rows = parseJsonArray<AiRow>(text)
  const out = new Map<number, MetaFields>()
  for (const r of rows) {
    if (typeof r.id !== 'number') continue
    const f: MetaFields = {}
    if (r.title) f.title = r.title
    if (r.artist) f.artist = r.artist
    if (r.album) f.album = r.album
    if (r.genre) f.genre = r.genre
    out.set(r.id, f)
  }
  return out
}
