import { useEffect, useMemo, useState } from 'react'
import { useVocab } from '../state/vocab'
import { EntryView, Highlighted } from '../components/EntryView'
import { intervalLabel, nextSrs } from '../learn/srs'
import type { Grade } from '../learn/srs'
import { speak } from '../learn/speak'
import { IconBack, IconVolume } from '../icons'
import type { DictEntry } from '../learn/dictionary'

const SESSION_SIZE = 30

const GRADES: { g: Grade; label: string }[] = [
  { g: 0, label: 'Otra vez' },
  { g: 1, label: 'Difícil' },
  { g: 2, label: 'Bien' },
  { g: 3, label: 'Fácil' },
]

export function Review({ onClose }: { onClose: () => void }) {
  const { words, grade, getEntry, getContexts } = useVocab()
  const [queue, setQueue] = useState<number[]>(() => {
    const t = Date.now()
    return words
      .filter((w) => w.dueAt <= t)
      .sort((a, b) => Number(b.difficult) - Number(a.difficult) || a.dueAt - b.dueAt)
      .slice(0, SESSION_SIZE)
      .map((w) => w.id)
  })
  const [pos, setPos] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [entry, setEntry] = useState<DictEntry | null>(null)
  const [line, setLine] = useState('')
  const [reviewed, setReviewed] = useState(0)
  const [again, setAgain] = useState(0)
  const [busy, setBusy] = useState(false)

  const currentId = queue[pos]
  const word = words.find((w) => w.id === currentId)

  useEffect(() => {
    if (currentId === undefined) return
    let alive = true
    setRevealed(false)
    setEntry(null)
    setLine('')
    void getEntry(currentId).then((e) => alive && setEntry(e))
    void getContexts(currentId).then((c) => alive && setLine(c[0]?.line ?? ''))
    return () => {
      alive = false
    }
  }, [currentId, getEntry, getContexts])

  const previews = useMemo(
    () =>
      word
        ? GRADES.map(({ g }) => intervalLabel(nextSrs(word, g).dueInMs))
        : [],
    [word],
  )

  const answer = async (g: Grade) => {
    if (!word || busy) return
    setBusy(true)
    try {
      await grade(word.id, g)
      setReviewed((n) => n + 1)
      if (g === 0) {
        setAgain((n) => n + 1)
        setQueue((q) => [...q, word.id]) // vuelve a salir al final de esta sesión
      }
      setPos((p) => p + 1)
    } finally {
      setBusy(false)
    }
  }

  const finished = pos >= queue.length

  return (
    <div className="review">
      <header className="screen-head">
        <button className="icon-btn" onClick={onClose} aria-label="Salir del repaso">
          <IconBack size={26} />
        </button>
        <div className="head-text">
          <h1>Repaso</h1>
          {!finished && (
            <span className="muted">
              {pos + 1} de {queue.length}
            </span>
          )}
        </div>
      </header>

      {finished || !word ? (
        <div className="review-done">
          <h2>{queue.length === 0 ? 'Nada pendiente' : '¡Sesión terminada!'}</h2>
          <p className="muted">
            {queue.length === 0
              ? 'No tienes palabras para repasar ahora.'
              : `Repasaste ${reviewed} tarjetas${again > 0 ? ` (${again} para volver a ver)` : ''}.`}
          </p>
          <button className="big-btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
      ) : (
        <div className="review-card">
          <div className="card-face">
            <div className="word-head">
              <h2 className="review-word">{word.word}</h2>
              <button
                className="icon-btn"
                onClick={() => speak(word.word, word.lang, entry?.audioUrl)}
                aria-label="Escuchar la pronunciación"
              >
                <IconVolume size={26} />
              </button>
            </div>
            {entry?.ipa && <span className="muted">{entry.ipa}</span>}
            {line && (
              <p className="word-context">
                <Highlighted text={line} word={word.word} />
              </p>
            )}

            {revealed &&
              (entry ? (
                <EntryView entry={entry} />
              ) : (
                <p className="review-answer">{word.translation || 'Sin traducción guardada'}</p>
              ))}
          </div>

          {!revealed ? (
            <button className="big-btn" onClick={() => setRevealed(true)}>
              Mostrar respuesta
            </button>
          ) : (
            <div className="grades">
              {GRADES.map(({ g, label }, i) => (
                <button key={g} className={`grade g${g}`} disabled={busy} onClick={() => void answer(g)}>
                  <span>{label}</span>
                  <small>{previews[i]}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
