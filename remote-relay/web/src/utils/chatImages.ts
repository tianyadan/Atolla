/** Max images per ask (align PC) */
export const MAX_CHAT_IMAGES = 6

/** Longest edge before upload */
const UPLOAD_MAX_EDGE = 1600

export type ChatAttachment = {
  id: string
  url: string
  mime: string
  name: string
}

export type PendingImage = {
  localId: string
  previewUrl: string
  file: File
  uploading: boolean
  error: string
  uploaded: ChatAttachment | null
}

/** Compress image via canvas to JPEG blob */
export async function compressImageFile(file: Blob, maxEdge = UPLOAD_MAX_EDGE): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bmp.close()
    throw new Error('canvas unsupported')
  }
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('compress failed'))),
      'image/jpeg',
      0.85,
    )
  })
  return blob
}

/** Blob → base64 (no data: prefix) */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Append local pending previews */
export function appendPendingImages(
  prev: PendingImage[],
  files: File[],
): { next: PendingImage[]; overflow: boolean } {
  const list = [...prev]
  let overflow = false
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue
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

/** Revoke object URLs */
export function revokePendingImages(items: PendingImage[]): void {
  for (const it of items) {
    try {
      URL.revokeObjectURL(it.previewUrl)
    } catch {
      /* ignore */
    }
  }
}

/** Read attachments from message payload */
export function attachmentsFromPayload(
  payload: Record<string, unknown> | undefined | null,
): ChatAttachment[] {
  const raw = payload?.attachments
  if (!Array.isArray(raw)) return []
  const out: ChatAttachment[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const url = String(o.url || '').trim()
    const id = String(o.id || '').trim()
    if (!url && !id) continue
    out.push({
      id,
      url,
      mime: String(o.mime || 'image/jpeg'),
      name: String(o.name || ''),
    })
  }
  return out
}
