import { useEffect } from 'react'

/**
 * 发送前图片预览条：缩略图 + 删除。
 */
export function ChatAttachPreview({ items, onRemove }) {
  if (!items?.length) return null
  return (
    <div className="chat-attach-preview" aria-label="待发送图片">
      {items.map((it) => (
        <div key={it.localId} className={`chat-attach-thumb ${it.uploading ? 'uploading' : ''} ${it.error ? 'err' : ''}`}>
          <img src={it.previewUrl || it.uploaded?.url} alt="" />
          {it.uploading && <span className="chat-attach-spin" aria-hidden />}
          {it.error && <span className="chat-attach-err" title={it.error}>!</span>}
          <button
            type="button"
            className="chat-attach-rm"
            aria-label="移除图片"
            title="移除"
            onClick={() => onRemove?.(it.localId)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

/**
 * 消息内缩略图网格，点击放大。
 */
export function ChatMessageImages({ attachments, onOpen }) {
  const list = (attachments || []).filter((a) => a?.url)
  if (!list.length) return null
  return (
    <div className="chat-msg-images">
      {list.map((a, i) => (
        <button
          key={a.id || a.url || i}
          type="button"
          className="chat-msg-img"
          onClick={() => onOpen?.(a.url)}
          title={a.name || '查看大图'}
        >
          <img src={a.url} alt={a.name || ''} loading="lazy" />
        </button>
      ))}
    </div>
  )
}

/**
 * 全屏 Lightbox 放大查看。
 */
export function ChatLightbox({ src, onClose }) {
  useEffect(() => {
    if (!src) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [src, onClose])

  if (!src) return null
  return (
    <div
      className="chat-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={() => onClose?.()}
    >
      <button type="button" className="chat-lightbox-close" aria-label="关闭" onClick={() => onClose?.()}>
        ×
      </button>
      <img
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
