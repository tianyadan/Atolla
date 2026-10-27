/** SQLite / MySQL 小图标；mono 为设置页用的单色线框，避免彩色品牌块。 */
export function DbLogo({ id, size = 18, mono = false }) {
  const s = { width: size, height: size, display: 'block', flex: 'none' }
  const stroke = mono ? '#a3a3a3' : undefined

  if (id === 'mysql') {
    if (mono) {
      return (
        <svg viewBox="0 0 24 24" style={s} fill="none" aria-hidden="true">
          <ellipse cx="12" cy="7" rx="7" ry="3" stroke={stroke} strokeWidth="1.5" />
          <path
            d="M5 7v6c0 1.7 3.1 3 7 3s7-1.3 7-3V7"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M5 13v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )
    }
    return (
      <svg viewBox="0 0 64 64" style={s} aria-hidden="true">
        <circle cx="32" cy="32" r="30" fill="#00758F" />
        <path
          fill="#F29111"
          d="M18 38c2.5-8 7-14 14-18 1.2 4 2 8.5 2 13 0 2-.2 4-.5 6-5 1.5-10 2.5-15.5 2.5-.1-1.2 0-2.4.2-3.5zm28-2c-.4 4-1.2 7.5-2.4 10.5 4.2-.8 8-2.2 11.2-4.2-1.5-2.5-3.8-4.5-6.8-6.3h-2z"
        />
        <path
          fill="#fff"
          opacity=".9"
          d="M22 22c4-3 9-5 14-5 2 3.5 3.2 7.5 3.5 12-4.5.5-9 1.8-13 3.8-.8-3.5-2.2-7-4.5-10.8z"
        />
      </svg>
    )
  }

  // sqlite
  if (mono) {
    return (
      <svg viewBox="0 0 24 24" style={s} fill="none" aria-hidden="true">
        <rect x="4" y="3.5" width="16" height="17" rx="2.5" stroke={stroke} strokeWidth="1.5" />
        <path d="M8 8h5.5M8 12h8M8 16h6" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 64 64" style={s} aria-hidden="true">
      <rect x="4" y="4" width="56" height="56" rx="12" fill="#0F80CC" />
      <path
        fill="#fff"
        d="M20 16h10c8 0 14 5 14 13s-6 13-14 13H26v10h-6V16zm6 6v14h4c4.5 0 8-3.2 8-7s-3.5-7-8-7h-4z"
      />
    </svg>
  )
}
