import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ContextRow, Word } from '../types'
import {
  dbAddContext,
  dbSetContextNote,
  dbDeleteWord,
  dbGetContexts,
  dbGetWordEntry,
  dbInsertWord,
  dbLoadWords,
  dbSetDifficult,
  dbUpdateSrs,
  dbUpdateWordEntry,
  openDb,
} from '../db/db'
import { emptyEntry, entryHasContent, shortTranslation } from '../learn/dictionary'
import type { DictEntry } from '../learn/dictionary'
import { nextSrs } from '../learn/srs'
import type { Grade } from '../learn/srs'

export interface SaveContext {
  trackId: number
  line: string
  timeMs: number
}

interface VocabValue {
  words: Word[]
  loaded: boolean
  now: number
  dueCount: number
  find: (word: string, lang: string) => Word | undefined
  save: (word: string, lang: string, entry: DictEntry | null, ctx: SaveContext) => Promise<Word>
  addContext: (wordId: number, ctx: SaveContext) => Promise<void>
  saveAiNote: (wordId: number, trackId: number, timeMs: number, note: string) => Promise<void>
  setDifficult: (id: number, value: boolean) => Promise<void>
  remove: (id: number) => Promise<void>
  grade: (id: number, g: Grade) => Promise<void>
  getContexts: (id: number) => Promise<ContextRow[]>
  getEntry: (id: number) => Promise<DictEntry | null>
  reload: () => Promise<void>
}

const Ctx = createContext<VocabValue | null>(null)

export function useVocab(): VocabValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useVocab fuera de VocabProvider')
  return v
}

export function VocabProvider({ children }: { children: ReactNode }) {
  const [words, setWords] = useState<Word[]>([])
  const [loaded, setLoaded] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        await openDb()
        const list = await dbLoadWords()
        if (alive) setWords(list)
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    const t = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [])

  const dueCount = useMemo(() => words.filter((w) => w.dueAt <= now).length, [words, now])

  const find = useCallback(
    (word: string, lang: string) => words.find((w) => w.word === word && w.lang === lang),
    [words],
  )

  const addContext = useCallback(async (wordId: number, ctx: SaveContext) => {
    await dbAddContext(wordId, ctx.trackId, ctx.line, ctx.timeMs)
  }, [])

  const saveAiNote = useCallback(async (wordId: number, trackId: number, timeMs: number, note: string) => {
    await dbSetContextNote(wordId, trackId, timeMs, note)
  }, [])

  const save = useCallback(
    async (word: string, lang: string, entry: DictEntry | null, ctx: SaveContext): Promise<Word> => {
      const translation = shortTranslation(entry)
      const json = entry && entryHasContent(entry) ? JSON.stringify(entry) : ''
      const id = await dbInsertWord(word, lang, translation, json)
      // si la palabra ya existía sin datos (se guardó sin internet), completarla ahora
      if (json) await dbUpdateWordEntry(id, translation, json)
      await dbAddContext(id, ctx.trackId, ctx.line, ctx.timeMs)
      const list = await dbLoadWords()
      setWords(list)
      return list.find((w) => w.id === id) as Word
    },
    [],
  )

  const setDifficult = useCallback(async (id: number, value: boolean) => {
    await dbSetDifficult(id, value)
    setWords((prev) => prev.map((w) => (w.id === id ? { ...w, difficult: value } : w)))
  }, [])

  const remove = useCallback(async (id: number) => {
    await dbDeleteWord(id)
    setWords((prev) => prev.filter((w) => w.id !== id))
  }, [])

  const grade = useCallback(
    async (id: number, g: Grade) => {
      const w = words.find((x) => x.id === id)
      if (!w) return
      const { state, dueInMs } = nextSrs(w, g)
      const at = Date.now()
      const upd = { ...state, dueAt: at + dueInMs, lastReviewed: at }
      await dbUpdateSrs(id, upd)
      setWords((prev) => prev.map((x) => (x.id === id ? { ...x, ...upd } : x)))
      setNow(at)
    },
    [words],
  )

  const reload = useCallback(async () => {
    setWords(await dbLoadWords())
  }, [])

  const getContexts = useCallback((id: number) => dbGetContexts(id), [])

  const getEntry = useCallback(async (id: number): Promise<DictEntry | null> => {
    const raw = await dbGetWordEntry(id)
    if (!raw) return null
    try {
      return { ...emptyEntry(''), ...(JSON.parse(raw) as DictEntry) }
    } catch {
      return null
    }
  }, [])

  const value = useMemo<VocabValue>(
    () => ({ words, loaded, now, dueCount, find, save, addContext, saveAiNote, setDifficult, remove, grade, getContexts, getEntry, reload }),
    [words, loaded, now, dueCount, find, save, addContext, saveAiNote, setDifficult, remove, grade, getContexts, getEntry, reload],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
