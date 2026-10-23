import { resetIslandSyncKey } from './islandLiveActivity'

const listeners = new Set<() => void>()

/** 对话已读或审批完成后，要求全局轮询立即重算。 */
export function invalidateIslandSync(): void {
  resetIslandSyncKey()
  listeners.forEach((listener) => listener())
}

export function subscribeIslandSyncInvalidation(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
