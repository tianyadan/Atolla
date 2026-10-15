/** localStorage key for collapsed agent folder keys on one instance */
export function collapseStorageKey(instanceId: string): string {
  return `relay_agent_collapsed:${instanceId}`
}

/** Load collapsed folder keys; empty set = all expanded */
export function loadCollapsedFolders(instanceId: string): Set<string> {
  if (!instanceId || typeof localStorage === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(collapseStorageKey(instanceId))
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((k): k is string => typeof k === 'string' && k.length > 0))
  } catch {
    return new Set()
  }
}

/** Persist collapsed folder keys */
export function saveCollapsedFolders(instanceId: string, collapsed: Set<string>): void {
  if (!instanceId || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(collapseStorageKey(instanceId), JSON.stringify([...collapsed]))
  } catch {
    /* quota / private mode */
  }
}
