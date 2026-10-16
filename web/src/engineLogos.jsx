/** 官方标志：Claude 符号、Codex 产品标、Cursor 品牌方块。 */
const LOGO_SRC = {
  claude: '/engine-logos/claude.svg',
  codex: '/engine-logos/codex.svg',
  cursor: '/engine-logos/cursor.svg',
}

export function EngineLogo({ id, className = '' }) {
  const src = LOGO_SRC[id] || LOGO_SRC.cursor
  return (
    <img
      className={`engine-logo ${className}`.trim()}
      src={src}
      alt=""
      width={34}
      height={34}
    />
  )
}
