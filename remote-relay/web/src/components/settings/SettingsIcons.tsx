import type { ReactNode } from 'react'

type IconProps = { size?: number; className?: string }

/** Shared monochrome line-icon base for Settings */
function base(props: IconProps & { children: ReactNode }) {
  const { size = 20, className, children } = props
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function SettingsIconLayers(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <path d="M12 2 2 7l10 5 10-5-10-5Z" />
        <path d="m2 17 10 5 10-5" />
        <path d="m2 12 10 5 10-5" />
      </>
    ),
  })
}

export function SettingsIconGlobe(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 0 1 0 18" />
        <path d="M12 3a14 14 0 0 0 0 18" />
      </>
    ),
  })
}

export function SettingsIconMail(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </>
    ),
  })
}

export function SettingsIconNetwork(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <circle cx="6" cy="12" r="2.2" />
        <circle cx="18" cy="6" r="2.2" />
        <circle cx="18" cy="18" r="2.2" />
        <path d="M8 12h6.5M16.2 7.6 9.8 11M16.2 16.4 9.8 13" />
      </>
    ),
  })
}

export function SettingsIconBell(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />
        <path d="M10 21a2 2 0 0 0 4 0" />
      </>
    ),
  })
}

export function SettingsIconDoc(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <path d="M8 3h6l4 4v14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M14 3v4h4M9 12h6M9 16h6" />
      </>
    ),
  })
}

export function SettingsIconInfo(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10v6M12 7.5h.01" />
      </>
    ),
  })
}

export function SettingsIconChevron(p: IconProps) {
  return base({
    ...p,
    size: p.size ?? 16,
    children: <path d="m9 6 6 6-6 6" />,
  })
}

export function SettingsIconMonitor(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </>
    ),
  })
}
