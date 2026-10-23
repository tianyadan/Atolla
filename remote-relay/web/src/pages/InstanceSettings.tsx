import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  clearToken,
  fetchJevosSettings,
  fetchNotifyPrefs,
  installJevos,
  setJevosEnabled,
  updateNotifyPrefs,
  type JevosSettings,
  type NotifyPrefs,
} from '../api'
import { PageShell } from '../components/PageShell'
import { useUnlockHeartbeat } from '../hooks/useUnlockHeartbeat'

/** 实例内设置：通知 + JEV（数字人对话相关，与全局「中继/版本」分离） */
export function InstanceSettingsPage() {
  const { instanceId = '' } = useParams()
  const navigate = useNavigate()
  useUnlockHeartbeat(instanceId || undefined)

  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null)
  const [prefsBusy, setPrefsBusy] = useState(false)
  const [jev, setJev] = useState<JevosSettings | null>(null)
  const [jevBusy, setJevBusy] = useState(false)
  const [pick, setPick] = useState('')
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

  /** 切换通知开关 */
  async function togglePref(key: keyof NotifyPrefs, next: boolean) {
    if (!prefs || !instanceId || prefsBusy) return
    const prev = prefs
    const body = { ...prefs, [key]: next }
    setPrefs(body)
    setPrefsBusy(true)
    setErr(null)
    try {
      setPrefs(await updateNotifyPrefs(instanceId, body))
    } catch (e) {
      setPrefs(prev)
      if (!handleAuth(e)) setErr(e instanceof Error ? e.message : '保存通知失败')
    } finally {
      setPrefsBusy(false)
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
    try {
      const st = await installJevos(instanceId, pick)
      setJev(st)
      setShowPkgList(false)
      setOkMsg('安装完成，请打开上方胶囊启用')
    } catch (e) {
      if (!handleAuth(e)) setErr(e instanceof Error ? e.message : '安装失败')
      setOkMsg(null)
    } finally {
      setJevBusy(false)
    }
  }

  const canCapsule = !!(jev?.installed || jev?.healthy)
  const hub = `/instances/${encodeURIComponent(instanceId)}`

  return (
    <PageShell title="设置" backTo={hub}>
      {err ? <p className="error-banner">{err}</p> : null}
      {okMsg ? <p className="ok-banner">{okMsg}</p> : null}

      <h2 className="settings-section-title">通知</h2>
      <p className="settings-section-hint">与电脑端同一开关。离开对话后是否推送到手机。</p>
      <div className="settings-block">
        <label className="settings-row settings-toggle-row">
          <span>
            <span className="settings-label">完成通知</span>
            <span className="settings-hint">任务结束且两端都没看对话时推送</span>
          </span>
          <span className={`settings-switch${prefsBusy ? ' busy' : ''}`}>
            <input
              type="checkbox"
              checked={!!prefs?.task_done}
              disabled={prefsBusy || !prefs}
              onChange={(e) => void togglePref('task_done', e.target.checked)}
            />
            <span />
          </span>
        </label>
        <label className="settings-row settings-toggle-row">
          <span>
            <span className="settings-label">命令审批通知</span>
            <span className="settings-hint">有命令待审批且两端都没看对话时推送</span>
          </span>
          <span className={`settings-switch${prefsBusy ? ' busy' : ''}`}>
            <input
              type="checkbox"
              checked={!!prefs?.permission}
              disabled={prefsBusy || !prefs}
              onChange={(e) => void togglePref('permission', e.target.checked)}
            />
            <span />
          </span>
        </label>
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
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn primary"
                disabled={jevBusy || !pick}
                onClick={() => void onInstall()}
              >
                {jevBusy ? '安装中…' : '下载并安装'}
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
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn primary"
                disabled={jevBusy || !pick}
                onClick={() => void onInstall()}
              >
                {jevBusy ? '安装中…' : '下载并安装'}
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
