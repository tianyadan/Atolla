import { useLayoutEffect, useRef } from 'react'

/**
 * 命令式渲染一段静态 HTML。
 *
 * 不用 dangerouslySetInnerHTML：父组件高频重渲染时会传新的 {__html} 对象，
 * React 把内容相同的子节点整段重建，会冲掉用户正在选中/复制的文字。
 * 这里只有 html 字符串真的变了才写 DOM。
 */
export default function StaticHtml({ html, className }) {
  const ref = useRef(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const next = String(html ?? '')
    if (el.__staticHtml === next) return
    el.__staticHtml = next
    el.innerHTML = next
  }, [html])

  return <div ref={ref} className={className} />
}
