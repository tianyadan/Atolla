import { coalesceChatLog, looksLikeDuplicatedAssistant } from './coalesceChatLog.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function ids(list) {
  return list.map((m) => m.id).filter((x) => x != null)
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

// 手机发问：DB 有新 user，本地因命令气泡更多旧逻辑会整段丢掉 —— 必须合并进来
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
  assert(ids(got).includes(15), 'new id present')
}

console.log('coalesceChatLog ok')
