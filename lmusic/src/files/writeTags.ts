import { Capacitor } from '@capacitor/core'
import type { Track } from '../types'
import { LMusic } from '../native/lmusic'
import type { TagItem, TagResult } from '../native/lmusic'

async function coverBase64(track: Track): Promise<string | undefined> {
  try {
    const r = await LMusic.getCover({ id: track.id, uri: track.uri, size: 500 })
    if (!r.path) return undefined
    const res = await fetch(Capacitor.convertFileSrc('file://' + r.path))
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '')
      fr.onerror = () => reject(fr.error)
      fr.readAsDataURL(blob)
    })
  } catch {
    return undefined
  }
}

/**
 * Escribe título, artista, álbum, género (y la portada) dentro de los archivos mp3.
 * Android pide permiso con un aviso del sistema. Por defecto NO se guarda copia del original (ocuparía espacio);
 * con `keepOriginal` se guarda una copia durante 30 días.
 */
const GRANT = 400 // canciones por cada aviso de permiso del sistema

export async function writeTagsToFiles(
  tracks: Track[],
  includeCover: boolean,
  onProgress?: (done: number, total: number) => void,
  opts: { keepOriginal?: boolean } = {},
): Promise<TagResult> {
  const total: TagResult = { ok: 0, failed: [] }
  const keepOriginal = opts.keepOriginal ?? false
  // tandas chicas con portada para no llenar la memoria del teléfono
  const size = includeCover ? 15 : 100
  let done = 0
  for (let g = 0; g < tracks.length; g += GRANT) {
    const group = tracks.slice(g, g + GRANT)
    // un solo aviso del sistema por cada grupo; las tandas de adentro ya no vuelven a preguntar
    await LMusic.grantWrite({ items: group.map((t) => ({ id: t.id, uri: t.uri })) })
    for (let i = 0; i < group.length; i += size) {
      const chunk = group.slice(i, i + size)
      try {
        const items: TagItem[] = []
        for (const t of chunk) {
          items.push({
            id: t.id,
            uri: t.uri,
            title: t.title,
            artist: t.artist,
            album: t.album,
            genre: t.genre,
            trackNo: t.trackNo,
            coverBase64: includeCover ? await coverBase64(t) : undefined,
          })
        }
        let r = await LMusic.writeTags({ items, skipPrompt: true, keepOriginal })
        // si el sistema no recordó el permiso, se vuelve a pedir una vez para esta tanda
        if (r.ok === 0 && r.failed.length === items.length && r.failed.every((f) => /permission|denied|security|permiso|acceso/i.test(f.message))) {
          r = await LMusic.writeTags({ items, skipPrompt: false, keepOriginal })
        }
        total.ok += r.ok
        total.failed.push(...r.failed)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Error'
        total.failed.push(...chunk.map((t) => ({ id: t.id, message })))
      }
      done += chunk.length
      onProgress?.(done, tracks.length)
    }
  }
  return total
}

export async function restoreFileOriginals(tracks: Track[]): Promise<TagResult> {
  const items = tracks.map((t) => ({ id: t.id, uri: t.uri }))
  if (items.length > 1) await LMusic.grantWrite({ items })
  return LMusic.restoreOriginals({ items, skipPrompt: items.length > 1 })
}
