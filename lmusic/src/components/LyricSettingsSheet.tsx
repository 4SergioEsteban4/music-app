import { useSettings } from '../state/settings'
import { Picker, Toggle } from './ui'
import type { PickOption } from './ui'
import { AUTO_OPTION, LYRIC_ANIMS, LYRIC_FONTS, LYRIC_FX, LYRIC_STYLES } from '../themes'

// "Ninguno" va primero, luego "Automático"
const withAuto = (list: PickOption[]): PickOption[] => [
  ...list.filter((o) => o.id === 'none'),
  AUTO_OPTION,
  ...list.filter((o) => o.id !== 'none'),
]

export function LyricSettingsSheet({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings()
  return (
    <div className="sheet-backdrop top" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Configuración de la letra</h2>
        <Toggle label="Mostrar la letra debajo de la portada" checked={settings.lyricsUnderCover} onChange={(v) => update({ lyricsUnderCover: v })} />
        <Toggle label="Mostrar la traducción debajo de la letra" checked={settings.lyricTranslate} onChange={(v) => update({ lyricTranslate: v })} />
        <Picker
          label="Estilo"
          value={settings.lyricStyle}
          options={withAuto(LYRIC_STYLES.map((l) => ({ id: l.id, name: l.name })))}
          onChange={(id) => update({ lyricStyle: id })}
        />
        <Picker
          label="Tipo de letra"
          value={settings.lyricFont}
          options={[AUTO_OPTION, ...LYRIC_FONTS.map((f) => ({ id: f.id, name: f.name, style: { fontFamily: f.family } }))]}
          onChange={(id) => update({ lyricFont: id })}
        />
        <Picker label="Animación de entrada" value={settings.lyricAnim} options={withAuto(LYRIC_ANIMS)} onChange={(id) => update({ lyricAnim: id })} />
        <Picker
          label="Efecto de la letra"
          value={settings.lyricFx}
          options={withAuto(LYRIC_FX.map((f) => ({ id: f.id, name: `${f.glyph}  ${f.name}` })))}
          onChange={(id) => update({ lyricFx: id })}
        />
        <label className="field">
          <span>Tamaño de la letra: {settings.lyricSize}%</span>
          <input type="range" min={70} max={200} step={5} value={settings.lyricSize} onChange={(e) => update({ lyricSize: Number(e.target.value) })} />
        </label>
        <div className="rhythm-row end">
          <button className="chip solid" onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>
  )
}
