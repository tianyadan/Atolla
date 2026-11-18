import express, { type NextFunction, type Request, type Response, type Router } from 'express'
import { z } from 'zod'
import type { RelayDatabase } from '../db.js'
import { verifySiteToken } from '../auth/site.js'
import { getInstanceRow, listInstancesPublic, revokeInstancePassword } from '../auth/instance.js'
import type { FailLockLimiter } from '../auth/failLock.js'
import {
  unlockClientIp,
  unlockInstance,
  createRequireInstanceUnlock,
  type UnlockRequest,
} from '../auth/unlock.js'
import {
  getSiteReceiveEmail,
  getUnlockOtpStatus,
  isValidReceiveEmail,
  maskEmail,
  sendUnlockOtp,
  setSiteReceiveEmail,
} from '../auth/unlockOtp.js'
import {
  listDeviceSessions,
  revokeDeviceSession,
  touchDeviceSession,
} from '../auth/deviceSession.js'
import { enqueueAndWait, enqueueCommand } from '../commands.js'
import { clearMobileViewer, setMobileViewer } from '../viewer.js'
import {
  clearAgentTaskUnreadMirror,
  deletePermissionsMirror,
  listAgentsMirror,
  listInstancePermissionsMirror,
  listMessagesMirror,
  listPermissionsMirror,
  listTasksMirror,
  normalizeMessagesLimit,
} from '../mirror.js'
import { routeParam } from '../params.js'
import {
  agentStatusProvider,
  listSiriAgents,
  SIRI_INSTANCE_ONLINE_THRESHOLD_MS,
} from '../siri.js'

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

const receiveEmailBodySchema = z.object({
  email: z.string().max(200),
})

const askBodySchema = z.object({
  question: z.string().optional().default(''),
  mode: z.enum(['direct', 'enqueue', 'interrupt']).optional(),
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

const taskQueueQuestionBodySchema = z.object({
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
  /** Optional pixel jelly color; omit to leave unchanged on Mac */
  jelly_color: z
    .enum([
      'orange',
      'yellow',
      'blue',
      'green',
      'purple',
      'red',
      'cyan',
      'teal',
      'pink',
      'lime',
      'coral',
      'sky',
    ])
    .optional(),
})

const agentCreateBodySchema = z.object({
  name: z.string().min(1).max(80),
  engine: z.enum(['claude', 'codex', 'agent']),
  jelly_color: z
    .enum([
      'orange',
      'yellow',
      'blue',
      'green',
      'purple',
      'red',
      'cyan',
      'teal',
      'pink',
      'lime',
      'coral',
      'sky',
    ])
    .optional(),
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

const siriAgentsQuerySchema = z.object({
  group: z.string().max(100).optional(),
  working: z.enum(['true', 'false', '1', '0']).optional(),
})

const siriReceptionistAskBodySchema = z.object({
  question: z.string().trim().min(1).max(4_000),
})

/** Keep Siri within its background execution window; configurable for integration tests. */
function siriReceptionistWaitMs(): number {
  const configured = Number.parseInt(process.env.RELAY_SIRI_RECEPTIONIST_WAIT_MS || '', 10)
  if (!Number.isFinite(configured) || configured <= 0) return 20_000
  return Math.min(configured, 60_000)
}

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

  router.get('/instances', guard, (req: Request, res: Response) => {
    const receive = getSiteReceiveEmail(db)
    const receiveSet = receive.length > 0
    const instances = listInstancesPublic(db).map((inst) => ({
      ...inst,
      unlock_otp_ready: !!inst.unlock_otp_smtp_ok && receiveSet,
    }))
    res.json({
      instances,
      receive_email_set: receiveSet,
      receive_email_masked: maskEmail(receive),
    })
  })

  /** 站点接收邮箱（验证码登录收件地址） */
  router.get('/site/receive-email', guard, (_req: Request, res: Response) => {
    const email = getSiteReceiveEmail(db)
    res.json({
      email,
      email_masked: maskEmail(email),
      set: email.length > 0,
    })
  })

  router.put('/site/receive-email', guard, (req: Request, res: Response) => {
    const parsed = receiveEmailBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid email payload' })
      return
    }
    const email = parsed.data.email.trim()
    if (email && !isValidReceiveEmail(email)) {
      res.status(400).json({ error: '邮箱格式无效' })
      return
    }
    try {
      setSiteReceiveEmail(db, email)
    } catch {
      res.status(400).json({ error: '请先完成站点密码初始化' })
      return
    }
    res.json({
      ok: true,
      email,
      email_masked: maskEmail(email),
      set: email.length > 0,
    })
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

  /** 验证码登录能力查询（解锁弹窗按钮灰/亮） */
  router.get('/instances/:id/unlock-otp/status', guard, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    if (!instanceId || !getInstanceRow(db, instanceId)) {
      res.status(404).json({ error: 'Instance not found' })
      return
    }
    res.json(getUnlockOtpStatus(db, instanceId))
  })

  /** 发送一次性解锁验证码（等 Mac SMTP 真正发出后再返回） */
  router.post('/instances/:id/unlock-otp/send', guard, async (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    if (!instanceId) {
      res.status(400).json({ error: 'Invalid instance id' })
      return
    }
    const result = await sendUnlockOtp(db, instanceId)
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.status(200).json({
      ok: true,
      expires_in: result.expires_in,
      receive_email_masked: maskEmail(getSiteReceiveEmail(db)),
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

  /** Mobile: create a custom digital employee (no talent-market presets) */
  router.post(
    '/instances/:id/agents',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      if (!instanceId) {
        res.status(400).json({ error: 'Invalid instance id' })
        return
      }
      const parsed = agentCreateBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid create payload' })
        return
      }
      const payload: Record<string, unknown> = {
        name: parsed.data.name.trim(),
        engine: parsed.data.engine,
      }
      if (parsed.data.jelly_color) payload.jelly_color = parsed.data.jelly_color
      await respondRpc(res, instanceId, 'agent.create', payload)
    },
  )

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

  /** Siri: compact agent entities with optional group / working filters. */
  router.get('/instances/:id/siri/agents', guard, needUnlock, (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.id)
    if (!instanceId) {
      res.status(400).json({ error: 'Invalid instance id' })
      return
    }
    const parsed = siriAgentsQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid Siri agents query' })
      return
    }
    const working = parsed.data.working == null
      ? undefined
      : parsed.data.working === 'true' || parsed.data.working === '1'
    const result = listSiriAgents(db, instanceId, {
      group: parsed.data.group,
      working,
    })
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.json({ agents: result.agents })
  })

  /** Siri: stable rules-based agent status contract. */
  router.get(
    '/instances/:id/siri/agents/:agentId/status',
    guard,
    needUnlock,
    (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const result = agentStatusProvider.getStatus(db, instanceId, agentId)
      if (!result.ok) {
        res.status(result.status).json({ error: result.error })
        return
      }
      res.json(result.status)
    },
  )

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
      const mode = (parsed.data.mode || '').trim()
      if (mode) payload.mode = mode
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

  /** Task plan active / confirm / reject / abort / resume（等 Mac RPC） */
  router.get(
    '/instances/:id/agents/:agentId/task-plan/active',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      await respondRpc(res, instanceId, 'agent.task_plan.active', { agent_id: agentId })
    },
  )
  for (const action of ['confirm', 'reject', 'abort', 'resume'] as const) {
    router.post(
      `/instances/:id/agents/:agentId/task-plan/:planId/${action}`,
      guard,
      needUnlock,
      async (req: Request, res: Response) => {
        const instanceId = routeParam(req.params.id)
        const agentId = routeParam(req.params.agentId)
        const planId = routeParam(req.params.planId)
        if (!instanceId || !agentId || !planId) {
          res.status(400).json({ error: 'Invalid instance, agent or plan id' })
          return
        }
        const body = (req.body ?? {}) as Record<string, unknown>
        await respondRpc(res, instanceId, `agent.task_plan.${action}`, {
          agent_id: agentId,
          plan_id: planId,
          steps: body.steps,
        })
      },
    )
  }

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

  /** List pending permission cards across one instance */
  router.get(
    '/instances/:id/permissions/pending',
    guard,
    (req: Request, res: Response, next: NextFunction) => {
      const instanceId = routeParam(req.params.id)
      if (!instanceId) {
        res.status(400).json({ error: 'Invalid instance id' })
        return
      }
      if (!getInstanceRow(db, instanceId)) {
        res.status(404).json({ error: 'Instance not found' })
        return
      }
      next()
    },
    needUnlock,
    (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const result = listInstancePermissionsMirror(db, instanceId)
      if (!result.ok) {
        res.status(result.status).json({ error: result.error })
        return
      }
      res.json({ items: result.items })
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

  /** 手机主动进入对话：清未读（与 viewer 心跳分离） */
  router.post(
    '/instances/:id/agents/:agentId/mark-read',
    guard,
    needUnlock,
    (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const result = enqueueCommand(db, instanceId, 'agent.mark_read', { agent_id: agentId })
      if (!result.ok) {
        res.status(result.status).json({ error: result.error })
        return
      }
      // 立刻清镜像，避免列表轮询在 Mac 处理前仍显示「未读」（PC 直连库无此延迟）
      clearAgentTaskUnreadMirror(db, instanceId, agentId)
      res.status(202).json({ ok: true, command: result.command })
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
    timeoutMs?: number,
  ): Promise<void> {
    const result = await enqueueAndWait(db, instanceId, action, payload, timeoutMs)
    if (!result.ok) {
      res.status(result.httpStatus).json({ error: result.error })
      return
    }
    res.json(result.body ?? {})
  }

  /** Siri Receptionist: wait briefly for a full answer, then degrade to accepted/pending. */
  router.post(
    '/instances/:id/siri/receptionist/ask',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      if (!instanceId) {
        res.status(400).json({ error: 'Invalid instance id' })
        return
      }
      const parsed = siriReceptionistAskBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid Receptionist question' })
        return
      }
      const instance = getInstanceRow(db, instanceId)
      if (
        !instance?.last_heartbeat_at
        || Date.now() - instance.last_heartbeat_at >= SIRI_INSTANCE_ONLINE_THRESHOLD_MS
      ) {
        res.status(503).json({
          error: 'Mac offline',
          code: 'MAC_OFFLINE',
        })
        return
      }
      const result = await enqueueAndWait(
        db,
        instanceId,
        'receptionist.ask',
        { question: parsed.data.question },
        siriReceptionistWaitMs(),
      )
      if (!result.ok) {
        if (result.httpStatus === 504) {
          res.status(202).json({
            submitted: true,
            pending: true,
            answer: '',
            conversation_id: 0,
            reply_ms: 0,
            speech_text: '问题已提交，回答时间较长，请稍后打开 Atolla 查看。',
          })
          return
        }
        res.status(result.httpStatus).json({ error: result.error })
        return
      }
      res.json(result.body ?? {})
    },
  )

  /** 任务队列：列表（等 Mac 结果） */
  router.get(
    '/instances/:id/agents/:agentId/task-queue',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      await respondRpc(res, instanceId, 'agent.task_queue.list', { agent_id: agentId })
    },
  )

  /** 任务队列：入队 */
  router.post(
    '/instances/:id/agents/:agentId/task-queue',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const parsed = taskQueueQuestionBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid task-queue payload' })
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
      const payload: Record<string, unknown> = { agent_id: agentId, question }
      if (attachments.length) payload.attachments = attachments
      await respondRpc(res, instanceId, 'agent.task_queue.enqueue', payload)
    },
  )

  /** 任务队列：打断优先（fire-and-forget 亦可；等待确认 accepted） */
  router.post(
    '/instances/:id/agents/:agentId/task-queue/interrupt',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      const parsed = taskQueueQuestionBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid interrupt payload' })
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
      const payload: Record<string, unknown> = { agent_id: agentId, question }
      if (attachments.length) payload.attachments = attachments
      await respondRpc(res, instanceId, 'agent.task_queue.interrupt', payload, 60_000)
    },
  )

  /** 任务队列：继续 */
  router.post(
    '/instances/:id/agents/:agentId/task-queue/continue',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      await respondRpc(res, instanceId, 'agent.task_queue.continue', { agent_id: agentId })
    },
  )

  /** 任务队列：取消一项 */
  router.post(
    '/instances/:id/agents/:agentId/task-queue/:taskId/cancel',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      const taskId = routeParam(req.params.taskId)
      if (!instanceId || !agentId || !taskId) {
        res.status(400).json({ error: 'Invalid instance, agent or task id' })
        return
      }
      await respondRpc(res, instanceId, 'agent.task_queue.cancel', {
        agent_id: agentId,
        task_id: taskId,
      })
    },
  )

  /** 任务队列：改写未执行文案 */
  router.post(
    '/instances/:id/agents/:agentId/task-queue/:taskId/update',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      const taskId = routeParam(req.params.taskId)
      if (!instanceId || !agentId || !taskId) {
        res.status(400).json({ error: 'Invalid instance, agent or task id' })
        return
      }
      const question = typeof req.body?.question === 'string' ? req.body.question.trim() : ''
      if (!question) {
        res.status(400).json({ error: 'question required' })
        return
      }
      await respondRpc(res, instanceId, 'agent.task_queue.update', {
        agent_id: agentId,
        task_id: taskId,
        question,
      })
    },
  )

  /** 任务队列：清除已完成 */
  router.post(
    '/instances/:id/agents/:agentId/task-queue/clear-done',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      const agentId = routeParam(req.params.agentId)
      if (!instanceId || !agentId) {
        res.status(400).json({ error: 'Invalid instance or agent id' })
        return
      }
      await respondRpc(res, instanceId, 'agent.task_queue.clear_done', { agent_id: agentId })
    },
  )

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

  /** Mobile settings: save rules_prompt (+ optional jelly_color) */
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
      const payload: Record<string, unknown> = {
        agent_id: agentId,
        rules_prompt: parsed.data.rules_prompt,
      }
      if (parsed.data.jelly_color) {
        payload.jelly_color = parsed.data.jelly_color
      }
      await respondRpc(res, instanceId, 'agent.settings.update', payload)
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

  /** Bark 发送开启通知用的 6 位验证码 */
  router.post(
    '/instances/:id/notify-prefs/verify/send',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      if (!instanceId) {
        res.status(400).json({ error: 'Invalid instance id' })
        return
      }
      await respondRpc(res, instanceId, 'notify.bark.verify.send', {})
    },
  )

  /** 校验 Bark 验证码并标记已验证 */
  router.post(
    '/instances/:id/notify-prefs/verify/confirm',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      if (!instanceId) {
        res.status(400).json({ error: 'Invalid instance id' })
        return
      }
      const code = String((req.body as { code?: string } | undefined)?.code || '').trim()
      if (!/^\d{6}$/.test(code)) {
        res.status(400).json({ error: '请输入 6 位验证码' })
        return
      }
      await respondRpc(res, instanceId, 'notify.bark.verify.confirm', { code })
    },
  )

  /** 读取本机 Claude / Codex / Cursor 订阅额度（Mac 聚合，默认缓存） */
  router.get(
    '/instances/:id/engines/usage',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      if (!instanceId) {
        res.status(400).json({ error: 'Invalid instance id' })
        return
      }
      const freshRaw = String(req.query.fresh ?? '')
      const fresh = freshRaw === '1' || freshRaw === 'true' || freshRaw === 'yes'
      await respondRpc(res, instanceId, 'engines.usage.get', { fresh })
    },
  )

  /** 读取该电脑 JEV（jevos）安装/启停状态 */
  router.get(
    '/instances/:id/jevos/settings',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      if (!instanceId) {
        res.status(400).json({ error: 'Invalid instance id' })
        return
      }
      const forceRaw = String(req.query.force ?? '')
      const force = forceRaw === '1' || forceRaw === 'true'
      await respondRpc(res, instanceId, 'jevos.settings.get', { force })
    },
  )

  /** 从 GitHub Release 安装 JEV（长耗时） */
  router.post(
    '/instances/:id/jevos/settings/install',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      if (!instanceId) {
        res.status(400).json({ error: 'Invalid instance id' })
        return
      }
      const body = req.body as { package_id?: string; china_mirror?: boolean }
      const packageId = String(body?.package_id || '').trim()
      if (!packageId) {
        res.status(400).json({ error: 'package_id required' })
        return
      }
      await respondRpc(
        res,
        instanceId,
        'jevos.settings.install',
        { package_id: packageId, china_mirror: body?.china_mirror === true },
        31 * 60_000,
      )
    },
  )

  /** JEV 胶囊开关 */
  router.put(
    '/instances/:id/jevos/settings',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      if (!instanceId) {
        res.status(400).json({ error: 'Invalid instance id' })
        return
      }
      const enabled = !!(req.body as { enabled?: boolean })?.enabled
      await respondRpc(res, instanceId, 'jevos.settings.set', { enabled }, 120_000)
    },
  )

  /** 卸载平台安装的 JEV（电脑端归档安装目录） */
  router.post(
    '/instances/:id/jevos/settings/uninstall',
    guard,
    needUnlock,
    async (req: Request, res: Response) => {
      const instanceId = routeParam(req.params.id)
      if (!instanceId) {
        res.status(400).json({ error: 'Invalid instance id' })
        return
      }
      await respondRpc(res, instanceId, 'jevos.settings.uninstall', {}, 120_000)
    },
  )

  return router
}
