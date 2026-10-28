import { useEffect, useState } from 'react'
import { useLocale } from './i18n/useLocale.js'

const EXIT_MS = 320

/**
 * 忙碌发送弹层：挂在输入框上方，不遮挡 composer。
 * 进出场补帧动画（opacity + translate + 按钮错峰）。
 */
export default function TaskQueueChoiceSheet({ open, busy, hideEnqueue, onInterrupt, onEnqueue, onCancel }) {
  const { t } = useLocale()
  const [mounted, setMounted] = useState(!!open)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    let raf1 = 0
    let raf2 = 0
    let timer = 0
    if (open) {
      setMounted(true)
      // 双 rAF：确保先挂上再切 is-open，触发 transition
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setShown(false)
    timer = window.setTimeout(() => setMounted(false), EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!mounted) return null

  return (
    <div
      className={`tq-sheet-anchor${shown ? ' is-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('tq.sheetTitle')}
    >
      <div className="tq-sheet">
        <p className="tq-sheet-title">{t('tq.sheetTitle')}</p>
        <div className="tq-sheet-actions">
          <button
            type="button"
            className="primary tq-sheet-btn"
            style={{ '--tq-i': 0 }}
            disabled={busy}
            onClick={onInterrupt}
          >
            {t('tq.interrupt')}
          </button>
          {!hideEnqueue ? (
            <button
              type="button"
              className="outline tq-sheet-btn"
              style={{ '--tq-i': 1 }}
              disabled={busy}
              onClick={onEnqueue}
            >
              {t('tq.enqueue')}
            </button>
          ) : null}
          <button
            type="button"
            className="ghost tq-sheet-btn"
            style={{ '--tq-i': hideEnqueue ? 1 : 2 }}
            disabled={busy}
            onClick={onCancel}
          >
            {t('tq.sheetCancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
