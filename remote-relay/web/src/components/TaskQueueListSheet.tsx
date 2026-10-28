import { useEffect, useState } from 'react'
import {
  cancelTaskQueueItem,
  clearTaskQueueDone,
  continueTaskQueue,
  fetchTaskQueue,
  updateTaskQueueItem,
  type TaskQueueItem,
  type TaskQueueView,
} from '../api'
import { useLocale } from '../i18n/useLocale'

type Props = {
  open: boolean
  instanceId: string
  agentId: string
  onClose: () => void
  onError?: (msg: string) => void
}

/** 未执行项可改文案 */
function isEditable(status: string) {
  return status === 'queued' || status === 'paused'
}

/** 半屏任务队列列表：取消 / 编辑 / 继续 / 清已完成。 */
export function TaskQueueListSheet({ open, instanceId, agentId, onClose, onError }: Props) {
  const { t } = useLocale()
  const [view, setView] = useState<TaskQueueView>({ items: [], hold: false, active: 0 })
  const [busy, setBusy] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  async function load() {
    try {
      const v = await fetchTaskQueue(instanceId, agentId)
      setView(v)
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '加载队列失败')
    }
  }

  useEffect(() => {
    if (!open || !agentId) return undefined
    setEditId(null)
    void load()
    const timer = window.setInterval(() => void load(), 4000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instanceId, agentId])

  if (!open) return null

  const live = view.items.filter((x) => ['queued', 'paused', 'running'].includes(x.status))
  const done = view.items.filter((x) => ['done', 'failed', 'cancelled'].includes(x.status)).slice(0, 8)

  async function onContinue() {
    setBusy(true)
    try {
      await continueTaskQueue(instanceId, agentId)
      await load()
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '继续失败')
    } finally {
      setBusy(false)
    }
  }

  async function onCancel(item: TaskQueueItem) {
    setBusy(true)
    try {
      await cancelTaskQueueItem(instanceId, agentId, item.id)
      if (editId === item.id) setEditId(null)
      await load()
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '取消失败')
    } finally {
      setBusy(false)
    }
  }

  /** 进入编辑模式 */
  function beginEdit(item: TaskQueueItem) {
    setEditId(item.id)
    setDraft(item.question || '')
  }

  /** 保存未执行文案 */
  async function onSave(item: TaskQueueItem) {
    const q = draft.trim()
    if (!q) return
    setBusy(true)
    try {
      await updateTaskQueueItem(instanceId, agentId, item.id, q)
      setEditId(null)
      await load()
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function onClearDone() {
    setBusy(true)
    try {
      await clearTaskQueueDone(instanceId, agentId)
      await load()
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '清除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tq-list-mask" role="presentation" onClick={onClose}>
      <div className="tq-list-sheet" role="dialog" aria-label={t('tq.title')} onClick={(e) => e.stopPropagation()}>
        <header className="tq-list-head">
          <strong>{t('tq.title')}</strong>
          <div className="tq-list-head-actions">
            {view.hold ? (
              <button type="button" disabled={busy} onClick={() => void onContinue()}>
                {t('tq.continue')}
              </button>
            ) : null}
            <button type="button" disabled={busy} onClick={() => void onClearDone()}>
              {t('tq.clearDone')}
            </button>
            <button type="button" onClick={onClose} aria-label={t('tq.close')}>
              ×
            </button>
          </div>
        </header>
        {view.hold ? <p className="tq-list-hold">{t('tq.holdHint')}</p> : null}
        <ul className="tq-list-body">
          {live.length === 0 && done.length === 0 ? <li className="tq-list-empty">{t('tq.empty')}</li> : null}
          {[...live, ...done].map((item) => {
            const editing = editId === item.id
            return (
              <li key={item.id} className={`tq-list-item st-${item.status}`}>
                <i className={`tq-list-dot st-${item.status}`} aria-hidden />
                <div className="tq-list-main">
                  <span className="tq-list-status">{t(`tq.status.${item.status}`)}</span>
                  {editing ? (
                    <textarea
                      className="tq-list-edit"
                      value={draft}
                      rows={3}
                      aria-label={t('tq.edit')}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                  ) : (
                    <p>{item.question || '—'}</p>
                  )}
                </div>
                <div className="tq-list-actions">
                  {isEditable(item.status) ? (
                    editing ? (
                      <>
                        <button
                          type="button"
                          className="tq-list-cancel"
                          disabled={busy || !draft.trim()}
                          onClick={() => void onSave(item)}
                        >
                          {t('tq.save')}
                        </button>
                        <button
                          type="button"
                          className="tq-list-cancel"
                          disabled={busy}
                          onClick={() => setEditId(null)}
                        >
                          {t('tq.editCancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="tq-list-cancel"
                          disabled={busy}
                          onClick={() => beginEdit(item)}
                        >
                          {t('tq.edit')}
                        </button>
                        <button
                          type="button"
                          className="tq-list-cancel"
                          disabled={busy}
                          onClick={() => void onCancel(item)}
                        >
                          {t('tq.cancel')}
                        </button>
                      </>
                    )
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
