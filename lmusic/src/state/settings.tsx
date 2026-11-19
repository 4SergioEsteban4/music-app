import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { dbLoadSettings, dbSetSetting, openDb } from '../db/db'

export interface AppSettings {
  learningMode: boolean
  nativeLang: string
  targetLang: string
  pauseOnWordTap: boolean
  theme: string
  dynamicAccent: boolean
  bgImage: string
  bgBlur: number
  bgDim: number
  lyricStyle: string
  particles: boolean
  beatFx: boolean
  nowBg: string
  fx: string
  lyricFont: string
  lyricAnim: string
  tapMode: string
  aiProvider: string
  aiKey: string
  aiModel: string
  lyricFx: string
  primeOn: boolean
  primeFx: string
  primeAlbum: string
  accentColor: string
  songPalette: boolean
  coverFx: string
  lyricSize: number
  starMode: string
  lyricsUnderCover: boolean
  saver: number
  keepBackups: boolean
  skin: string
  lyricTranslate: boolean
  aiRetry: boolean
}

const DEFAULTS: AppSettings = {
  learningMode: false,
  nativeLang: 'es',
  targetLang: 'en',
  pauseOnWordTap: true,
  theme: 'valvula',
  dynamicAccent: false,
  bgImage: '',
  bgBlur: 14,
  bgDim: 60,
  lyricStyle: 'classic',
  particles: true,
  beatFx: true,
  nowBg: 'cover',
  fx: 'auto',
  lyricFont: 'system',
  lyricAnim: 'rise',
  tapMode: 'translate',
  aiProvider: 'none',
  aiKey: '',
  aiModel: '',
  lyricFx: 'auto',
  primeOn: true,
  primeFx: 'auto',
  primeAlbum: 'auto',
  accentColor: '',
  songPalette: false,
  coverFx: 'none',
  lyricSize: 100,
  starMode: 'instant',
  lyricsUnderCover: false,
  saver: 0,
  keepBackups: false,
  skin: 'classic',
  lyricTranslate: false,
  aiRetry: true,
}

const num = (raw: string | undefined, def: number) => {
  const n = Number(raw)
  return raw !== undefined && raw !== '' && Number.isFinite(n) ? n : def
}

interface SettingsValue {
  settings: AppSettings
  loaded: boolean
  update: (patch: Partial<AppSettings>) => void
  reload: () => Promise<void>
}

const Ctx = createContext<SettingsValue | null>(null)

export function useSettings(): SettingsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSettings fuera de SettingsProvider')
  return v
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    await openDb()
    const raw = await dbLoadSettings()
    setSettings({
      learningMode: raw.learningMode === '1',
      nativeLang: raw.nativeLang || DEFAULTS.nativeLang,
      targetLang: raw.targetLang || DEFAULTS.targetLang,
      pauseOnWordTap: raw.pauseOnWordTap !== '0',
      theme: raw.theme || DEFAULTS.theme,
      dynamicAccent: raw.dynamicAccent === '1',
      bgImage: raw.bgImage ?? '',
      bgBlur: num(raw.bgBlur, DEFAULTS.bgBlur),
      bgDim: num(raw.bgDim, DEFAULTS.bgDim),
      lyricStyle: raw.lyricStyle || DEFAULTS.lyricStyle,
      particles: raw.particles !== '0',
      beatFx: raw.beatFx !== '0',
      nowBg: raw.nowBg || DEFAULTS.nowBg,
      fx: (raw.fx || DEFAULTS.fx).split(',')[0],
      lyricFont: raw.lyricFont || DEFAULTS.lyricFont,
      lyricAnim: raw.lyricAnim || DEFAULTS.lyricAnim,
      tapMode: raw.tapMode || DEFAULTS.tapMode,
      aiProvider: raw.aiProvider || DEFAULTS.aiProvider,
      aiKey: raw.aiKey ?? '',
      aiModel: raw.aiModel ?? '',
      lyricFx: raw.lyricFx || DEFAULTS.lyricFx,
      primeOn: raw.primeOn !== '0',
      primeFx: raw.primeFx || DEFAULTS.primeFx,
      primeAlbum: raw.primeAlbum || DEFAULTS.primeAlbum,
      accentColor: raw.accentColor ?? '',
      songPalette: raw.songPalette === '1',
      coverFx: raw.coverFx || DEFAULTS.coverFx,
      lyricSize: num(raw.lyricSize, DEFAULTS.lyricSize),
      starMode: raw.starMode === 'moments' ? 'moments' : 'instant',
      lyricsUnderCover: raw.lyricsUnderCover === '1',
      saver: num(raw.saver, DEFAULTS.saver),
      keepBackups: raw.keepBackups === '1',
      skin: raw.skin || DEFAULTS.skin,
      lyricTranslate: raw.lyricTranslate === '1',
      aiRetry: raw.aiRetry !== '0',
    })
  }, [])

  useEffect(() => {
    let alive = true
    void load()
      .catch(() => {
        // se queda con los valores por defecto
      })
      .finally(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [load])

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((s) => ({ ...s, ...patch }))
    for (const [k, v] of Object.entries(patch)) {
      void dbSetSetting(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
    }
  }, [])

  const value = useMemo(() => ({ settings, loaded, update, reload: load }), [settings, loaded, update, load])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
