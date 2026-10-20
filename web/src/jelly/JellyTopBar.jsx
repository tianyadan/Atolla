import { useEffect, useRef, useState } from 'react'
import { UI_MODE_CLASSIC, UI_MODE_JELLY } from './uiMode.js'

/**
 * 水母顶栏：团队名（可切换）、一键招聘、⋯、经典/水母切换。
 */
export default function JellyTopBar({
  teams = [],
  teamId,
  onTeamChange,
  onHire,
  onMenu,
  uiMode,
  onUiModeChange,
  extra,
}) {
  const [open, setOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const boxRef = useRef(null)
  const current = teams.find((t) => String(t.id) === String(teamId)) || teams[0]

  useEffect(() => {
    function onDoc(e) {
      if (!boxRef.current?.contains(e.target)) {
        setOpen(false)
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <header className="jelly-top" ref={boxRef}>
      <div className="jelly-team-wrap">
        <button type="button" className="jelly-team" onClick={() => setOpen((v) => !v)}>
          {current?.name || '未命名工作组'}
          <small>⌄</small>
        </button>
        {open && (
          <div className="jelly-team-menu">
            {teams.length === 0 && <div className="jelly-team-empty">暂无工作组</div>}
            {teams.map((t) => (
              <button
                key={t.id}
                type="button"
                className={String(t.id) === String(teamId) ? 'on' : ''}
                onClick={() => {
                  onTeamChange?.(t.id)
                  setOpen(false)
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="jelly-acts">
        {extra}
        <div className="jelly-mode-toggle" role="group" aria-label="界面切换">
          <button
            type="button"
            className={uiMode === UI_MODE_CLASSIC ? 'on' : ''}
            onClick={() => onUiModeChange?.(UI_MODE_CLASSIC)}
          >
            经典界面
          </button>
          <button
            type="button"
            className={uiMode === UI_MODE_JELLY ? 'on' : ''}
            onClick={() => onUiModeChange?.(UI_MODE_JELLY)}
          >
            水母界面
          </button>
        </div>
        <button type="button" className="jelly-btn" onClick={() => onHire?.()}>一键招聘</button>
        <button type="button" className="jelly-btn ghost" onClick={() => setMoreOpen((v) => !v)} aria-label="更多">⋯</button>
        {moreOpen && (
          <div className="jelly-more-menu">
            <button type="button" onClick={() => { onMenu?.('agents-manage'); setMoreOpen(false) }}>数字人管理</button>
            <button type="button" onClick={() => { onMenu?.('audit'); setMoreOpen(false) }}>对话审计</button>
            <button type="button" onClick={() => { onMenu?.('changelog'); setMoreOpen(false) }}>版本</button>
            <button type="button" onClick={() => { onMenu?.('logout'); setMoreOpen(false) }}>退出登录</button>
          </div>
        )}
      </div>
    </header>
  )
}
