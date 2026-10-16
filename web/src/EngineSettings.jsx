import { useEffect, useState } from 'react'
import { copyText, fetchSetupStatus, installCommand } from './engineCatalog.js'
import { EngineLogo } from './engineLogos.jsx'
import SettingsFold from './SettingsFold.jsx'

/** 设置页「工作引擎」：已安装亮绿灯，未安装置灰，点击可复制安装命令。 */
export default function EngineSettings({ active }) {
  const [engines, setEngines] = useState([])
  const [openId, setOpenId] = useState('')
  const [china, setChina] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(true)

  /** 重新检测三个工作引擎。 */
  async function load() {
    setBusy(true)
    setErr('')
    try {
      const data = await fetchSetupStatus()
      setEngines(data.engines)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (active) void load()
  }, [active])

  const opened = engines.find((e) => e.id === openId)
  const command = installCommand(opened, china)

  /** 复制当前弹层里的安装命令。 */
  async function copyCmd() {
    if (!command) return
    await copyText(command)
    setCopied(true)
  }

  return (
    <SettingsFold
      title="工作引擎"
      desc="绿灯表示本机已能调用该 CLI，灰色表示还没安装"
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="engine-card-grid engine-settings-grid">
        {engines.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`engine-pick engine-status${e.installed ? '' : ' is-off'}`}
            onClick={() => { setOpenId(e.id); setCopied(false) }}
          >
            <EngineLogo id={e.id} />
            <strong>{e.name}</strong>
            <i className={`engine-dot ${e.installed ? 'ok' : 'off'}`} aria-hidden="true" />
            <span>{e.installed ? '已安装' : '未安装'}</span>
          </button>
        ))}
      </div>
      <button type="button" className="engine-recheck" onClick={load} disabled={busy}>
        {busy ? '正在重新检查…' : '重新检查环境'}
      </button>
      {err && <p className="engine-hint">{err}</p>}
      {opened && (
        <div className="modal-mask" onClick={() => setOpenId('')}>
          <div className="modal-card engine-pop" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="engine-pop-title">
            <h2 id="engine-pop-title">安装 {opened.name}</h2>
            <label className="engine-mirror">
              <input type="checkbox" checked={china} onChange={(ev) => { setChina(ev.target.checked); setCopied(false) }} />
              China-mirror
            </label>
            <pre className="engine-pop-cmd">{command}</pre>
            {opened.note && <p className="engine-note">{opened.note}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => setOpenId('')}>关闭</button>
              <button type="button" className="engine-copy" onClick={copyCmd}>{copied ? '已复制' : '复制命令'}</button>
            </div>
          </div>
        </div>
      )}
    </SettingsFold>
  )
}
