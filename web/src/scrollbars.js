/**
 * 滚动中给目标元素加上 is-scrolling，停滚约 0.9s 后去掉，配合 CSS 显隐滚动条。
 */
const HIDE_DELAY_MS = 900
const timers = new WeakMap()

function markScrolling(el) {
  if (!(el instanceof Element)) return
  el.classList.add('is-scrolling')
  const prev = timers.get(el)
  if (prev) clearTimeout(prev)
  timers.set(
    el,
    setTimeout(() => {
      el.classList.remove('is-scrolling')
      timers.delete(el)
    }, HIDE_DELAY_MS),
  )
}

/** 安装全局滚动监听（捕获阶段覆盖 overflow 容器） */
export function installAutoHideScrollbars() {
  const onScroll = (e) => markScrolling(e.target)
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  return () => document.removeEventListener('scroll', onScroll, { capture: true })
}
