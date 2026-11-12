import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  clearToken,
  confirmNotifyBarkVerify,
  fetchJevosSettings,
  fetchNotifyPrefs,
  installJevos,
  sendNotifyBarkVerify,
  setJevosEnabled,
  uninstallJevos,
  updateNotifyPrefs,
  type JevosSettings,
  type NotifyPrefs,
} from '../api'
import { PageShell } from '../components/PageShell'
import { useUnlockHeartbeat } from '../hooks/useUnlockHeartbeat'
import { useLocale } from '../i18n/useLocale'

/** 实例内设置：通知 + JEV（数字人对话相关，与全局「中继/版本」分离） */
export function InstanceSettingsPage() {
  const { instanceId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useLocale()
  useUnlockHeartbeat(instanceId || undefined)
  const fromSettings = searchParams.get('from') === 'settings'

  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null)
  const [prefsBusy, setPrefsBusy] = useState(false)
  /** 未验证时点开开关，暂存待开启项 */
  const [pendingPref, setPendingPref] = useState<keyof NotifyPrefs | null>(null)
  const [otpCode, setOtpCode] = useState('')
  const [otpBusy, setOtpBusy] = useState(false)
  const [otpCooldown, setOtpCooldown] = useState(0)
  const [jev, setJev] = useState<JevosSettings | null>(null)
  const [jevBusy, setJevBusy] = useState(false)
  const [pick, setPick] = useState('')
	const [chinaMirror, setChinaMirror] = useState(false)
	const [jevSlow, setJevSlow] = useState(false)
	const [installFailed, setInstallFailed] = useState(false)
	const slowTimerRef = useRef<number | null>(null)
  /** 点击「安装」后再展开下载列表 */
  const [showPkgList, setShowPkgList] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  /** 401/403 时退回 */
  function handleAuth(e: unknown) {
    const status = (e as { status?: number })?.status
    const msg = e instanceof Error ? e.message : ''
    if (msg.includes('Unauthorized') || status === 401) {
      clearToken()
      navigate('/login', { replace: true })
      return true
    }
    if (status === 403 || msg.includes('实例密码')) {
      navigate('/instances', { replace: true })
      return true
    }
    return false
  }

  const load = useCallback(async () => {
    if (!instanceId) return
    setErr(null)
    try {
      const [p, j] = await Promise.all([
        fetchNotifyPrefs(instanceId),
        fetchJevosSettings(instanceId, { force: true }),
      ])
      setPrefs(p)
      setJev(j)
      if (!pick) {
        const rec = (j.packages || []).find((x) => x.recommended)
        setPick(rec?.id || j.packages?.[0]?.id || '')
      }
    } catch (e) {
      if (!handleAuth(e)) setErr(e instanceof Error ? e.message : '加载失败')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  useEffect(() => {
    void load()
  }, [load])

	useEffect(() => () => {
	  if (slowTimerRef.current != null) window.clearTimeout(slowTimerRef.current)
	}, [])

  useEffect(() => {
    if (otpCooldown <= 0) return undefined
    const t = window.setTimeout(() => setOtpCooldown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [otpCooldown])

  /** 关闭直接保存；开启且未验证则进入验码。 */
  async function togglePref(key: 'task_done' | 'permission', next: boolean) {
    if (!prefs || !instanceId || prefsBusy || otpBusy) return
    if (next && !prefs.bark_verified) {
      setPendingPref(key)
      setOtpCode('')
      setErr(null)
      return
    }
    const prev = prefs
    const body = { ...prefs, [key]: next }
    setPrefs(body)
    setPrefsBusy(true)
    setErr(null)
    try {
      setPrefs(await updateNotifyPrefs(instanceId, body))
      setPendingPref(null)
    } catch (e) {
      setPrefs(prev)
      if (!handleAuth(e)) setErr(e instanceof Error ? e.message : '保存通知失败')
    } finally {
      setPrefsBusy(false)
    }
  }

  /** 发送 Bark 验证码 */
  async function onSendBarkOtp() {
    if (!instanceId || otpBusy || otpCooldown > 0) return
    setOtpBusy(true)
    setErr(null)
    try {
      await sendNotifyBarkVerify(instanceId)
      setOtpCooldown(60)
    } catch (e) {
      if (!handleAuth(e)) setErr(e instanceof Error ? e.message : '发送失败')
    } finally {
      setOtpBusy(false)
    }
  }

  /** 校验验证码并开启待定开关 */
  async function onConfirmBarkOtp() {
    if (!prefs || !instanceId || otpBusy) return
    const code = otpCode.trim()
    if (!/^\d{6}$/.test(code)) {
      setErr('请输入 6 位验证码')
      return
    }
    setOtpBusy(true)
    setErr(null)
    try {
      let next = await confirmNotifyBarkVerify(instanceId, code)
      setPrefs(next)
      const key = pendingPref
      setPendingPref(null)
      setOtpCode('')
      if (key === 'task_done' || key === 'permission') {
        next = await updateNotifyPrefs(instanceId, { ...next, [key]: true })
        setPrefs(next)
      }
    } catch (e) {
      if (!handleAuth(e)) setErr(e instanceof Error ? e.message : '验证失败')
    } finally {
      setOtpBusy(false)
    }
  }

  /** JEV 胶囊 */
  async function toggleJev(next: boolean) {
    if (!instanceId || jevBusy) return
    const prev = jev
    setJev(prev ? { ...prev, enabled: next } : prev)
    setJevBusy(true)
    setErr(null)
    setOkMsg(null)
    try {
      const st = await setJevosEnabled(instanceId, next)
      setJev(st)
      setOkMsg(next ? 'JEV 已开启' : 'JEV 已关闭')
    } catch (e) {
      setJev(prev)
      if (!handleAuth(e)) setErr(e instanceof Error ? e.message : 'JEV 开关失败')
    } finally {
      setJevBusy(false)
    }
  }

  /** 下载安装（在电脑本机执行，可能较久） */
  async function onInstall() {
    if (!instanceId || !pick || jevBusy) return
    setJevBusy(true)
    setErr(null)
    setOkMsg('正在电脑上下载安装（约 600MB），请保持电脑在线…')
	setJevSlow(false)
	setInstallFailed(false)
	slowTimerRef.current = window.setTimeout(() => setJevSlow(true), 120_000)
    try {
	  const st = await installJevos(instanceId, pick, chinaMirror)
      setJev(st)
      setShowPkgList(false)
      setOkMsg('安装完成，请打开上方胶囊启用')
    } catch (e) {
      if (!handleAuth(e)) setErr(e instanceof Error ? e.message : '安装失败')
	  setInstallFailed(true)
      setOkMsg(null)
    } finally {
	  if (slowTimerRef.current != null) window.clearTimeout(slowTimerRef.current)
	  slowTimerRef.current = null
	  setJevSlow(false)
      setJevBusy(false)
    }
  }

  /** 卸载平台安装的 JEV */
  async function onUninstall() {
    if (!instanceId || jevBusy) return
    if (!window.confirm('确认卸载电脑上的平台 JEV？将停止常驻并归档安装目录。')) return
    setJevBusy(true)
    setErr(null)
    setOkMsg('正在卸载…')
    try {
      const st = await uninstallJevos(instanceId)
      setJev(st)
      setShowPkgList(false)
      setOkMsg(st.detail || '已卸载')
    } catch (e) {
      if (!handleAuth(e)) setErr(e instanceof Error ? e.message : '卸载失败')
      setOkMsg(null)
    } finally {
      setJevBusy(false)
    }
  }

  const canCapsule = !!(jev?.installed || jev?.healthy)
  /** Prefer agents list over removed「功能」hub */
  const agentsPath = `/instances/${encodeURIComponent(instanceId)}/agents`
  const backTo = fromSettings ? '/settings/preferences' : agentsPath

  return (
    <PageShell title={t('instance.settings')} backTo={backTo}>
      {err ? <p className="error-banner">{err}</p> : null}
      {okMsg ? <p className="ok-banner">{okMsg}</p> : null}
	  {jevSlow ? (
		<p
		  style={{
			margin: '0 0 12px',
			padding: '10px 12px',
			border: '1px solid #e8c784',
			borderRadius: 12,
			background: '#fff8e8',
			color: '#8a5a12',
			fontSize: 13,
			lineHeight: 1.5,
		  }}
		>
		  安装已超过 2 分钟，大模型仍在下载。可继续等待；若最终超时，开启镜像源后重试。
		</p>
	  ) : null}

      <h2 className="settings-section-title">{t('settings.notify')}</h2>
      <div className="settings-block">
        <label className="settings-row settings-toggle-row">
          <span>
            <span className="settings-label">{t('settings.notify.taskDone')}</span>
          </span>
          <span className={`settings-switch${prefsBusy || otpBusy ? ' busy' : ''}`}>
            <input
              type="checkbox"
              checked={!!prefs?.task_done}
              disabled={prefsBusy || otpBusy || !prefs}
              onChange={(e) => void togglePref('task_done', e.target.checked)}
            />
            <span />
          </span>
        </label>
        <label className="settings-row settings-toggle-row">
          <span>
            <span className="settings-label">{t('settings.notify.permission')}</span>
          </span>
          <span className={`settings-switch${prefsBusy || otpBusy ? ' busy' : ''}`}>
            <input
              type="checkbox"
              checked={!!prefs?.permission}
              disabled={prefsBusy || otpBusy || !prefs}
              onChange={(e) => void togglePref('permission', e.target.checked)}
            />
            <span />
          </span>
        </label>
        {pendingPref && !prefs?.bark_verified ? (
          <div
            style={{
              marginTop: 12,
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder={t('settings.notify.code')}
              value={otpCode}
              disabled={otpBusy}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{
                width: 96,
                padding: '8px 10px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg, #fff)',
                color: 'inherit',
              }}
            />
            <button
              type="button"
              className="btn outline"
              disabled={otpBusy || otpCooldown > 0}
              onClick={() => void onSendBarkOtp()}
            >
              {otpCooldown > 0 ? `${otpCooldown}s` : t('settings.notify.send')}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={otpBusy || otpCode.length !== 6}
              onClick={() => void onConfirmBarkOtp()}
            >
              {t('settings.notify.confirm')}
            </button>
            <button
              type="button"
              className="btn outline"
              disabled={otpBusy}
              onClick={() => {
                setPendingPref(null)
                setOtpCode('')
                setErr(null)
              }}
            >
              {t('settings.notify.cancel')}
            </button>
          </div>
        ) : null}
      </div>

      <h2 className="settings-section-title">JEV</h2>
      <p className="settings-section-hint">
        本机 AI 风险审核引擎。开启后数字人才可使用「自动审核」。安装在电脑端执行。
      </p>
      <div className="settings-block">
        <label className="settings-row settings-toggle-row">
          <span>
            <span className="settings-label">
              {jev?.enabled && jev?.healthy ? (
                <span className="engine-dot ok" style={{ marginRight: 8, verticalAlign: 'middle' }} />
              ) : null}
              JEV 常驻
            </span>
            <span className="settings-hint">{jev?.detail || '加载中…'}</span>
            {jev?.release_tag ? (
              <span className="settings-hint"> · {jev.release_tag}</span>
            ) : null}
          </span>
          {canCapsule ? (
            <span className={`settings-switch${jevBusy ? ' busy' : ''}`}>
              <input
                type="checkbox"
                checked={!!jev?.enabled}
                disabled={jevBusy || !jev}
                onChange={(e) => void toggleJev(e.target.checked)}
              />
              <span />
            </span>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={jevBusy}
              onClick={() => setShowPkgList(true)}
            >
              安装
            </button>
          )}
        </label>

        {!jev?.installed && showPkgList ? (
          <div style={{ marginTop: 12 }}>
            <p className="settings-hint" style={{ marginBottom: 8 }}>
              选择平台包（运行时 + 模型约 620MB，由电脑下载）：
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(jev?.packages || []).map((p) => (
                <li key={p.id}>
                  <label
                    style={{
                      display: 'flex',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border:
                        pick === p.id
                          ? '1px solid var(--accent, #2f65f6)'
                          : '1px solid var(--border)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="jev-pkg"
                      checked={pick === p.id}
                      disabled={jevBusy}
                      onChange={() => setPick(p.id)}
                    />
                    <span>
                      <strong>{p.name}</strong>
                      {p.recommended ? <em style={{ marginLeft: 8, opacity: 0.7 }}>推荐</em> : null}
                      <br />
                      <span className="settings-hint">{p.size_hint || p.id}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
			<label
			  className="settings-row settings-toggle-row"
			  style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 12 }}
			>
			  <span>
				<span className="settings-label">中国大陆网络：使用镜像源</span>
				<span className="settings-hint">优先从 GitHub 镜像下载，失败时自动回退官方源</span>
			  </span>
			  <span className={`settings-switch${jevBusy ? ' busy' : ''}`}>
				<input
				  type="checkbox"
				  checked={chinaMirror}
				  disabled={jevBusy}
				  onChange={(e) => setChinaMirror(e.target.checked)}
				/>
				<span />
			  </span>
			</label>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn primary"
                disabled={jevBusy || !pick}
                onClick={() => void onInstall()}
              >
				{jevBusy ? '安装中…' : installFailed ? '重试安装' : '下载并安装'}
              </button>
              <button
                type="button"
                className="btn outline"
                disabled={jevBusy}
                onClick={() => setShowPkgList(false)}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn outline" disabled={jevBusy} onClick={() => void load()}>
            重新检测
          </button>
          {jev?.installed ? (
            <button
              type="button"
              className="btn outline"
              disabled={jevBusy}
              onClick={() => setShowPkgList(true)}
            >
              重新安装
            </button>
          ) : null}
          {jev?.can_uninstall || jev?.installed ? (
            <button type="button" className="btn outline" disabled={jevBusy} onClick={() => void onUninstall()}>
              卸载
            </button>
          ) : null}
        </div>

        {jev?.installed && showPkgList ? (
          <div style={{ marginTop: 12 }}>
            <p className="settings-hint" style={{ marginBottom: 8 }}>
              选择平台包以重新安装：
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(jev?.packages || []).map((p) => (
                <li key={p.id}>
                  <label
                    style={{
                      display: 'flex',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border:
                        pick === p.id
                          ? '1px solid var(--accent, #2f65f6)'
                          : '1px solid var(--border)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="jev-pkg-re"
                      checked={pick === p.id}
                      disabled={jevBusy}
                      onChange={() => setPick(p.id)}
                    />
                    <span>
                      <strong>{p.name}</strong>
                      {p.recommended ? <em style={{ marginLeft: 8, opacity: 0.7 }}>推荐</em> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
			<label
			  className="settings-row settings-toggle-row"
			  style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 12 }}
			>
			  <span>
				<span className="settings-label">中国大陆网络：使用镜像源</span>
				<span className="settings-hint">优先从 GitHub 镜像下载，失败时自动回退官方源</span>
			  </span>
			  <span className={`settings-switch${jevBusy ? ' busy' : ''}`}>
				<input
				  type="checkbox"
				  checked={chinaMirror}
				  disabled={jevBusy}
				  onChange={(e) => setChinaMirror(e.target.checked)}
				/>
				<span />
			  </span>
			</label>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn primary"
                disabled={jevBusy || !pick}
                onClick={() => void onInstall()}
              >
				{jevBusy ? '安装中…' : installFailed ? '重试安装' : '下载并安装'}
              </button>
              <button
                type="button"
                className="btn outline"
                disabled={jevBusy}
                onClick={() => setShowPkgList(false)}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </PageShell>
  )
}
