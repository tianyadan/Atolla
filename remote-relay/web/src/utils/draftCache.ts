/** sessionStorage key for unsaved chat composer draft */
export function draftStorageKey(instanceId: string, agentId: string): string {
  return `relay_chat_draft:${instanceId}:${agentId}`
}

/** Load draft text for one agent chat */
export function loadChatDraft(instanceId: string, agentId: string): string {
  if (!instanceId || !agentId || typeof sessionStorage === 'undefined') return ''
  try {
    return String(sessionStorage.getItem(draftStorageKey(instanceId, agentId)) || '')
  } catch {
    return ''
  }
}

/** Persist draft; empty string clears */
export function saveChatDraft(instanceId: string, agentId: string, text: string): void {
  if (!instanceId || !agentId || typeof sessionStorage === 'undefined') return
  try {
    const key = draftStorageKey(instanceId, agentId)
    if (!text) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, text)
  } catch {
    /* ignore */
  }
}
