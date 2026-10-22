import { useEffect, useState, type FormEvent } from 'react'
import { createAgent } from '../api'
import { JellyAvatar } from '../jelly/JellyAvatar'
import { JellyColorPicker } from '../jelly/JellyColorPicker'
import { assignJellyColor, type JellyColor } from '../jelly/jellyColor'
import { ENGINES } from '../utils/engine'

type Props = {
  open: boolean
  instanceId: string
  onClose: () => void
  /** Called with new agent id after successful create */
  onCreated: (agentId: string) => void
}

/** Mobile create employee sheet — custom only (no talent presets) */
export function CreateAgentSheet({ open, instanceId, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [engine, setEngine] = useState('claude')
  const [jelly, setJelly] = useState<JellyColor>(() => assignJellyColor(Date.now()))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setEngine('claude')
    setJelly(assignJellyColor(Date.now()))
    setErr(null)
    setBusy(false)
  }, [open])

  if (!open) return null

  /** Submit create RPC */
  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const trimmed = name.trim()
    if (!trimmed) {
      setErr('请输入名称')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const created = await createAgent(instanceId, {
        name: trimmed,
        engine,
        jelly_color: jelly,
      })
      onCreated(created.agent_id)
      onClose()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-sheet-mask" role="presentation" onClick={onClose}>
      <div
        className="settings-sheet create-agent-sheet"
        role="dialog"
        aria-modal
        aria-label="创建数字员工"
        onClick={(ev) => ev.stopPropagation()}
      >
        <header className="settings-sheet-head">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
          <h2 className="settings-sheet-title">创建数字员工</h2>
          <span className="settings-sheet-spacer" />
        </header>
        <form className="settings-sheet-body" onSubmit={(e) => void onSubmit(e)}>
          {err ? <p className="error-banner">{err}</p> : null}
          <div className="settings-jelly-preview">
            <JellyAvatar color={jelly} size={56} state="idle" />
          </div>
          <JellyColorPicker value={jelly} onChange={setJelly} disabled={busy} label="水母颜色" />
          <label className="settings-label">
            名称
            <input
              className="settings-input"
              value={name}
              disabled={busy}
              placeholder="例如：后端助手"
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="settings-label">
            引擎
            <select
              className="settings-input"
              value={engine}
              disabled={busy}
              onChange={(e) => setEngine(e.target.value)}
            >
              {ENGINES.map((eng) => (
                <option key={eng.id} value={eng.id}>
                  {eng.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? '创建中…' : '创建'}
          </button>
        </form>
      </div>
    </div>
  )
}
