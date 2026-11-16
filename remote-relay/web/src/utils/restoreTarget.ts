type RestoreTargetInput = {
  routeInstanceId?: string
  lanSessionInstanceId?: string
  lastChatInstanceId?: string
}

/**
 * A QR pairing binds the current App session to one concrete Mac. That local
 * target must win over a remembered cloud conversation, otherwise the app
 * tries to restore an instance that the LAN-only Facade intentionally cannot
 * expose.
 */
export function resolveRestoreInstanceId(input: RestoreTargetInput): string {
  return String(
    input.routeInstanceId || input.lanSessionInstanceId || input.lastChatInstanceId || '',
  ).trim()
}
