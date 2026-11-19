import { useEffect, useRef, useState } from 'react'
import type { WordTap } from '../types'
import { useSettings } from '../state/settings'
import { useVocab } from '../state/vocab'
import { DictNetworkError, entryHasContent, lookupWord } from '../learn/dictionary'
import type { DictEntry } from '../learn/dictionary'
import { speak } from '../learn/speak'
import { aiAsk, aiReady } from '../ai/client'
import type { AiConfig, AiProvider } from '../ai/client'
import { LANGS } from '../learn/dictionary'
import { dbCacheGet, dbCacheSet } from '../db/db'
import { EntryView, Highlighted } from './EntryView'
import { IconStar, IconVolume } from '../icons'

type Status = 'loading' | 'ready' | 'offline' | 'error'

/** Hoja que aparece al tocar una palabra de la letra. */
export function WordSheet({ tap, onClose }: { tap: WordTap; onClose: () => void }) {
  const { settings } = useSettings()
  const vocab = useVocab()
  const { nativeLang: native, targetLang: target } = settings
  const [entry, setEntry] = useState<DictEntry | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [errDetail, setErrDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiErr, setAiErr] = useState('')
  const aiCfg: AiConfig = {
    provider: settings.aiProvider as AiProvider,
    key: settings.aiKey,
    model: settings.aiModel,
  }

  const aiKey = `ai:${native}:${tap.word.toLowerCase()}:${tap.trackId}:${tap.timeMs}`
  const saved = vocab.find(tap.word, target)
  const savedRef = useRef(saved)
  savedRef.current = saved
  const vocabRef = useRef(vocab)
  vocabRef.current = vocab

  // Si la palabra ya estaba guardada, anotar también esta canción como contexto
  useEffect(() => {
    const s = savedRef.current
    if (s) void vocabRef.current.addContext(s.id, tap)
  }, [tap])

  // Si ya le preguntaste a la IA por esta palabra en esta frase, se muestra la respuesta guardada
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        let note = ''
        const s = savedRef.current
        if (s) {
          const rows = await vocabRef.current.getContexts(s.id)
          note = rows.find((r) => r.trackId === tap.trackId && r.timeMs === tap.timeMs)?.aiNote ?? ''
        }
        if (!note) note = (await dbCacheGet(aiKey)) ?? ''
        if (alive && note) setAiText(note)
      } catch {
        // sin respuesta guardada
      }
    })()
    return () => {
      alive = false
    }
  }, [tap, aiKey])

  useEffect(() => {
    let alive = true
    setStatus('loading')
    void (async () => {
      try {
        const s = savedRef.current
        if (s) {
          const stored = await vocabRef.current.getEntry(s.id)
          if (stored && entryHasContent(stored)) {
            if (alive) {
              setEntry(stored)
              setStatus('ready')
            }
            return
          }
        }
        const e = await lookupWord(tap.word, native, target)
        if (alive) {
          setEntry(e)
          setStatus('ready')
        }
      } catch (err) {
        if (alive) {
          setErrDetail(err instanceof Error ? err.message : '')
          setStatus(err instanceof DictNetworkError ? 'offline' : 'error')
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [tap.word, native, target, nonce])

  const ctx = { trackId: tap.trackId, line: tap.line, timeMs: tap.timeMs }

  const explainWithAi = async () => {
    setAiBusy(true)
    setAiErr('')
    try {
      const langName = LANGS.find((l) => l.code === native)?.name ?? 'Español'
      const text = await aiAsk(
        aiCfg,
        `Eres un profesor de idiomas. Responde siempre en ${langName}, muy corto y directo.`,
        `La palabra "${tap.word}" aparece en esta línea de una canción: "${tap.line}". ` +
          'Di en 1 o 2 frases cortas qué significa AQUÍ (si es jerga o modismo, solo menciónalo). Sin introducción ni listas.',
      )
      setAiText(text)
      // se guarda siempre; si la palabra ya está en tu diccionario, queda junto a ella
      await dbCacheSet(aiKey, text)
      const s = savedRef.current
      if (s) {
        await vocabRef.current.addContext(s.id, tap)
        await vocabRef.current.saveAiNote(s.id, tap.trackId, tap.timeMs, text)
      }
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : 'Algo falló con la IA.')
    } finally {
      setAiBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    try {
      const w = await vocab.save(tap.word, target, entry, ctx)
      if (aiText) await vocab.saveAiNote(w.id, tap.trackId, tap.timeMs, aiText)
    } finally {
      setBusy(false)
    }
  }

  const toggleDifficult = async () => {
    setBusy(true)
    try {
      const w = saved ?? (await vocab.save(tap.word, target, entry, ctx))
      if (!saved && aiText) await vocab.saveAiNote(w.id, tap.trackId, tap.timeMs, aiText)
      await vocab.setDifficult(w.id, !(saved ? saved.difficult : false))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop top" onClick={onClose}>
      <div className="sheet word-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="word-head">
          <div className="word-title">
            <h2>{tap.word}</h2>
            {entry?.ipa && <span className="muted">{entry.ipa}</span>}
          </div>
          <button
            className="icon-btn"
            onClick={() => speak(tap.word, target, entry?.audioUrl)}
            aria-label="Escuchar la pronunciación"
          >
            <IconVolume size={24} />
          </button>
        </div>

        {tap.line && (
          <p className="word-context">
            <Highlighted text={tap.line} word={tap.word} />
          </p>
        )}

        {status === 'loading' && <p className="muted">Buscando el significado…</p>}
        {status === 'offline' && (
          <div className="entry-block">
            <p className="muted">
              No pude consultar el diccionario. Las palabras que ya consultaste se ven sin internet.
              {errDetail ? ` (${errDetail})` : ''}
            </p>
            <button className="chip" onClick={() => setNonce((n) => n + 1)}>
              Reintentar
            </button>
          </div>
        )}
        {status === 'error' && <p className="muted">Algo falló al buscar la palabra. Intenta de nuevo.</p>}
        {status === 'ready' && entry && <EntryView entry={entry} />}

        {aiReady(aiCfg) && (
          <div className="entry-block">
            {aiText ? (
              <>
                <h3>Explicación de la IA</h3>
                <p className="ai-text">{aiText}</p>
                <p className="muted small">{saved ? 'Guardada en tu diccionario.' : 'Guardada. Si guardas la palabra, también se verá en tu diccionario.'}</p>
              </>
            ) : (
              <button className="chip" disabled={aiBusy} onClick={() => void explainWithAi()}>
                {aiBusy ? 'Pensando…' : 'Explicar con IA en esta frase'}
              </button>
            )}
            {aiErr && <p className="muted">{aiErr}</p>}
          </div>
        )}

        <div className="word-actions">
          <button className={`chip${saved ? '' : ' solid'}`} disabled={!!saved || busy} onClick={() => void save()}>
            {saved ? 'Guardada ✓' : 'Guardar palabra'}
          </button>
          <button
            className={`chip${saved?.difficult ? ' solid' : ''}`}
            disabled={busy}
            onClick={() => void toggleDifficult()}
          >
            <IconStar size={16} filled={saved?.difficult} /> Difícil
          </button>
        </div>
      </div>
    </div>
  )
}
