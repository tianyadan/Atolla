export type InstanceConnection = 'lan' | 'server'

type SourceInstance = {
  instance_id: string
  [key: string]: unknown
}

/**
 * The same Mac may be visible through both transports. Keep one row and route
 * it through LAN because its paired, signed channel is lower latency; retain
 * cloud-only rows so a local session can still browse other online instances.
 */
export function mergeInstanceSources<T extends SourceInstance>(
  serverInstances: T[],
  lanInstances: T[],
): Array<T & { connection: InstanceConnection }> {
  const merged = new Map<string, T & { connection: InstanceConnection }>()
  for (const item of serverInstances) {
    if (!String(item.instance_id || '').trim()) continue
    merged.set(item.instance_id, { ...item, connection: 'server' })
  }
  for (const item of lanInstances) {
    if (!String(item.instance_id || '').trim()) continue
    merged.set(item.instance_id, { ...item, connection: 'lan' })
  }
  return [...merged.values()]
}
