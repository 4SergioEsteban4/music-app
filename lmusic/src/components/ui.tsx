import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { IconChevron } from '../icons'

/** Sección plegable: los ajustes quedan compactos y se abre solo lo que necesitas. */
export function Section({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string
  summary?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`acc${open ? ' open' : ''}`}>
      <button className="acc-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="acc-title">
          <strong>{title}</strong>
          {summary && !open && <small>{summary}</small>}
        </span>
        <span className="acc-chev">
          <IconChevron size={20} />
        </span>
      </button>
      {open && <div className="acc-body">{children}</div>}
    </section>
  )
}

export interface PickOption {
  id: string
  name: string
  hint?: string
  style?: CSSProperties
}

/** Selector compacto: una fila con el valor actual que abre una hoja con las opciones. */
export function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: PickOption[]
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.id === value)
  return (
    <>
      <button className="pick-row" onClick={() => setOpen(true)}>
        <span className="pick-label">{label}</span>
        <span className="pick-value" style={current?.style}>
          {current?.name ?? '—'}
        </span>
        <IconChevron size={18} />
      </button>
      {open && (
        <div className="sheet-backdrop top" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2 className="pick-title">{label}</h2>
            <div className="opt-grid">
              {options.map((o) => (
                <button
                  key={o.id}
                  className={`opt${o.id === value ? ' on' : ''}`}
                  onClick={() => {
                    onChange(o.id)
                    setOpen(false)
                  }}
                >
                  <span className="opt-name" style={o.style}>
                    {o.name}
                  </span>
                  {o.hint && <span className="opt-hint">{o.hint}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <input
        type="checkbox"
        className="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}
