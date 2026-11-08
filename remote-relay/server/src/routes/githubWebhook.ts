import express, { type Request, type Response, type Router } from 'express'
import { enqueueCommand } from '../commands.js'
import type { RelayDatabase } from '../db.js'
import { getInstanceRow } from '../auth/instance.js'
import { routeParam } from '../params.js'

type RawBodyRequest = Request & { rawBody?: Buffer }

function headerValue(req: Request, name: string): string {
  const value = req.headers[name]
  if (Array.isArray(value)) return value[0]?.trim() || ''
  return typeof value === 'string' ? value.trim() : ''
}

/** GitHub 公网入口：只透传受支持的 Issue 事件，签名最终由持有 Secret 的 Mac 校验。 */
export function createGitHubWebhookRouter(db: RelayDatabase): Router {
  const router = express.Router()

  router.post('/:instanceId', (req: Request, res: Response) => {
    const instanceId = routeParam(req.params.instanceId)
    if (!instanceId || !getInstanceRow(db, instanceId)) {
      res.status(404).json({ error: 'Instance not found' })
      return
    }
    const deliveryId = headerValue(req, 'x-github-delivery')
    const event = headerValue(req, 'x-github-event').toLowerCase()
    const signature = headerValue(req, 'x-hub-signature-256')
    if (!deliveryId || !event || !/^sha256=[0-9a-f]{64}$/i.test(signature)) {
      res.status(400).json({ error: 'Invalid GitHub webhook headers' })
      return
    }
    if (event === 'ping') {
      res.status(200).json({ ok: true, pong: true })
      return
    }
    const action = typeof req.body?.action === 'string' ? req.body.action.toLowerCase() : ''
    if (event !== 'issues' || !['opened', 'edited', 'reopened'].includes(action)) {
      res.status(202).json({ accepted: false, ignored: true })
      return
    }
    const rawBody = (req as RawBodyRequest).rawBody
    if (!rawBody?.length) {
      res.status(400).json({ error: 'Raw webhook body unavailable' })
      return
    }
    const enqueued = enqueueCommand(db, instanceId, 'github.idea.event', {
      delivery_id: deliveryId,
      event,
      signature,
      body_base64: rawBody.toString('base64'),
    })
    if (!enqueued.ok) {
      res.status(enqueued.status).json({ error: enqueued.error })
      return
    }
    // GitHub 要求快速响应；签名校验和任务派发由 Mac 异步完成。
    res.status(202).json({
      accepted: true,
      delivery_id: deliveryId,
      command_id: enqueued.command.id,
    })
  })

  return router
}
