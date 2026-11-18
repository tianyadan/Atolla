import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../i18n/useLocale'

const OFFER_MS = 5000

type Props = {
  open: boolean
  busy?: boolean
  onInterrupt: () => void
  onEnqueue: () => void
  onCancel: () => void
}

/** 忙碌发送：横排打断/入队 + 5s 进度条，超时默认打断。 */
export function TaskQueueChoiceSheet({ open, busy, onInterrupt, onEnqueue, onCancel }: Props) {
  const { t } = useLocale()
  const [remainMs, setRemainMs] = useState(OFFER_MS)
  const doneRef = useRef(false)
  const onInterruptRef = useRef(onInterrupt)
  onInterruptRef.current = onInterrupt

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
        onInterruptRef.current()
      }
    }, 50)
    return () => window.clearInterval(tick)
  }, [open])

  if (!open) return null

  const pct = Math.max(0, Math.min(100, (remainMs / OFFER_MS) * 100))
  const sec = Math.max(0, Math.ceil(remainMs / 1000))

  function pick(fn: () => void) {
    if (doneRef.current || busy) return
    doneRef.current = true
    fn()
  }

  return (
    <div className="tq-choice" role="dialog" aria-modal="true" aria-label={t('tq.sheetTitle')}>
      <div className="tq-choice-progress" aria-hidden>
        <div className="tq-choice-progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="tq-choice-head">
        <div>
          <strong>{t('tq.sheetTitle')}</strong>
          <p>{t('tq.sheetHint', { sec })}</p>
        </div>
        <button type="button" className="tq-choice-x" disabled={busy} onClick={() => pick(onCancel)} aria-label={t('tq.cancel')}>
          ×
        </button>
      </div>
      <div className="tq-choice-actions">
        <button type="button" className="tq-choice-interrupt" disabled={busy} onClick={() => pick(onInterrupt)}>
          {t('tq.interrupt')}
          <em>{t('tq.sheetDefault')}</em>
        </button>
        <button type="button" className="tq-choice-enqueue" disabled={busy} onClick={() => pick(onEnqueue)}>
          {t('tq.enqueue')}
        </button>
      </div>
    </div>
  )
}
