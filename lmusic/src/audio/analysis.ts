import { useEffect, useState } from 'react'
import type { Track } from '../types'
import { dbGetAudioInfo, dbSaveAudioInfo } from '../db/db'
import type { AudioInfo } from '../db/db'
import { LMusic } from '../native/lmusic'

export type { AudioInfo }

const mem = new Map<number, AudioInfo>()
const subs = new Set<(id: number, info: AudioInfo) => void>()
const publish = (id: number, info: AudioInfo) => {
  mem.set(id, info)
  for (const fn of subs) fn(id, info)
}
const inflight = new Map<number, Promise<AudioInfo | null>>()
let chain: Promise<unknown> = Promise.resolve()

async function run(track: Track, force: boolean): Promise<AudioInfo | null> {
  if (!force) {
    const row = await dbGetAudioInfo(track.id)
    if (row) {
      publish(track.id, row)
      return row
    }
  }
  let info: AudioInfo
  try {
    const r = await LMusic.analyzeAudio({ uri: track.uri })
    info = { bpm: r.bpm, offsetMs: r.offsetMs, confidence: r.confidence, source: r.source }
  } catch (e) {
    // No se pudo analizar (archivo dañado, muy corto…): se anota el motivo para no insistir
    const why = e instanceof Error ? e.message : String(e)
    info = { bpm: 0, offsetMs: 0, confidence: 0, source: `failed: ${why}`.slice(0, 160) }
  }
  await dbSaveAudioInfo(track.id, info)
  publish(track.id, info)
  return info
}

/** BPM y rejilla de pulsos de una canción. Se calcula una sola vez y se guarda. Uno a la vez. */
export function ensureAudioInfo(track: Track, opts: { force?: boolean } = {}): Promise<AudioInfo | null> {
  const force = !!opts.force
  if (!force) {
    const hit = mem.get(track.id)
    if (hit) return Promise.resolve(hit)
    const pending = inflight.get(track.id)
    if (pending) return pending
  }
  const job = chain.then(() => run(track, force))
  chain = job.catch(() => undefined)
  inflight.set(track.id, job)
  void job.finally(() => inflight.delete(track.id))
  return job
}

/** Guarda un ajuste manual del ritmo (BPM o desfase del pulso). */
export async function saveAudioInfo(track: Track, info: AudioInfo): Promise<void> {
  await dbSaveAudioInfo(track.id, info)
  publish(track.id, info)
}

/** Info de ritmo de la canción actual (null mientras se analiza). */
export function useAudioInfo(track: Track | null): { info: AudioInfo | null; analyzing: boolean } {
  const [state, setState] = useState<{ id: number; info: AudioInfo | null } | null>(null)
  const id = track?.id
  const uri = track?.uri

  useEffect(() => {
    if (id === undefined || uri === undefined) return
    let alive = true
    void ensureAudioInfo({ id, uri } as Track).then((info) => {
      if (alive) setState({ id, info })
    })
    return () => {
      alive = false
    }
  }, [id, uri])

  useEffect(() => {
    if (id === undefined) return
    const fn = (tid: number, info: AudioInfo) => {
      if (tid === id) setState({ id, info })
    }
    subs.add(fn)
    return () => {
      subs.delete(fn)
    }
  }, [id])

  const ready = state !== null && state.id === id
  return { info: ready ? state.info : null, analyzing: id !== undefined && !ready }
}
