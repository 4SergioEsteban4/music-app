import { usePlayer } from '../state/player'

const PRESETS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2]

export function SpeedSheet({ onClose }: { onClose: () => void }) {
  const { speed, setSpeed } = usePlayer()
  return (
    <div className="sheet-backdrop top" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Velocidad de reproducción</h2>
        <div className="sync-big">{speed.toFixed(2)}×</div>
        <div className="rhythm-row">
          {PRESETS.map((v) => (
            <button key={v} className={`chip${Math.abs(speed - v) < 0.01 ? ' solid' : ''}`} onClick={() => void setSpeed(v)}>
              {v === 1 ? 'Normal' : `${v}×`}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Ajuste fino</span>
          <input type="range" min={0.5} max={2} step={0.05} value={speed} onChange={(e) => void setSpeed(Number(e.target.value))} />
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
