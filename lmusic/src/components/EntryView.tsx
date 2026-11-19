import type { DictEntry } from '../learn/dictionary'

/** Traducciones, significados por categoría y definiciones de una palabra. */
export function EntryView({ entry }: { entry: DictEntry }) {
  const hasNative = entry.meanings.length > 0
  return (
    <div className="entry">
      {entry.translations.length > 0 && (
        <div className="entry-block">
          <h3>Traducciones</h3>
          <div className="tags">
            {entry.translations.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {hasNative && (
        <div className="entry-block">
          <h3>Significados</h3>
          {entry.meanings.map((m) => (
            <div key={m.pos} className="pos">
              <span className="pos-name">{m.pos}</span>
              <ol>
                {m.senses.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {entry.enMeanings.length > 0 &&
        (hasNative ? (
          <details className="entry-block">
            <summary>Definiciones en inglés</summary>
            {entry.enMeanings.map((m) => (
              <div key={m.pos} className="pos">
                <span className="pos-name">{m.pos}</span>
                <ol>
                  {m.senses.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            ))}
          </details>
        ) : (
          <div className="entry-block">
            <h3>Definiciones en inglés</h3>
            {entry.enMeanings.map((m) => (
              <div key={m.pos} className="pos">
                <span className="pos-name">{m.pos}</span>
                <ol>
                  {m.senses.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        ))}

      {entry.translations.length === 0 && !hasNative && entry.enMeanings.length === 0 && (
        <p className="muted">No encontré esta palabra en el diccionario. Puedes guardarla igual.</p>
      )}
    </div>
  )
}

/** Muestra una frase resaltando la palabra buscada. */
export function Highlighted({ text, word }: { text: string; word: string }) {
  const re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = text.split(re)
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase().replace(/’/g, "'") === word ? (
          <mark key={i}>{p}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}
