import type { ReactNode } from 'react'
import { SettingsIconChevron } from './SettingsIcons'

type GroupProps = {
  title: string
  children: ReactNode
}

/** iOS-style settings section: uppercase header + continuous list */
export function SettingsGroup({ title, children }: GroupProps) {
  return (
    <section className="ios-settings-group">
      <h2 className="ios-settings-group-title">{title}</h2>
      <div className="ios-settings-group-card">{children}</div>
    </section>
  )
}

type RowProps = {
  icon: ReactNode
  title: string
  value?: string
  /** Show trailing chevron (default true for navigable rows) */
  chevron?: boolean
  onClick?: () => void
  disabled?: boolean
  /** Read-only row (no button semantics) */
  readOnly?: boolean
}

/** Single settings row: icon · title · value · chevron */
export function SettingsRow({
  icon,
  title,
  value,
  chevron = true,
  onClick,
  disabled,
  readOnly,
}: RowProps) {
  const body = (
    <>
      <span className="ios-settings-row-icon">{icon}</span>
      <span className="ios-settings-row-title">{title}</span>
      {value ? <span className="ios-settings-row-value">{value}</span> : null}
      {chevron ? (
        <span className="ios-settings-row-chevron" aria-hidden>
          <SettingsIconChevron />
        </span>
      ) : null}
    </>
  )

  if (readOnly || !onClick) {
    return <div className="ios-settings-row is-static">{body}</div>
  }

  return (
    <button
      type="button"
      className="ios-settings-row"
      onClick={onClick}
      disabled={disabled}
    >
      {body}
    </button>
  )
}

type PageProps = {
  children: ReactNode
  className?: string
}

/** Scroll body wrapper for ios settings pages */
export function SettingsPageBody({ children, className = '' }: PageProps) {
  return <div className={`ios-settings-body ${className}`.trim()}>{children}</div>
}
