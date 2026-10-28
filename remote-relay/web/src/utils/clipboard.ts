/**
 * 复制到剪贴板（优先 Clipboard API；失败则用选区 + execCommand，兼容 iOS WKWebView）
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const value = String(text || '')
  if (!value) return false

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    /* fall through */
  }

  try {
    const el = document.createElement('textarea')
    el.value = value
    el.setAttribute('readonly', '')
    el.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;'
    document.body.appendChild(el)
    el.focus()
    el.select()
    el.setSelectionRange(0, value.length)
    const ok = document.execCommand('copy')
    el.remove()
    return ok
  } catch {
    return false
  }
}
