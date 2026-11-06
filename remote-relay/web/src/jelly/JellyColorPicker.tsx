import { useState } from 'react'
import { JellyAvatar } from './JellyAvatar'
import { JELLY_COLORS, type JellyColor } from './jellyColor'
import type { JellyActionState } from './jellySprite'

/** 十二色中文标签 */
export const JELLY_COLOR_LABEL: Record<JellyColor, string> = {
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

/** 可手动预览的精灵动作（与 JellyAvatar 已支持行一致） */
export const JELLY_PREVIEW_ACTIONS: { id: JellyActionState; label: string }[] = [
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

type Props = {
  value: string
  onChange: (color: JellyColor) => void
  disabled?: boolean
  label?: string
  showPreview?: boolean
  previewSize?: number
  showActions?: boolean
}

/** 十二色水母选择行 + 大预览 */
export function JellyColorPicker({
  value,
  onChange,
  disabled = false,
  label = '头像颜色',
  showPreview = true,
  previewSize = 64,
  showActions = true,
}: Props) {
  const [previewAction, setPreviewAction] = useState<JellyActionState>('idle')

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
                onChange={(e) => setPreviewAction(e.target.value as JellyActionState)}
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
          const name = JELLY_COLOR_LABEL[c]
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
              onClick={() => onChange(c)}
            >
              <JellyAvatar color={c} size={32} state="idle" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
