import JellyAvatar from './JellyAvatar.jsx'
import { JELLY_COLORS } from './jellyColor.js'

const COLOR_LABEL = {
  orange: '橙',
  yellow: '黄',
  blue: '蓝',
  green: '绿',
  purple: '紫',
  red: '红',
}

/**
 * 六色水母选择行（创建 / 编辑员工头像）。
 * @param {{
 *   value: string,
 *   onChange: (color: string) => void,
 *   disabled?: boolean,
 *   label?: string,
 * }} props
 */
export default function JellyColorPicker({ value, onChange, disabled = false, label = '头像颜色' }) {
  return (
    <div className="jelly-color-picker">
      <span className="jelly-color-picker-label">{label}</span>
      <div className="jelly-color-picker-row" role="radiogroup" aria-label={label}>
        {JELLY_COLORS.map((c) => {
          const selected = value === c
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={COLOR_LABEL[c] || c}
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
