import type { Track } from '../types'
import { LMusic } from '../native/lmusic'

/** Borra el archivo de la canción del teléfono. Android pide confirmar; si se cancela, lanza un error. */
export async function deleteTrackFile(track: Track): Promise<number> {
  const r = await LMusic.deleteTracks({ items: [{ id: track.id, uri: track.uri }] })
  return r.ok
}
