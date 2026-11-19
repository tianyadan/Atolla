import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

const CONTROL_HOST = '127.0.0.1'

function isAuthorized(request, token) {
  const header = String(request.headers.authorization || '')
  const expected = `Bearer ${token}`
  const actualBytes = Buffer.from(header)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

function sendJSON(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function readJSON(request) {
  let raw = ''
  for await (const chunk of request) {
    raw += chunk
    if (raw.length > 16 * 1024) throw new Error('request body too large')
  }
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

/**
 * 开发态控制面只运行于 loopback，并以一次性令牌鉴权。
 * WHY: Electron 重启不能成为 Go 生命周期的所有者；仅 dev-runner 可启动/停止后端。
 */
export async function createDevControlServer({ backendManager }) {
  if (!backendManager?.ensure || !backendManager?.restart) {
    throw new Error('dev control requires a backend manager')
  }
  const token = randomBytes(32).toString('base64url')
  const server = createServer(async (request, response) => {
    if (!isAuthorized(request, token)) {
      sendJSON(response, 401, { error: 'unauthorized dev runner control request' })
      return
    }
    if (request.method !== 'POST') {
      sendJSON(response, 405, { error: 'method not allowed' })
      return
    }
    try {
      if (request.url === '/v1/backend/ensure') {
        const body = await readJSON(request)
        const userDataPath = typeof body.userDataPath === 'string' ? body.userDataPath.trim() : ''
        if (!userDataPath) {
          sendJSON(response, 400, { error: 'userDataPath required' })
          return
        }
        const backend = await backendManager.ensure(userDataPath)
        sendJSON(response, 200, { baseUrl: backend.baseUrl })
        return
      }
      if (request.url === '/v1/backend/restart') {
        const backend = await backendManager.restart()
        sendJSON(response, 200, { baseUrl: backend.baseUrl })
        return
      }
      sendJSON(response, 404, { error: 'unknown dev runner control endpoint' })
    } catch (error) {
      sendJSON(response, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, CONTROL_HOST, resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('failed to allocate dev runner control port')
  }
  return {
    url: `http://${CONTROL_HOST}:${address.port}`,
    token,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}
