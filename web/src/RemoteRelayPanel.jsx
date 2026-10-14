import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const API = '/api'
const PW_SESSION_KEY = 'atolla_relay_instance_password_once'

/** Bash 单引号包裹（等价于常见 shell 参数转义，避免空格/元字符破坏命令） */
function shellSingleQuote(value) {
  const s = String(value)
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** 眼睛图标：切换密码可见性 */
function EyeIcon({ open }) {
  if (open) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path d="M3 3l18 18" />
        <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
        <path d="M9.9 5.1A10.5 10.5 0 0 1 12 5c5 0 9.3 3.1 11 7.5a11.8 11.8 0 0 1-4.2 5.1" />
        <path d="M6.1 6.1A11.8 11.8 0 0 0 1 12.5C2.7 16.9 7 20 12 20c1.2 0 2.4-.2 3.5-.6" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M1 12.5C2.7 8.1 7 5 12 5s9.3 3.1 11 7.5c-1.7 4.4-6 7.5-11 7.5S2.7 16.9 1 12.5Z" />
      <circle cx="12" cy="12.5" r="3" />
    </svg>
  )
}

/** 桥接运行态：绿呼吸 / 灰未连接 / 红错误 */
function BridgeRunDot({ running, hasError }) {
  let cls = 'rr-dot offline'
  let label = '未连接'
  if (hasError) {
    cls = 'rr-dot error'
    label = '错误'
  } else if (running) {
    cls = 'rr-dot running'
    label = '运行中'
  }
  return (
    <span className="rr-run-pill">
      <span className={cls} aria-hidden />
      <span>{label}</span>
    </span>
  )
}

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
  const [newPasswordOnce, setNewPasswordOnce] = useState(() => {
    try {
      return sessionStorage.getItem(PW_SESSION_KEY) || ''
    } catch {
      return ''
    }
  })
  const [passwordVisible, setPasswordVisible] = useState(false)

  const [status, setStatus] = useState(null)

  const [deployHost, setDeployHost] = useState('')
  const [deployUser, setDeployUser] = useState('root')
  const [deploySshPort, setDeploySshPort] = useState(22)
  const [deployRemoteDir, setDeployRemoteDir] = useState('/opt/atolla-remote-relay')
  const [deployListenPort, setDeployListenPort] = useState(3080)
  const [deploySitePassword, setDeploySitePassword] = useState('')
  const [deployChinaMirror, setDeployChinaMirror] = useState(false)
  const [jobRunning, setJobRunning] = useState(false)
  const [jobKind, setJobKind] = useState('')
  const [jobLogs, setJobLogs] = useState([])
  const [jobStatus, setJobStatus] = useState('') // '' | running | ok | error
  /** 点击部署/升级时弹出：云机 SSH 密码（不落盘，仅本次任务） */
  const [sshAuthOpen, setSshAuthOpen] = useState(false)
  const [sshAuthKind, setSshAuthKind] = useState('') // 'deploy' | 'upgrade'
  const [sshPasswordDraft, setSshPasswordDraft] = useState('')
  const logEndRef = useRef(null)
  const jobAbortRef = useRef(null)

  /** 记住本次会话内生成的明文密码（刷新页面仍可显示，关闭标签页清除） */
  function rememberPassword(plain) {
    const p = String(plain || '').trim()
    setNewPasswordOnce(p)
    setPasswordVisible(false)
    try {
      if (p) sessionStorage.setItem(PW_SESSION_KEY, p)
      else sessionStorage.removeItem(PW_SESSION_KEY)
    } catch {
      /* ignore */
    }
  }

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

  // 运行中时定期刷新状态（注册标记依赖心跳成功）
  useEffect(() => {
    if (!active) return undefined
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const stRes = await fetch(`${API}/admin/remote-relay/status`, { headers: authHeaders() })
          if (stRes.status === 401) {
            onUnauthorized?.()
            return
          }
          if (stRes.ok) setStatus(await stRes.json())
        } catch {
          /* ignore poll errors */
        }
      })()
    }, 5000)
    return () => window.clearInterval(id)
  }, [active, authHeaders, onUnauthorized])

  /** 仅保存本机连接参数并重载桥接（不会向中继注册密码） */
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
      setMsg(
        enabled
          ? '本机连接配置已保存，出站桥接已按新配置重载（未改动实例密码 / 未重新注册）。'
          : '本机连接配置已保存。出站桥接未启用；启用后请点击「生成并注册密码」或「轮换并重新注册」。',
      )
      await load()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  /** 首次生成并注册，或轮换 6 位实例密码 */
  async function rotatePassword() {
    if (busy) return
    if (!baseUrl.trim()) {
      setErr('请先填写中继 Base URL，并点击「保存连接配置」。')
      return
    }
    const first = !hasPassword
    const tip = first
      ? '将生成 6 位实例密码并注册到中继服务器，确定继续？'
      : '将生成新密码并重新注册到中继（旧密码立即失效），确定继续？'
    if (!window.confirm(tip)) return
    setBusy(true)
    setErr('')
    setMsg('')
    rememberPassword('')
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
      if (!res.ok) throw new Error(d.error || '操作失败')
      rememberPassword(d.password || '')
      setHasPassword(true)
      setMsg(
        first
          ? '密码已生成并完成中继注册。请确认已勾选「启用出站桥接」并已「保存连接配置」。'
          : '新密码已生成并重新注册到中继。',
      )
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
    if (!host || !deploySitePassword.trim()) return ''
    const china = deployChinaMirror ? ' --china-mirror' : ''
    return `./remote-relay/deploy/install.sh --host ${shellSingleQuote(host)} --user ${shellSingleQuote(user)} --ssh-port ${sshPort} --remote-dir ${shellSingleQuote(remoteDir)} --port ${listenPort} --site-password ${shellSingleQuote(deploySitePassword)}${china}`
  }, [deployHost, deployUser, deploySshPort, deployRemoteDir, deployListenPort, deploySitePassword, deployChinaMirror])

  /** 一键升级：不需要门禁密码，保留远端 env */
  const upgradeCommand = useMemo(() => {
    const host = deployHost.trim()
    const user = deployUser.trim() || 'root'
    const sshPort = Number(deploySshPort) || 22
    const remoteDir = deployRemoteDir.trim() || '/opt/atolla-remote-relay'
    if (!host) return ''
    const china = deployChinaMirror ? ' --china-mirror' : ''
    return `./remote-relay/deploy/upgrade.sh --host ${shellSingleQuote(host)} --user ${shellSingleQuote(user)} --ssh-port ${sshPort} --remote-dir ${shellSingleQuote(remoteDir)}${china}`
  }, [deployHost, deployUser, deploySshPort, deployRemoteDir, deployChinaMirror])

  useEffect(() => {
    logEndRef.current?.scrollIntoView?.({ block: 'end' })
  }, [jobLogs])

  /** 订阅部署/升级任务 SSE 日志 */
  async function streamDeployJob(jobId) {
    jobAbortRef.current?.abort?.()
    const ac = new AbortController()
    jobAbortRef.current = ac
    const res = await fetch(`${API}/admin/remote-relay/deploy-job/${encodeURIComponent(jobId)}/stream`, {
      headers: authHeaders(),
      signal: ac.signal,
    })
    if (res.status === 401) {
      onUnauthorized?.()
      throw new Error('Unauthorized')
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || `stream failed (${res.status})`)
    }
    const reader = res.body?.getReader()
    if (!reader) throw new Error('no response body')
    const decoder = new TextDecoder()
    let buf = ''
    let terminal = null
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      while (true) {
        const idx = buf.indexOf('\n\n')
        if (idx < 0) break
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const evLine = block.split('\n').find((l) => l.startsWith('event:'))
        const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
        if (!evLine || !dataLine) continue
        const ev = evLine.slice(6).trim()
        let data = {}
        try {
          data = JSON.parse(dataLine.slice(5).trim())
        } catch {
          continue
        }
        if (ev === 'log' && data.line != null) {
          setJobLogs((prev) => [...prev, String(data.line)])
        } else if (ev === 'done') {
          terminal = 'ok'
        } else if (ev === 'error') {
          terminal = 'error'
          if (data.error) setJobLogs((prev) => [...prev, `ERROR: ${data.error}`])
        }
      }
      if (terminal) break
    }
    return terminal || 'error'
  }

  /** 打开 SSH 密码确认框（空密码则走本机密钥 BatchMode） */
  function openSshAuth(kind) {
    if (jobRunning) return
    const host = deployHost.trim()
    if (kind === 'deploy') {
      if (!host || !deploySitePassword.trim()) {
        setErr('一键部署需要填写 SSH 主机与门禁密码')
        return
      }
    } else if (!host) {
      setErr('一键升级需要填写 SSH 主机')
      return
    }
    setErr('')
    setSshAuthKind(kind)
    setSshPasswordDraft('')
    setSshAuthOpen(true)
  }

  function closeSshAuth() {
    if (jobRunning) return
    setSshAuthOpen(false)
    setSshAuthKind('')
    setSshPasswordDraft('')
  }

  /** 确认密码后启动一键部署/升级 */
  function confirmSshAuth(e) {
    e?.preventDefault?.()
    const kind = sshAuthKind
    const sshPassword = sshPasswordDraft
    setSshAuthOpen(false)
    setSshAuthKind('')
    setSshPasswordDraft('')
    if (kind === 'deploy') void runDeploy(sshPassword)
    else if (kind === 'upgrade') void runUpgrade(sshPassword)
  }

  /** 一键部署（本机 Atolla 跑 install.sh；可传云机 SSH 密码） */
  async function runDeploy(sshPassword = '') {
    if (jobRunning) return
    const host = deployHost.trim()
    if (!host || !deploySitePassword.trim()) {
      setErr('一键部署需要填写 SSH 主机与门禁密码')
      return
    }
    setErr('')
    setMsg('')
    setJobKind('deploy')
    setJobLogs([])
    setJobStatus('running')
    setJobRunning(true)
    try {
      const res = await fetch(`${API}/admin/remote-relay/deploy`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          host,
          user: deployUser.trim() || 'root',
          ssh_port: Number(deploySshPort) || 22,
          remote_dir: deployRemoteDir.trim() || '/opt/atolla-remote-relay',
          listen_port: Number(deployListenPort) || 3080,
          site_password: deploySitePassword,
          ssh_password: String(sshPassword || ''),
          china_mirror: !!deployChinaMirror,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      if (!res.ok) throw new Error(d.error || `启动部署失败(${res.status})`)
      const result = await streamDeployJob(d.job_id)
      setJobStatus(result)
      setMsg(result === 'ok' ? '部署完成' : '部署失败，见下方日志')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setJobStatus('error')
      setErr(String(e.message || e))
      setJobLogs((prev) => [...prev, `ERROR: ${e.message || e}`])
    } finally {
      setJobRunning(false)
    }
  }

  /** 一键升级（本机 Atolla 跑 upgrade.sh；可传云机 SSH 密码） */
  async function runUpgrade(sshPassword = '') {
    if (jobRunning) return
    const host = deployHost.trim()
    if (!host) {
      setErr('一键升级需要填写 SSH 主机')
      return
    }
    setErr('')
    setMsg('')
    setJobKind('upgrade')
    setJobLogs([])
    setJobStatus('running')
    setJobRunning(true)
    try {
      const res = await fetch(`${API}/admin/remote-relay/upgrade`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          host,
          user: deployUser.trim() || 'root',
          ssh_port: Number(deploySshPort) || 22,
          remote_dir: deployRemoteDir.trim() || '/opt/atolla-remote-relay',
          ssh_password: String(sshPassword || ''),
          china_mirror: !!deployChinaMirror,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      if (!res.ok) throw new Error(d.error || `启动升级失败(${res.status})`)
      const result = await streamDeployJob(d.job_id)
      setJobStatus(result)
      setMsg(result === 'ok' ? '升级完成' : '升级失败，见下方日志')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setJobStatus('error')
      setErr(String(e.message || e))
      setJobLogs((prev) => [...prev, `ERROR: ${e.message || e}`])
    } finally {
      setJobRunning(false)
    }
  }

  function formatTime(iso) {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return String(iso)
    }
  }

  const running = !!status?.running
  const registered = !!status?.registered
  const lastError = String(status?.last_error || '').trim()
  const hasError = Boolean(lastError) && !running

  return (
    <section className="list rr-panel">
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

        <div className="rr-password-block">
          <div className="rr-password-head">
            <span>实例密码</span>
            <span className={`rr-reg-tag ${hasPassword ? 'set' : 'unset'}`}>
              {hasPassword ? '本机已保存' : '本机未设置'}
            </span>
          </div>
          {newPasswordOnce ? (
            <div className="rr-password-row">
              <code className="rr-password-mask">
                {passwordVisible ? newPasswordOnce : '******'}
              </code>
              <button
                type="button"
                className="ghost rr-eye-btn"
                title={passwordVisible ? '隐藏密码' : '显示密码'}
                aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
                onClick={() => setPasswordVisible((v) => !v)}
              >
                <EyeIcon open={passwordVisible} />
              </button>
              <button type="button" className="ghost" onClick={() => copyText(newPasswordOnce)}>
                复制
              </button>
            </div>
          ) : (
            <p className="empty-hint" style={{ margin: '6px 0 0' }}>
              {hasPassword
                ? '明文仅在生成/轮换后展示；可再次轮换以得到新密码。'
                : '尚未生成。请先保存连接配置，再点击下方按钮注册到中继。'}
            </p>
          )}
          <div className="rr-password-actions">
            <button type="button" className="ghost" disabled={busy || !baseUrl.trim()} onClick={rotatePassword}>
              {hasPassword ? '轮换并重新注册' : '生成并注册密码'}
            </button>
          </div>
        </div>

        <p className="empty-hint">
          推荐流程：填写 Base URL →「保存连接配置」→「生成并注册密码」→ 勾选启用并再次保存（若尚未启用）。
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="submit" className="primary" disabled={busy}>
            保存连接配置
          </button>
          <span className="empty-hint" style={{ margin: 0 }}>
            仅写入本机并重载桥接，不会注册/轮换密码
          </span>
        </div>
      </form>

      <article className="version-card rr-status-card">
        <div className="version-head">
          <span className="version-tag">运行状态</span>
        </div>
        <ul className="rr-status-list">
          <li>
            <span className="rr-status-label">桥接循环</span>
            <BridgeRunDot running={running} hasError={hasError || Boolean(lastError && running === false && enabled)} />
          </li>
          <li>
            <span className="rr-status-label">中继注册</span>
            {registered ? (
              <span className="rr-reg-tag on">已注册</span>
            ) : (
              <span className="rr-reg-tag off">未注册</span>
            )}
          </li>
          <li>
            <span className="rr-status-label">最近成功</span>
            <span>{formatTime(status?.last_ok)}</span>
          </li>
          <li>
            <span className="rr-status-label">最近错误</span>
            <span className={lastError ? 'rr-err-text' : ''}>{lastError || '—'}</span>
          </li>
        </ul>
      </article>

      <article className="version-card">
        <div className="version-head">
          <span className="version-tag">服务器部署</span>
        </div>
        <p className="empty-hint">
          由本机 Atolla 直接跑脚本并实时出日志。点击部署/升级时会询问云机 <strong>SSH 密码</strong>（也可留空，改用本机已配置的 SSH 密钥）。
          也可复制命令到终端手动执行。
        </p>
        <div className="tm-form-row" style={{ maxWidth: 640 }}>
          <label>
            <span>SSH 主机</span>
            <input type="text" placeholder="1.2.3.4" value={deployHost} onChange={(e) => setDeployHost(e.target.value)} disabled={jobRunning} />
          </label>
          <label>
            <span>SSH 用户</span>
            <input type="text" value={deployUser} onChange={(e) => setDeployUser(e.target.value)} disabled={jobRunning} />
          </label>
          <label>
            <span>SSH 端口</span>
            <input type="number" min={1} value={deploySshPort} onChange={(e) => setDeploySshPort(e.target.value)} disabled={jobRunning} />
          </label>
          <label>
            <span>远端目录</span>
            <input type="text" value={deployRemoteDir} onChange={(e) => setDeployRemoteDir(e.target.value)} disabled={jobRunning} />
          </label>
          <label>
            <span>监听端口（仅首次部署）</span>
            <input type="number" min={1} value={deployListenPort} onChange={(e) => setDeployListenPort(e.target.value)} disabled={jobRunning} />
          </label>
          <label>
            <span>门禁密码 SITE_PASSWORD（仅首次部署）</span>
            <input type="password" autoComplete="new-password" value={deploySitePassword} onChange={(e) => setDeploySitePassword(e.target.value)} disabled={jobRunning} />
          </label>
          <label>
            <span>China-mirror</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <input
                type="checkbox"
                checked={deployChinaMirror}
                disabled={jobRunning}
                onChange={(e) => setDeployChinaMirror(e.target.checked)}
              />
              <span className="empty-hint" style={{ margin: 0 }}>
                国内 npmmirror 加速
              </span>
            </span>
          </label>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="primary"
            disabled={jobRunning || !deployHost.trim() || !deploySitePassword.trim()}
            onClick={() => openSshAuth('deploy')}
          >
            {jobRunning && jobKind === 'deploy' ? '部署中…' : '一键部署'}
          </button>
          <button
            type="button"
            className="primary"
            disabled={jobRunning || !deployHost.trim()}
            onClick={() => openSshAuth('upgrade')}
          >
            {jobRunning && jobKind === 'upgrade' ? '升级中…' : '一键升级'}
          </button>
          {installCommand && (
            <button type="button" className="ghost" disabled={jobRunning} onClick={() => copyText(installCommand)}>
              复制部署命令
            </button>
          )}
          {upgradeCommand && (
            <button type="button" className="ghost" disabled={jobRunning} onClick={() => copyText(upgradeCommand)}>
              复制升级命令
            </button>
          )}
        </div>
        <p className="empty-hint" style={{ marginTop: 8 }}>
          升级会保留云上的门禁密码 / JWT / 端口；首次部署才写入门禁密码。
        </p>
      </article>

      <article className="version-card">
        <div className="version-head">
          <span className="version-tag">部署进度</span>
          {jobStatus === 'running' && <span className="empty-hint">进行中（{jobKind || '…'}）</span>}
          {jobStatus === 'ok' && <span style={{ color: '#16a34a' }}>成功</span>}
          {jobStatus === 'error' && <span style={{ color: '#dc2626' }}>失败</span>}
        </div>
        <pre
          className="rr-deploy-log"
          style={{
            margin: 0,
            maxHeight: 320,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 12,
            lineHeight: 1.45,
            background: 'var(--surface, #0f172a)',
            color: 'var(--text, #e2e8f0)',
            padding: 12,
            borderRadius: 8,
          }}
        >
          {jobLogs.length === 0
            ? '点击「一键部署」或「一键升级」后，日志会显示在这里。'
            : jobLogs.join('\n')}
          <span ref={logEndRef} />
        </pre>
      </article>

      {sshAuthOpen && (
        <div className="modal-mask" onClick={closeSshAuth}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={confirmSshAuth}>
            <h2>{sshAuthKind === 'upgrade' ? '确认升级' : '确认部署'}</h2>
            <p className="empty-hint" style={{ margin: '0 0 12px' }}>
              输入云机 SSH 登录密码（{deployUser.trim() || 'root'}@{deployHost.trim()}）。留空则使用本机已配置的 SSH 密钥。
            </p>
            <label>
              <span>SSH 密码</span>
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                value={sshPasswordDraft}
                onChange={(e) => setSshPasswordDraft(e.target.value)}
                placeholder="可留空（密钥登录）"
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={closeSshAuth}>
                取消
              </button>
              <button type="submit">
                {sshAuthKind === 'upgrade' ? '开始升级' : '开始部署'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
