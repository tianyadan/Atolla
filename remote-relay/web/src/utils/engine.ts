/** Engine display meta — same palette as PC ManagedAgents */

export type EngineMeta = { id: string; label: string; color: string }

export const ENGINES: EngineMeta[] = [
  { id: 'claude', label: 'Claude', color: '#D97757' },
  { id: 'codex', label: 'Codex', color: '#10a37f' },
  { id: 'agent', label: 'Cursor', color: '#6366f1' },
]

/** Resolve engine id → label/color for tags */
export function engineMeta(id: string | null | undefined): EngineMeta {
  const key = String(id || '').toLowerCase()
  return ENGINES.find((e) => e.id === key) || { id: key || '—', label: key || '—', color: '#94a3b8' }
}
