import { useState } from 'react'
import JellyAvatar from './JellyAvatar.jsx'
import { JELLY_COLORS } from './jellyColor.js'

/** 十二色中文标签（aria / title） */
export const JELLY_COLOR_LABEL = {
  orange: '橙',
  yellow: '黄',
  blue: '蓝',
  green: '绿',
  purple: '紫',
  red: '红',
  cyan: '青蓝',
  teal: '青绿',
  pink: '粉',
  lime: '柠',
  coral: '珊瑚',
  sky: '天蓝',
}

/**
 * 创建/编辑时可手动预览的精灵动作（与 JellyAvatar 已支持的行一致）。
 * 仅影响预览，不写入 jelly_color。
 */
export const JELLY_PREVIEW_ACTIONS = [
  { id: 'idle', label: 'idle' },
  { id: 'typing', label: 'typing' },
  { id: 'sleep', label: 'sleep' },
  { id: 'eat', label: 'eat' },
  { id: 'waiting', label: 'alert' },
  { id: 'error', label: 'error' },
  { id: 'celebrate', label: 'celebrate' },
  { id: 'ponder', label: 'ponder' },
  { id: 'coding', label: 'coding' },
]

/**
 * 十二色水母选择行 + 大预览（创建 / 编辑员工头像）。
 * 选色立即驱动上方 JellyAvatar 播放对应色精灵动画。
 * @param {{
 *   value: string,
 *   onChange: (color: string) => void,
 *   disabled?: boolean,
 *   label?: string,
 *   showPreview?: boolean,
 *   previewSize?: number,
 *   showActions?: boolean,
 * }} props
 */
export default function JellyColorPicker({
  value,
  onChange,
  disabled = false,
  label = '头像颜色',
  showPreview = true,
  previewSize = 64,
  showActions = true,
}) {
  const [previewAction, setPreviewAction] = useState('idle')

  return (
    <div className="jelly-color-picker">
      {showPreview ? (
        <div className="jelly-color-picker-preview">
          <JellyAvatar color={value} size={previewSize} state={previewAction} />
          {showActions ? (
            <label className="jelly-color-picker-action">
              <span>动作预览</span>
              <select
                value={previewAction}
                disabled={disabled}
                aria-label="动作预览"
                onChange={(e) => setPreviewAction(e.target.value)}
              >
                {JELLY_PREVIEW_ACTIONS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      <span className="jelly-color-picker-label">{label}</span>
      <div className="jelly-color-picker-row" role="radiogroup" aria-label={label}>
        {JELLY_COLORS.map((c) => {
          const selected = value === c
          const name = JELLY_COLOR_LABEL[c] || c
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={name}
              title={name}
              className={`jelly-color-swatch${selected ? ' is-selected' : ''}`}
              disabled={disabled}
              onClick={() => onChange?.(c)}
            >
              <JellyAvatar color={c} size={32} state="idle" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
