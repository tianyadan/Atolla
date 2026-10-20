#!/usr/bin/env node
/** 本地截图用 mock API：鉴权 + agents/folders/tasks/permissions */
import http from 'node:http'

const agents = [
  { id: 1, name: '产品经理', status: 'idle', folder_id: 1, conversation_id: 101, engine: 'claude' },
  { id: 2, name: 'UI 设计师', status: 'running', folder_id: 1, conversation_id: 102, engine: 'claude', run_started_at: new Date().toISOString() },
  { id: 3, name: '后端', status: 'running', folder_id: 1, conversation_id: 103, engine: 'claude', run_started_at: new Date().toISOString() },
  { id: 4, name: '前端', status: 'running', folder_id: 1, conversation_id: 104, engine: 'claude', run_started_at: new Date().toISOString() },
  { id: 5, name: '测试', status: 'waiting', folder_id: 1, conversation_id: 105, engine: 'claude' },
  { id: 6, name: '文档', status: 'idle', folder_id: 1, conversation_id: 106, engine: 'claude' },
]

const tasks = {
  2: [{ task_name: '画环礁视图', status: 'running', progress: 0.4, message: '画环礁视图' }],
  3: [{ task_name: '重构任务清理', status: 'running', progress: 0.625, message: '重构任务清理 · 5/8' }],
  4: [{ task_name: '水母动效', status: 'running', progress: 0.3, message: '水母动效' }],
  5: [{ task_name: '用例超时，等你看看', status: 'waiting', progress: 0.9, message: '用例超时，等你看看' }],
}

const pending = {
  105: [{
    request_id: 'perm-demo-1',
    tool_name: 'Bash',
    summary: 'pytest SalesBudgetExportIT',
    meaning: '导出任务的集成用例超时 3 次，要重跑还是先跳过？',
    risk: 'mid',
    deadline: new Date(Date.now() + 120000).toISOString(),
  }],
}

const msgs = {
  5: [
    { id: 1, role: 'assistant', content: '导出任务的集成用例 `SalesBudgetExportIT` 连续超时 3 次，看起来是 MinIO 上传在测试环境里很慢。', created_at: new Date().toISOString() },
    { id: 2, role: 'assistant', content: '我可以把超时从 30 秒放宽到 90 秒后重跑，或者先跳过这个用例，其余 29 个都通过了。', created_at: new Date().toISOString() },
  ],
}

function json(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*',
  })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
    })
    res.end()
    return
  }
  const url = new URL(req.url, 'http://127.0.0.1')
  const p = url.pathname

  if (p === '/api/auth/me') return json(res, 200, { username: 'demo' })
  if (p === '/api/auth/setup') return json(res, 200, { needs_register: false })
  if (p === '/api/admin/agents') return json(res, 200, { items: agents })
  if (p === '/api/admin/agent-folders') return json(res, 200, { items: [{ id: 1, name: 'sales-analytics 开发团队' }] })
  if (p === '/api/admin/agents/pc-viewer') return json(res, 200, { ok: true })

  const taskM = p.match(/^\/api\/admin\/agents\/(\d+)\/tasks$/)
  if (taskM) return json(res, 200, { items: tasks[taskM[1]] || [] })

  const msgM = p.match(/^\/api\/admin\/agents\/(\d+)\/messages$/)
  if (msgM) {
    const id = Number(msgM[1])
    const a = agents.find((x) => x.id === id)
    return json(res, 200, {
      items: msgs[id] || [],
      total: (msgs[id] || []).length,
      has_more: false,
      conversation_id: a?.conversation_id || 0,
    })
  }

  if (p === '/api/permissions/pending') {
    const cid = url.searchParams.get('conversation_id')
    return json(res, 200, { items: pending[cid] || [] })
  }
  if (p === '/api/permissions/decide') return json(res, 200, { ok: true })

  if (p.startsWith('/api/teams/') && p.endsWith('/stream')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not implemented')
    return
  }

  if (p.startsWith('/api/')) return json(res, 200, { items: [], ok: true })
  json(res, 404, { error: 'not found' })
})

server.listen(8080, '127.0.0.1', () => {
  console.log('jelly mock api on :8080')
})
