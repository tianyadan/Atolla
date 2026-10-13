/** Registry contract version for Mac bridge negotiation */
export const REGISTRY_VERSION = 1

/** All actions the cloud may reference (V1 executable + reserved placeholders) */
export const KNOWN_ACTIONS = [
  'ping',
  'sync.agents',
  'sync.tasks',
  'sync.messages',
  // reserved, not executable on Mac V1:
  'agent.ask',
  'agent.stop',
] as const

export type KnownAction = (typeof KNOWN_ACTIONS)[number]

/** Actions the site may enqueue for phone sync on Mac V1 */
export const V1_EXECUTABLE = new Set<string>([
  'ping',
  'sync.agents',
  'sync.tasks',
  'sync.messages',
])
