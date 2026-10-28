import { useLocale } from './i18n/useLocale.js'

/**
 * 忙碌发送底部弹层：打断优先 / 加入队列。
 * hideEnqueue：多人 @ 群聊资格时隐藏入队。
 */
export default function TaskQueueChoiceSheet({ open, busy, hideEnqueue, onInterrupt, onEnqueue, onCancel }) {
  const { t } = useLocale()
  if (!open) return null
  return (
    <div className="tq-sheet-mask" role="presentation" onMouseDown={onCancel}>
      <div
        className="tq-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('tq.sheetTitle')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="tq-sheet-title">{t('tq.sheetTitle')}</p>
        <div className="tq-sheet-actions">
          <button type="button" className="primary" disabled={busy} onClick={onInterrupt}>
            {t('tq.interrupt')}
          </button>
          {!hideEnqueue ? (
            <button type="button" className="outline" disabled={busy} onClick={onEnqueue}>
              {t('tq.enqueue')}
            </button>
          ) : null}
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>
            {t('tq.sheetCancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
