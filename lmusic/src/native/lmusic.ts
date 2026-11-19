import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import type { RepeatMode } from '../types'

export interface ScannedTrack {
  id: number
  uri: string
  title: string
  artist: string
  album: string
  albumId: number
  genre: string
  trackNo: number
  durationMs: number
  dateAdded: number
  size: number
  fileName: string
}

export interface QueueTrack {
  id: number
  uri: string
  title: string
  artist: string
  album: string
}

export interface NativeState {
  ready: boolean
  isPlaying?: boolean
  playWhenReady?: boolean
  index?: number
  mediaId?: string
  positionMs?: number
  durationMs?: number
  shuffle?: boolean
  repeat?: RepeatMode
  speed?: number
  queue?: string[]
}

export interface AccessState {
  audio: boolean
  notifications: boolean
}

export interface TagItem {
  id: number
  uri: string
  title: string
  artist: string
  album: string
  genre: string
  trackNo: number
  coverBase64?: string
}

export interface TagResult {
  ok: number
  failed: { id: number; message: string }[]
}

export interface LMusicPlugin {
  checkAccess(): Promise<AccessState>
  requestAccess(): Promise<AccessState>
  scanLibrary(): Promise<{ tracks: ScannedTrack[] }>
  setQueue(o: { tracks: QueueTrack[]; startIndex: number; play: boolean }): Promise<void>
  play(): Promise<void>
  pause(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  seekTo(o: { positionMs: number }): Promise<void>
  setShuffle(o: { enabled: boolean }): Promise<void>
  setRepeat(o: { mode: RepeatMode }): Promise<void>
  setSpeed(o: { speed: number }): Promise<void>
  getState(): Promise<NativeState>
  getCover(o: { id: number; uri: string; size: number }): Promise<{ path: string }>
  saveCoverFromUrl(o: { id: number; url: string }): Promise<void>
  saveCoverFromBase64(o: { ids: number[]; data: string }): Promise<void>
  removeCustomCover(o: { ids: number[] }): Promise<void>
  setLoop(o: { startMs: number; endMs: number }): Promise<void>
  clearLoop(): Promise<void>
  saveBackup(o: { name: string; text: string }): Promise<{ path: string }>
  writeTags(o: { items: TagItem[]; skipPrompt?: boolean; keepOriginal?: boolean }): Promise<TagResult>
  restoreOriginals(o: { items: { id: number; uri: string }[]; skipPrompt?: boolean }): Promise<TagResult>
  /** Pide permiso del sistema una sola vez para todos estos archivos. */
  grantWrite(o: { items: { id: number; uri: string }[] }): Promise<{ ok: number }>
  /** Borra los archivos del teléfono (el sistema pide confirmar). */
  deleteTracks(o: { items: { id: number; uri: string }[] }): Promise<{ ok: number }>
  moveQueueItem(o: { from: number; to: number }): Promise<void>
  /** Volumen de la canción en tramos (para sugerir el momento más intenso). */
  analyzeEnergy(o: { uri: string; durationMs: number }): Promise<{ stepMs: number; values: number[] }>
  /** Borra las copias de los originales guardadas por la app. */
  clearOriginals(): Promise<{ files: number; freedBytes: number }>
  analyzeAudio(o: { uri: string }): Promise<{
    bpm: number
    offsetMs: number
    confidence: number
    source: string
  }>
  addListener(ev: 'state', cb: (s: NativeState) => void): Promise<PluginListenerHandle>
  addListener(
    ev: 'progress',
    cb: (p: { positionMs: number; durationMs: number }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    ev: 'transition',
    cb: (t: { mediaId: string; index: number }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    ev: 'error',
    cb: (e: { message: string; mediaId: string }) => void,
  ): Promise<PluginListenerHandle>
}

export const LMusic = registerPlugin<LMusicPlugin>('LMusic')
