import { UI_MODE_JELLY, UI_MODE_CLASSIC } from './uiMode.js'

/**
 * 经典左侧导航底部「新版界面」开关（紧挨「版本」下方）。
 * 点击在经典 ↔ 水母间切换，不刷新页面。
 */
export default function ClassicNewUiNavButton({ uiMode, onUiModeChange, collapsed = false }) {
  const on = uiMode === UI_MODE_JELLY
  return (
    <button
      type="button"
      className={`admin-side-new-ui ${on ? 'active' : ''}`}
      title="新版界面"
      onClick={() => onUiModeChange?.(on ? UI_MODE_CLASSIC : UI_MODE_JELLY)}
    >
      <span className="admin-side-main">
        <svg className="admin-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <path d="M5 11a7 6 0 0 1 14 0H5zM8 11v7M12 11v9M16 11v6" />
        </svg>
        {!collapsed && <span className="admin-side-label">新版界面</span>}
      </span>
      {!collapsed && (
        <span className="admin-side-new-ui-state">{on ? '开' : '关'}</span>
      )}
    </button>
  )
}
