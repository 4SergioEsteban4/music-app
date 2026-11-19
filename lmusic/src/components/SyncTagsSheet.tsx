import { useState } from 'react'
import { useLibrary } from '../state/library'
import { useSettings } from '../state/settings'
import { writeTagsToFiles } from '../files/writeTags'
import { Toggle } from './ui'

/** Actualiza las etiquetas (y las portadas de los álbumes) de toda la biblioteca de una sola vez. */
export function SyncTagsSheet({ onClose }: { onClose: () => void }) {
  const { tracks, rescan } = useLibrary()
  const { settings, update } = useSettings()
  const [onlyEdited, setOnlyEdited] = useState(false)
  const [covers, setCovers] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const edited = tracks.filter((t) => t.metaEdited)
  const list = onlyEdited ? edited : tracks

  const run = async () => {
    if (!list.length) return
    setBusy(true)
    setMsg('Esperando el permiso del sistema…')
    try {
      const r = await writeTagsToFiles(list, covers, (d, n) => setMsg(`Actualizando… ${d} de ${n}`), { keepOriginal: settings.keepBackups })
      await rescan()
      setMsg(
        `Listo: ${r.ok} canciones actualizadas${r.failed.length ? `, ${r.failed.length} con error (${r.failed.slice(0, 3).map((x) => x.message).join('; ')})` : ''}.`,
      )
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo actualizar. Inténtalo de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop top" onClick={busy ? undefined : onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Actualizar etiquetas y portadas</h2>
        <p className="muted">
          Escribe dentro de cada mp3 el título, artista, álbum y género que ves en la app. Android pide un solo permiso para todas las
          canciones. Con portadas va por tandas y tarda más.
        </p>
        <Toggle label={`Solo las que edité (${edited.length})`} checked={onlyEdited} onChange={setOnlyEdited} />
        <Toggle label="Incluir las portadas de los álbumes" checked={covers} onChange={setCovers} />
        <Toggle label="Guardar copia del original (ocupa espacio)" checked={settings.keepBackups} onChange={(v) => update({ keepBackups: v })} />
        {!settings.keepBackups && <p className="muted small">Sin copia no podrás volver al archivo original.</p>}
        <div className="rhythm-row end">
          <button className="chip solid" disabled={busy || list.length === 0} onClick={() => void run()}>
            {busy ? 'Actualizando…' : `Actualizar ${list.length} canciones`}
          </button>
          <button className="chip" disabled={busy} onClick={onClose}>
            Cerrar
          </button>
        </div>
        {msg && <p className="muted">{msg}</p>}
      </div>
    </div>
  )
}
