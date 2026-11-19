import { useEffect, useState } from 'react'
import { useVocab } from '../state/vocab'
import { useLibrary } from '../state/library'
import { useSettings } from '../state/settings'
import { EntryView, Highlighted } from '../components/EntryView'
import { speak } from '../learn/speak'
import { IconBack, IconStar, IconTrash, IconVolume } from '../icons'
import { artistOf, fmtTime } from '../utils'
import type { ContextRow } from '../types'
import type { DictEntry } from '../learn/dictionary'

interface Props {
  id: number
  onBack: () => void
  onPlayAt: (trackId: number, timeMs: number) => void
}

export function WordDetail({ id, onBack, onPlayAt }: Props) {
  const { words, setDifficult, remove, getEntry, getContexts } = useVocab()
  const { byId } = useLibrary()
  const { settings } = useSettings()
  const word = words.find((w) => w.id === id)
  const [entry, setEntry] = useState<DictEntry | null>(null)
  const [contexts, setContexts] = useState<ContextRow[]>([])

  useEffect(() => {
    let alive = true
    void getEntry(id).then((e) => alive && setEntry(e))
    void getContexts(id).then((c) => alive && setContexts(c))
    return () => {
      alive = false
    }
  }, [id, getEntry, getContexts])

  if (!word) return null

  const del = async () => {
    if (window.confirm(`¿Eliminar "${word.word}" de tus palabras?`)) {
      await remove(word.id)
      onBack()
    }
  }

  return (
    <div className="screen overlay">
      <header className="screen-head">
        <button className="icon-btn" onClick={onBack} aria-label="Volver">
          <IconBack size={26} />
        </button>
        <div className="head-text">
          <h1>{word.word}</h1>
          {entry?.ipa && <span className="muted">{entry.ipa}</span>}
        </div>
        <button
          className="icon-btn"
          onClick={() => speak(word.word, word.lang, entry?.audioUrl)}
          aria-label="Escuchar la pronunciación"
        >
          <IconVolume size={24} />
        </button>
      </header>

      <div className="detail-body">
        <div className="word-actions">
          <button
            className={`chip${word.difficult ? ' solid' : ''}`}
            onClick={() => void setDifficult(word.id, !word.difficult)}
          >
            <IconStar size={16} filled={word.difficult} /> Difícil
          </button>
          <button className="chip" onClick={() => void del()}>
            <IconTrash size={16} /> Eliminar
          </button>
        </div>

        {entry ? (
          <EntryView entry={entry} />
        ) : (
          <p className="muted">
            {word.translation
              ? `Traducción guardada: ${word.translation}`
              : 'Esta palabra se guardó sin datos del diccionario. Vuelve a tocarla en una letra con internet para completarla.'}
          </p>
        )}

        <div className="entry-block">
          <h3>Dónde la escuchaste</h3>
          {contexts.length === 0 && <p className="muted">Aún sin canciones registradas.</p>}
          {contexts.map((c) => {
            const t = byId.get(c.trackId)
            return (
              <button
                key={c.id}
                className="ctx-row"
                disabled={!t}
                onClick={() => onPlayAt(c.trackId, c.timeMs)}
              >
                <span className="ctx-line">
                  <Highlighted text={c.line} word={word.word} />
                </span>
                <span className="muted">
                  {t ? `${t.title} · ${artistOf(t)}${c.timeMs > 0 ? ` · ${fmtTime(c.timeMs)}` : ''}` : 'Canción no disponible'}
                </span>
                {c.aiNote && <span className="ctx-ai">IA: {c.aiNote}</span>}
              </button>
            )
          })}
        </div>
        <p className="muted small">Idioma de la palabra: {settings.targetLang === word.lang ? 'el de tus canciones' : word.lang}</p>
      </div>
    </div>
  )
}
