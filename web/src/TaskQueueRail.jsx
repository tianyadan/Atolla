import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale } from './i18n/useLocale.js'

const API = '/api'
const SIZE_KEY = 'atolla.tq.drawerSize'
const DEFAULT_SIZE = { w: 320, h: 480 }
const MIN_W = 220
const MIN_H = 240

/** 读取本地保存的抽屉尺寸 */
function loadSavedSize() {
  try {
    const raw = localStorage.getItem(SIZE_KEY)
    if (!raw) return { ...DEFAULT_SIZE }
    const d = JSON.parse(raw)
    const w = Number(d.w)
    const h = Number(d.h)
    if (!Number.isFinite(w) || !Number.isFinite(h)) return { ...DEFAULT_SIZE }
    return { w: Math.round(w), h: Math.round(h) }
  } catch {
    return { ...DEFAULT_SIZE }
  }
}

/** 视口内夹紧宽高 */
function clampSize(w, h) {
  const maxW = Math.max(MIN_W, Math.min(720, Math.floor(window.innerWidth * 0.72)))
  const maxH = Math.max(MIN_H, Math.min(900, Math.floor(window.innerHeight * 0.85)))
  return {
    w: Math.min(maxW, Math.max(MIN_W, Math.round(w))),
    h: Math.min(maxH, Math.max(MIN_H, Math.round(h))),
  }
}

/** 右侧任务队列轨：三角展开抽屉，可拖拽改宽高。 */
export default function TaskQueueRail({
  agentId,
  authHeaders,
  onUnauthorized,
  active,
  refreshKey = 0,
  onContinue,
}) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState({ items: [], hold: false, active: 0 })
  const [hoverId, setHoverId] = useState(null)
  /** fixed 气泡，避免被抽屉 overflow 裁切 */
  const [tip, setTip] = useState(null)
  const tipHideTimer = useRef(0)
  const [busy, setBusy] = useState(false)
  const [size, setSize] = useState(() => clampSize(loadSavedSize().w, loadSavedSize().h))
  const dragRef = useRef(null)

  function clearTipSoon() {
    window.clearTimeout(tipHideTimer.current)
    tipHideTimer.current = window.setTimeout(() => {
      setHoverId(null)
      setTip(null)
    }, 120)
  }

  /** 按灯点位置把气泡固定到视口左侧（或空间不够时右侧） */
  function showTipFor(item, anchorEl) {
    window.clearTimeout(tipHideTimer.current)
    if (!anchorEl) return
    const r = anchorEl.getBoundingClientRect()
    const width = Math.min(280, Math.max(200, Math.floor(window.innerWidth * 0.26)))
    const gap = 12
    let left = r.left - gap - width
    let place = 'left'
    if (left < 8) {
      left = Math.min(r.right + gap, window.innerWidth - width - 8)
      place = 'right'
    }
    let top = r.top + r.height / 2
    const maxTop = window.innerHeight - 24
    const minTop = 24
    top = Math.min(maxTop, Math.max(minTop, top))
    setHoverId(item.id)
    setTip({
      id: item.id,
      status: item.status || 'queued',
      text: item.question || '',
      top,
      left,
      width,
      place,
    })
  }

  useEffect(() => () => window.clearTimeout(tipHideTimer.current), [])

  useEffect(() => {
    if (!open) {
      setHoverId(null)
      setTip(null)
    }
  }, [open])

  async function load() {
    if (!agentId) return
    try {
      const res = await fetch(`${API}/admin/agents/${agentId}/task-queue`, { headers: authHeaders() })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      if (!res.ok) return
      const d = await res.json()
      setView({
        items: Array.isArray(d.items) ? d.items : [],
        hold: !!d.hold,
        active: Number(d.active) || 0,
      })
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!active || !agentId) return undefined
    void load()
    const timer = window.setInterval(() => void load(), 4000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, agentId, refreshKey])

  // 窗口变化时重新夹紧
  useEffect(() => {
    function onResize() {
      setSize((s) => clampSize(s.w, s.h))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const persistSize = useCallback((next) => {
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }, [])

  /** 开始拖拽改尺寸：axis = w | h | both */
  function startResize(e, axis) {
    e.preventDefault()
    e.stopPropagation()
    const pointerId = e.pointerId
    const startX = e.clientX
    const startY = e.clientY
    const startW = size.w
    const startH = size.h
    dragRef.current = { axis, pointerId, startX, startY, startW, startH }
    const el = e.currentTarget
    try {
      el.setPointerCapture(pointerId)
    } catch {
      /* ignore */
    }
    document.body.classList.add('tq-resizing')
  }

  function onResizeMove(e) {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    // 抽屉贴右：向左拖增大宽度；向下拖增大高度
    let w = d.startW
    let h = d.startH
    if (d.axis === 'w' || d.axis === 'both') {
      w = d.startW + (d.startX - e.clientX)
    }
    if (d.axis === 'h' || d.axis === 'both') {
      h = d.startH + (e.clientY - d.startY)
    }
    setSize(clampSize(w, h))
  }

  function endResize(e) {
    const d = dragRef.current
    if (!d || (e && d.pointerId !== e.pointerId)) return
    dragRef.current = null
    document.body.classList.remove('tq-resizing')
    setSize((s) => {
      const next = clampSize(s.w, s.h)
      persistSize(next)
      return next
    })
  }

  const trackItems = useMemo(() => {
    const activeStatuses = new Set(['running', 'paused', 'queued'])
    const live = view.items.filter((x) => activeStatuses.has(x.status))
    const done = view.items.filter((x) => x.status === 'done' || x.status === 'failed' || x.status === 'cancelled')
    return [...live, ...done.slice(0, 12)]
  }, [view.items])

  const badge = view.active || (view.hold ? 1 : 0)

  async function cancelTask(taskId) {
    if (!agentId || busy) return
    setBusy(true)
    try {
      const res = await fetch(`${API}/admin/agents/${agentId}/task-queue/${taskId}/cancel`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (res.status === 401) onUnauthorized?.()
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function clearDone() {
    if (!agentId || busy) return
    setBusy(true)
    try {
      await fetch(`${API}/admin/agents/${agentId}/task-queue/clear-done`, {
        method: 'POST',
        headers: authHeaders(),
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!agentId) return null

  return (
    <div className={`tq-rail${open ? ' is-open' : ''}${badge ? ' has-badge' : ''}`}>
      <button
        type="button"
        className="tq-rail-toggle"
        title={t('tq.toggle')}
        aria-label={t('tq.toggle')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tq-rail-chevron" aria-hidden="true" />
        {badge > 0 ? <em className="tq-rail-badge">{badge > 9 ? '9+' : badge}</em> : null}
      </button>

      {open ? (
        <aside
          className="tq-drawer"
          aria-label={t('tq.title')}
          style={{ width: size.w, height: size.h, maxHeight: 'none' }}
        >
          <header className="tq-drawer-head">
            <strong>{t('tq.title')}</strong>
            <div className="tq-drawer-actions">
              {view.hold ? (
                <button type="button" className="ghost" disabled={busy} onClick={() => onContinue?.()}>
                  {t('tq.continue')}
                </button>
              ) : null}
              <button type="button" className="ghost" disabled={busy} onClick={() => void clearDone()}>
                {t('tq.clearDone')}
              </button>
              <button type="button" className="ghost" onClick={() => setOpen(false)} aria-label={t('tq.close')}>
                ×
              </button>
            </div>
          </header>
          {view.hold ? <p className="tq-hold-hint">{t('tq.holdHint')}</p> : null}
          <div className="tq-track">
            {trackItems.length === 0 ? (
              <p className="tq-empty">{t('tq.empty')}</p>
            ) : (
              trackItems.map((item, idx) => {
                const st = item.status || 'queued'
                const q = item.question || ''
                return (
                  <div
                    key={item.id}
                    className={`tq-node st-${st}${hoverId === item.id ? ' is-hover' : ''}`}
                    onMouseEnter={(e) => showTipFor(item, e.currentTarget.querySelector('.tq-dot') || e.currentTarget)}
                    onMouseLeave={clearTipSoon}
                  >
                    {idx > 0 ? <i className="tq-line" aria-hidden="true" /> : null}
                    <button
                      type="button"
                      className={`tq-dot st-${st}`}
                      aria-label={q.slice(0, 80)}
                    />
                  </div>
                )
              })
            )}
          </div>

          {/* 左缘改宽 */}
          <div
            className="tq-resize tq-resize-w"
            title={t('tq.resize')}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('tq.resizeW')}
            onPointerDown={(e) => startResize(e, 'w')}
            onPointerMove={onResizeMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
          {/* 底缘改高 */}
          <div
            className="tq-resize tq-resize-h"
            title={t('tq.resize')}
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('tq.resizeH')}
            onPointerDown={(e) => startResize(e, 'h')}
            onPointerMove={onResizeMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
          {/* 左下角同时改宽高 */}
          <div
            className="tq-resize tq-resize-both"
            title={t('tq.resize')}
            role="separator"
            aria-label={t('tq.resize')}
            onPointerDown={(e) => startResize(e, 'both')}
            onPointerMove={onResizeMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
        </aside>
      ) : null}

      {tip ? (
        <div
          className={`tq-tooltip tq-tooltip-fixed place-${tip.place || 'left'}`}
          role="tooltip"
          style={{ top: tip.top, left: tip.left, width: tip.width }}
          onMouseEnter={() => window.clearTimeout(tipHideTimer.current)}
          onMouseLeave={clearTipSoon}
        >
          <span className={`tq-status st-${tip.status}`}>{t(`tq.status.${tip.status}`)}</span>
          <p>{tip.text}</p>
          {(tip.status === 'queued' || tip.status === 'paused') && (
            <button type="button" className="ghost" disabled={busy} onClick={() => void cancelTask(tip.id)}>
              {t('tq.cancel')}
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
