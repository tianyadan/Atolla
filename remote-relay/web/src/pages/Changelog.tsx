import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearToken, fetchChangelogPage, type ChangelogEntry } from '../api'
import { PageShell } from '../components/PageShell'

/** Infinite-scroll changelog (newest first) */
export function ChangelogPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<ChangelogEntry[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sentinel = useRef<HTMLDivElement | null>(null)

  /** Load next page */
  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return
    setLoading(true)
    setError(null)
    try {
      const page = await fetchChangelogPage({
        cursor: cursor === undefined ? undefined : cursor ?? undefined,
        limit: 5,
      })
      setItems((prev) => [...prev, ...page.items])
      setCursor(page.next_cursor)
      setHasMore(page.has_more)
    } catch (err) {
      const status = (err as { status?: number })?.status
      if (status === 401) {
        clearToken()
        navigate('/login', { replace: true })
        return
      }
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [cursor, hasMore, loading, navigate])

  useEffect(() => {
    if (items.length === 0 && hasMore && !loading) void loadMore()
  }, [items.length, hasMore, loading, loadMore])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore()
      },
      { rootMargin: '120px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore])

  return (
    <PageShell title="更新记录" backTo="/settings">
      {error ? <p className="error-banner">{error}</p> : null}
      <div className="changelog-list">
        {items.map((e) => (
          <article key={e.version} className="changelog-card">
            <header>
              <strong>{e.version}</strong>
              <span className="muted">{e.date}</span>
            </header>
            <ul>
              {e.items.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <div ref={sentinel} className="changelog-sentinel" />
      {loading ? <p className="muted">加载中…</p> : null}
      {!loading && !hasMore && items.length === 0 ? (
        <p className="muted">暂无更新记录</p>
      ) : null}
      {!loading && !hasMore && items.length > 0 ? (
        <p className="muted">已到底</p>
      ) : null}
    </PageShell>
  )
}
