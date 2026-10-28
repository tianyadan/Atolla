import { useEffect, useRef, useState } from 'react'
import { useLocale } from './i18n/useLocale.js'

const EXIT_MS = 320
const OFFER_MS = 5000

/**
 * 忙碌发送弹层：输入框上方；两按钮横排 + 5s 进度条。
 * 超时默认「打断并优先」；点入队则取消倒计时。
 */
export default function TaskQueueChoiceSheet({ open, busy, hideEnqueue, onInterrupt, onEnqueue, onCancel }) {
  const { t } = useLocale()
  const [mounted, setMounted] = useState(!!open)
  const [shown, setShown] = useState(false)
  const [remainMs, setRemainMs] = useState(OFFER_MS)
  const doneRef = useRef(false)
  const onInterruptRef = useRef(onInterrupt)
  onInterruptRef.current = onInterrupt

  // 进出场挂载
  useEffect(() => {
    let raf1 = 0
    let raf2 = 0
    let timer = 0
    if (open) {
      setMounted(true)
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

  // 5s 倒计时：超时默认打断
  useEffect(() => {
    if (!open) {
      doneRef.current = false
      setRemainMs(OFFER_MS)
      return undefined
    }
    doneRef.current = false
    setRemainMs(OFFER_MS)
    const started = Date.now()
    const tick = window.setInterval(() => {
      const left = Math.max(0, OFFER_MS - (Date.now() - started))
      setRemainMs(left)
      if (left <= 0 && !doneRef.current) {
        doneRef.current = true
        window.clearInterval(tick)
        onInterruptRef.current?.()
      }
    }, 50)
    return () => window.clearInterval(tick)
  }, [open])

  if (!mounted) return null

  const pct = Math.max(0, Math.min(100, (remainMs / OFFER_MS) * 100))
  const sec = Math.max(0, Math.ceil(remainMs / 1000))

  function pickInterrupt() {
    if (doneRef.current || busy) return
    doneRef.current = true
    onInterrupt?.()
  }

  function pickEnqueue() {
    if (doneRef.current || busy) return
    doneRef.current = true
    onEnqueue?.()
  }

  function pickCancel() {
    if (doneRef.current || busy) return
    doneRef.current = true
    onCancel?.()
  }

  return (
    <div
      className={`tq-sheet-anchor${shown ? ' is-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('tq.sheetTitle')}
    >
      <div className="tq-sheet">
        <div className="tq-sheet-progress" aria-hidden="true">
          <div className="tq-sheet-progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="tq-sheet-body">
          <div className="tq-sheet-text">
            <p className="tq-sheet-title">{t('tq.sheetTitle')}</p>
            <p className="tq-sheet-hint">
              {t('tq.sheetHint', { sec })}
            </p>
          </div>
          <button type="button" className="tq-sheet-dismiss" disabled={busy} onClick={pickCancel} aria-label={t('tq.sheetCancel')}>
            ×
          </button>
        </div>
        <div className="tq-sheet-actions">
          <button
            type="button"
            className="primary tq-sheet-btn"
            style={{ '--tq-i': 0 }}
            disabled={busy}
            onClick={pickInterrupt}
          >
            {t('tq.interrupt')}
            <em className="tq-sheet-default">{t('tq.sheetDefault')}</em>
          </button>
          {!hideEnqueue ? (
            <button
              type="button"
              className="outline tq-sheet-btn"
              style={{ '--tq-i': 1 }}
              disabled={busy}
              onClick={pickEnqueue}
            >
              {t('tq.enqueue')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
