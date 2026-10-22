import { useEffect, useState, type CSSProperties } from 'react'
import { isJellyColor, normalizeJellyColor, type JellyAvatarState } from './jellyColor'
import {
  JELLY_ACTION_ROWS,
  JELLY_CELL,
  JELLY_FRAMES,
  jellyActionRow,
  jellySpriteUrl,
  pickSpriteScale,
  prefersReducedMotion,
} from './jellySprite'

const FLOAT_MS = 3000
const JUMP_MS = 600
const ALERT_MS = 800
const ERROR_MS = 889
const FRAME_MS_FLOAT = FLOAT_MS / JELLY_FRAMES
const FRAME_MS_JUMP = JUMP_MS / JELLY_FRAMES
const FRAME_MS_ALERT = ALERT_MS / JELLY_FRAMES
const FRAME_MS_ERROR = ERROR_MS / JELLY_FRAMES

type Props = {
  color?: string
  size?: number
  state?: JellyAvatarState
  className?: string
  title?: string
  'aria-label'?: string
}

/** 可复用像素水母头像（v2：7 行动作精灵表，与 PC 一致） */
export function JellyAvatar({
  color = 'blue',
  size = 32,
  state = 'idle',
  className = '',
  title,
  'aria-label': ariaLabel,
}: Props) {
  const safeColor = isJellyColor(color) ? normalizeJellyColor(color) || 'blue' : 'blue'
  const px = Math.max(8, Math.round(Number(size) || 32))
  const cellPx = px / JELLY_CELL
  const [frame, setFrame] = useState(0)
  const [reduced, setReduced] = useState(() => prefersReducedMotion())
  const [flashOn, setFlashOn] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    onChange()
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  const row = jellyActionRow(state)
  const frameMs =
    state === 'waiting'
      ? FRAME_MS_ALERT
      : state === 'error'
        ? FRAME_MS_ERROR
        : state === 'working' || state === 'typing'
          ? FRAME_MS_JUMP
          : FRAME_MS_FLOAT

  useEffect(() => {
    if (reduced) {
      setFrame(0)
      return undefined
    }
    const t = setInterval(() => {
      setFrame((f) => (f + 1) % JELLY_FRAMES)
    }, frameMs)
    return () => clearInterval(t)
  }, [state, frameMs, reduced])

  useEffect(() => {
    if (state !== 'waiting' || reduced) {
      setFlashOn(true)
      return undefined
    }
    let bright = true
    setFlashOn(true)
    const t = setInterval(() => {
      bright = !bright
      setFlashOn(bright)
    }, 700)
    return () => clearInterval(t)
  }, [state, reduced])

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const scale = pickSpriteScale(px, dpr)
  const sheetW = JELLY_FRAMES * px
  const sheetH = JELLY_ACTION_ROWS * px
  const bgX = -frame * px
  const bgY = -row * px

  let transform = 'translateY(0)'
  let opacity = 1
  let animClass = ''

  if (state === 'error' && !reduced) {
    transform = `translateY(${cellPx * 1.5}px)`
  } else if (state === 'waiting') {
    opacity = flashOn ? 1 : 0.35
  } else if (!reduced && state === 'idle') {
    animClass = 'jelly-avatar--bob'
  } else if (!reduced && (state === 'working' || state === 'typing')) {
    animClass = 'jelly-avatar--jump'
  }

  const classes = ['jelly-avatar', animClass, className].filter(Boolean).join(' ')
  const style = {
    width: px,
    height: px,
    '--jelly-cell': `${cellPx}px`,
    backgroundImage: `url(${jellySpriteUrl(safeColor, scale)})`,
    backgroundSize: `${sheetW}px ${sheetH}px`,
    backgroundPosition: `${bgX}px ${bgY}px`,
    transform,
    opacity,
  } as CSSProperties

  return (
    <span
      className={classes}
      title={title}
      role="img"
      aria-label={ariaLabel || `jelly ${safeColor}`}
      style={style}
    />
  )
}
