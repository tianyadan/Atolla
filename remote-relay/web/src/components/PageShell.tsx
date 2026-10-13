import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

type PageShellProps = {
  title: string
  backTo?: string
  children: ReactNode
  right?: ReactNode
}

/** Mobile page frame with optional back link */
export function PageShell({ title, backTo, children, right }: PageShellProps) {
  return (
    <div className="page">
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
      <main className="page-body">{children}</main>
    </div>
  )
}
