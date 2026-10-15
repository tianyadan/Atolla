import type { ReactNode } from 'react'

/** Inline SVG icons for instances dark UI (Heroicons-style) */

type IconProps = { size?: number; className?: string }

function base(props: IconProps & { children: ReactNode; viewBox?: string }) {
  const { size = 18, className, children, viewBox = '0 0 24 24' } = props
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function IconSearch(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
  })
}

export function IconChevronDown(p: IconProps) {
  return base({ ...p, children: <path d="m6 9 6 6 6-6" /> })
}

export function IconSun(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </>
    ),
  })
}

/** Moon for switching to dark theme */
export function IconMoon(p: IconProps) {
  return base({
    ...p,
    children: <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z" />,
  })
}

export function IconMonitor(p: IconProps) {
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

export function IconChip(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <rect x="7" y="7" width="10" height="10" rx="1.5" />
        <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
      </>
    ),
  })
}

export function IconClock(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  })
}

export function IconMemory(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <rect x="3" y="7" width="18" height="10" rx="2" />
        <path d="M7 7V5M12 7V5M17 7V5M7 17v2M12 17v2M17 17v2" />
      </>
    ),
  })
}

export function IconDisk(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <ellipse cx="12" cy="6" rx="7" ry="3" />
        <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
        <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
      </>
    ),
  })
}

export function IconInfo(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8h.01M11 12h1v4h1" />
      </>
    ),
  })
}

export function IconEnter(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
        <path d="M10 17l5-5-5-5M15 12H3" />
      </>
    ),
  })
}

export function IconTrash(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
      </>
    ),
  })
}

export function IconMore(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <circle cx="12" cy="5" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
        <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
      </>
    ),
  })
}

export function IconChevronRight(p: IconProps) {
  return base({ ...p, children: <path d="m9 6 6 6-6 6" /> })
}

export function IconEmptyMonitor(p: IconProps) {
  return base({
    ...p,
    size: p.size ?? 64,
    children: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
        <path d="M9 9h2l1 3 1-3h2" />
      </>
    ),
  })
}
