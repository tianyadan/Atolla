import { engineMeta } from '../utils/engine'

type Props = {
  engine?: string | null
  className?: string
}

/** Small colored engine label (PC-style) */
export function EngineTag({ engine, className = '' }: Props) {
  if (!engine) return null
  const meta = engineMeta(engine)
  return (
    <span
      className={`tag engine-tag ${className}`.trim()}
      style={{ ['--eng' as string]: meta.color }}
    >
      {meta.label}
    </span>
  )
}
