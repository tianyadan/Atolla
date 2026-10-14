import type { ReactNode } from 'react'

type Props = {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
}

/** Kimi-style centered modal (mask + card) — no window.confirm */
export function Modal({ open, title, children, onClose, footer }: Props) {
  if (!open) return null
  return (
    <div className="modal-mask" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="btn text modal-x" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  )
}
