import { compressImageFile } from './agentAvatar.js'

/** 单次提问最多附带图片数 */
export const MAX_CHAT_IMAGES = 6

/** 上传前最长边 */
const UPLOAD_MAX_EDGE = 1600

/**
 * 从剪贴板 DataTransfer 收集图片 File。
 * @param {DataTransfer|null|undefined} dt
 * @returns {File[]}
 */
export function imageFilesFromDataTransfer(dt) {
  if (!dt) return []
  const out = []
  const seen = new Set()
  const push = (f) => {
    if (!f || !String(f.type || '').startsWith('image/')) return
    const key = `${f.name}|${f.size}|${f.lastModified}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(f)
  }
  if (dt.files?.length) {
    for (const f of dt.files) push(f)
  }
  if (out.length === 0 && dt.items?.length) {
    for (const it of dt.items) {
      if (it.kind === 'file') push(it.getAsFile())
    }
  }
  return out
}

/**
 * 上传一张图到聊天图床；返回 { id, url, mime, name }。
 * @param {File|Blob} file
 * @param {{ endpoint: string, headers?: Record<string,string>, credentials?: RequestCredentials }} opts
 */
export async function uploadChatImage(file, opts) {
  const blob = file instanceof Blob && !(file instanceof File)
    ? file
    : await compressImageFile(file, UPLOAD_MAX_EDGE)
  const name = (file && file.name) || 'paste.jpg'
  const fd = new FormData()
  fd.append('file', blob, name.endsWith('.jpg') || name.endsWith('.jpeg') ? name : `${name.replace(/\.[^.]+$/, '') || 'paste'}.jpg`)
  const res = await fetch(opts.endpoint, {
    method: 'POST',
    headers: opts.headers || {},
    credentials: opts.credentials || 'same-origin',
    body: fd,
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.error || `上传失败(${res.status})`)
  return {
    id: d.id || '',
    url: d.url || '',
    mime: d.mime || 'image/jpeg',
    name: d.name || name,
  }
}

/**
 * 批量加入待发送预览（本地 blob URL），上限 MAX_CHAT_IMAGES。
 * @param {Array} prev
 * @param {File[]} files
 * @returns {{ next: Array, overflow: boolean }}
 */
export function appendPendingImages(prev, files) {
  const list = [...(prev || [])]
  let overflow = false
  for (const f of files || []) {
    if (list.length >= MAX_CHAT_IMAGES) {
      overflow = true
      break
    }
    list.push({
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      previewUrl: URL.createObjectURL(f),
      file: f,
      uploading: false,
      error: '',
      uploaded: null,
    })
  }
  return { next: list, overflow }
}

/** 释放预览 object URL */
export function revokePendingImages(items) {
  for (const it of items || []) {
    if (it?.previewUrl) {
      try { URL.revokeObjectURL(it.previewUrl) } catch { /* ignore */ }
    }
  }
}

/**
 * 确保 pending 项均已上传；返回 ask 用的 attachments。
 * @param {Array} items
 * @param {(localId: string, patch: object) => void} patchItem
 * @param {{ endpoint: string, headers?: object, credentials?: RequestCredentials }} opts
 */
export async function ensureUploadedAttachments(items, patchItem, opts) {
  const out = []
  for (const it of items || []) {
    if (it.uploaded?.url || it.uploaded?.id) {
      out.push({
        id: it.uploaded.id,
        url: it.uploaded.url,
        mime: it.uploaded.mime,
        name: it.uploaded.name,
      })
      continue
    }
    patchItem?.(it.localId, { uploading: true, error: '' })
    try {
      const att = await uploadChatImage(it.file, opts)
      patchItem?.(it.localId, { uploading: false, uploaded: att })
      out.push(att)
    } catch (err) {
      patchItem?.(it.localId, { uploading: false, error: String(err.message || err) })
      throw err
    }
  }
  return out
}
