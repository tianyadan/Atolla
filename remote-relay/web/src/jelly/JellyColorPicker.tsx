import { JellyAvatar } from './JellyAvatar'
import { JELLY_COLORS, type JellyColor } from './jellyColor'

const COLOR_LABEL: Record<JellyColor, string> = {
  orange: '橙',
  yellow: '黄',
  blue: '蓝',
  green: '绿',
  purple: '紫',
  red: '红',
}

type Props = {
  value: string
  onChange: (color: JellyColor) => void
  disabled?: boolean
  label?: string
}

/** 六色水母选择行 */
export function JellyColorPicker({
  value,
  onChange,
  disabled = false,
  label = '头像颜色',
}: Props) {
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
