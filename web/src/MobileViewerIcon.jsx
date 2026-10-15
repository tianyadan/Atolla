/** 15×15 手机图标：标示「手机端正在查看」该数字人 */
export function MobileViewerIcon({ title = '手机端正在查看' }) {
  return (
    <span className="ma-mobile-viewer" title={title}>
      <svg
        className="ma-mobile-viewer-icon"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label={title}
        role="img"
      >
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" />
      </svg>
    </span>
  )
}
