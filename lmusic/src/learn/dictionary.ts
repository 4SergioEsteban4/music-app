import { CapacitorHttp } from '@capacitor/core'
import { dbCacheGet, dbCacheSet } from '../db/db'

export interface DictMeaning {
  pos: string
  senses: string[]
}

export interface DictEntry {
  word: string
  ipa: string
  audioUrl: string
  /** traducciones frecuentes de la palabra suelta */
  translations: string[]
  /** significados por categoría, en el idioma del usuario */
  meanings: DictMeaning[]
  /** definiciones en el idioma de la canción (inglés) */
  enMeanings: DictMeaning[]
}

/** No se pudo consultar (sin internet o servicio caído): no significa que la palabra no exista. */
export class DictNetworkError extends Error {}

export const LANGS = [
  { code: 'es', name: 'Español' },
  { code: 'en', name: 'English' },
  { code: 'pt', name: 'Português' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
]

export const emptyEntry = (word: string): DictEntry => ({
  word,
  ipa: '',
  audioUrl: '',
  translations: [],
  meanings: [],
  enMeanings: [],
})

export const entryHasContent = (e: DictEntry): boolean =>
  e.translations.length > 0 || e.meanings.length > 0 || e.enMeanings.length > 0

/** Resumen corto para mostrar en listas. */
export function shortTranslation(e: DictEntry | null): string {
  if (!e) return ''
  if (e.translations.length) return e.translations.slice(0, 3).join(', ')
  return e.meanings[0]?.senses[0] ?? e.enMeanings[0]?.senses[0] ?? ''
}

/* ---------- HTTP ---------- */

async function getJson(url: string, params: Record<string, string> = {}): Promise<{ status: number; data: unknown }> {
  try {
    const r = await CapacitorHttp.get({
      url,
      params,
      headers: { Accept: 'application/json' },
      connectTimeout: 8000,
      readTimeout: 12000,
    })
    let data: unknown = r.data
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch {
        // dejar el texto tal cual
      }
    }
    return { status: r.status, data }
  } catch (e) {
    throw new DictNetworkError(`No se pudo conectar (${e instanceof Error ? e.message : String(e)})`)
  }
}

/* ---------- traducción de la palabra suelta (MyMemory, gratis y sin clave) ---------- */

async function translate(word: string, from: string, to: string): Promise<string[]> {
  const { status, data } = await getJson('https://api.mymemory.translated.net/get', {
    q: word,
    langpair: `${from}|${to}`,
  })
  if (status < 200 || status >= 300) throw new DictNetworkError(`Traductor respondió ${status}`)
  const d = data as {
    responseData?: { translatedText?: string }
    matches?: { translation?: string; match?: number; quality?: string | number }[]
  }
  const base = d.responseData?.translatedText ?? ''
  if (/MYMEMORY WARNING/i.test(base)) throw new DictNetworkError('Se alcanzó el límite diario del traductor gratuito')

  const scored: { t: string; score: number }[] = []
  if (base) scored.push({ t: base, score: 2 })
  for (const m of d.matches ?? []) {
    if (m.translation) scored.push({ t: m.translation, score: (m.match ?? 0) + Number(m.quality ?? 0) / 100 })
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const { t } of scored.sort((a, b) => b.score - a.score)) {
    const clean = t.trim().replace(/[.!?¿¡]+$/g, '').toLowerCase()
    if (!clean || clean.length > 40 || clean === word.toLowerCase() || seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
    if (out.length >= 6) break
  }
  return out
}

/* ---------- significados por categoría en español (Wiktionary en español) ---------- */

const ES_LANG_NAME: Record<string, string> = {
  en: 'Inglés',
  fr: 'Francés',
  pt: 'Portugués',
  de: 'Alemán',
  it: 'Italiano',
  es: 'Español',
}

const ES_POS =
  /^(sustantivo|verbo|adjetivo|adverbio|preposición|conjunción|interjección|pronombre|artículo|determinante|numeral|locución|contracción|forma|participio|onomatopeya|abreviatura|sigla|prefijo|sufijo)/i

function headingText(el: Element): string {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('.mw-editsection').forEach((n) => n.remove())
  return (clone.textContent ?? '').replace(/\[editar\]/gi, '').trim()
}

function glossText(dd: Element): string {
  const clone = dd.cloneNode(true) as Element
  clone.querySelectorAll('dl, ul, sup, .mw-editsection, style').forEach((n) => n.remove())
  return (clone.textContent ?? '').replace(/\s+/g, ' ').replace(/\s*Ejemplo:.*$/i, '').trim()
}

export function parseEsWiktionary(html: string, langName: string): DictMeaning[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const nodes = doc.querySelectorAll('h2, h3, h4, h5, dl')
  const out: DictMeaning[] = []
  let inLang = false
  let current: DictMeaning | null = null

  for (const n of Array.from(nodes)) {
    const tag = n.tagName
    if (tag === 'H2') {
      inLang = headingText(n).toLowerCase() === langName.toLowerCase()
      current = null
      continue
    }
    if (!inLang) continue
    if (tag === 'H3' || tag === 'H4' || tag === 'H5') {
      const t = headingText(n)
      if (ES_POS.test(t)) {
        const existing: DictMeaning | undefined = out.find((m) => m.pos === t)
        current = existing ?? { pos: t, senses: [] }
        if (!existing) out.push(current)
      } else {
        current = null
      }
      continue
    }
    if (tag === 'DL' && current && !n.closest('dd')) {
      for (const child of Array.from(n.children)) {
        if (child.tagName !== 'DD') continue
        const prev = child.previousElementSibling
        if (!prev || prev.tagName !== 'DT' || !/^\d+/.test((prev.textContent ?? '').trim())) continue
        const g = glossText(child)
        if (g && current.senses.length < 8) current.senses.push(g)
      }
    }
  }
  return out.filter((m) => m.senses.length > 0)
}

async function esWiktionaryMeanings(word: string, target: string): Promise<DictMeaning[]> {
  const langName = ES_LANG_NAME[target]
  if (!langName) return []
  const { status, data } = await getJson('https://es.wiktionary.org/w/api.php', {
    action: 'parse',
    page: word,
    prop: 'text',
    format: 'json',
    formatversion: '2',
    redirects: '1',
    disableeditsection: '1',
    disablelimitreport: '1',
    disabletoc: '1',
  })
  if (status < 200 || status >= 300) throw new DictNetworkError(`Wiktionary respondió ${status}`)
  const d = data as { parse?: { text?: string }; error?: unknown }
  const html = d.parse?.text
  if (typeof html !== 'string') return [] // la palabra no tiene página
  return parseEsWiktionary(html, langName)
}

/* ---------- definiciones en inglés, pronunciación y audio (Free Dictionary API) ---------- */

const POS_ES: Record<string, string> = {
  noun: 'Sustantivo',
  verb: 'Verbo',
  adjective: 'Adjetivo',
  adverb: 'Adverbio',
  preposition: 'Preposición',
  conjunction: 'Conjunción',
  interjection: 'Interjección',
  pronoun: 'Pronombre',
  article: 'Artículo',
  determiner: 'Determinante',
  exclamation: 'Exclamación',
}

interface FreeDictEntry {
  phonetic?: string
  phonetics?: { text?: string; audio?: string }[]
  meanings?: { partOfSpeech?: string; definitions?: { definition?: string }[] }[]
}

async function englishDefinitions(
  word: string,
): Promise<{ ipa: string; audioUrl: string; meanings: DictMeaning[] }> {
  const { status, data } = await getJson(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
  )
  if (status === 404) return { ipa: '', audioUrl: '', meanings: [] }
  if (status < 200 || status >= 300) throw new DictNetworkError(`Diccionario respondió ${status}`)
  const list = Array.isArray(data) ? (data as FreeDictEntry[]) : []
  let ipa = ''
  let audioUrl = ''
  const meanings: DictMeaning[] = []
  for (const e of list) {
    ipa ||= e.phonetic ?? e.phonetics?.find((p) => p.text)?.text ?? ''
    audioUrl ||= e.phonetics?.find((p) => p.audio)?.audio ?? ''
    for (const m of e.meanings ?? []) {
      const pos = POS_ES[m.partOfSpeech ?? ''] ?? m.partOfSpeech ?? ''
      const senses = (m.definitions ?? [])
        .map((x) => x.definition ?? '')
        .filter(Boolean)
        .slice(0, 3)
      if (!pos || !senses.length) continue
      const existing = meanings.find((x) => x.pos === pos)
      if (existing) existing.senses.push(...senses.slice(0, 3 - Math.min(3, existing.senses.length)))
      else meanings.push({ pos, senses })
    }
  }
  return { ipa, audioUrl, meanings }
}

/* ---------- API pública ---------- */

/**
 * Busca una palabra: traducciones + significados por categoría + definiciones.
 * Cada consulta se guarda en el teléfono, así la segunda vez funciona sin internet.
 * Lanza DictNetworkError si ninguna fuente respondió.
 */
export async function lookupWord(word: string, native: string, target: string): Promise<DictEntry> {
  const key = `v1|${target}|${native}|${word}`
  const cached = await dbCacheGet(key)
  if (cached) {
    try {
      return JSON.parse(cached) as DictEntry
    } catch {
      // caché dañada: se vuelve a consultar
    }
  }

  const [tr, nat, en] = await Promise.allSettled([
    translate(word, target, native),
    native === 'es' ? esWiktionaryMeanings(word, target) : Promise.resolve([] as DictMeaning[]),
    target === 'en' ? englishDefinitions(word) : Promise.resolve({ ipa: '', audioUrl: '', meanings: [] as DictMeaning[] }),
  ])

  if (tr.status === 'rejected' && nat.status === 'rejected' && en.status === 'rejected') {
    throw tr.reason instanceof DictNetworkError ? tr.reason : new DictNetworkError('Sin conexión')
  }

  const entry = emptyEntry(word)
  if (tr.status === 'fulfilled') entry.translations = tr.value
  if (nat.status === 'fulfilled') entry.meanings = nat.value
  if (en.status === 'fulfilled') {
    entry.ipa = en.value.ipa
    entry.audioUrl = en.value.audioUrl
    entry.enMeanings = en.value.meanings
  }

  // Solo se guarda si todas las fuentes respondieron y hubo algo: así un fallo parcial se reintenta.
  const allOk = tr.status === 'fulfilled' && nat.status === 'fulfilled' && en.status === 'fulfilled'
  if (allOk && entryHasContent(entry)) await dbCacheSet(key, JSON.stringify(entry))
  return entry
}
