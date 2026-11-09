import { useEffect, useMemo, useState } from 'react'
import {
  abortTaskPlan,
  confirmTaskPlan,
  rejectTaskPlan,
  resumeTaskPlan,
  type ActiveTaskPlanDTO,
  type TaskPlanStepDTO,
} from '../api'

type Props = {
  open: boolean
  instanceId: string
  agentId: string
  plan: ActiveTaskPlanDTO | null
  onClose: () => void
  onChanged?: () => void
  onError?: (msg: string) => void
}

const TITLE_MAX = 6

/** 底部任务计划弹窗：确认前可编辑；确认后只读 + 终止/继续 */
export function TaskPlanSheet({
  open,
  instanceId,
  agentId,
  plan,
  onClose,
  onChanged,
  onError,
}: Props) {
  const editable = plan?.phase === 'awaiting_confirm' && !plan.frozen
  const [steps, setSteps] = useState<TaskPlanStepDTO[]>([])
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  useEffect(() => {
    if (!open || !plan) return
    setSteps(
      (plan.step_items ?? []).map((s, i) => ({
        id: s.id || `s${i}`,
        title: s.title || '',
        detail: s.detail || '',
        status: s.status || 'pending',
      })),
    )
    setExpanded({})
  }, [open, plan?.plan_id, plan?.phase, plan?.step_items])

  const progress = plan?.progress ?? 0
  const phaseLabel = useMemo(() => {
    switch (plan?.phase) {
      case 'awaiting_confirm':
        return '待确认'
      case 'running':
        return '执行中'
      case 'paused':
        return '已暂停'
      default:
        return plan?.phase || ''
    }
  }, [plan?.phase])

  if (!open || !plan) return null

  function updateStep(i: number, patch: Partial<TaskPlanStepDTO>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  function addStep() {
    if (steps.length >= 8) return
    setSteps((prev) => [...prev, { id: `s${prev.length}`, title: '', detail: '', status: 'pending' }])
  }

  function removeStep(i: number) {
    if (steps.length <= 3) return
    setSteps((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function onConfirm() {
    if (!plan) return
    const cleaned = steps
      .map((s) => ({
        ...s,
        title: (s.title || '').trim().slice(0, TITLE_MAX),
        detail: (s.detail || '').trim(),
      }))
      .filter((s) => s.title)
    if (cleaned.length < 3) {
      onError?.('至少保留 3 个步骤')
      return
    }
    setBusy(true)
    try {
      await confirmTaskPlan(instanceId, agentId, plan.plan_id, cleaned)
      onChanged?.()
      onClose()
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '确认失败')
    } finally {
      setBusy(false)
    }
  }

  async function onReject() {
    if (!plan) return
    setBusy(true)
    try {
      await rejectTaskPlan(instanceId, agentId, plan.plan_id)
      onChanged?.()
      onClose()
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '拒绝失败')
    } finally {
      setBusy(false)
    }
  }

  async function onAbort() {
    if (!plan) return
    setBusy(true)
    try {
      await abortTaskPlan(instanceId, agentId, plan.plan_id)
      onChanged?.()
      onClose()
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '终止失败')
    } finally {
      setBusy(false)
    }
  }

  async function onResume() {
    if (!plan) return
    setBusy(true)
    try {
      await resumeTaskPlan(instanceId, agentId, plan.plan_id)
      onChanged?.()
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '继续失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tq-list-mask" role="presentation" onClick={onClose}>
      <div
        className="tq-list-sheet task-plan-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="任务计划"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="tq-list-head">
          <div>
            <strong>任务计划</strong>
            <span className="muted"> · {phaseLabel}</span>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>
            关闭
          </button>
        </header>

        <p className="modal-hint">{plan.task_name || plan.plan_id}</p>
        {(plan.phase === 'running' || plan.phase === 'paused') && (
          <div className="agent-progress-bar" style={{ marginBottom: 12 }}>
            <div style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
        )}

        <ol className="task-plan-steps">
          {steps.map((step, i) => {
            const openDetail = !!expanded[i]
            const status = step.status || 'pending'
            return (
              <li key={step.id || i} className={`task-plan-step is-${status}`}>
                <div className="task-plan-step-row">
                  <span className="task-plan-idx">{i + 1}</span>
                  {editable ? (
                    <input
                      className="task-plan-title-input"
                      value={step.title}
                      maxLength={TITLE_MAX}
                      placeholder="标题≤6字"
                      onChange={(e) => updateStep(i, { title: e.target.value })}
                    />
                  ) : (
                    <strong className="task-plan-title">{step.title || '—'}</strong>
                  )}
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setExpanded((m) => ({ ...m, [i]: !openDetail }))}
                  >
                    {openDetail ? '收起' : '详情'}
                  </button>
                  {editable && (
                    <button type="button" className="btn ghost" disabled={steps.length <= 3} onClick={() => removeStep(i)}>
                      删
                    </button>
                  )}
                </div>
                {openDetail && (
                  editable ? (
                    <textarea
                      className="task-plan-detail-input"
                      rows={3}
                      value={step.detail || ''}
                      placeholder="步骤说明"
                      onChange={(e) => updateStep(i, { detail: e.target.value })}
                    />
                  ) : (
                    <p className="muted task-plan-detail">{step.detail || '无详情'}</p>
                  )
                )}
              </li>
            )
          })}
        </ol>

        {editable && (
          <button type="button" className="btn" disabled={steps.length >= 8 || busy} onClick={addStep}>
            增加步骤
          </button>
        )}

        <footer className="tq-list-foot task-plan-foot">
          {editable ? (
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => void onReject()}>
                拒绝
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void onConfirm()}>
                确认执行
              </button>
            </>
          ) : (
            <>
              {plan.phase === 'paused' && (
                <button type="button" className="btn primary" disabled={busy} onClick={() => void onResume()}>
                  继续
                </button>
              )}
              {(plan.phase === 'running' || plan.phase === 'paused') && (
                <button type="button" className="btn danger" disabled={busy} onClick={() => void onAbort()}>
                  终止计划
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
