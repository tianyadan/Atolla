import express, { type Request, type Response, type Router } from 'express'
import { z } from 'zod'
import type { RelayDatabase } from '../db.js'
import { verifySiteToken } from '../auth/site.js'
import { listInstancesPublic, revokeInstancePassword } from '../auth/instance.js'
import type { FailLockLimiter } from '../auth/failLock.js'
import {
  unlockClientIp,
  unlockInstance,
  createRequireInstanceUnlock,
  type UnlockRequest,
} from '../auth/unlock.js'
import {
  listDeviceSessions,
  revokeDeviceSession,
  touchDeviceSession,
} from '../auth/deviceSession.js'
import { enqueueAndWait, enqueueCommand } from '../commands.js'
import { clearMobileViewer, setMobileViewer } from '../viewer.js'
import {
  deletePermissionsMirror,
  listAgentsMirror,
  listMessagesMirror,
  listPermissionsMirror,
  listTasksMirror,
  normalizeMessagesLimit,
} from '../mirror.js'
import { routeParam } from '../params.js'

const notifyPrefsBodySchema = z.object({
  task_done: z.boolean(),
  permission: z.boolean(),
})

const enqueueBodySchema = z.object({
  action: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
})

const syncMessagesBodySchema = z.object({
  before_id: z.string().optional(),
  limit: z.number().int().positive().optional(),
})

const unlockBodySchema = z.object({
  password: z.string().min(1),
  device_label: z.string().max(64).optional(),
})

const askBodySchema = z.object({
  question: z.string().optional().default(''),
  attachments: z
    .array(
      z.object({
        id: z.string().optional(),
        url: z.string().optional(),
        mime: z.string().optional(),
        name: z.string().optional(),
      }),
    )
    .optional(),
})

const chatImageUploadBodySchema = z.object({
  data_base64: z.string().min(1),
  filename: z.string().optional(),
})

const settingsUpdateBodySchema = z.object({
  rules_prompt: z.string(),
})

const skillInstallBodySchema = z.object({
  skill_id: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
})

const taskPlanBodySchema = z.object({
  enabled: z.boolean(),
})

const enabledBodySchema = z.object({
  enabled: z.boolean(),
})

const decideBodySchema = z.object({
  request_id: z.string().min(1),
  behavior: z.enum(['allow', 'deny', 'allow_session']),
})

/** Extract bearer token from Authorization header */
function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization
  const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header) : null
  const token = match?.[1]?.trim()
  return token || null
}

/** Require valid site gate JWT */
function requireSiteAuth(db: RelayDatabase) {
  return (req: Request, res: Response, next: express.NextFunction) => {
    const token = readBearerToken(req)
    if (!token || !verifySiteToken(db, token)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    next()
  }
}

/** Mount site-facing instance list, unlock, and revoke routes */
export function createSiteRouter(db: RelayDatabase, unlockFailLock: FailLockLimiter): Router {
  const router = express.Router()
  const guard = requireSiteAuth(db)
  const needUnlock = createRequireInstanceUnlock(db, 'id')

  router.get('/instances', guard, (_req: Request, res: Response) => {
    res.json({ instances: listInstancesPublic(db) })
  })

  /** Enter instance: verify 6-char Mac password → unlock_token bound to device session (7d) */
  router.post('/instances/:id/unlock', guard, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    if (!instanceId) {
      res.status(400).json({ error: 'Invalid instance id' })
      return
    }
    const parsed = unlockBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid unlock payload' })
      return
    }
    const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : ''
    const result = unlockInstance(
      db,
      unlockFailLock,
      instanceId,
      parsed.data.password,
      unlockClientIp(req),
      {
        deviceLabel: parsed.data.device_label,
        userAgent: ua,
        clientIp: unlockClientIp(req),
      },
    )
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.json({
      unlock_token: result.unlock_token,
      expires_in: result.expires_in,
      session_id: result.session_id,
    })
  })

  /** Mobile heartbeat: keep device online for PC panel */
  router.post('/instances/:id/sessions/heartbeat', guard, needUnlock, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    const session = (req as UnlockRequest).unlockSession
    if (!instanceId || !session) {
      res.status(400).json({ error: 'Invalid session' })
      return
    }
    const updated = touchDeviceSession(db, session.id)
    if (!updated) {
      res.status(403).json({ error: '需要先验证实例密码' })
      return
    }
    res.json({
      ok: true,
      session_id: updated.id,
      expires_at: updated.expires_at,
      last_seen_at: updated.last_seen_at,
    })
  })

  /** Logout this device unlock (keep site gate) */
  router.delete('/instances/:id/sessions/me', guard, needUnlock, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    const session = (req as UnlockRequest).unlockSession
    if (!instanceId || !session) {
      res.status(400).json({ error: 'Invalid session' })
      return
    }
    revokeDeviceSession(db, session.id, instanceId)
    res.json({ ok: true })
  })

  /** Optional: list sessions visible to this unlock (same instance) */
  router.get('/instances/:id/sessions', guard, needUnlock, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    if (!instanceId) {
      res.status(400).json({ error: 'Invalid instance id' })
      return
    }
    res.json({ sessions: listDeviceSessions(db, instanceId) })
  })

  router.post('/instances/:id/commands', guard, needUnlock, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    if (!instanceId) {
      res.status(400).json({ error: 'Invalid instance id' })
      return
    }
    const parsed = enqueueBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid command payload' })
      return
    }
    const result = enqueueCommand(
      db,
      instanceId,
      parsed.data.action,
      parsed.data.payload ?? {},
    )
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.json({ command: result.command })
  })

  router.get('/instances/:id/agents', guard, needUnlock, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    if (!instanceId) {
      res.status(400).json({ error: 'Invalid instance id' })
      return
    }
    const result = listAgentsMirror(db, instanceId)
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.json({ agents: result.agents })
  })

  router.get('/instances/:id/agents/:agentId/tasks', guard, needUnlock, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    const agentId = routeParam(req.params.agentId)
    if (!instanceId || !agentId) {
      res.status(400).json({ error: 'Invalid instance or agent id' })
      return
    }
    const result = listTasksMirror(db, instanceId, agentId)
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.json({ tasks: result.tasks })
  })

  router.get('/instances/:id/agents/:agentId/messages', guard, needUnlock, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    const agentId = routeParam(req.params.agentId)
    if (!instanceId || !agentId) {
      res.status(400).json({ error: 'Invalid instance or agent id' })
      return
    }
    const beforeRaw = req.query.before_id
    const beforeId = typeof beforeRaw === 'string' && beforeRaw.trim() ? beforeRaw.trim() : undefined
    const limitRaw = req.query.limit
    let limit: number | undefined
    if (typeof limitRaw === 'string' && limitRaw.trim()) {
      const parsed = Number.parseInt(limitRaw, 10)
      if (!Number.isFinite(parsed)) {
        res.status(400).json({ error: 'Invalid limit' })
        return
      }
      limit = parsed
    }
    const result = listMessagesMirror(
      db,
      instanceId,
      agentId,
      beforeId,
      normalizeMessagesLimit(limit),
    )
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.json(result.page)
  })

  router.post(
    '/instances/:id/agents/:agentId/sync-messages',
    guard,
    needUnlock,
    (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const parsed = syncMessagesBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid sync-messages payload' })
        return
      }
      const payload: Record<string, unknown> = { agent_id: agentId }
      if (parsed.data.before_id?.trim()) payload.before_id = parsed.data.before_id.trim()
      if (parsed.data.limit != null) payload.limit = parsed.data.limit

      const result = enqueueCommand(db, instanceId, 'sync.messages', payload)
      if (!result.ok) {
        res.status(result.status).json({ error: result.error })
        return
      }
      res.json({ command: result.command })
    },
  )

  /** Enqueue agent.ask for Mac */
  router.post(
    '/instances/:id/agents/:agentId/ask',
    guard,
    needUnlock,
    (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const parsed = askBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid ask payload' })
        return
      }
      const question = (parsed.data.question || '').trim()
      const attachments = (parsed.data.attachments || []).filter(
        (a) => (a.url && a.url.trim()) || (a.id && a.id.trim()),
      )
      if (!question && attachments.length === 0) {
        res.status(400).json({ error: 'question or attachments required' })
        return
      }
      const payload: Record<string, unknown> = {
        agent_id: agentId,
        question,
      }
      if (attachments.length) payload.attachments = attachments
      const result = enqueueCommand(db, instanceId, 'agent.ask', payload)
      if (!result.ok) {
        res.status(result.status).json({ error: result.error })
        return
      }
      res.json({ command: result.command })
    },
  )

  /** Enqueue agent.stop */
  router.post(
    '/instances/:id/agents/:agentId/stop',
    guard,
    needUnlock,
    (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const result = enqueueCommand(db, instanceId, 'agent.stop', { agent_id: agentId })
      if (!result.ok) {
        res.status(result.status).json({ error: result.error })
        return
      }
      res.json({ command: result.command })
    },
  )

  /** Enqueue agent.set_task_plan */
  router.post(
    '/instances/:id/agents/:agentId/task-plan',
    guard,
    needUnlock,
    (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const parsed = taskPlanBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid task-plan payload' })
        return
      }
      const result = enqueueCommand(db, instanceId, 'agent.set_task_plan', {
        agent_id: agentId,
        enabled: parsed.data.enabled,
      })
      if (!result.ok) {
        res.status(result.status).json({ error: result.error })
        return
      }
      res.json({ command: result.command })
    },
  )

  /** Enqueue agent.set_auto_review */
  router.post(
    '/instances/:id/agents/:agentId/auto-review',
    guard,
    needUnlock,
    (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const parsed = enabledBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid auto-review payload' })
        return
      }
      const result = enqueueCommand(db, instanceId, 'agent.set_auto_review', {
        agent_id: agentId,
        enabled: parsed.data.enabled,
      })
      if (!result.ok) {
        res.status(result.status).json({ error: result.error })
        return
      }
      res.json({ command: result.command })
    },
  )

  /** Enqueue agent.set_auto_approve_all */
  router.post(
    '/instances/:id/agents/:agentId/auto-approve-all',
    guard,
    needUnlock,
    (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const parsed = enabledBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid auto-approve-all payload' })
        return
      }
      const result = enqueueCommand(db, instanceId, 'agent.set_auto_approve_all', {
        agent_id: agentId,
        enabled: parsed.data.enabled,
      })
      if (!result.ok) {
        res.status(result.status).json({ error: result.error })
        return
      }
      res.json({ command: result.command })
    },
  )

  /** List pending permission cards for one agent */
  router.get(
    '/instances/:id/agents/:agentId/permissions/pending',
    guard,
    needUnlock,
    (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const result = listPermissionsMirror(db, instanceId, agentId)
      if (!result.ok) {
        res.status(result.status).json({ error: result.error })
        return
      }
      res.json({ items: result.items })
    },
  )

  /** Phone presence: currently viewing this agent (persisted on relay; Mac reads via heartbeat) */
  router.post(
    '/instances/:id/agents/:agentId/viewer',
    guard,
    needUnlock,
    (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      // Primary path: write relay DB (does not depend on Mac action allowlist).
      if (!setMobileViewer(db, instanceId, agentId)) {
        res.status(404).json({ error: 'Instance not found' })
        return
      }
      // Best-effort also enqueue for Mac command handlers (ignore allowlist failures).
      const result = enqueueCommand(db, instanceId, 'viewer.set', { agent_id: agentId })
      res.json({
        ok: true,
        command: result.ok ? result.command : null,
        queued: result.ok,
      })
    },
  )

  /** Phone presence: left chat (clear viewing) */
  router.delete(
    '/instances/:id/agents/:agentId/viewer',
    guard,
    needUnlock,
    (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      if (!clearMobileViewer(db, instanceId)) {
        res.status(404).json({ error: 'Instance not found' })
        return
      }
      const result = enqueueCommand(db, instanceId, 'viewer.clear', { agent_id: agentId })
      res.json({
        ok: true,
        command: result.ok ? result.command : null,
        queued: result.ok,
      })
    },
  )

  /** Enqueue permission.decide */
  router.post(
    '/instances/:id/agents/:agentId/permissions/decide',
    guard,
    needUnlock,
    (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const parsed = decideBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid decide payload' })
        return
      }
      const result = enqueueCommand(db, instanceId, 'permission.decide', {
        request_id: parsed.data.request_id,
        behavior: parsed.data.behavior,
        agent_id: agentId,
      })
      if (!result.ok) {
        res.status(result.status).json({ error: result.error })
        return
      }
      // 立即从镜像移除，避免手机轮询在 Mac 裁决前又把同一张卡弹回来
      deletePermissionsMirror(db, instanceId, [parsed.data.request_id])
      res.json({ command: result.command })
    },
  )

  router.delete('/instances/:id/password', guard, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    if (!instanceId) {
      res.status(400).json({ error: 'Invalid instance id' })
      return
    }
    const ok = revokeInstancePassword(db, instanceId)
    if (!ok) {
      res.status(404).json({ error: 'Instance not found' })
      return
    }
    res.json({ ok: true })
  })

  /** Send enqueueAndWait outcome to the client */
  async function respondRpc(
    res: Response,
    instanceId: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const result = await enqueueAndWait(db, instanceId, action, payload)
    if (!result.ok) {
      res.status(result.httpStatus).json({ error: result.error })
      return
    }
    res.json(result.body ?? {})
  }

  /** Mobile settings: load agent rules / engine (read-only engine) */
  router.get(
    '/instances/:id/agents/:agentId/settings',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      await respondRpc(res, instanceId, 'agent.settings.get', { agent_id: agentId })
    },
  )

  /** Mobile settings: save rules_prompt only */
  router.patch(
    '/instances/:id/agents/:agentId/settings',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const parsed = settingsUpdateBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid settings payload' })
        return
      }
      await respondRpc(res, instanceId, 'agent.settings.update', {
        agent_id: agentId,
        rules_prompt: parsed.data.rules_prompt,
      })
    },
  )

  /** List skills for one agent (installed + catalog merge) */
  router.get(
    '/instances/:id/agents/:agentId/skills',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      await respondRpc(res, instanceId, 'agent.skills.list', { agent_id: agentId })
    },
  )

  /** Skill store catalog (optional q / category) */
  router.get(
    '/instances/:id/agents/:agentId/skills/store',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const q = typeof req.query.q === 'string' ? req.query.q : ''
      const category = typeof req.query.category === 'string' ? req.query.category : ''
      await respondRpc(res, instanceId, 'agent.skills.store', {
        agent_id: agentId,
        q,
        category,
      })
    },
  )

  /** Install a catalog skill */
  router.post(
    '/instances/:id/agents/:agentId/skills/install',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const parsed = skillInstallBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid install payload' })
        return
      }
      const payload: Record<string, unknown> = {
        agent_id: agentId,
        skill_id: parsed.data.skill_id.trim(),
      }
      if (parsed.data.capabilities) payload.capabilities = parsed.data.capabilities
      await respondRpc(res, instanceId, 'agent.skills.install', payload)
    },
  )

  /** Uninstall a skill */
  router.delete(
    '/instances/:id/agents/:agentId/skills/:skillId',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      const skillId = routeParam(req.params.skillId)
      if (!instanceId || !agentId || !skillId) {
        res.status(400).json({ error: 'Invalid instance, agent or skill id' })
        return
      }
      await respondRpc(res, instanceId, 'agent.skills.uninstall', {
        agent_id: agentId,
        skill_id: skillId,
      })
    },
  )

  /** Read-only legacy memory mounts */
  router.get(
    '/instances/:id/agents/:agentId/legacy-mounts',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      await respondRpc(res, instanceId, 'agent.legacy_mounts.list', { agent_id: agentId })
    },
  )

  /** Upload compressed chat image (base64) via Mac SaveChatImage */
  router.post(
    '/instances/:id/agents/:agentId/chat-images',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const parsed = chatImageUploadBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid chat-image payload' })
        return
      }
      await respondRpc(res, instanceId, 'chat.image.upload', {
        agent_id: agentId,
        data_base64: parsed.data.data_base64,
        filename: parsed.data.filename || 'mobile.jpg',
      })
    },
  )

  /** 读取该电脑的完成通知 / 命令审批通知开关 */
  router.get(
    '/instances/:id/notify-prefs',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      if (!instanceId) {
        res.status(400).json({ error: 'Invalid instance id' })
        return
      }
      await respondRpc(res, instanceId, 'notify.prefs.get', {})
    },
  )

  /** 保存该电脑的完成通知 / 命令审批通知开关 */
  router.put(
    '/instances/:id/notify-prefs',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      if (!instanceId) {
        res.status(400).json({ error: 'Invalid instance id' })
        return
      }
      const parsed = notifyPrefsBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid notify prefs payload' })
        return
      }
      await respondRpc(res, instanceId, 'notify.prefs.update', {
        task_done: parsed.data.task_done,
        permission: parsed.data.permission,
      })
    },
  )

  return router
}
