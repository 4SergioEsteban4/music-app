import { aiAsk } from './client'
import type { AiConfig } from './client'

export interface AiSuggestion {
  title: string
  artist: string
  why: string
}

/** Pide a la IA canciones nuevas según tu gusto. Devuelve una lista corta de {título, artista, motivo}. */
export async function aiSuggest(cfg: AiConfig, taste: string, count = 10): Promise<AiSuggestion[]> {
  const text = await aiAsk(
    cfg,
    'Eres un experto en música. Responde SOLO con un arreglo JSON válido, sin texto antes ni después y sin bloques de código.',
    `Esto es lo que escucho: ${taste}\nSugiéreme ${count} canciones reales que probablemente me gusten y que no estén en esa lista. ` +
      'Formato exacto: [{"title":"","artist":"","why":"máximo 8 palabras en español"}]',
  )
  const a = text.indexOf('[')
  const b = text.lastIndexOf(']')
  if (a < 0 || b <= a) throw new Error('La IA no devolvió una lista. Inténtalo de nuevo.')
  const raw: unknown = JSON.parse(text.slice(a, b + 1))
  if (!Array.isArray(raw)) throw new Error('La IA no devolvió una lista. Inténtalo de nuevo.')
  return raw
    .map((r) => r as Record<string, unknown>)
    .filter((r) => typeof r.title === 'string' && typeof r.artist === 'string')
    .map((r) => ({ title: String(r.title), artist: String(r.artist), why: typeof r.why === 'string' ? r.why : '' }))
    .slice(0, count)
}
