import { LMusic } from '../native/lmusic'
import { invalidateCover } from '../native/covers'

/** Lee la imagen elegida, la reduce y devuelve su contenido en base64 (sin el prefijo data:). */
export async function imageFileToBase64(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const k = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * k))
    c.height = Math.max(1, Math.round(img.naturalHeight * k))
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('Sin canvas')
    ctx.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.9).split(',')[1]
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Pone una imagen propia como portada de una o varias canciones (p. ej. todo un álbum). */
export async function setCustomCover(ids: number[], file: File): Promise<void> {
  const data = await imageFileToBase64(file)
  await LMusic.saveCoverFromBase64({ ids, data })
  ids.forEach(invalidateCover)
}

/** Quita la portada propia: vuelve la que trae el archivo (o la de género si no tiene). */
export async function clearCustomCover(ids: number[]): Promise<void> {
  await LMusic.removeCustomCover({ ids })
  ids.forEach(invalidateCover)
}
