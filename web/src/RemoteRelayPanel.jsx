import { useCallback, useEffect, useMemo, useState } from 'react'

const API = '/api'

/** 管理台：远程中继配置与一键部署命令 */
export default function RemoteRelayPanel({ authHeaders, onUnauthorized, active }) {
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const [enabled, setEnabled] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [instanceId, setInstanceId] = useState('')
  const [hasPassword, setHasPassword] = useState(false)
  const [newPasswordOnce, setNewPasswordOnce] = useState('')

  const [status, setStatus] = useState(null)

  const [deployHost, setDeployHost] = useState('')
  const [deployUser, setDeployUser] = useState('root')
  const [deploySshPort, setDeploySshPort] = useState(22)
  const [deployRemoteDir, setDeployRemoteDir] = useState('/opt/atolla-remote-relay')
  const [deployListenPort, setDeployListenPort] = useState(3080)
  const [deploySitePassword, setDeploySitePassword] = useState('')

  /** 拉取配置与运行状态 */
  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const [cfgRes, stRes] = await Promise.all([
        fetch(`${API}/admin/remote-relay/config`, { headers: authHeaders() }),
        fetch(`${API}/admin/remote-relay/status`, { headers: authHeaders() }),
      ])
      if (cfgRes.status === 401 || stRes.status === 401) {
        onUnauthorized?.()
        return
      }
      const cfg = await cfgRes.json().catch(() => ({}))
      const st = await stRes.json().catch(() => ({}))
      if (!cfgRes.ok) throw new Error(cfg.error || '加载配置失败')
      setEnabled(!!cfg.enabled)
      setBaseUrl(cfg.base_url || '')
      setDisplayName(cfg.display_name || '')
      setInstanceId(cfg.instance_id || '')
      setHasPassword(!!cfg.has_password)
      setStatus(stRes.ok ? st : null)
      if (!stRes.ok) setErr(st.error || '加载状态失败')
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }, [authHeaders, onUnauthorized])

  useEffect(() => {
    if (active) load()
  }, [active, load])

  /** 保存 Mac 侧中继配置 */
  async function saveConfig(e) {
    e?.preventDefault?.()
    if (busy) return
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const res = await fetch(`${API}/admin/remote-relay/config`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          enabled,
          base_url: baseUrl.trim(),
          display_name: displayName.trim(),
          instance_id: instanceId.trim(),
        }),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || '保存失败')
      setEnabled(!!d.enabled)
      setBaseUrl(d.base_url || '')
      setDisplayName(d.display_name || '')
      setInstanceId(d.instance_id || '')
      setHasPassword(!!d.has_password)
      setMsg('配置已保存，桥接已重载')
      await load()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  /** 轮换 6 位实例密码（仅本次展示明文） */
  async function rotatePassword() {
    if (busy) return
    if (!window.confirm('轮换密码后需在手机端重新绑定实例，确定继续？')) return
    setBusy(true)
    setErr('')
    setMsg('')
    setNewPasswordOnce('')
    try {
      const res = await fetch(`${API}/admin/remote-relay/password/rotate`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || '轮换失败')
      setNewPasswordOnce(d.password || '')
      setHasPassword(true)
      setMsg('新密码已生成，请立即复制保存（仅显示一次）')
      await load()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  /** 复制文本到剪贴板 */
  async function copyText(t) {
    try {
      await navigator.clipboard.writeText(t)
      setMsg('已复制到剪贴板')
    } catch {
      setErr('复制失败，请手动选择复制')
    }
  }

  const installCommand = useMemo(() => {
    const host = deployHost.trim()
    const user = deployUser.trim() || 'root'
    const sshPort = Number(deploySshPort) || 22
    const remoteDir = deployRemoteDir.trim() || '/opt/atolla-remote-relay'
    const listenPort = Number(deployListenPort) || 3080
    const pwd = deploySitePassword.replace(/'/g, `'\\''`)
    if (!host || !deploySitePassword.trim()) return ''
    return `./remote-relay/deploy/install.sh --host ${host} --user ${user} --ssh-port ${sshPort} --remote-dir ${remoteDir} --port ${listenPort} --site-password '${pwd}'`
  }, [deployHost, deployUser, deploySshPort, deployRemoteDir, deployListenPort, deploySitePassword])

  function formatTime(iso) {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return String(iso)
    }
  }

  return (
    <section className="list">
      <div className="lm-shelf-head">
        <div>
          <h2>远程中继</h2>
          <p className="empty-hint">Mac 主动连服务器；配置 Base URL 与实例密码后可在手机只读查看任务与镜像</p>
        </div>
        <button type="button" className="ghost" disabled={loading || busy} onClick={load}>刷新</button>
      </div>

      {err && <pre className="error">{err}</pre>}
      {msg && <p className="empty-hint">{msg}</p>}
      {loading && !baseUrl && !instanceId && <p className="empty">加载中…</p>}

      <form className="tm-form-row" onSubmit={saveConfig} style={{ maxWidth: 640 }}>
        <label>
          <span>启用出站桥接</span>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        </label>
        <label>
          <span>中继 Base URL</span>
          <input
            type="url"
            placeholder="https://relay.example.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <label>
          <span>显示名称</span>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label>
          <span>实例 ID</span>
          <input type="text" value={instanceId} onChange={(e) => setInstanceId(e.target.value)} />
        </label>
        <p className="empty-hint">
          实例密码：
          {hasPassword ? ' 已设置（不明文回显）' : ' 未设置，请轮换生成'}
          {' · '}
          <button type="button" className="ghost" disabled={busy} onClick={rotatePassword}>轮换密码</button>
        </p>
        {newPasswordOnce && (
          <div className="version-card" style={{ padding: 12 }}>
            <strong>新实例密码（仅显示一次）：</strong>
            <code style={{ marginLeft: 8 }}>{newPasswordOnce}</code>
            <button type="button" className="ghost" style={{ marginLeft: 8 }} onClick={() => copyText(newPasswordOnce)}>复制</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="submit" className="primary" disabled={busy}>保存配置</button>
        </div>
      </form>

      <article className="version-card">
        <div className="version-head">
          <span className="version-tag">运行状态</span>
        </div>
        <ul>
          <li>桥接循环：{status?.running ? '运行中' : '未运行'}</li>
          <li>已注册：{status?.registered ? '是' : '否'}</li>
          <li>最近成功：{formatTime(status?.last_ok)}</li>
          <li>最近错误：{status?.last_error ? status.last_error : '—'}</li>
        </ul>
      </article>

      <article className="version-card">
        <div className="version-head">
          <span className="version-tag">服务器部署</span>
        </div>
        <p className="empty-hint">在本机仓库根目录执行（需 SSH 免密或交互登录）。脚本会 rsync、远端 build、安装 systemd 并 curl 健康检查。</p>
        <div className="tm-form-row" style={{ maxWidth: 640 }}>
          <label>
            <span>SSH 主机</span>
            <input type="text" placeholder="1.2.3.4" value={deployHost} onChange={(e) => setDeployHost(e.target.value)} />
          </label>
          <label>
            <span>SSH 用户</span>
            <input type="text" value={deployUser} onChange={(e) => setDeployUser(e.target.value)} />
          </label>
          <label>
            <span>SSH 端口</span>
            <input type="number" min={1} value={deploySshPort} onChange={(e) => setDeploySshPort(e.target.value)} />
          </label>
          <label>
            <span>远端目录</span>
            <input type="text" value={deployRemoteDir} onChange={(e) => setDeployRemoteDir(e.target.value)} />
          </label>
          <label>
            <span>监听端口</span>
            <input type="number" min={1} value={deployListenPort} onChange={(e) => setDeployListenPort(e.target.value)} />
          </label>
          <label>
            <span>门禁密码 SITE_PASSWORD</span>
            <input type="password" autoComplete="new-password" value={deploySitePassword} onChange={(e) => setDeploySitePassword(e.target.value)} />
          </label>
        </div>
        {installCommand ? (
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginTop: 8 }}>{installCommand}</pre>
        ) : (
          <p className="empty-hint">填写 SSH 主机与门禁密码后生成命令</p>
        )}
        {installCommand && (
          <button type="button" className="ghost" onClick={() => copyText(installCommand)}>复制部署命令</button>
        )}
      </article>
    </section>
  )
}
