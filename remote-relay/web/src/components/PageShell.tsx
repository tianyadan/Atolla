import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

type PageShellProps = {
  title: string
  backTo?: string
  children: ReactNode
  right?: ReactNode
  /** Extra class on main (e.g. chat full-height layout) */
  bodyClassName?: string
}

/** Mobile page frame with optional back link */
export function PageShell({ title, backTo, children, right, bodyClassName }: PageShellProps) {
  const isChat = bodyClassName?.includes('page-body-chat')
  return (
    <div className={`page${isChat ? ' page-fill' : ''}`}>
      <header className="page-header">
        <div className="page-header-left">
          {backTo ? (
            <Link to={backTo} className="back-link">
              ←
            </Link>
          ) : (
            <span className="back-spacer" />
          )}
          <h1>{title}</h1>
        </div>
        {right ? <div className="page-header-right">{right}</div> : null}
      </header>
      <main className={`page-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</main>
    </div>
  )
}
