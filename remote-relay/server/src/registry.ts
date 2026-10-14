/** Registry contract version for Mac bridge negotiation */
export const REGISTRY_VERSION = 1

/** All actions the cloud may reference */
export const KNOWN_ACTIONS = [
  'ping',
  'sync.agents',
  'sync.tasks',
  'sync.messages',
  'agent.ask',
  'agent.stop',
  'agent.set_task_plan',
  'agent.set_auto_review',
  'agent.set_auto_approve_all',
  'permission.decide',
] as const

export type KnownAction = (typeof KNOWN_ACTIONS)[number]

/** Actions the site may enqueue for phone on Mac V1 */
export const V1_EXECUTABLE = new Set<string>([
  'ping',
  'sync.agents',
  'sync.tasks',
  'sync.messages',
  'agent.ask',
  'agent.stop',
  'agent.set_task_plan',
  'agent.set_auto_review',
  'agent.set_auto_approve_all',
  'permission.decide',
])
