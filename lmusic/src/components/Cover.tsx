import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Track } from '../types'
import { albumOf, artistOf } from '../utils'
import { genreArt } from '../visual/genreArt'
import { useCover } from '../native/covers'

/**
 * Portada: la imagen real del mp3 si existe; mientras tanto (o si no hay)
 * un disco de vinilo cuyo sello toma el color del álbum.
 */
export function Cover({ track, size = 48 }: { track: Track | null; size?: number }) {
  const url = useCover(track, size <= 160 ? 160 : 720)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const art = genreArt(track?.genre ?? '', track ? `${albumOf(track)}|${artistOf(track)}` : 'lmusic')
  const h = art.hue
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.max(6, Math.round(size / 9)),
    background: `radial-gradient(circle, hsl(${h} 72% 58%) 0 12%, #0b0a0d 12% 14.5%, transparent 14.5%),
      repeating-radial-gradient(circle, hsl(${h} 18% 15%) 0 1.5px, hsl(${h} 18% 10%) 1.5px 3.5px)`,
  }
  return (
    <div className="cover" style={style}>
      {!url && size >= 88 && (
        <span className="cover-glyph" style={{ fontSize: Math.round(size * 0.13) }} aria-hidden="true">
          {art.glyph}
        </span>
      )}
      {url && (
        <img
          className={`cover-img${loadedUrl === url ? ' on' : ''}`}
          src={url}
          alt=""
          draggable={false}
          onLoad={() => setLoadedUrl(url)}
        />
      )}
    </div>
  )
}
