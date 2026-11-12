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

/** Sidebar / left-drawer toggle — monochrome via currentColor */
export function IconSidebar(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
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

/** Thermometer for host temperature metric */
export function IconTemp(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4 4 0 1 0 5 0Z" />
        <path d="M11.5 15.5V7" />
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

/** Horizontal ⋯ menu affordance (prototype) */
export function IconMore(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <circle cx="5" cy="12" r="1.35" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1.35" fill="currentColor" stroke="none" />
      </>
    ),
  })
}

/** Single user silhouette (drawer footer avatar) */
export function IconUser(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="3.5" />
      </>
    ),
  })
}

/** People / agents management */
export function IconUsers(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="3" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
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

/** Filter / sort sliders (toolbar) — monochrome */
export function IconSliders(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="8" cy="6" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="14" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="10" cy="18" r="1.6" fill="currentColor" stroke="none" />
      </>
    ),
  })
}

/** Plus for add-instance top action */
export function IconPlus(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
  })
}

/** Bell / notifications — monochrome */
export function IconBell(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </>
    ),
  })
}

/** Filled Windows mark (4 panes) — black/white via currentColor */
export function IconWindows(p: IconProps) {
  const { size = 22, className } = p
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M3 4.5h8.2v7.2H3V4.5zm9.8 0H21v7.2h-8.2V4.5zM3 12.8h8.2V20H3v-7.2zm9.8 0H21V20h-8.2v-7.2z" />
    </svg>
  )
}

/** Filled Apple mark — black/white via currentColor */
export function IconApple(p: IconProps) {
  const { size = 22, className } = p
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M16.7 12.3c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.7-1.3-.1-2.5.8-3.1.8-.7 0-1.7-.7-2.8-.7-1.4 0-2.8.9-3.5 2.2-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.6 2.2 2.7 2.1 1.1-.1 1.5-.7 2.8-.7s1.7.7 2.8.7c1.2 0 1.9-1 2.6-2 .8-1.2 1.1-2.3 1.1-2.4-.02-.01-2.2-.8-2.2-3.7zM14.8 5.9c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.7-1 1.6-.9 2.6 1 0 1.9-.5 2.5-1.2z" />
    </svg>
  )
}

/** Compact laptop glyph for generic / Linux hosts */
export function IconLaptop(p: IconProps) {
  return base({
    ...p,
    children: (
      <>
        <rect x="3" y="5" width="18" height="12" rx="1.5" />
        <path d="M2 19h20" />
      </>
    ),
  })
}
