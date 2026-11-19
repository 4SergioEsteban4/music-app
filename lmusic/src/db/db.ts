import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import type { SQLiteDBConnection } from '@capacitor-community/sqlite'
import type { ContextRow, Playlist, Track, Word } from '../types'
import type { ScannedTrack } from '../native/lmusic'

const DB_NAME = 'lmusic'
const sqlite = new SQLiteConnection(CapacitorSQLite)
let db: SQLiteDBConnection | null = null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracks(
  id INTEGER PRIMARY KEY,
  uri TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  track_no INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  date_added INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  meta_edited INTEGER NOT NULL DEFAULT 0,
  missing INTEGER NOT NULL DEFAULT 0,
  file_name TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS playlists(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist_tracks(
  playlist_id INTEGER NOT NULL,
  track_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY(playlist_id, track_id)
);
CREATE TABLE IF NOT EXISTS lyrics(
  track_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  synced TEXT NOT NULL DEFAULT '',
  plain TEXT NOT NULL DEFAULT '',
  instrumental INTEGER NOT NULL DEFAULT 0,
  offset_ms INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audio_info(
  track_id INTEGER PRIMARY KEY,
  bpm REAL NOT NULL DEFAULT 0,
  offset_ms REAL NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT '',
  analyzed_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cover_online2(
  track_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL,
  tried_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prime_moments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  stars INTEGER NOT NULL DEFAULT 4
);
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dict_cache(
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS words(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'en',
  translation TEXT NOT NULL DEFAULT '',
  entry_json TEXT NOT NULL DEFAULT '',
  difficult INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL DEFAULT 0,
  last_reviewed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(word, lang)
);
CREATE TABLE IF NOT EXISTS word_contexts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id INTEGER NOT NULL,
  track_id INTEGER NOT NULL,
  line TEXT NOT NULL,
  time_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(word_id, track_id, time_ms)
);
`

function conn(): SQLiteDBConnection {
  if (!db) throw new Error('La base de datos no está abierta')
  return db
}

let opening: Promise<void> | null = null

/** Abre la base una sola vez; cualquier parte de la app puede esperarla con `await openDb()`. */
export function openDb(): Promise<void> {
  if (!opening) {
    opening = doOpen().catch((e) => {
      opening = null
      throw e
    })
  }
  return opening
}

async function doOpen(): Promise<void> {
  const consistent = (await sqlite.checkConnectionsConsistency()).result
  const exists = (await sqlite.isConnection(DB_NAME, false)).result
  if (consistent && exists) {
    db = await sqlite.retrieveConnection(DB_NAME, false)
  } else {
    db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false)
  }
  await db.open()
  await db.execute(SCHEMA)
  // Bases creadas antes de esta versión: agregar la columna del nombre de archivo
  try {
    await db.execute("ALTER TABLE tracks ADD COLUMN file_name TEXT NOT NULL DEFAULT ''")
  } catch {
    // ya existe
  }
  // Explicación de la IA guardada junto a cada contexto de una palabra
  try {
    await db.execute("ALTER TABLE word_contexts ADD COLUMN ai_note TEXT NOT NULL DEFAULT ''")
  } catch {
    // ya existe
  }
}

/* ---------- canciones ---------- */

interface TrackRow {
  id: number
  uri: string
  title: string
  artist: string
  album: string
  genre: string
  track_no: number
  duration_ms: number
  date_added: number
  size: number
  play_count: number
  last_played: number
  favorite: number
  meta_edited: number
  file_name: string
}

export async function loadTracks(): Promise<Track[]> {
  const res = await conn().query('SELECT * FROM tracks WHERE missing = 0')
  const rows = (res.values ?? []) as TrackRow[]
  return rows.map((r) => ({
    id: r.id,
    uri: r.uri,
    title: r.title,
    artist: r.artist,
    album: r.album,
    genre: r.genre,
    trackNo: r.track_no,
    durationMs: r.duration_ms,
    dateAdded: r.date_added,
    size: r.size,
    playCount: r.play_count,
    lastPlayed: r.last_played,
    favorite: r.favorite === 1,
    metaEdited: r.meta_edited === 1,
    fileName: r.file_name ?? '',
  }))
}

const UPSERT = `
INSERT INTO tracks(id,uri,title,artist,album,genre,track_no,duration_ms,date_added,size,file_name,missing)
VALUES(?,?,?,?,?,?,?,?,?,?,?,0)
ON CONFLICT(id) DO UPDATE SET
  uri=excluded.uri,
  duration_ms=excluded.duration_ms,
  date_added=excluded.date_added,
  size=excluded.size,
  file_name=excluded.file_name,
  missing=0,
  title=CASE WHEN tracks.meta_edited=1 THEN tracks.title ELSE excluded.title END,
  artist=CASE WHEN tracks.meta_edited=1 THEN tracks.artist ELSE excluded.artist END,
  album=CASE WHEN tracks.meta_edited=1 THEN tracks.album ELSE excluded.album END,
  genre=CASE WHEN tracks.meta_edited=1 THEN tracks.genre ELSE excluded.genre END,
  track_no=CASE WHEN tracks.meta_edited=1 THEN tracks.track_no ELSE excluded.track_no END
`

/** Sincroniza lo escaneado con la BD conservando conteos, favoritas y ediciones del usuario. */
export async function syncScanned(scanned: ScannedTrack[]): Promise<void> {
  const set = [
    { statement: 'UPDATE tracks SET missing = 1', values: [] as unknown[] },
    ...scanned.map((t) => ({
      statement: UPSERT,
      values: [
        t.id,
        t.uri,
        t.title,
        t.artist,
        t.album,
        t.genre,
        t.trackNo,
        t.durationMs,
        t.dateAdded,
        t.size,
        t.fileName ?? '',
      ],
    })),
  ]
  await conn().executeSet(set, true)
}

export async function dbRecordPlay(id: number, at: number): Promise<void> {
  await conn().run('UPDATE tracks SET play_count = play_count + 1, last_played = ? WHERE id = ?', [
    at,
    id,
  ])
}

export async function dbSetFavorite(id: number, value: boolean): Promise<void> {
  await conn().run('UPDATE tracks SET favorite = ? WHERE id = ?', [value ? 1 : 0, id])
}

/* ---------- listas de reproducción ---------- */

export async function loadPlaylists(): Promise<Playlist[]> {
  const lists = await conn().query('SELECT id, name FROM playlists ORDER BY created_at DESC')
  const items = await conn().query(
    'SELECT playlist_id, track_id FROM playlist_tracks ORDER BY playlist_id, position',
  )
  const map = new Map<number, number[]>()
  for (const r of (items.values ?? []) as { playlist_id: number; track_id: number }[]) {
    const arr = map.get(r.playlist_id) ?? []
    arr.push(r.track_id)
    map.set(r.playlist_id, arr)
  }
  return ((lists.values ?? []) as { id: number; name: string }[]).map((l) => ({
    id: l.id,
    name: l.name,
    trackIds: map.get(l.id) ?? [],
  }))
}

export async function dbCreatePlaylist(name: string): Promise<number> {
  const res = await conn().run('INSERT INTO playlists(name, created_at) VALUES(?, ?)', [
    name,
    Date.now(),
  ])
  const id = res.changes?.lastId
  if (typeof id !== 'number') throw new Error('No se pudo crear la lista')
  return id
}

export async function dbRenamePlaylist(id: number, name: string): Promise<void> {
  await conn().run('UPDATE playlists SET name = ? WHERE id = ?', [name, id])
}

export async function dbDeletePlaylist(id: number): Promise<void> {
  await conn().executeSet(
    [
      { statement: 'DELETE FROM playlist_tracks WHERE playlist_id = ?', values: [id] },
      { statement: 'DELETE FROM playlists WHERE id = ?', values: [id] },
    ],
    true,
  )
}

export async function dbAddToPlaylist(
  playlistId: number,
  trackIds: number[],
  startPosition: number,
): Promise<void> {
  const set = trackIds.map((tid, i) => ({
    statement:
      'INSERT OR IGNORE INTO playlist_tracks(playlist_id, track_id, position) VALUES(?,?,?)',
    values: [playlistId, tid, startPosition + i],
  }))
  if (set.length) await conn().executeSet(set, true)
}

export async function dbRemoveFromPlaylist(playlistId: number, trackId: number): Promise<void> {
  await conn().run('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?', [
    playlistId,
    trackId,
  ])
}

/* ---------- letras ---------- */

export interface LyricsRow {
  status: 'found' | 'none'
  source: string
  synced: string
  plain: string
  instrumental: boolean
  offsetMs: number
}

export async function dbGetLyrics(trackId: number): Promise<LyricsRow | null> {
  const res = await conn().query('SELECT * FROM lyrics WHERE track_id = ?', [trackId])
  const r = (res.values ?? [])[0] as
    | {
        status: string
        source: string
        synced: string
        plain: string
        instrumental: number
        offset_ms: number
      }
    | undefined
  if (!r) return null
  return {
    status: r.status === 'found' ? 'found' : 'none',
    source: r.source,
    synced: r.synced,
    plain: r.plain,
    instrumental: r.instrumental === 1,
    offsetMs: r.offset_ms,
  }
}

/** Guarda la letra conservando el desfase que el usuario haya ajustado. */
export async function dbSaveLyrics(
  trackId: number,
  d: Omit<LyricsRow, 'offsetMs'>,
): Promise<void> {
  await conn().run(
    `INSERT INTO lyrics(track_id,status,source,synced,plain,instrumental,fetched_at)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(track_id) DO UPDATE SET
       status=excluded.status, source=excluded.source, synced=excluded.synced,
       plain=excluded.plain, instrumental=excluded.instrumental, fetched_at=excluded.fetched_at`,
    [trackId, d.status, d.source, d.synced, d.plain, d.instrumental ? 1 : 0, Date.now()],
  )
}

export async function dbSetLyricsOffset(trackId: number, offsetMs: number): Promise<void> {
  await conn().run('UPDATE lyrics SET offset_ms = ? WHERE track_id = ?', [offsetMs, trackId])
}

/** track_id -> 'found' | 'none' para todas las canciones que ya se intentaron. */
export async function dbLyricsIndex(): Promise<Map<number, 'found' | 'none'>> {
  const res = await conn().query('SELECT track_id, status FROM lyrics')
  const map = new Map<number, 'found' | 'none'>()
  for (const r of (res.values ?? []) as { track_id: number; status: string }[]) {
    map.set(r.track_id, r.status === 'found' ? 'found' : 'none')
  }
  return map
}

/* ---------- ajustes ---------- */

export async function dbLoadSettings(): Promise<Record<string, string>> {
  const res = await conn().query('SELECT key, value FROM settings')
  const out: Record<string, string> = {}
  for (const r of (res.values ?? []) as { key: string; value: string }[]) out[r.key] = r.value
  return out
}

export async function dbSetSetting(key: string, value: string): Promise<void> {
  await conn().run(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [key, value],
  )
}

/* ---------- caché del diccionario ---------- */

export async function dbCacheGet(key: string): Promise<string | null> {
  const res = await conn().query('SELECT json FROM dict_cache WHERE key = ?', [key])
  const r = (res.values ?? [])[0] as { json: string } | undefined
  return r ? r.json : null
}

export async function dbCacheSet(key: string, json: string): Promise<void> {
  await conn().run(
    'INSERT INTO dict_cache(key,json,fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json, fetched_at=excluded.fetched_at',
    [key, json, Date.now()],
  )
}

/* ---------- vocabulario ---------- */

interface WordDbRow {
  id: number
  word: string
  lang: string
  translation: string
  difficult: number
  created_at: number
  ease: number
  interval_days: number
  reps: number
  lapses: number
  due_at: number
  last_reviewed: number
}

export async function dbLoadWords(): Promise<Word[]> {
  const res = await conn().query(
    'SELECT id,word,lang,translation,difficult,created_at,ease,interval_days,reps,lapses,due_at,last_reviewed FROM words ORDER BY created_at DESC',
  )
  return ((res.values ?? []) as WordDbRow[]).map((r) => ({
    id: r.id,
    word: r.word,
    lang: r.lang,
    translation: r.translation,
    difficult: r.difficult === 1,
    createdAt: r.created_at,
    ease: r.ease,
    intervalDays: r.interval_days,
    reps: r.reps,
    lapses: r.lapses,
    dueAt: r.due_at,
    lastReviewed: r.last_reviewed,
  }))
}

/** Inserta la palabra (si no existía) y devuelve su id. */
export async function dbInsertWord(
  word: string,
  lang: string,
  translation: string,
  entryJson: string,
): Promise<number> {
  await conn().run(
    'INSERT OR IGNORE INTO words(word,lang,translation,entry_json,created_at) VALUES(?,?,?,?,?)',
    [word, lang, translation, entryJson, Date.now()],
  )
  const res = await conn().query('SELECT id FROM words WHERE word = ? AND lang = ?', [word, lang])
  const r = (res.values ?? [])[0] as { id: number } | undefined
  if (!r) throw new Error('No se pudo guardar la palabra')
  return r.id
}

export async function dbGetWordEntry(id: number): Promise<string> {
  const res = await conn().query('SELECT entry_json FROM words WHERE id = ?', [id])
  const r = (res.values ?? [])[0] as { entry_json: string } | undefined
  return r ? r.entry_json : ''
}

export async function dbUpdateWordEntry(id: number, translation: string, entryJson: string): Promise<void> {
  await conn().run('UPDATE words SET translation = ?, entry_json = ? WHERE id = ?', [translation, entryJson, id])
}

export async function dbAddContext(
  wordId: number,
  trackId: number,
  line: string,
  timeMs: number,
): Promise<void> {
  await conn().run(
    'INSERT OR IGNORE INTO word_contexts(word_id,track_id,line,time_ms,created_at) VALUES(?,?,?,?,?)',
    [wordId, trackId, line, timeMs, Date.now()],
  )
}

export async function dbGetContexts(wordId: number): Promise<ContextRow[]> {
  const res = await conn().query(
    'SELECT id,track_id,line,time_ms,created_at,ai_note FROM word_contexts WHERE word_id = ? ORDER BY created_at DESC',
    [wordId],
  )
  return ((res.values ?? []) as { id: number; track_id: number; line: string; time_ms: number; created_at: number; ai_note: string | null }[]).map(
    (r) => ({ id: r.id, trackId: r.track_id, line: r.line, timeMs: r.time_ms, createdAt: r.created_at, aiNote: r.ai_note ?? '' }),
  )
}

export async function dbSetContextNote(wordId: number, trackId: number, timeMs: number, note: string): Promise<void> {
  await conn().run('UPDATE word_contexts SET ai_note = ? WHERE word_id = ? AND track_id = ? AND time_ms = ?', [note, wordId, trackId, timeMs])
}

/** Canciones cuya letra contiene el texto (búsqueda en las letras ya descargadas). */
export async function dbSearchLyricTracks(text: string): Promise<number[]> {
  const t = text.trim()
  if (t.length < 3) return []
  const like = `%${t.replace(/[%_]/g, ' ')}%`
  const res = await conn().query('SELECT track_id FROM lyrics WHERE status = ? AND plain LIKE ? LIMIT 60', ['found', like])
  return ((res.values ?? []) as { track_id: number }[]).map((r) => r.track_id)
}

export async function dbSetDifficult(id: number, value: boolean): Promise<void> {
  await conn().run('UPDATE words SET difficult = ? WHERE id = ?', [value ? 1 : 0, id])
}

export async function dbDeleteWord(id: number): Promise<void> {
  await conn().executeSet(
    [
      { statement: 'DELETE FROM word_contexts WHERE word_id = ?', values: [id] },
      { statement: 'DELETE FROM words WHERE id = ?', values: [id] },
    ],
    true,
  )
}

export async function dbUpdateSrs(
  id: number,
  s: { ease: number; intervalDays: number; reps: number; lapses: number; dueAt: number; lastReviewed: number },
): Promise<void> {
  await conn().run(
    'UPDATE words SET ease=?, interval_days=?, reps=?, lapses=?, due_at=?, last_reviewed=? WHERE id=?',
    [s.ease, s.intervalDays, s.reps, s.lapses, s.dueAt, s.lastReviewed, id],
  )
}

/* ---------- BPM / ritmo ---------- */

export interface AudioInfo {
  bpm: number // 0 = no se pudo analizar
  offsetMs: number
  confidence: number
  source: string
}

export async function dbGetAudioInfo(trackId: number): Promise<AudioInfo | null> {
  const res = await conn().query('SELECT bpm, offset_ms, confidence, source FROM audio_info WHERE track_id = ?', [
    trackId,
  ])
  const r = (res.values ?? [])[0] as
    | { bpm: number; offset_ms: number; confidence: number; source: string }
    | undefined
  return r ? { bpm: r.bpm, offsetMs: r.offset_ms, confidence: r.confidence, source: r.source } : null
}

export async function dbSaveAudioInfo(trackId: number, i: AudioInfo): Promise<void> {
  await conn().run(
    `INSERT INTO audio_info(track_id,bpm,offset_ms,confidence,source,analyzed_at) VALUES(?,?,?,?,?,?)
     ON CONFLICT(track_id) DO UPDATE SET bpm=excluded.bpm, offset_ms=excluded.offset_ms,
       confidence=excluded.confidence, source=excluded.source, analyzed_at=excluded.analyzed_at`,
    [trackId, i.bpm, i.offsetMs, i.confidence, i.source, Date.now()],
  )
}

/** track_id -> bpm (0 si el análisis falló) para todo lo ya analizado. */
export async function dbAudioIndex(): Promise<Map<number, number>> {
  const res = await conn().query('SELECT track_id, bpm FROM audio_info')
  return new Map(((res.values ?? []) as { track_id: number; bpm: number }[]).map((r) => [r.track_id, r.bpm]))
}

/* ---------- portadas buscadas en internet ---------- */

/** track_id -> 'found' | 'none' para las canciones ya intentadas. */
export async function dbCoverOnlineIndex(): Promise<Map<number, 'found' | 'none'>> {
  const res = await conn().query('SELECT track_id, status FROM cover_online2')
  return new Map(
    ((res.values ?? []) as { track_id: number; status: string }[]).map((r) => [
      r.track_id,
      r.status === 'found' ? 'found' : 'none',
    ]),
  )
}

/** Olvida cuáles portadas vinieron de internet (para poder volver a buscarlas desde cero). */
export async function dbClearCoverOnline(): Promise<void> {
  await conn().run('DELETE FROM cover_online2')
}

export async function dbSetCoverOnline(trackId: number, status: 'found' | 'none'): Promise<void> {
  await conn().run(
    'INSERT INTO cover_online2(track_id,status,tried_at) VALUES(?,?,?) ON CONFLICT(track_id) DO UPDATE SET status=excluded.status, tried_at=excluded.tried_at',
    [trackId, status, Date.now()],
  )
}

/* ---------- edición de etiquetas (solo en la base de LMusic) ---------- */

export interface MetaPatch {
  title?: string
  artist?: string
  album?: string
  genre?: string
  trackNo?: number
}

export async function dbUpdateTrackMeta(id: number, p: MetaPatch): Promise<void> {
  const sets: string[] = []
  const vals: unknown[] = []
  if (p.title !== undefined) (sets.push('title = ?'), vals.push(p.title))
  if (p.artist !== undefined) (sets.push('artist = ?'), vals.push(p.artist))
  if (p.album !== undefined) (sets.push('album = ?'), vals.push(p.album))
  if (p.genre !== undefined) (sets.push('genre = ?'), vals.push(p.genre))
  if (p.trackNo !== undefined) (sets.push('track_no = ?'), vals.push(p.trackNo))
  if (!sets.length) return
  await conn().run(`UPDATE tracks SET ${sets.join(', ')}, meta_edited = 1 WHERE id = ?`, [...vals, id])
}

/** Devuelve la canción a los datos que trae el archivo (se recuperan al volver a escanear). */
export async function dbRevertTrackMeta(ids: number[]): Promise<void> {
  if (!ids.length) return
  await conn().executeSet(
    ids.map((id) => ({ statement: 'UPDATE tracks SET meta_edited = 0 WHERE id = ?', values: [id] })),
    true,
  )
}

/* ---------- respaldo: lectura y restauración masiva ---------- */

export interface LyricsBackupRow {
  trackId: number
  status: 'found' | 'none'
  source: string
  synced: string
  plain: string
  instrumental: boolean
  offsetMs: number
}

export async function dbAllLyrics(): Promise<LyricsBackupRow[]> {
  const res = await conn().query(
    'SELECT track_id,status,source,synced,plain,instrumental,offset_ms FROM lyrics WHERE status = ?',
    ['found'],
  )
  return ((res.values ?? []) as {
    track_id: number
    status: string
    source: string
    synced: string
    plain: string
    instrumental: number
    offset_ms: number
  }[]).map((r) => ({
    trackId: r.track_id,
    status: 'found',
    source: r.source,
    synced: r.synced,
    plain: r.plain,
    instrumental: r.instrumental === 1,
    offsetMs: r.offset_ms,
  }))
}

export async function dbRestoreLyrics(trackId: number, r: Omit<LyricsBackupRow, 'trackId'>): Promise<void> {
  await dbSaveLyrics(trackId, {
    status: r.status,
    source: r.source,
    synced: r.synced,
    plain: r.plain,
    instrumental: r.instrumental,
  })
  await dbSetLyricsOffset(trackId, r.offsetMs)
}

export async function dbAllAudio(): Promise<({ trackId: number } & AudioInfo)[]> {
  const res = await conn().query('SELECT track_id,bpm,offset_ms,confidence,source FROM audio_info WHERE bpm > 0')
  return ((res.values ?? []) as { track_id: number; bpm: number; offset_ms: number; confidence: number; source: string }[]).map(
    (r) => ({ trackId: r.track_id, bpm: r.bpm, offsetMs: r.offset_ms, confidence: r.confidence, source: r.source }),
  )
}

export async function dbAllWordEntries(): Promise<Record<number, string>> {
  const res = await conn().query('SELECT id, entry_json FROM words')
  const out: Record<number, string> = {}
  for (const r of (res.values ?? []) as { id: number; entry_json: string }[]) out[r.id] = r.entry_json
  return out
}

export async function dbAllContexts(): Promise<{ wordId: number; trackId: number; line: string; timeMs: number; aiNote: string }[]> {
  const res = await conn().query('SELECT word_id,track_id,line,time_ms,ai_note FROM word_contexts')
  return ((res.values ?? []) as { word_id: number; track_id: number; line: string; time_ms: number; ai_note: string | null }[]).map((r) => ({
    wordId: r.word_id,
    trackId: r.track_id,
    line: r.line,
    timeMs: r.time_ms,
    aiNote: r.ai_note ?? '',
  }))
}

export async function dbSetPlayStats(id: number, count: number, last: number): Promise<void> {
  await conn().run('UPDATE tracks SET play_count = ?, last_played = ? WHERE id = ?', [count, last, id])
}

export interface WordBackup {
  word: string
  lang: string
  translation: string
  entryJson: string
  difficult: boolean
  createdAt: number
  ease: number
  intervalDays: number
  reps: number
  lapses: number
  dueAt: number
  lastReviewed: number
}

/** Restaura una palabra del respaldo. Si ya existía se deja como está. */
export async function dbRestoreWord(w: WordBackup): Promise<{ id: number; created: boolean }> {
  const found = await conn().query('SELECT id FROM words WHERE word = ? AND lang = ?', [w.word, w.lang])
  const row = (found.values ?? [])[0] as { id: number } | undefined
  if (row) return { id: row.id, created: false }
  await conn().run(
    'INSERT INTO words(word,lang,translation,entry_json,difficult,created_at,ease,interval_days,reps,lapses,due_at,last_reviewed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    [w.word, w.lang, w.translation, w.entryJson, w.difficult ? 1 : 0, w.createdAt, w.ease, w.intervalDays, w.reps, w.lapses, w.dueAt, w.lastReviewed],
  )
  const again = await conn().query('SELECT id FROM words WHERE word = ? AND lang = ?', [w.word, w.lang])
  return { id: ((again.values ?? [])[0] as { id: number }).id, created: true }
}

/* ---------- momentos prime ---------- */

export interface PrimeMoment {
  id: number
  trackId: number
  startMs: number
  endMs: number
  stars: number
}

export async function dbLoadPrime(trackId: number): Promise<PrimeMoment[]> {
  const res = await conn().query(
    'SELECT id,track_id,start_ms,end_ms,stars FROM prime_moments WHERE track_id = ? ORDER BY start_ms',
    [trackId],
  )
  return ((res.values ?? []) as { id: number; track_id: number; start_ms: number; end_ms: number; stars: number }[]).map(
    (r) => ({ id: r.id, trackId: r.track_id, startMs: r.start_ms, endMs: r.end_ms, stars: r.stars }),
  )
}

export async function dbAllPrime(): Promise<PrimeMoment[]> {
  const res = await conn().query('SELECT id,track_id,start_ms,end_ms,stars FROM prime_moments')
  return ((res.values ?? []) as { id: number; track_id: number; start_ms: number; end_ms: number; stars: number }[]).map(
    (r) => ({ id: r.id, trackId: r.track_id, startMs: r.start_ms, endMs: r.end_ms, stars: r.stars }),
  )
}

export async function dbAddPrime(trackId: number, startMs: number, endMs: number, stars: number): Promise<void> {
  await conn().run('INSERT INTO prime_moments(track_id,start_ms,end_ms,stars) VALUES(?,?,?,?)', [
    trackId,
    startMs,
    endMs,
    stars,
  ])
}

export async function dbSetPrimeStars(id: number, stars: number): Promise<void> {
  await conn().run('UPDATE prime_moments SET stars = ? WHERE id = ?', [stars, id])
}

export async function dbDeletePrime(id: number): Promise<void> {
  await conn().run('DELETE FROM prime_moments WHERE id = ?', [id])
}
