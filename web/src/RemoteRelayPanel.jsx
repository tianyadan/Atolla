import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const API = '/api'
const PW_SESSION_KEY = 'atolla_relay_instance_password_once'
const DEPLOY_HOST_HISTORY_KEY = 'atolla_relay_deploy_hosts'
const DEPLOY_HOST_HISTORY_MAX = 12

/** 读取部署/升级过的主机历史（新到旧） */
function loadDeployHostHistory() {
  try {
    const raw = localStorage.getItem(DEPLOY_HOST_HISTORY_KEY)
    const arr = JSON.parse(raw || '[]')
    return Array.isArray(arr) ? arr.map((x) => String(x || '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

/** 成功部署/升级后记住 SSH 主机，供 datalist 联想 */
function rememberDeployHost(host) {
  const h = String(host || '').trim()
  if (!h) return loadDeployHostHistory()
  const next = [h, ...loadDeployHostHistory().filter((x) => x !== h)].slice(0, DEPLOY_HOST_HISTORY_MAX)
  try {
    localStorage.setItem(DEPLOY_HOST_HISTORY_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}

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

/** 简易 iPhone 线稿（设备卡片装饰） */
function IPhoneSvg({ online }) {
  return (
    <svg width="36" height="56" viewBox="0 0 36 56" fill="none" aria-hidden className="rr-phone-svg">
      <rect x="2" y="1" width="32" height="54" rx="6" stroke="currentColor" strokeWidth="1.5" opacity="0.85" />
      <rect x="6" y="8" width="24" height="36" rx="1.5" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
      <circle cx="18" cy="49" r="2.2" stroke="currentColor" strokeWidth="1.2" opacity="0.7" />
      <circle cx="28" cy="6" r="2.5" fill={online ? '#22c55e' : '#ef4444'} className={online ? 'rr-phone-led on' : 'rr-phone-led off'} />
    </svg>
  )
}

/** 相对时间（入参为 epoch ms） */
function formatRelative(ms) {
  if (!ms) return '—'
  const n = Number(ms)
  const d = Date.now() - n
  if (d < 5_000) return '刚刚'
  if (d < 60_000) return `${Math.floor(d / 1000)} 秒前`
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`
  try {
    return new Date(n).toLocaleString()
  } catch {
    return String(ms)
  }
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

  /** SMTP：验证码登录发信（163 等） */
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState(465)
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpFrom, setSmtpFrom] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [hasSmtpPass, setHasSmtpPass] = useState(false)
  const [smtpOk, setSmtpOk] = useState(false)
  const [smtpBusy, setSmtpBusy] = useState(false)
  /** SMTP 校验失败原因（展示在 SMTP 区块旁，避免只滚到页顶才看见） */
  const [smtpErr, setSmtpErr] = useState('')

  const [status, setStatus] = useState(null)
  const [mobileSessions, setMobileSessions] = useState([])
  const [mobileErr, setMobileErr] = useState('')
  const [kickId, setKickId] = useState('')

  const [deployHost, setDeployHost] = useState('')
  const [deployHostHistory, setDeployHostHistory] = useState(() => loadDeployHostHistory())
  const [deployHostSuggestOpen, setDeployHostSuggestOpen] = useState(false)
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
      setSmtpHost(cfg.smtp_host || '')
      setSmtpPort(cfg.smtp_port > 0 ? cfg.smtp_port : 465)
      setSmtpUser(cfg.smtp_user || '')
      setSmtpFrom(cfg.smtp_from || '')
      setHasSmtpPass(!!cfg.has_smtp_password)
      setSmtpOk(!!cfg.smtp_ok)
      setSmtpPassword('')
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

  /** 拉取移动端解锁会话列表 */
  const loadMobileSessions = useCallback(async () => {
    setMobileErr('')
    try {
      const res = await fetch(`${API}/admin/remote-relay/mobile-sessions`, { headers: authHeaders() })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMobileSessions([])
        setMobileErr(d.error || `加载失败(${res.status})`)
        return
      }
      setMobileSessions(Array.isArray(d.sessions) ? d.sessions : [])
    } catch (e) {
      setMobileSessions([])
      setMobileErr(String(e.message || e))
    }
  }, [authHeaders, onUnauthorized])

  // 运行中时定期刷新状态（注册标记依赖心跳成功）+ 移动设备
  useEffect(() => {
    if (!active) return undefined
    void loadMobileSessions()
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
        void loadMobileSessions()
      })()
    }, 10000)
    return () => window.clearInterval(id)
  }, [active, authHeaders, onUnauthorized, loadMobileSessions])

  /** PC 踢下线某一移动解锁会话 */
  async function kickMobileSession(sessionId) {
    if (!sessionId || kickId) return
    if (!window.confirm('踢下线后该手机需重新输入 6 位实例密码，确定？')) return
    setKickId(sessionId)
    setErr('')
    try {
      const res = await fetch(
        `${API}/admin/remote-relay/mobile-sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE', headers: authHeaders() },
      )
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `踢下线失败(${res.status})`)
      setMsg('已踢下线该移动设备')
      await loadMobileSessions()
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setKickId('')
    }
  }

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
          smtp_host: smtpHost.trim(),
          smtp_port: Number(smtpPort) || 465,
          smtp_user: smtpUser.trim(),
          smtp_from: smtpFrom.trim(),
          ...(smtpPassword.trim() ? { smtp_password: smtpPassword.trim() } : {}),
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
      setSmtpHost(d.smtp_host || '')
      setSmtpPort(d.smtp_port > 0 ? d.smtp_port : 465)
      setSmtpUser(d.smtp_user || '')
      setSmtpFrom(d.smtp_from || '')
      setHasSmtpPass(!!d.has_smtp_password)
      setSmtpOk(!!d.smtp_ok)
      setSmtpPassword('')
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

  /** 校验 SMTP 并上报 smtp_ok（心跳会同步到中继） */
  async function testSmtp() {
    if (smtpBusy || busy) return
    setSmtpBusy(true)
    setErr('')
    setSmtpErr('')
    setMsg('')
    try {
      if (!smtpHost.trim() || !smtpUser.trim() || !smtpFrom.trim()) {
        throw new Error('请先填写 SMTP 主机、账号与发件人 From')
      }
      if (!smtpPassword.trim() && !hasSmtpPass) {
        throw new Error('请填写授权码/密码（首次校验必填）')
      }
      // 先保存再测，避免测的是旧配置
      const saveRes = await fetch(`${API}/admin/remote-relay/config`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          enabled,
          base_url: baseUrl.trim(),
          display_name: displayName.trim(),
          instance_id: instanceId.trim(),
          smtp_host: smtpHost.trim(),
          smtp_port: Number(smtpPort) || 465,
          smtp_user: smtpUser.trim(),
          smtp_from: smtpFrom.trim(),
          ...(smtpPassword.trim() ? { smtp_password: smtpPassword.trim() } : {}),
        }),
      })
      if (saveRes.status === 401) {
        onUnauthorized?.()
        return
      }
      const saved = await saveRes.json().catch(() => ({}))
      if (!saveRes.ok) throw new Error(saved.error || `保存 SMTP 失败(${saveRes.status})`)

      const res = await fetch(`${API}/admin/remote-relay/smtp/test`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          (typeof d.error === 'string' && d.error.trim()) ||
            `SMTP 校验失败(HTTP ${res.status})`,
        )
      }
      const cfg = d.config || {}
      setSmtpOk(!!cfg.smtp_ok)
      setHasSmtpPass(!!cfg.has_smtp_password)
      setSmtpPassword('')
      setSmtpErr('')
      setMsg('SMTP 校验通过，心跳将上报「验证码登录可用」。')
      await load()
    } catch (e) {
      setSmtpOk(false)
      const tip = String(e.message || e)
      setSmtpErr(tip)
      setErr(tip)
    } finally {
      setSmtpBusy(false)
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
      if (result === 'ok') setDeployHostHistory(rememberDeployHost(host))
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
      if (result === 'ok') setDeployHostHistory(rememberDeployHost(host))
    } catch (e) {
      if (e?.name === 'AbortError') return
      setJobStatus('error')
      setErr(String(e.message || e))
      setJobLogs((prev) => [...prev, `ERROR: ${e.message || e}`])
    } finally {
      setJobRunning(false)
    }
  }

  /** 主机输入联想：历史 IP/域名过滤 */
  const deployHostSuggestions = useMemo(() => {
    const q = deployHost.trim().toLowerCase()
    if (!q) return deployHostHistory
    return deployHostHistory.filter((h) => h.toLowerCase().includes(q))
  }, [deployHost, deployHostHistory])

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

        <div className="rr-password-block" style={{ marginTop: 16 }}>
          <div className="rr-password-head">
            <span>验证码登录 · 发送邮箱 SMTP</span>
            <span className={`rr-reg-tag ${smtpOk ? 'set' : 'unset'}`}>
              {smtpOk ? '已校验' : '未校验'}
            </span>
          </div>
          <p className="empty-hint" style={{ margin: '6px 0 10px' }}>
            配置 163 等 SMTP 后点「校验 SMTP」。手机需在设置填写接收邮箱，解锁弹窗才可「验证码登录」。
          </p>
          <label>
            <span>SMTP 主机</span>
            <input
              type="text"
              placeholder="smtp.163.com"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
            />
          </label>
          <label>
            <span>端口</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={smtpPort}
              onChange={(e) => setSmtpPort(Number(e.target.value) || 465)}
            />
          </label>
          <label>
            <span>账号</span>
            <input
              type="text"
              autoComplete="off"
              placeholder="you@163.com"
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
            />
          </label>
          <label>
            <span>授权码 / 密码</span>
            <input
              type="password"
              autoComplete="new-password"
              placeholder={hasSmtpPass ? '已保存，留空不修改' : '邮箱授权码'}
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
            />
          </label>
          <label>
            <span>发件人 From</span>
            <input
              type="email"
              placeholder="you@163.com"
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
            />
          </label>
          <div className="rr-password-actions">
            <button
              type="button"
              className="ghost"
              disabled={busy || smtpBusy || !smtpHost.trim() || !smtpUser.trim()}
              onClick={() => void testSmtp()}
            >
              {smtpBusy ? '校验中…' : '校验 SMTP'}
            </button>
          </div>
          {smtpErr ? (
            <pre className="error" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>
              {smtpErr}
            </pre>
          ) : null}
        </div>

        <p className="empty-hint">
          推荐流程：填写 Base URL →「保存连接配置」→「生成并注册密码」→ 勾选启用并再次保存（若尚未启用）。
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="submit" className="primary" disabled={busy || smtpBusy}>
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

      <article className="version-card rr-mobile-card">
        <div className="version-head">
          <span className="version-tag">移动端访问</span>
          <button type="button" className="ghost" disabled={busy || !!kickId} onClick={() => void loadMobileSessions()}>
            刷新
          </button>
        </div>
        <p className="empty-hint">
          绿点 = 约 90 秒内有心跳（页面打开中）；红点 = 离线但解锁会话可能仍有效（7 天内免再输密码）。踢下线立即作废。
        </p>
        {mobileErr ? <pre className="error" style={{ marginTop: 8 }}>{mobileErr}</pre> : null}
        {!mobileErr && mobileSessions.length === 0 ? (
          <p className="empty-hint" style={{ marginTop: 12 }}>暂无移动设备会话</p>
        ) : null}
        <div className="rr-mobile-grid">
          {mobileSessions.map((s) => {
            const online = !!s.online && !s.revoked
            return (
              <div key={s.session_id} className={`rr-mobile-device ${online ? 'online' : 'offline'}${s.revoked ? ' revoked' : ''}`}>
                <div className="rr-mobile-device-art">
                  <IPhoneSvg online={online} />
                </div>
                <div className="rr-mobile-device-body">
                  <div className="rr-mobile-device-title">
                    <strong>{s.device_label || 'Mobile'}</strong>
                    <span className={`rr-dot ${online ? 'running' : 'error'}`} title={online ? '在线' : '离线'} />
                    <span className="rr-mobile-device-state">{online ? '在线' : s.revoked ? '已注销' : '离线'}</span>
                  </div>
                  <ul className="rr-mobile-meta">
                    <li>
                      <span>IP</span>
                      <code>{s.client_ip || '—'}</code>
                    </li>
                    <li>
                      <span>最近活跃</span>
                      <span>{formatRelative(s.last_seen_at)}</span>
                    </li>
                    <li>
                      <span>过期</span>
                      <span>{s.expires_at ? new Date(s.expires_at).toLocaleString() : '—'}</span>
                    </li>
                    {s.user_agent ? (
                      <li className="rr-mobile-ua">
                        <span>UA</span>
                        <span title={s.user_agent}>{String(s.user_agent).slice(0, 72)}{String(s.user_agent).length > 72 ? '…' : ''}</span>
                      </li>
                    ) : null}
                  </ul>
                  {!s.revoked ? (
                    <button
                      type="button"
                      className="ghost rr-kick-btn"
                      disabled={!!kickId}
                      onClick={() => void kickMobileSession(s.session_id)}
                    >
                      {kickId === s.session_id ? '处理中…' : '踢下线'}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
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
            <div className="rr-host-suggest">
              <input
                type="text"
                placeholder="1.2.3.4（支持历史联想）"
                value={deployHost}
                list="rr-deploy-host-list"
                autoComplete="off"
                disabled={jobRunning}
                onChange={(e) => setDeployHost(e.target.value)}
                onFocus={() => setDeployHostSuggestOpen(true)}
                onBlur={() => window.setTimeout(() => setDeployHostSuggestOpen(false), 150)}
              />
              <datalist id="rr-deploy-host-list">
                {deployHostHistory.map((h) => (
                  <option key={h} value={h} />
                ))}
              </datalist>
              {deployHostSuggestOpen && deployHostSuggestions.length > 0 ? (
                <ul className="rr-host-suggest-menu" role="listbox">
                  {deployHostSuggestions.map((h) => (
                    <li key={h}>
                      <button
                        type="button"
                        className="rr-host-suggest-item"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setDeployHost(h)
                          setDeployHostSuggestOpen(false)
                        }}
                      >
                        {h}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
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
