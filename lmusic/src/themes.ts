export interface ThemeInfo {
  id: string
  name: string
  swatch: [string, string]
}

/** Los colores de cada tema están en index.css ([data-theme="…"]). */
export const THEMES: ThemeInfo[] = [
  { id: 'valvula', name: 'Válvula', swatch: ['#141316', '#f2a93b'] },
  { id: 'medianoche', name: 'Medianoche', swatch: ['#0d1117', '#5aa9ff'] },
  { id: 'neon', name: 'Neón', swatch: ['#0f0a14', '#ff4fa3'] },
  { id: 'bosque', name: 'Bosque', swatch: ['#0e1410', '#9be15d'] },
  { id: 'luz', name: 'Luz', swatch: ['#f6f2ea', '#c26a00'] },
]

export const AUTO_OPTION = { id: 'auto', name: 'Automático (según el género)' }

export const LYRIC_STYLES: { id: string; name: string; hint: string }[] = [
  { id: 'classic', name: 'Clásico', hint: 'La letra se desplaza y la línea activa crece y brilla.' },
  { id: 'karaoke', name: 'Karaoke', hint: 'La línea activa se va llenando de color mientras suena.' },
  { id: 'cinema', name: 'Cine', hint: 'Una línea grande al centro que aparece con efecto cinematográfico.' },
  { id: 'epic', name: 'Épico', hint: 'Como Cine, pero late al ritmo de la canción.' },
  { id: 'text', name: 'Solo texto', hint: 'Sin animaciones: solo se resalta la línea activa.' },
]

export const LYRIC_FONTS: { id: string; name: string; family: string }[] = [
  { id: 'system', name: 'Normal', family: 'inherit' },
  { id: 'cinzel', name: 'Épica (Cinzel)', family: "'Cinzel', serif" },
  { id: 'metal', name: 'Metal', family: "'Metal Mania', cursive" },
  { id: 'orbitron', name: 'Futurista (Orbitron)', family: "'Orbitron', sans-serif" },
  { id: 'marker', name: 'Grafiti (marcador)', family: "'Permanent Marker', cursive" },
  { id: 'bebas', name: 'Impacto (Bebas Neue)', family: "'Bebas Neue', sans-serif" },
  { id: 'pacifico', name: 'Cursiva (Pacifico)', family: "'Pacifico', cursive" },
  { id: 'typewriter', name: 'Máquina de escribir', family: "'Special Elite', monospace" },
]

export const LYRIC_ANIMS: { id: string; name: string }[] = [
  { id: 'none', name: 'Ninguno' },
  { id: 'fade', name: 'Aparecer' },
  { id: 'rise', name: 'Subir' },
  { id: 'zoom', name: 'Zoom' },
  { id: 'wipe', name: 'Barrido (máquina de escribir)' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'beat', name: 'Al ritmo' },
  { id: 'bounce', name: 'Rebote' },
  { id: 'flip', name: 'Giro 3D' },
  { id: 'slide', name: 'Deslizar' },
  { id: 'stamp', name: 'Sello (golpe)' },
  { id: 'flicker', name: 'Parpadeo eléctrico' },
  { id: 'drop', name: 'Caída' },
]

export const LYRIC_FX: { id: string; name: string; glyph: string }[] = [
  { id: 'none', name: 'Ninguno', glyph: '○' },
  { id: 'electric', name: 'Electricidad', glyph: '⚡' },
  { id: 'shock', name: 'Electrochoque', glyph: '🔌' },
  { id: 'outlaw', name: 'Forajido', glyph: '🤠' },
  { id: 'blood', name: 'Sangre', glyph: '🩸' },
  { id: 'fire', name: 'Fuego', glyph: '🔥' },
  { id: 'ice', name: 'Hielo', glyph: '❄️' },
  { id: 'neon', name: 'Neón', glyph: '💡' },
  { id: 'glitch', name: 'Glitch', glyph: '📺' },
  { id: 'gold', name: 'Oro', glyph: '✨' },
]

export const PRIME_ALBUM: { id: string; name: string }[] = [
  { id: 'pulse', name: 'Latido' },
  { id: 'bounce', name: 'Rebote' },
  { id: 'rainbow', name: 'Arcoíris' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'shock', name: 'Electrochoque' },
]

/** Efecto de la portada que se puede dejar puesto siempre (no solo en momentos prime). */
export const COVER_FX: { id: string; name: string }[] = [
  { id: 'none', name: 'Ninguno' },
  { id: 'pulse', name: 'Latido' },
  { id: 'bounce', name: 'Rebote' },
  { id: 'rainbow', name: 'Arcoíris' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'shock', name: 'Electrochoque' },
]

/** Colores de acento a elegir (además del selector libre). */
export const ACCENTS = [
  '#f2a93b', '#ff6b35', '#ff3b5c', '#ff4fa3', '#c15bff', '#7a6bff', '#5aa9ff', '#2ec4ff',
  '#1de2c1', '#4cd964', '#9be15d', '#e6e34a', '#ffffff', '#b0b6c3',
]
