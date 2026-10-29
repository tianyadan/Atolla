import {
  coalesceChatLog,
  looksLikeDuplicatedAssistant,
  shouldAppendAssistantChunk,
  stripRepeatedAssistantTail,
} from './coalesceChatLog.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

{
  const local = [
    { id: 1, role: 'user', content: 'hi' },
    { id: 2, role: 'assistant', content: '· full answer here that is long enough' },
  ]
  const db = [
    { id: 3, role: 'assistant', content: '📦 上下文已由引擎压缩，会话已保留' },
    { id: 1, role: 'user', content: 'hi' },
  ]
  const got = coalesceChatLog(local, db)
  const asst = got.find((m) => m.id === 2)
  assert(asst && asst.content.includes('full answer'), 'should keep longer local assistant by id')
}

{
  const local = [{ id: 1, role: 'user', content: 'q' }, { id: 2, role: 'assistant', content: 'short' }]
  const db = [
    { id: 1, role: 'user', content: 'q' },
    { id: 2, role: 'assistant', content: 'short but from db with more detail xyz' },
  ]
  const got = coalesceChatLog(local, db)
  assert(got.find((m) => m.id === 2).content.includes('more detail'), 'prefer longer db')
}

{
  const answer = '已落地，灵动岛与后端已热更新。灵动岛永久隐藏滚动条。未读机制跨端清除。feat(unread): ok'
  const local = [
    { id: 1, role: 'user', content: 'q' },
    { id: 2, role: 'assistant', content: `${answer}\n\n这是跨端未读机制，先摸清再落地。${answer}` },
  ]
  const db = [
    { id: 1, role: 'user', content: 'q' },
    { id: 2, role: 'assistant', content: `这是跨端未读机制，先摸清再落地。${answer}` },
  ]
  assert(looksLikeDuplicatedAssistant(local[1].content, db[1].content), 'detect dup')
  const got = coalesceChatLog(local, db)
  assert(got.find((m) => m.id === 2).content === db[1].content, 'prefer db when local duplicated stream+result')
}

{
  const local = [
    { id: 10, role: 'user', content: 'old' },
    { id: 11, role: 'assistant', content: 'old reply long enough here' },
    { id: 12, role: 'command', content: '{"cmd":"ls"}' },
    { id: 13, role: 'command', content: '{"cmd":"pwd"}' },
    { id: 14, role: 'command', content: '{"cmd":"git"}' },
  ]
  const db = [
    { id: 11, role: 'assistant', content: 'old reply long enough here' },
    { id: 12, role: 'command', content: '{"cmd":"ls"}' },
    { id: 15, role: 'user', content: 'from mobile' },
  ]
  const got = coalesceChatLog(local, db)
  assert(got.some((m) => m.id === 15 && m.content === 'from mobile'), 'must include mobile user msg')
  assert(got.some((m) => m.id === 14), 'keep local-only older command outside db page')
}

// 回合结束：本地无 id 命令若被追加到末尾，会把 DB 最终回复顶上去 —— 不得追加命令
{
  const local = [
    { role: 'user', content: '做一下' },
    { role: 'assistant', content: '先看下环境' },
    { role: 'command', content: 'ls -la' },
    { role: 'command', content: 'git status' },
    { role: 'command', content: 'npm test' },
    { role: 'assistant', content: '全部完成，测试已通过，变更已推送。' },
  ]
  const db = [
    { id: 1, role: 'user', content: '做一下' },
    { id: 2, role: 'assistant', content: '先看下环境' },
    { id: 3, role: 'command', content: 'ls -la' },
    { id: 4, role: 'command', content: 'git status' },
    { id: 5, role: 'command', content: 'npm test' },
    { id: 6, role: 'assistant', content: '全部完成，测试已通过，变更已推送。' },
  ]
  const got = coalesceChatLog(local, db)
  const last = got[got.length - 1]
  assert(last.role === 'assistant' && last.content.includes('全部完成'), 'final reply must stay at end')
  assert(!got.some((m) => m.id == null && m.role === 'command'), 'must not append no-id commands')
}

// DB 尚未写入最终回复时：保留本地流式 assistant
{
  const local = [
    { role: 'command', content: 'ls' },
    { role: 'assistant', content: '这是还没落库的最终答复正文' },
  ]
  const db = [
    { id: 1, role: 'user', content: 'q' },
    { id: 2, role: 'command', content: 'ls' },
  ]
  const got = coalesceChatLog(local, db)
  assert(got[got.length - 1].role === 'assistant', 'keep streamed reply when db missing it')
}

// 乐观 user：轮询 force 时 DB 尚未写入，不得冲掉刚发的气泡
{
  const local = [
    { id: 1, role: 'user', content: 'old' },
    { id: 2, role: 'assistant', content: 'old reply' },
    { role: 'user', content: '刚发出去', pending: true },
  ]
  const db = [
    { id: 1, role: 'user', content: 'old' },
    { id: 2, role: 'assistant', content: 'old reply' },
  ]
  const got = coalesceChatLog(local, db)
  assert(got.some((m) => m.role === 'user' && m.content === '刚发出去'), 'keep pending optimistic user')
  assert(!got.some((m) => m.id == null && m.role === 'command'), 'still no stray commands')
}

// DB 已有同文 user 后不再重复追加乐观气泡
{
  const local = [
    { role: 'user', content: 'hello', pending: true },
    { role: 'assistant', content: 'streaming…' },
  ]
  const db = [
    { id: 10, role: 'user', content: 'hello' },
  ]
  const got = coalesceChatLog(local, db)
  assert(got.filter((m) => m.role === 'user' && m.content === 'hello').length === 1, 'no dup user')
  assert(got[got.length - 1].role === 'assistant', 'stream after user')
}

// 同一「改动」章节贴两次 → 剥尾
{
  const once = '已修好。轮询会冲掉气泡。\n\n改动\n- pending\n- coalesce 保留\n\n建议提交：\nfix(pc-chat): 修复发送后用户消息'
  const dup = `${once}\n\n改动\n- pending\n- coalesce 保留\n\n建议提交：\nfix(pc-chat): 修复发送后用户消息`
  const stripped = stripRepeatedAssistantTail(dup)
  assert(stripped === once, `strip repeated 改动 tail, got ${JSON.stringify(stripped)}`)
  assert(looksLikeDuplicatedAssistant(dup), 'detect self-dup tail')
  assert(
    shouldAppendAssistantChunk(once, '\n\n改动\n- pending\n- coalesce 保留\n\n建议提交：\nfix(pc-chat): 修复发送后用户消息') === false,
    'skip replayed chunk',
  )
}

// 回合结束：SSE 无 id 命令不得挂在 DB 最终回复后面（否则粘底只看见命令）
{
  const local = [
    { role: 'user', content: '修 bug' },
    { role: 'assistant', content: '先排查…' },
    { role: 'command', content: 'rg foo' },
    { role: 'command', content: 'rg bar' },
    { role: 'command', content: 'go test' },
  ]
  const db = [
    { id: 1, role: 'user', content: '修 bug' },
    { id: 2, role: 'assistant', content: '先排查…' },
    { id: 3, role: 'command', content: 'rg foo' },
    { id: 4, role: 'command', content: 'rg bar' },
    { id: 5, role: 'command', content: 'go test' },
    { id: 6, role: 'assistant', content: '根因是 coalesce 挂尾，已修复。' },
  ]
  const got = coalesceChatLog(local, db)
  const last = got[got.length - 1]
  assert(last?.role === 'assistant' && last.content.includes('已修复'), 'final assistant must be last')
  assert(!got.some((m) => m.role === 'command' && m.id == null), 'no orphan SSE commands after db catch-up')
}

console.log('coalesceChatLog ok')
