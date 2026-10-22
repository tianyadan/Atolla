import { useEffect, useRef, useState } from 'react'
import JellyAvatar from './JellyAvatar.jsx'
import { resolveJellyColor } from './jellyColor.js'

export { buildGroupMemberSet, parseMentionAgentIds } from './groupChatMentions.js'

const OFFER_MS = 5000

/**
 * @ 3～5 人发送时的底部岔路面板：5s 进度条 +「生成群聊」。
 * 超时/关闭 → onTimeout（走旧并行）；点生成 → onCreate。
 */
export default function GroupChatOfferSheet({
  open,
  agents = [],
  memberIds = [],
  onCreate,
  onTimeout,
  creating = false,
}) {
  const [remainMs, setRemainMs] = useState(OFFER_MS)
  const doneRef = useRef(false)
  const onTimeoutRef = useRef(onTimeout)
  onTimeoutRef.current = onTimeout

  useEffect(() => {
    if (!open) {
      doneRef.current = false
      setRemainMs(OFFER_MS)
      return undefined
    }
    doneRef.current = false
    setRemainMs(OFFER_MS)
    const started = Date.now()
    const tick = setInterval(() => {
      const left = Math.max(0, OFFER_MS - (Date.now() - started))
      setRemainMs(left)
      if (left <= 0 && !doneRef.current) {
        doneRef.current = true
        clearInterval(tick)
        onTimeoutRef.current?.()
      }
    }, 50)
    return () => clearInterval(tick)
  }, [open])

  if (!open) return null

  const members = memberIds
    .map((id) => agents.find((a) => Number(a.id) === Number(id)))
    .filter(Boolean)
  const pct = Math.max(0, Math.min(100, (remainMs / OFFER_MS) * 100))

  function dismissParallel() {
    if (doneRef.current || creating) return
    doneRef.current = true
    onTimeout?.()
  }

  function create() {
    if (doneRef.current || creating) return
    doneRef.current = true
    onCreate?.()
  }

  return (
    <div className="gc-offer" role="dialog" aria-label="是否生成群聊">
      <div className="gc-offer-progress" aria-hidden="true">
        <div className="gc-offer-progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="gc-offer-body">
        <div className="gc-offer-text">
          <strong>生成群聊开会？</strong>
          <p>
            已 @ {memberIds.length} 位同事。点「生成群聊」进共享时间线主持开会；
            {Math.ceil(remainMs / 1000)} 秒内不操作则仍按原方式并行委托。
          </p>
          <div className="gc-offer-avatars">
            {members.map((a) => (
              <span key={a.id} className="gc-offer-avatar" title={a.name}>
                <JellyAvatar color={resolveJellyColor(a)} size={24} state="idle" />
              </span>
            ))}
          </div>
        </div>
        <div className="gc-offer-actions">
          <button type="button" className="gc-offer-skip" onClick={dismissParallel} disabled={creating}>
            并行委托
          </button>
          <button type="button" className="gc-offer-create" onClick={create} disabled={creating}>
            {creating ? '建群中…' : '生成群聊'}
          </button>
        </div>
      </div>
    </div>
  )
}
