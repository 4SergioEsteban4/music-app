import { CapacitorHttp } from '@capacitor/core'

export type AiProvider = 'none' | 'claude' | 'openai' | 'gemini'

export interface AiConfig {
  provider: AiProvider
  key: string
  model: string
}

export const AI_PROVIDERS: { id: AiProvider; name: string; model: string }[] = [
  { id: 'none', name: 'Sin IA', model: '' },
  { id: 'gemini', name: 'Gemini (Google) · GRATIS con límites', model: 'gemini-2.0-flash' },
  { id: 'claude', name: 'Claude (Anthropic) · de pago', model: 'claude-haiku-5-5' },
  { id: 'openai', name: 'ChatGPT (OpenAI) · de pago', model: 'gpt-4o-mini' },
]

export const aiReady = (c: AiConfig): boolean => c.provider !== 'none' && c.key.trim().length > 8

export class AiError extends Error {}

let retryOn = true
/** Si está encendido, cuando Gemini está saturado se reintenta solo y se prueba un modelo más liviano. */
export const setAiRetry = (v: boolean): void => {
  retryOn = v
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const BUSY = new Set([429, 500, 502, 503, 504])
const GEMINI_FALLBACKS = ['gemini-flash-lite-latest', 'gemini-flash-latest']

async function callOnce(cfg: AiConfig, model: string, system: string, user: string): Promise<{ status: number; data: unknown }> {
  let res
  if (cfg.provider === 'claude') {
    res = await CapacitorHttp.post({
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': cfg.key.trim(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      data: { model, max_tokens: 1500, system, messages: [{ role: 'user', content: user }] },
      connectTimeout: 15000,
      readTimeout: 60000,
    })
  } else if (cfg.provider === 'openai') {
    res = await CapacitorHttp.post({
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { Authorization: `Bearer ${cfg.key.trim()}`, 'content-type': 'application/json' },
      data: {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      connectTimeout: 15000,
      readTimeout: 60000,
    })
  } else if (cfg.provider === 'gemini') {
    res = await CapacitorHttp.post({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      params: { key: cfg.key.trim() },
      headers: { 'content-type': 'application/json' },
      data: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
      },
      connectTimeout: 15000,
      readTimeout: 60000,
    })
  } else {
    throw new AiError('No hay una IA configurada en Ajustes.')
  }
  let data: unknown = res.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      // se queda como texto
    }
  }
  return { status: res.status, data }
}

function friendly(provider: AiProvider, last: { status: number } | null): AiError {
  const name = provider === 'gemini' ? 'Gemini' : provider === 'claude' ? 'Claude' : 'ChatGPT'
  if (!last) return new AiError('No pude conectar con la IA. Revisa tu internet.')
  const s = last.status
  if (s === 429 && provider !== 'gemini') return new AiError(`${name}: se alcanzó el límite o no hay saldo en la cuenta.`)
  if (BUSY.has(s)) return new AiError(`${name} está muy ocupado ahora mismo (mucha demanda). Prueba otra vez en unos segundos.`)
  if (s === 400 || s === 401 || s === 403) return new AiError(`${name} no aceptó la clave. Revísala en Ajustes.`)
  if (s === 404) return new AiError(`${name} no encontró el modelo. Déjalo en blanco en Ajustes para usar el automático.`)
  return new AiError(`${name} respondió con un error (${s}). Inténtalo de nuevo.`)
}

function extractText(provider: AiProvider, data: unknown): string {
  const d = data as {
    content?: { text?: string }[]
    choices?: { message?: { content?: string } }[]
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text =
    provider === 'claude'
      ? d?.content?.map((c) => c.text ?? '').join('')
      : provider === 'openai'
        ? d?.choices?.[0]?.message?.content
        : d?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  if (!text) throw new AiError('La IA no devolvió texto.')
  return text.trim()
}

/**
 * Pregunta a la IA que eligió el usuario, con su propia clave. Con Gemini, si está saturado (503/429), reintenta solo y
 * prueba un modelo más liviano antes de rendirse. Los errores salen cortos y en español.
 */
export async function aiAsk(cfg: AiConfig, system: string, user: string): Promise<string> {
  const base = cfg.model.trim() || AI_PROVIDERS.find((p) => p.id === cfg.provider)?.model || ''
  const smart = cfg.provider === 'gemini' && retryOn
  const models = smart ? [base, ...GEMINI_FALLBACKS.filter((m) => m !== base)] : [base]
  const attempts = smart ? 2 : 1
  let last: { status: number; data: unknown } | null = null
  let netFail = false
  for (let mi = 0; mi < models.length; mi++) {
    for (let a = 0; a < attempts; a++) {
      try {
        last = await callOnce(cfg, models[mi], system, user)
        netFail = false
      } catch (e) {
        if (e instanceof AiError) throw e
        netFail = true
        last = null
        if (a < attempts - 1) await wait(1500)
        continue
      }
      if (last.status >= 200 && last.status < 300) return extractText(cfg.provider, last.data)
      if (!BUSY.has(last.status)) break
      if (a < attempts - 1) await wait(1500 * (a + 1))
    }
    if (last && !BUSY.has(last.status) && last.status !== 404) break
  }
  if (netFail) throw new AiError('No pude conectar con la IA. Revisa tu internet.')
  throw friendly(cfg.provider, last)
}

/** Extrae el primer arreglo JSON de una respuesta (la IA a veces añade texto alrededor). */
export function parseJsonArray<T>(text: string): T[] {
  const a = text.indexOf('[')
  const b = text.lastIndexOf(']')
  if (a < 0 || b <= a) throw new AiError('La respuesta de la IA no tenía el formato esperado.')
  try {
    return JSON.parse(text.slice(a, b + 1)) as T[]
  } catch {
    throw new AiError('La respuesta de la IA no tenía el formato esperado.')
  }
}
