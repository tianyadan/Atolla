import { useEffect, useRef, useState } from 'react'
import { UI_MODE_CLASSIC, UI_MODE_JELLY } from './uiMode.js'

/**
 * 水母顶栏：团队名、一键招聘、⋯（含「新版界面」开关）。
 */
export default function JellyTopBar({
  teams = [],
  teamId,
  onTeamChange,
  onHire,
  onMenu,
  uiMode = UI_MODE_JELLY,
  onUiModeChange,
  extra,
}) {
  const [open, setOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const boxRef = useRef(null)
  const current = teams.find((t) => String(t.id) === String(teamId)) || teams[0]
  const jellyOn = uiMode === UI_MODE_JELLY

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
        <button type="button" className="jelly-btn" onClick={() => onHire?.()}>一键招聘</button>
        <button type="button" className="jelly-btn ghost" onClick={() => setMoreOpen((v) => !v)} aria-label="更多">⋯</button>
        {moreOpen && (
          <div className="jelly-more-menu">
            <button
              type="button"
              className={jellyOn ? 'on' : ''}
              onClick={() => {
                onUiModeChange?.(jellyOn ? UI_MODE_CLASSIC : UI_MODE_JELLY)
                setMoreOpen(false)
              }}
            >
              {jellyOn ? '✓ 新版界面' : '新版界面'}
            </button>
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
