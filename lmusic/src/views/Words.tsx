import { useEffect, useMemo, useState } from 'react'
import { useVocab } from '../state/vocab'
import { useLibrary } from '../state/library'
import { dueLabel } from '../learn/srs'
import { dbAllContexts } from '../db/db'
import { IconChevron, IconPlay, IconSearch, IconStar } from '../icons'
import { artistOf, norm } from '../utils'
import { WordPlaySheet } from '../components/WordPlaySheet'
import type { Word } from '../types'

type Filter = 'all' | 'due' | 'hard'
type Group = 'none' | 'song' | 'list'

interface Props {
  onOpenWord: (id: number) => void
  onReview: () => void
  onPlayAt: (trackId: number, timeMs: number) => void
}

interface WordGroup {
  key: string
  title: string
  sub: string
  trackId?: number
  words: Word[]
}

export function Words({ onOpenWord, onReview, onPlayAt }: Props) {
  const { words, now, dueCount } = useVocab()
  const { byId, playlists } = useLibrary()
  const [filter, setFilter] = useState<Filter>('all')
  const [group, setGroup] = useState<Group>('none')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [pick, setPick] = useState<{ id: number; word: string } | null>(null)
  const [ctx, setCtx] = useState<{ wordId: number; trackId: number }[]>([])

  useEffect(() => {
    void dbAllContexts().then((rows) => setCtx(rows.map((r) => ({ wordId: r.wordId, trackId: r.trackId }))))
  }, [words])

  const hardCount = useMemo(() => words.filter((w) => w.difficult).length, [words])

  const list = useMemo(() => {
    const q = norm(query.trim())
    return words
      .filter((w) => (filter === 'due' ? w.dueAt <= now : filter === 'hard' ? w.difficult : true))
      .filter((w) => !q || norm(w.word).includes(q) || norm(w.translation).includes(q))
  }, [words, filter, query, now])

  const groups = useMemo<WordGroup[]>(() => {
    if (group === 'none') return []
    const byWord = new Map<number, Set<number>>()
    for (const c of ctx) {
      const s = byWord.get(c.wordId) ?? new Set<number>()
      s.add(c.trackId)
      byWord.set(c.wordId, s)
    }
    const out: WordGroup[] = []
    if (group === 'song') {
      const m = new Map<number, Word[]>()
      const none: Word[] = []
      for (const w of list) {
        const ids = byWord.get(w.id)
        if (!ids || ids.size === 0) {
          none.push(w)
          continue
        }
        for (const id of ids) m.set(id, [...(m.get(id) ?? []), w])
      }
      for (const [id, ws] of m) {
        const t = byId.get(id)
        out.push({ key: `s${id}`, title: t?.title ?? 'Canción no disponible', sub: t ? artistOf(t) : '', trackId: t ? id : undefined, words: ws })
      }
      out.sort((a, b) => b.words.length - a.words.length || a.title.localeCompare(b.title, 'es'))
      if (none.length) out.push({ key: 's0', title: 'Sin canción guardada', sub: '', words: none })
    } else {
      const assigned = new Set<number>()
      for (const p of playlists) {
        const set = new Set(p.trackIds)
        const ws = list.filter((w) => [...(byWord.get(w.id) ?? [])].some((id) => set.has(id)))
        if (!ws.length) continue
        ws.forEach((w) => assigned.add(w.id))
        out.push({ key: `p${p.id}`, title: p.name, sub: `${p.trackIds.length} canciones`, words: ws })
      }
      out.sort((a, b) => b.words.length - a.words.length || a.title.localeCompare(b.title, 'es'))
      const rest = list.filter((w) => !assigned.has(w.id))
      if (rest.length) out.push({ key: 'p0', title: 'Sin lista', sub: 'Palabras de canciones que no están en ninguna lista', words: rest })
    }
    return out
  }, [group, list, ctx, byId, playlists])

  const toggle = (key: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const renderRow = (w: Word) => (
    <button key={w.id} className="row-main group-row" onClick={() => setPick({ id: w.id, word: w.word })}>
      <span className="row-text">
        <span className="row-title">{w.word}</span>
        <span className="row-sub">{w.translation || 'Sin traducción guardada'}</span>
      </span>
      {w.difficult && (
        <span className="row-fav">
          <IconStar size={16} filled />
        </span>
      )}
      <span className="row-time">{dueLabel(w, now)}</span>
    </button>
  )

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Palabras</h1>
      </header>

      {words.length === 0 ? (
        <p className="empty">
          Aún no guardaste palabras. Abre una canción, toca <strong>Letra</strong> y toca cualquier palabra para
          ver su significado y guardarla.
        </p>
      ) : (
        <>
          <button className="big-btn" disabled={dueCount === 0} onClick={onReview}>
            {dueCount > 0 ? `Repasar ahora · ${dueCount} pendientes` : 'No tienes palabras pendientes'}
          </button>

          <div className="search">
            <IconSearch size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar una palabra"
              aria-label="Buscar palabra"
            />
          </div>

          <div className="seg">
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
              Todas · {words.length}
            </button>
            <button className={filter === 'due' ? 'on' : ''} onClick={() => setFilter('due')}>
              Pendientes · {dueCount}
            </button>
            <button className={filter === 'hard' ? 'on' : ''} onClick={() => setFilter('hard')}>
              Difíciles · {hardCount}
            </button>
          </div>

          <div className="seg">
            <button className={group === 'none' ? 'on' : ''} onClick={() => setGroup('none')}>
              Sin agrupar
            </button>
            <button className={group === 'song' ? 'on' : ''} onClick={() => setGroup('song')}>
              Por canción
            </button>
            <button className={group === 'list' ? 'on' : ''} onClick={() => setGroup('list')}>
              Por lista
            </button>
          </div>

          <div className="track-list">
            {group === 'none' && list.map(renderRow)}
            {group !== 'none' &&
              groups.map((g) => {
                const closed = collapsed.has(g.key)
                return (
                  <section key={g.key} className="word-group">
                    <div className="word-group-head">
                      <button className="wg-toggle" onClick={() => toggle(g.key)} aria-expanded={!closed}>
                        <span className="wg-text">
                          <strong>{g.title}</strong>
                          {g.sub && <small>{g.sub}</small>}
                        </span>
                        <span className="wg-count">{g.words.length}</span>
                        <span className={`group-chev${closed ? '' : ' open'}`}>
                          <IconChevron size={18} />
                        </span>
                      </button>
                      {g.trackId !== undefined && (
                        <button className="icon-btn" aria-label="Reproducir la canción" onClick={() => onPlayAt(g.trackId as number, 0)}>
                          <IconPlay size={18} />
                        </button>
                      )}
                    </div>
                    {!closed && g.words.map(renderRow)}
                  </section>
                )
              })}
            {list.length === 0 && <p className="empty">Nada por mostrar con este filtro.</p>}
            {group !== 'none' && list.length > 0 && groups.length === 0 && <p className="empty">Cargando…</p>}
          </div>
        </>
      )}
      {pick && (
        <WordPlaySheet
          word={pick}
          onClose={() => setPick(null)}
          onDetail={() => {
            onOpenWord(pick.id)
            setPick(null)
          }}
          onPlayAt={onPlayAt}
        />
      )}
    </div>
  )
}
