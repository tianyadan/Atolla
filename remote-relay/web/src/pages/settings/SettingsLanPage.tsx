import { useState } from 'react'
import { PageShell } from '../../components/PageShell'
import { SettingsPageBody } from '../../components/settings/SettingsList'
import {
  checkLanConnection,
  clearLanConnection,
  completeLanPairing,
  getLanConnection,
  getLanRouteState,
  saveLanConnection,
  type LanConnection,
} from '../../utils/lanConnection'
import { scanNativeLanPairingQRCode } from '../../nativeCredentials'

/** Local-only pairing settings. This page never changes the cloud relay address. */
export function SettingsLanPage() {
  const [draft, setDraft] = useState<LanConnection>(() => getLanConnection())
  const [message, setMessage] = useState('')
  const [testing, setTesting] = useState(false)
  const route = draft.instanceId ? getLanRouteState(draft.instanceId) : null

  async function scanPairing() {
    setTesting(true); setMessage('')
    try {
      const payload = await scanNativeLanPairingQRCode()
      if (!payload) return
      const paired = await completeLanPairing(payload)
      setDraft(paired)
      setMessage('配对成功：密钥已保存至 iPhone Keychain。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '二维码配对失败') } finally { setTesting(false) }
  }

  function save() {
    if (!draft.instanceId?.trim()) { setMessage('请填写实例 ID；每个实例必须单独配对。'); return }
    saveLanConnection(draft)
    setMessage('已保存。此配对仅适用于当前实例，业务请求将按实例选择局域网或云端。')
  }

  async function test() {
    setTesting(true)
    setMessage('')
    try {
      await checkLanConnection(draft)
      saveLanConnection(draft)
      setMessage('已验证：iPhone 可以通过签名请求连接此 Mac。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '局域网连接失败')
    } finally {
      setTesting(false)
    }
  }

  return (
    <PageShell title="局域网连接" backTo="/settings">
      <SettingsPageBody>
        <p className="ios-settings-hint">在 Mac 的「远程中继 → 局域网直连」生成二维码后直接扫描。二维码已包含实例信息，配对密钥只会保存到 iPhone Keychain。HTTP 仅适用于可信网络，内容不加密。</p>
        {message ? <p className="ios-settings-hint">{message}</p> : null}
        {route ? <p className="ios-settings-hint">当前路由：{route.channel === 'lan' ? '局域网直连' : route.channel === 'cloud' ? '云端中继' : '不可用'}；失败次数：{route.failureCount}{route.lastSuccessAt ? `；最近局域网成功：${new Date(route.lastSuccessAt).toLocaleString()}` : ''}{route.lastError ? `；最近错误：${route.lastError}` : ''}</p> : null}
        {draft.instanceId ? <p className="ios-settings-hint">已配对实例：{draft.instanceId}</p> : null}
        <label className="ios-settings-field"><span>Mac 地址</span><input value={draft.baseUrl} inputMode="url" autoCapitalize="off" placeholder="http://192.168.1.20:7943" onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
        <label className="ios-settings-field"><span>设备 ID</span><input value={draft.deviceId} autoCapitalize="off" autoCorrect="off" onChange={(event) => setDraft({ ...draft, deviceId: event.target.value })} /></label>
        <label className="ios-settings-field"><span>配对密钥</span><input type="password" value={draft.deviceSecret} autoCapitalize="off" autoCorrect="off" onChange={(event) => setDraft({ ...draft, deviceSecret: event.target.value })} /></label>
        <label className="ios-settings-field"><span>连接策略</span><select value={draft.strategy} onChange={(event) => setDraft({ ...draft, strategy: event.target.value as LanConnection['strategy'] })}><option value="auto">自动（局域网优先）</option><option value="lan_only">仅局域网</option><option value="cloud_only">仅云端</option></select></label>
        <button type="button" className="ios-settings-save" onClick={save}>保存</button>
        <button type="button" className="ios-settings-save" disabled={testing} onClick={() => void scanPairing()}>{testing ? '处理中…' : '扫描配对二维码'}</button>
        <button type="button" className="ios-settings-save" disabled={testing} onClick={() => void test()}>{testing ? '验证中…' : '测试局域网连接'}</button>
        <button type="button" className="ios-settings-save" onClick={() => { clearLanConnection(draft.instanceId); setDraft(getLanConnection()); setMessage('已移除当前实例的局域网配对信息。') }}>移除局域网配对</button>
      </SettingsPageBody>
    </PageShell>
  )
}
