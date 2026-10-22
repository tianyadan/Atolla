import { coalesceChatLog, looksLikeDuplicatedAssistant } from './coalesceChatLog.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

{
  const local = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: '· full answer here that is long enough' },
  ]
  const db = [
    { role: 'assistant', content: '📦 上下文已由引擎压缩，会话已保留' },
    { role: 'user', content: 'hi' },
  ]
  const got = coalesceChatLog(local, db)
  assert(got === local, 'should keep local when db lost assistant')
}

{
  const local = [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'short' }]
  const db = [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: 'short but from db with more detail xyz' },
  ]
  const got = coalesceChatLog(local, db)
  assert(got === db, 'prefer longer db')
}

{
  const answer = '已落地，灵动岛与后端已热更新。灵动岛永久隐藏滚动条。未读机制跨端清除。feat(unread): ok'
  const local = [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: `${answer}\n\n这是跨端未读机制，先摸清再落地。${answer}` },
  ]
  const db = [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: `这是跨端未读机制，先摸清再落地。${answer}` },
  ]
  assert(looksLikeDuplicatedAssistant(local[1].content, db[1].content), 'detect dup')
  const got = coalesceChatLog(local, db)
  assert(got === db, 'prefer db when local duplicated stream+result')
}

console.log('coalesceChatLog ok')
