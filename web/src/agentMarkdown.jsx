import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import { hasTextSelection } from './selectionGuard.js'

const API = '/api'

/** 当前选区是否落在节点内（用于避免刷新冲掉复制选中）。 */
export function selectionInside(el) {
  if (!el) return false
  const sel = window.getSelection?.()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false
  const node = sel.anchorNode
  if (!node) return false
  return el.contains(node.nodeType === 1 ? node : node.parentNode)
}

/** 压缩多余空行，避免 marked 产出大段空白。 */
export function compactMarkdown(src) {
  return String(src || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n')
}

/**
 * 数字员工 Markdown。
 *
 * innerHTML 由这里命令式写入，**不用 dangerouslySetInnerHTML**：
 * 父组件每秒重渲染（运行计时等）会传新的 {__html} 对象，React 会把内容相同的
 * 子节点整段重建 —— 用户正选中的文字会瞬间丢失。命令式写入可以做到
 * 「字符串没变就一行 DOM 都不动」，选中就稳定了。
 */
export default function AgentMarkdown({ content, agentId, authHeaders, className = 'msg-body msg-body-flat' }) {
  const html = useMemo(
    () => marked.parse(compactMarkdown(content), { breaks: false, gfm: true }),
    [content],
  )
  const ref = useRef(null)
  const pendingHtml = useRef(html)
  const [renderHtml, setRenderHtml] = useState(html)

  // 正文变化：有选区时先挂着，等选完再落
  useEffect(() => {
    pendingHtml.current = html
    // 跨消息拖选时另一条也会走到这里，所以判断整个页面的选区，而不是只看本条
    if (hasTextSelection()) return
    setRenderHtml(html)
  }, [html])

  useEffect(() => {
    const flush = () => {
      if (pendingHtml.current === renderHtml) return
      if (hasTextSelection()) return
      setRenderHtml(pendingHtml.current)
    }
    document.addEventListener('selectionchange', flush)
    document.addEventListener('pointerup', flush)
    return () => {
      document.removeEventListener('selectionchange', flush)
      document.removeEventListener('pointerup', flush)
    }
  }, [renderHtml])

  // 只有内容真的变了才写 DOM；相同内容重写 innerHTML 会毁掉选区
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.__mdHtml === renderHtml) return
    el.__mdHtml = renderHtml
    el.innerHTML = renderHtml
  }, [renderHtml])

  // 写入后再做图片鉴权替换
  const applyImages = useCallback(() => {
    const root = ref.current
    if (!root || !agentId) return undefined
    const imgs = [...root.querySelectorAll('img')]
    const revoke = []
    let cancelled = false

    imgs.forEach((img) => {
      const src = (img.getAttribute('src') || '').trim()
      if (!src || src.startsWith('blob:') || src.startsWith('data:')) return
      // 远程 http(s) 直接展示；本地路径走鉴权 API
      if (/^https?:\/\//i.test(src)) return

      const path = src.replace(/^file:\/\//i, '')
      ;(async () => {
        try {
          const headers = typeof authHeaders === 'function' ? authHeaders() : {}
          const url = `${API}/admin/agents/${agentId}/file?path=${encodeURIComponent(path)}`
          const res = await fetch(url, { headers })
          if (!res.ok || cancelled) return
          const blob = await res.blob()
          if (cancelled) return
          const blobUrl = URL.createObjectURL(blob)
          revoke.push(blobUrl)
          img.src = blobUrl
          img.classList.add('ma-md-img')
        } catch {
          /* ignore broken image */
        }
      })()
    })

    return () => {
      cancelled = true
      revoke.forEach((u) => URL.revokeObjectURL(u))
    }
    // authHeaders 可能每次 render 新引用；仅随正文/数字员工变化重拉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId])

  useLayoutEffect(() => applyImages(), [applyImages, renderHtml])

  return <div ref={ref} className={className} />
}
