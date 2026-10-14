import { useMemo } from 'react'
import { marked } from 'marked'

marked.setOptions({ breaks: true, gfm: true })

/** Collapse excess blank lines before marked */
function compactMarkdown(src: string): string {
  return String(src || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

type Props = {
  content: string
  className?: string
}

/** Render assistant markdown as sanitized-ish HTML (trusted relay content) */
export function MarkdownBody({ content, className = 'md-body' }: Props) {
  const html = useMemo(() => {
    const parsed = marked.parse(compactMarkdown(content), { async: false })
    return typeof parsed === 'string' ? parsed : ''
  }, [content])

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html || '<p></p>' }}
    />
  )
}
