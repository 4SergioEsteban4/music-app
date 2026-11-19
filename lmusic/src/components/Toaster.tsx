import { useToast } from '../state/toast'

export function Toaster() {
  const t = useToast()
  if (!t) return null
  return (
    <div className="toast" role="status" key={t.id}>
      {t.text}
    </div>
  )
}
