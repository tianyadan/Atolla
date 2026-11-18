import { useEffect, useRef, useState } from 'react'
import { PageShell } from '../../components/PageShell'
import { SettingsGroup, SettingsPageBody } from '../../components/settings/SettingsList'
import { useLocale } from '../../i18n/useLocale'
import { login } from '../../api'
import { getApiBase, setApiBase } from '../../utils/apiBase'
import { validateApiBase } from '../../utils/settingsDisplay'
import {
  checkLanConnection,
  clearLanConnection,
  completeLanPairing,
  getLanConnection,
  getLanRouteState,
  saveLanConnection,
  type LanConnection,
} from '../../utils/lanConnection'
import { formatConnectionRoute } from '../../utils/connectionDisplay'
import { scanNativeLanPairingQRCode } from '../../nativeCredentials'

type Feedback = { tone: 'success' | 'danger'; message: string }

/** Unified connection settings: cloud relay and instance-scoped LAN pairing. */
export function SettingsRelayPage() {
  const { t } = useLocale()
  const [relayBaseUrl, setRelayBaseUrl] = useState(() => getApiBase())
  const [relayPassword, setRelayPassword] = useState('')
  const [lanDraft, setLanDraft] = useState<LanConnection>(() => getLanConnection())
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [testing, setTesting] = useState(false)
  const feedbackTimer = useRef<number | undefined>(undefined)
  const route = getLanRouteState(lanDraft.instanceId || '')
  const routeDisplay = formatConnectionRoute(route)

  useEffect(() => () => {
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current)
  }, [])

  function showFeedback(tone: Feedback['tone'], message: string) {
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current)
    setFeedback({ tone, message })
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 3_600)
  }

  function saveRelay() {
    const invalid = validateApiBase(relayBaseUrl)
    if (invalid) {
      showFeedback('danger', t('settings.relayInvalid'))
      return
    }
    setApiBase(relayBaseUrl)
    showFeedback('success', '服务器中继地址已保存。')
  }

  /** 地址与凭据分开保存：LAN 用户可先记录地址，决定开启云端回退时再登录。 */
  async function connectRemoteRelay() {
    const invalid = validateApiBase(relayBaseUrl)
    if (invalid) {
      showFeedback('danger', t('settings.relayInvalid'))
      return
    }
    if (!relayPassword.trim()) {
      showFeedback('danger', '请输入中继站点密码以完成远程连接。')
      return
    }
    setTesting(true)
    try {
      setApiBase(relayBaseUrl)
      await login(relayPassword.trim())
      setRelayPassword('')
      showFeedback('success', '远程中继已连接，可在局域网不可用时作为回退。')
    } catch (error) {
      showFeedback('danger', error instanceof Error ? error.message : '远程中继登录失败')
    } finally {
      setTesting(false)
    }
  }

  function saveLan() {
    if (!lanDraft.instanceId?.trim()) {
      showFeedback('danger', '请扫描配对二维码；二维码会自动写入实例信息。')
      return
    }
    saveLanConnection(lanDraft)
    showFeedback('success', '局域网连接配置已保存。')
  }

  async function scanPairing() {
    setTesting(true)
    try {
      const payload = await scanNativeLanPairingQRCode()
      if (!payload) return
      const paired = await completeLanPairing(payload)
      setLanDraft(paired)
      showFeedback('success', '配对成功，密钥已保存到 iPhone Keychain。')
    } catch (error) {
      showFeedback('danger', error instanceof Error ? error.message : '二维码配对失败')
    } finally {
      setTesting(false)
    }
  }

  async function testLanConnection() {
    setTesting(true)
    try {
      await checkLanConnection(lanDraft)
      saveLanConnection(lanDraft)
      showFeedback('success', '局域网连接成功：iPhone 已通过签名验证连接到此 Mac。')
    } catch (error) {
      showFeedback('danger', error instanceof Error ? error.message : '局域网连接失败')
    } finally {
      setTesting(false)
    }
  }

  return (
    <PageShell title="中继与连接" backTo="/settings">
      {feedback ? <div className={`settings-feedback-toast is-${feedback.tone}`} role="status">{feedback.message}</div> : null}
      <SettingsPageBody className="relay-connection-settings">
        <section className={`connection-route-card is-${routeDisplay.tone}`} aria-label="当前连接方式">
          <span>当前连接方式</span>
          <strong>{routeDisplay.label}</strong>
          <p>{routeDisplay.label === '局域网直连' ? '当前业务请求正通过本地网络连接 Mac。' : routeDisplay.label === '服务器中继' ? '当前业务请求通过服务器中继；局域网可用时会自动优先使用。' : '当前实例暂时没有可用连接，请检查网络或重试局域网测试。'}</p>
        </section>

        <SettingsGroup title="服务器中继">
          <div className="connection-settings-section">
            <p className="ios-settings-hint">{t('settings.relayHint')}</p>
            <label className="ios-settings-field">
              <span>{t('settings.apiBase')}</span>
              <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="https://your-relay.example.com" value={relayBaseUrl} onChange={(event) => setRelayBaseUrl(event.target.value)} />
            </label>
            <button type="button" className="ios-settings-action secondary" onClick={saveRelay}>保存服务器地址</button>
            <label className="ios-settings-field">
              <span>站点密码</span>
              <input type="password" value={relayPassword} autoComplete="current-password" onChange={(event) => setRelayPassword(event.target.value)} placeholder="用于远程中继登录" />
            </label>
            <button type="button" className="ios-settings-action" disabled={testing} onClick={() => void connectRemoteRelay()}>{testing ? '连接中…' : '连接远程中继'}</button>
          </div>
        </SettingsGroup>

        <SettingsGroup title="局域网直连">
          <div className="connection-settings-section">
            <p className="ios-settings-hint">扫描 Mac 端生成的配对二维码。二维码含实例信息；配对密钥仅保存到 iPhone Keychain。HTTP 仅适用于可信网络，内容不加密。</p>
            {lanDraft.instanceId ? <p className="connection-instance">已配对实例：{lanDraft.instanceId}</p> : <p className="connection-instance">尚未配对局域网实例</p>}
            <label className="ios-settings-field"><span>Mac 地址</span><input value={lanDraft.baseUrl} inputMode="url" autoCapitalize="off" placeholder="http://192.168.1.20:7943" onChange={(event) => setLanDraft({ ...lanDraft, baseUrl: event.target.value })} /></label>
            <label className="ios-settings-field"><span>设备 ID</span><input value={lanDraft.deviceId} autoCapitalize="off" autoCorrect="off" onChange={(event) => setLanDraft({ ...lanDraft, deviceId: event.target.value })} /></label>
            <label className="ios-settings-field"><span>配对密钥</span><input type="password" value={lanDraft.deviceSecret} autoCapitalize="off" autoCorrect="off" onChange={(event) => setLanDraft({ ...lanDraft, deviceSecret: event.target.value })} /></label>
            <label className="ios-settings-field"><span>连接策略</span><select value={lanDraft.strategy} onChange={(event) => setLanDraft({ ...lanDraft, strategy: event.target.value as LanConnection['strategy'] })}><option value="auto">自动（局域网优先）</option><option value="lan_only">仅局域网</option><option value="cloud_only">仅云端</option></select></label>
            <div className="connection-actions">
              <button type="button" className="ios-settings-action secondary" disabled={testing} onClick={() => void scanPairing()}>{testing ? '处理中…' : '扫描配对二维码'}</button>
              <button type="button" className="ios-settings-action" disabled={testing} onClick={() => void testLanConnection()}>{testing ? '验证中…' : '测试局域网连接'}</button>
            </div>
            <button type="button" className="ios-settings-action secondary" onClick={saveLan}>保存局域网配置</button>
            <button type="button" className="ios-settings-action danger" onClick={() => {
              clearLanConnection(lanDraft.instanceId)
              setLanDraft(getLanConnection())
              showFeedback('success', '已移除当前实例的局域网配对信息。')
            }}>移除局域网配对</button>
          </div>
        </SettingsGroup>
      </SettingsPageBody>
    </PageShell>
  )
}
