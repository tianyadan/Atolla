import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearToken, fetchReceiveEmail, fetchVersion, getToken } from '../api'
import { PageShell } from '../components/PageShell'
import {
  SettingsGroup,
  SettingsPageBody,
  SettingsRow,
} from '../components/settings/SettingsList'
import {
  SettingsIconBell,
  SettingsIconDoc,
  SettingsIconGlobe,
  SettingsIconInfo,
  SettingsIconLayers,
  SettingsIconMail,
  SettingsIconNetwork,
} from '../components/settings/SettingsIcons'
import { useLocale } from '../i18n/useLocale'
import { getLanConnection, getLanRouteState, type LanRouteState } from '../utils/lanConnection'
import { formatConnectionRoute } from '../utils/connectionDisplay'
import {
  currentLocaleLabel,
  formatEmailSummary,
} from '../utils/settingsDisplay'
import { clearSettingsBack, peekSettingsBack } from '../utils/settingsNav'
import { clearConnectionSession, getConnectionSession } from '../utils/connectionSession'

/**
 * Global Settings — iOS-style menu. Detail forms live on secondary routes.
 * Back target remembered via settingsNav (drawer ↔ settings ↔ instances).
 */
export function SettingsPage() {
  const navigate = useNavigate()
  const { locale, t } = useLocale()
  const [version, setVersion] = useState('…')
  const [emailMasked, setEmailMasked] = useState('')
  const [email, setEmail] = useState('')
  const [connectionRoute, setConnectionRoute] = useState<LanRouteState>(() => {
    const connection = getLanConnection()
    return getLanRouteState(connection.instanceId || '')
  })
  const backTo = useMemo(() => peekSettingsBack('/instances'), [])
  // LAN-only has no remote site session. Do not request or expose controls
  // which depend on remote relay APIs; a valid local pairing is not an error.
  const lanOnly = !!getConnectionSession() && !getToken()

  useEffect(() => {
    // Refresh summaries when returning from secondary pages
    const connection = getLanConnection()
    setConnectionRoute(getLanRouteState(connection.instanceId || ''))
    if (lanOnly) {
      setVersion('—')
      setEmail('')
      setEmailMasked('')
      return
    }
    void (async () => {
      const [versionResult, emailResult] = await Promise.allSettled([fetchVersion(), fetchReceiveEmail()])
      const rejected = [versionResult, emailResult].find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      )
      const status = (rejected?.reason as { status?: number } | undefined)?.status
      if (status === 401) {
        clearToken()
        clearSettingsBack()
        navigate('/login', { replace: true })
        return
      }
      if (versionResult.status === 'fulfilled') {
        setVersion(versionResult.value.startsWith('v') ? versionResult.value : `v${versionResult.value}`)
      } else {
        setVersion('—')
      }
      if (emailResult.status === 'fulfilled') {
        setEmail(emailResult.value.email || '')
        setEmailMasked(emailResult.value.email_masked || '')
      } else {
        setEmail('')
        setEmailMasked('')
      }
    })()
  }, [lanOnly, navigate])

  /**
   * 主动退出必须同时清除远程 JWT 和局域网会话。
   *
   * QR 配对后的 LAN session 也能通过 RequireAuth；此前只调用 clearToken()
   * 会让路由守卫继续判定为已登录，并自动恢复到最近的数字人对话。
   * 保留配对凭据本身，用户下次可在设置中复用或重新扫码，不等同于遗忘设备。
   */
  function onLogout() {
    clearToken()
    clearConnectionSession()
    clearSettingsBack()
    navigate('/login', { replace: true })
  }

  return (
    <PageShell title={t('settings.title')} backTo={backTo}>
      <SettingsPageBody>
        <SettingsGroup title={t('settings.section.app')}>
          {!lanOnly ? (
            <SettingsRow
              icon={<SettingsIconLayers />}
              title={t('settings.relayVersion')}
              value={version}
              chevron={false}
              readOnly
            />
          ) : null}
          <SettingsRow
            icon={<SettingsIconGlobe />}
            title={t('settings.language')}
            value={currentLocaleLabel(locale)}
            onClick={() => navigate('/settings/language')}
          />
        </SettingsGroup>

        <SettingsGroup title={t('settings.section.connection')}>
          {!lanOnly ? (
            <SettingsRow
              icon={<SettingsIconMail />}
              title={t('settings.otpLogin')}
              value={formatEmailSummary(emailMasked, email)}
              onClick={() => navigate('/settings/otp')}
            />
          ) : null}
          <SettingsRow
            icon={<SettingsIconNetwork />}
            title={t('settings.relayAndConnection')}
            value={formatConnectionRoute(connectionRoute, locale).label}
            onClick={() => navigate('/settings/relay')}
          />
        </SettingsGroup>

        <SettingsGroup title={t('settings.section.preferences')}>
          <SettingsRow
            icon={<SettingsIconBell />}
            title={t('settings.preferencesNotifyJev')}
            onClick={() => navigate('/settings/preferences')}
          />
        </SettingsGroup>

        <SettingsGroup title={t('settings.section.about')}>
          <SettingsRow
            icon={<SettingsIconDoc />}
            title={t('settings.changelog')}
            onClick={() => navigate('/settings/changelog')}
          />
          <SettingsRow
            icon={<SettingsIconInfo />}
            title={t('settings.aboutAtolla')}
            onClick={() => navigate('/settings/about')}
          />
        </SettingsGroup>

        <div className="ios-settings-logout-box">
          <button type="button" className="ios-settings-logout-btn" onClick={onLogout}>
            {t('settings.logout')}
          </button>
        </div>
      </SettingsPageBody>
    </PageShell>
  )
}
