import { useEffect, useRef, useState } from 'react'

const EXIT_MS = 320
const TITLE_MAX = 6

/** PC 端底部任务计划确认弹层：确认前允许编辑，与移动端共用后端状态。 */
export default function TaskPlanConfirmSheet({ open, plan, busy, onConfirm, onReject, onError }) {
  const [mounted, setMounted] = useState(!!open)
  const [shown, setShown] = useState(false)
  const [steps, setSteps] = useState([])
  const [expanded, setExpanded] = useState({})
  const planIdRef = useRef('')

  useEffect(() => {
    let raf1 = 0
    let raf2 = 0
    let timer = 0
    if (open) {
      // 弹层需要先挂载再补一帧触发进入动画，与 PC 插话弹层保持一致。
      // eslint-disable-next-line react/set-state-in-effect
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

  useEffect(() => {
    if (!open || !plan) return
    const nextPlanId = String(plan.plan_id || '')
    if (planIdRef.current === nextPlanId) return
    planIdRef.current = nextPlanId
    setSteps((plan.step_items || []).map((step, index) => ({
      id: step.id || `s${index}`,
      title: step.title || '',
      detail: step.detail || '',
      status: step.status || 'pending',
    })))
    setExpanded({})
  }, [open, plan])

  if (!mounted || !plan) return null

  function updateStep(index, patch) {
    setSteps((items) => items.map((step, i) => (i === index ? { ...step, ...patch } : step)))
  }

  function addStep() {
    if (steps.length >= 8) return
    setSteps((items) => [...items, { id: `s${items.length}`, title: '', detail: '', status: 'pending' }])
  }

  function removeStep(index) {
    if (steps.length <= 3) return
    setSteps((items) => items.filter((_, i) => i !== index))
  }

  function confirm() {
    const cleaned = steps
      .map((step) => ({
        ...step,
        title: String(step.title || '').trim().slice(0, TITLE_MAX),
        detail: String(step.detail || '').trim(),
      }))
      .filter((step) => step.title)
    if (cleaned.length < 3) {
      onError?.('至少保留 3 个步骤')
      return
    }
    onConfirm?.(cleaned)
  }

  return (
    <section
      className={`tq-sheet-anchor pc-task-plan-anchor${shown ? ' is-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="任务计划确认"
    >
      <div className="tq-sheet pc-task-plan-sheet">
        <header className="pc-task-plan-head">
          <div>
            <strong>任务计划</strong>
            <span>待确认</span>
          </div>
          <p>{plan.task_name || '请确认执行步骤'}</p>
        </header>

        <ol className="pc-task-plan-steps">
          {steps.map((step, index) => {
            const detailOpen = !!expanded[index]
            return (
              <li key={step.id || index} className="pc-task-plan-step">
                <div className="pc-task-plan-row">
                  <span className="pc-task-plan-index">{index + 1}</span>
                  <input
                    value={step.title}
                    maxLength={TITLE_MAX}
                    disabled={busy}
                    aria-label={`步骤 ${index + 1} 标题`}
                    placeholder="标题≤6字"
                    onChange={(event) => updateStep(index, { title: event.target.value })}
                  />
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => setExpanded((value) => ({ ...value, [index]: !detailOpen }))}
                  >
                    {detailOpen ? '收起' : '详情'}
                  </button>
                  <button type="button" className="ghost" disabled={busy || steps.length <= 3} onClick={() => removeStep(index)}>
                    删除
                  </button>
                </div>
                {detailOpen ? (
                  <textarea
                    rows={3}
                    value={step.detail || ''}
                    disabled={busy}
                    aria-label={`步骤 ${index + 1} 说明`}
                    placeholder="步骤说明"
                    onChange={(event) => updateStep(index, { detail: event.target.value })}
                  />
                ) : null}
              </li>
            )
          })}
        </ol>

        <footer className="pc-task-plan-foot">
          <button type="button" className="ghost pc-task-plan-add" disabled={busy || steps.length >= 8} onClick={addStep}>
            增加步骤
          </button>
          <div>
            <button type="button" className="outline" disabled={busy} onClick={() => onReject?.()}>
              {busy ? '处理中…' : '拒绝'}
            </button>
            <button type="button" className="primary" disabled={busy} onClick={confirm}>
              {busy ? '处理中…' : '确认执行'}
            </button>
          </div>
        </footer>
      </div>
    </section>
  )
}
