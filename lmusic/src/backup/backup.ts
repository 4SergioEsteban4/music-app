import type { Playlist, Track } from '../types'
import {
  dbAddContext,
  dbSetContextNote,
  dbAddPrime,
  dbAllPrime,
  dbLoadPrime,
  dbAllAudio,
  dbAllContexts,
  dbAllLyrics,
  dbAllWordEntries,
  dbGetAudioInfo,
  dbGetLyrics,
  dbLoadSettings,
  dbLoadWords,
  dbRestoreLyrics,
  dbRestoreWord,
  dbSaveAudioInfo,
  dbSetFavorite,
  dbSetPlayStats,
  dbSetSetting,
  dbUpdateSrs,
  dbSetDifficult,
} from '../db/db'
import type { WordBackup } from '../db/db'
import { norm } from '../utils'

/**
 * Respaldo de la configuración: listas ("mixes"), favoritas, conteos, etiquetas editadas, palabras y repaso,
 * letras propias, BPM y ajustes. Las canciones se reconocen por nombre de archivo, título y duración,
 * así el respaldo funciona aunque cambies de teléfono. No incluye los mp3 ni las portadas.
 */

export interface TrackKey {
  f: string // nombre de archivo
  t: string // título
  a: string // artista
  d: number // duración ms
}

interface BackupTrack {
  k: TrackKey
  fav: boolean
  plays: number
  last: number
  edited?: { title: string; artist: string; album: string; genre: string; trackNo: number }
}

export interface BackupData {
  app: 'LMusic'
  version: 1
  exportedAt: string
  settings: Record<string, string>
  tracks: BackupTrack[]
  playlists: { name: string; created: number; tracks: TrackKey[] }[]
  words: { w: WordBackup; ctx: { k: TrackKey; line: string; t: number; n?: string }[] }[]
  lyrics: { k: TrackKey; source: string; synced: string; plain: string; instrumental: boolean; offsetMs: number }[]
  audio: { k: TrackKey; bpm: number; offsetMs: number; confidence: number; source: string }[]
  prime?: { k: TrackKey; startMs: number; endMs: number; stars: number }[]
}

const keyOf = (t: Track): TrackKey => ({ f: t.fileName, t: t.title, a: t.artist, d: t.durationMs })

export async function buildBackup(
  tracks: Track[],
  playlists: Playlist[],
  opts: { allLyrics: boolean; includeBg: boolean },
): Promise<string> {
  const byId = new Map(tracks.map((t) => [t.id, t]))
  const kOf = (id: number): TrackKey | null => {
    const t = byId.get(id)
    return t ? keyOf(t) : null
  }

  const settings = await dbLoadSettings()
  delete settings.aiKey // la clave de la IA nunca sale del teléfono
  if (!opts.includeBg) delete settings.bgImage

  const bt: BackupTrack[] = []
  for (const t of tracks) {
    if (!t.favorite && t.playCount === 0 && !t.metaEdited) continue
    bt.push({
      k: keyOf(t),
      fav: t.favorite,
      plays: t.playCount,
      last: t.lastPlayed,
      edited: t.metaEdited
        ? { title: t.title, artist: t.artist, album: t.album, genre: t.genre, trackNo: t.trackNo }
        : undefined,
    })
  }

  const pls = playlists.map((p) => ({
    name: p.name,
    created: 0,
    tracks: p.trackIds.map(kOf).filter((k): k is TrackKey => k !== null),
  }))

  const words = await dbLoadWords()
  const entries = await dbAllWordEntries()
  const contexts = await dbAllContexts()
  const bw = words.map((w) => ({
    w: {
      word: w.word,
      lang: w.lang,
      translation: w.translation,
      entryJson: entries[w.id] ?? '',
      difficult: w.difficult,
      createdAt: w.createdAt,
      ease: w.ease,
      intervalDays: w.intervalDays,
      reps: w.reps,
      lapses: w.lapses,
      dueAt: w.dueAt,
      lastReviewed: w.lastReviewed,
    },
    ctx: contexts
      .filter((c) => c.wordId === w.id)
      .map((c) => ({ k: kOf(c.trackId), line: c.line, t: c.timeMs, n: c.aiNote || undefined }))
      .filter((c): c is { k: TrackKey; line: string; t: number; n: string | undefined } => c.k !== null),
  }))

  const lyrics = (await dbAllLyrics())
    .filter((r) => opts.allLyrics || r.source !== 'lrclib')
    .map((r) => ({ k: kOf(r.trackId), source: r.source, synced: r.synced, plain: r.plain, instrumental: r.instrumental, offsetMs: r.offsetMs }))
    .filter((r): r is typeof r & { k: TrackKey } => r.k !== null)

  const audio = (await dbAllAudio())
    .map((r) => ({ k: kOf(r.trackId), bpm: r.bpm, offsetMs: r.offsetMs, confidence: r.confidence, source: r.source }))
    .filter((r): r is typeof r & { k: TrackKey } => r.k !== null)

  const data: BackupData = {
    app: 'LMusic',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    tracks: bt,
    playlists: pls,
    words: bw,
    lyrics,
    audio,
    prime: (await dbAllPrime())
      .map((m) => ({ k: kOf(m.trackId), startMs: m.startMs, endMs: m.endMs, stars: m.stars }))
      .filter((m): m is typeof m & { k: TrackKey } => m.k !== null),
  }
  return JSON.stringify(data)
}

export function parseBackup(text: string): BackupData {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('El archivo no es un respaldo válido.')
  }
  const d = data as Partial<BackupData>
  if (!d || d.app !== 'LMusic' || d.version !== 1) throw new Error('Este archivo no es un respaldo de LMusic.')
  return {
    app: 'LMusic',
    version: 1,
    exportedAt: d.exportedAt ?? '',
    settings: d.settings ?? {},
    tracks: d.tracks ?? [],
    playlists: d.playlists ?? [],
    words: d.words ?? [],
    lyrics: d.lyrics ?? [],
    audio: d.audio ?? [],
    prime: d.prime ?? [],
  }
}

/* ---------- restauración ---------- */

interface Index {
  byFile: Map<string, Track[]>
  byTA: Map<string, Track[]>
  byTitle: Map<string, Track[]>
}

function buildIndex(local: Track[]): Index {
  const add = (m: Map<string, Track[]>, k: string, t: Track) => {
    if (!k) return
    const arr = m.get(k)
    if (arr) arr.push(t)
    else m.set(k, [t])
  }
  const idx: Index = { byFile: new Map(), byTA: new Map(), byTitle: new Map() }
  for (const t of local) {
    add(idx.byFile, t.fileName.toLowerCase(), t)
    add(idx.byTA, `${norm(t.title)}|${norm(t.artist)}`, t)
    add(idx.byTitle, norm(t.title), t)
  }
  return idx
}

function find(key: TrackKey, idx: Index): Track | undefined {
  // un respaldo dañado o editado a mano no debe romper la importación
  const k: TrackKey = { f: String(key?.f ?? ''), t: String(key?.t ?? ''), a: String(key?.a ?? ''), d: Number(key?.d ?? 0) }
  if (!k.t && !k.f) return undefined
  const near = (arr: Track[] | undefined, tol: number) => arr?.find((t) => Math.abs(t.durationMs - k.d) <= tol)
  if (k.f) {
    const c = idx.byFile.get(k.f.toLowerCase())
    const hit = near(c, 3000) ?? c?.[0]
    if (hit) return hit
  }
  const ta = idx.byTA.get(`${norm(k.t)}|${norm(k.a)}`)
  const hit = near(ta, 4000) ?? ta?.[0]
  if (hit) return hit
  return near(idx.byTitle.get(norm(k.t)), 2000)
}

export interface BackupSummary {
  tracksInFile: number
  tracksMatched: number
  playlists: number
  playlistTracks: number
  words: number
  lyrics: number
}

export function summarize(data: BackupData, local: Track[]): BackupSummary {
  const idx = buildIndex(local)
  const keys = new Map<string, TrackKey>()
  const addKey = (k: TrackKey) => keys.set(`${k.f}|${k.t}|${k.a}|${k.d}`, k)
  data.tracks.forEach((t) => addKey(t.k))
  data.playlists.forEach((p) => p.tracks.forEach(addKey))
  const matched = [...keys.values()].filter((k) => find(k, idx)).length
  return {
    tracksInFile: keys.size,
    tracksMatched: matched,
    playlists: data.playlists.length,
    playlistTracks: data.playlists.reduce((n, p) => n + p.tracks.length, 0),
    words: data.words.length,
    lyrics: data.lyrics.length,
  }
}

export interface RestoreCtx {
  tracks: Track[]
  playlists: Playlist[]
  createPlaylist: (name: string) => Promise<number>
  addToPlaylist: (playlistId: number, trackIds: number[]) => Promise<void>
  updateMeta: (u: { id: number; patch: { title: string; artist: string; album: string; genre: string; trackNo: number } }[]) => Promise<void>
}

export async function restoreBackup(data: BackupData, ctx: RestoreCtx): Promise<{ missing: number }> {
  const idx = buildIndex(ctx.tracks)
  let missing = 0
  const get = (k: TrackKey): Track | undefined => {
    const t = find(k, idx)
    if (!t) missing++
    return t
  }

  // ajustes (la clave de IA no viaja en el respaldo)
  for (const [k, v] of Object.entries(data.settings)) {
    if (k === 'aiKey') continue
    await dbSetSetting(k, v)
  }

  // favoritas, conteos y etiquetas editadas
  const metaUpdates: Parameters<RestoreCtx['updateMeta']>[0] = []
  for (const b of data.tracks) {
    const t = find(b.k, idx)
    if (!t) continue
    if (b.fav && !t.favorite) await dbSetFavorite(t.id, true)
    if (b.plays > t.playCount || b.last > t.lastPlayed) {
      await dbSetPlayStats(t.id, Math.max(b.plays, t.playCount), Math.max(b.last, t.lastPlayed))
    }
    if (b.edited) metaUpdates.push({ id: t.id, patch: b.edited })
  }
  if (metaUpdates.length) await ctx.updateMeta(metaUpdates)

  // listas
  for (const p of data.playlists) {
    const ids = p.tracks.map((k) => find(k, idx)?.id).filter((id): id is number => id !== undefined)
    const existing = ctx.playlists.find((x) => x.name === p.name)
    const pid = existing ? existing.id : await ctx.createPlaylist(p.name)
    if (ids.length) await ctx.addToPlaylist(pid, ids)
  }

  // palabras
  for (const w of data.words) {
    const { id, created } = await dbRestoreWord(w.w)
    if (created) {
      await dbUpdateSrs(id, {
        ease: w.w.ease,
        intervalDays: w.w.intervalDays,
        reps: w.w.reps,
        lapses: w.w.lapses,
        dueAt: w.w.dueAt,
        lastReviewed: w.w.lastReviewed,
      })
      if (w.w.difficult) await dbSetDifficult(id, true)
    }
    for (const c of w.ctx) {
      const t = get(c.k)
      if (t) {
        await dbAddContext(id, t.id, c.line, c.t)
        if (c.n) await dbSetContextNote(id, t.id, c.t, c.n)
      }
    }
  }

  // letras propias (no se pisa una letra que ya exista)
  for (const l of data.lyrics) {
    const t = get(l.k)
    if (!t) continue
    if (await dbGetLyrics(t.id)) continue
    await dbRestoreLyrics(t.id, { status: 'found', source: l.source, synced: l.synced, plain: l.plain, instrumental: l.instrumental, offsetMs: l.offsetMs })
  }

  // BPM
  for (const a of data.audio) {
    const t = get(a.k)
    if (!t) continue
    if (await dbGetAudioInfo(t.id)) continue
    await dbSaveAudioInfo(t.id, { bpm: a.bpm, offsetMs: a.offsetMs, confidence: a.confidence, source: a.source })
  }

  // momentos prime
  for (const m of data.prime ?? []) {
    const t = get(m.k)
    if (!t) continue
    const have = await dbLoadPrime(t.id)
    if (have.some((x) => x.startMs === m.startMs && x.endMs === m.endMs)) continue
    await dbAddPrime(t.id, m.startMs, m.endMs, m.stars)
  }
  return { missing }
}
