import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'

type Props = {
  open: boolean
  onClose: () => void
  /** Anchor element that owns the popover */
  anchorRef: RefObject<HTMLElement | null>
  children: ReactNode
  className?: string
  /** Preferred placement under the anchor */
  placement?: 'bottom-start' | 'bottom-end'
  style?: CSSProperties
}

/**
 * Lightweight anchored popover (not a global sheet).
 * Closes on outside click / Escape; positions under the anchor.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  className = '',
  placement = 'bottom-start',
  style,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [pos, setPos] = useState<CSSProperties>({})

  useEffect(() => {
    if (!open) return undefined
    function measure() {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const gap = 6
      const next: CSSProperties = {
        position: 'fixed',
        top: Math.round(rect.bottom + gap),
        zIndex: 60,
        minWidth: Math.max(180, Math.round(rect.width)),
      }
      if (placement === 'bottom-end') {
        next.right = Math.max(8, Math.round(window.innerWidth - rect.right))
        next.left = 'auto'
      } else {
        next.left = Math.max(8, Math.round(rect.left))
        next.right = 'auto'
      }
      setPos(next)
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchorRef, open, placement])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onPointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('touchstart', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('touchstart', onPointer)
    }
  }, [anchorRef, onClose, open])

  if (!open) return null

  return (
    <div
      ref={panelRef}
      className={`ui-popover ${className}`.trim()}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      style={{ ...pos, ...style }}
    >
      <span id={titleId} className="sr-only">
        选择
      </span>
      {children}
    </div>
  )
}
