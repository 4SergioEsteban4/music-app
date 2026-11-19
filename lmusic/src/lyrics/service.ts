import type { Track } from '../types'
import { dbGetLyrics, dbSaveLyrics, dbSetLyricsOffset } from '../db/db'
import type { LyricsRow } from '../db/db'
import { findLyrics } from './lrclib'
import type { LrclibRecord } from './lrclib'
import { isSyncedLrc, lrcToPlain } from './lrc'

export type LyricsResult = LyricsRow

const mem = new Map<number, LyricsResult>()
const listeners = new Set<(trackId: number) => void>()

/** Avisa a las pantallas abiertas cuando la letra de una canción cambió (editor, fragmento…). */
export function onLyricsChanged(fn: (trackId: number) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const emitChanged = (id: number) => listeners.forEach((fn) => fn(id))

/**
 * Devuelve la letra de una canción: primero la guardada, y si no existe la busca en LRCLIB.
 * Lanza LyricsNetworkError si no hay conexión (en ese caso no se guarda nada).
 */
export async function loadLyrics(track: Track, opts: { force?: boolean } = {}): Promise<LyricsResult> {
  if (!opts.force) {
    const cached = mem.get(track.id)
    if (cached) return cached
    const row = await dbGetLyrics(track.id)
    if (row) {
      mem.set(track.id, row)
      return row
    }
  }

  const rec = await findLyrics({
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
  })

  const data: Omit<LyricsRow, 'offsetMs'> = rec
    ? {
        status: 'found',
        source: 'lrclib',
        synced: rec.syncedLyrics ?? '',
        plain: rec.plainLyrics ?? '',
        instrumental: rec.instrumental && !rec.syncedLyrics && !rec.plainLyrics,
      }
    : { status: 'none', source: '', synced: '', plain: '', instrumental: false }

  await dbSaveLyrics(track.id, data)
  const saved = (await dbGetLyrics(track.id)) as LyricsResult
  mem.set(track.id, saved)
  return saved
}

/** Guarda una letra que el usuario importó desde un archivo .lrc o .txt. */
export async function importLyricsText(track: Track, text: string): Promise<LyricsResult> {
  const synced = isSyncedLrc(text)
  await dbSaveLyrics(track.id, {
    status: 'found',
    source: 'file',
    synced: synced ? text : '',
    plain: synced ? lrcToPlain(text) : text.trim(),
    instrumental: false,
  })
  const saved = (await dbGetLyrics(track.id)) as LyricsResult
  mem.set(track.id, saved)
  return saved
}

export async function setLyricsOffset(trackId: number, offsetMs: number): Promise<void> {
  await dbSetLyricsOffset(trackId, offsetMs)
  const cur = mem.get(trackId)
  if (cur) mem.set(trackId, { ...cur, offsetMs })
}

/** Guarda una letra elegida a mano (p. ej. la encontrada por fragmento) para esta canción. */
export async function applyLyricsRecord(track: Track, rec: LrclibRecord, source = 'lrclib'): Promise<LyricsResult> {
  await dbSaveLyrics(track.id, {
    status: 'found',
    source,
    synced: rec.syncedLyrics ?? '',
    plain: rec.plainLyrics ?? '',
    instrumental: rec.instrumental && !rec.syncedLyrics && !rec.plainLyrics,
  })
  const saved = (await dbGetLyrics(track.id)) as LyricsResult
  mem.set(track.id, saved)
  emitChanged(track.id)
  return saved
}

/** Guarda una letra sincronizada a mano con el editor. */
export async function saveManualLyrics(track: Track, lrc: string): Promise<LyricsResult> {
  await dbSaveLyrics(track.id, {
    status: 'found',
    source: 'manual',
    synced: lrc,
    plain: lrcToPlain(lrc),
    instrumental: false,
  })
  const saved = (await dbGetLyrics(track.id)) as LyricsResult
  mem.set(track.id, saved)
  emitChanged(track.id)
  return saved
}

/** Quita la letra de la canción y deja marcado que no hay, para que no se vuelva a buscar sola. */
export async function deleteLyrics(track: Track): Promise<void> {
  await dbSaveLyrics(track.id, { status: 'none', source: '', synced: '', plain: '', instrumental: false })
  const saved = (await dbGetLyrics(track.id)) as LyricsResult
  mem.set(track.id, saved)
  emitChanged(track.id)
}
