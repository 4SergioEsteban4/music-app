const TTS_LANG: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  pt: 'pt-BR',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
}

function tts(text: string, lang: string): void {
  if (!('speechSynthesis' in window)) return
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = TTS_LANG[lang] ?? lang
    u.rate = 0.9
    window.speechSynthesis.speak(u)
  } catch {
    // sin voz disponible en este teléfono
  }
}

/** Pronuncia una palabra: usa el audio del diccionario si hay, y si no la voz de Android. */
export function speak(text: string, lang: string, audioUrl?: string): void {
  if (audioUrl) {
    const a = new Audio(audioUrl)
    a.play().catch(() => tts(text, lang))
    return
  }
  tts(text, lang)
}
