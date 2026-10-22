import { useEffect, useState } from 'react'
import { JellyAvatar } from '../jelly/JellyAvatar'

/** Claude CLI 风格轮换文案（与 PC RunStatus 一致） */
const THINKING_PHRASES = [
  'thinking',
  'pondering',
  'brewing ideas',
  'consulting the rubber duck',
  'untangling spaghetti',
  'asking the void politely',
  'compiling vibes',
  'negotiating with reality',
  'warming up neurons',
  'reading tea leaves',
  'sharpening virtual pencils',
  'counting token sheep',
  'channeling inner Claude',
  'politely poking the model',
  'assembling coherent thoughts',
]

type Props = {
  color: string
  /** 任务开始 unix 秒；缺省则从挂载时刻起算 */
  runStartedAt?: number | null
}

/** 已运行秒数文案，如 12s / 1m5s */
function formatRunSec(sec: number): string {
  const n = Math.max(0, Math.round(sec))
  if (n < 60) return `${n}s`
  const m = Math.floor(n / 60)
  const r = n % 60
  return r > 0 ? `${m}m${r}s` : `${m}m`
}

/** 发送后等待回复：小水母上下浮动 + 轮换 loading 文案 + 运行秒数 */
export function ChatThinkingTip({ color, runStartedAt }: Props) {
  const [phraseIdx, setPhraseIdx] = useState(0)
  const [mountedAt] = useState(() => Math.floor(Date.now() / 1000))
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    const t = window.setInterval(() => {
      setPhraseIdx((i) => (i + 1) % THINKING_PHRASES.length)
    }, 2400)
    return () => window.clearInterval(t)
  }, [])

  // 每秒刷新运行时长
  useEffect(() => {
    const t = window.setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => window.clearInterval(t)
  }, [])

  const start =
    runStartedAt != null && Number.isFinite(runStartedAt) && runStartedAt > 0
      ? Math.floor(runStartedAt)
      : mountedAt
  const runSec = Math.max(0, nowSec - start)

  return (
    <div className="chat-thinking" aria-live="polite">
      <JellyAvatar
        className="chat-thinking-jelly"
        color={color}
        size={18}
        state="idle"
      />
      <span className="chat-thinking-text">{THINKING_PHRASES[phraseIdx]}</span>
      <span className="chat-thinking-sec">{formatRunSec(runSec)}</span>
    </div>
  )
}
