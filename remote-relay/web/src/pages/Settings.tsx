import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearToken, fetchReceiveEmail, fetchVersion } from '../api'
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
import { getApiBase } from '../utils/apiBase'
import {
  currentLocaleLabel,
  formatApiBaseSummary,
  formatEmailSummary,
} from '../utils/settingsDisplay'
import { clearSettingsBack, peekSettingsBack } from '../utils/settingsNav'

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
  const [apiBase, setApiBaseState] = useState(() => getApiBase())
  const [error, setError] = useState<string | null>(null)
  const backTo = useMemo(() => peekSettingsBack('/instances'), [])

  useEffect(() => {
    // Refresh summaries when returning from secondary pages
    setApiBaseState(getApiBase())
    void (async () => {
      try {
        const [v, re] = await Promise.all([fetchVersion(), fetchReceiveEmail()])
        setVersion(v.startsWith('v') ? v : `v${v}`)
        setEmail(re.email || '')
        setEmailMasked(re.email_masked || '')
      } catch (err) {
        const status = (err as { status?: number })?.status
        if (status === 401) {
          clearToken()
          clearSettingsBack()
          navigate('/login', { replace: true })
          return
        }
        setError(err instanceof Error ? err.message : 'Load failed')
        setVersion('—')
      }
    })()
  }, [navigate])

  /** Site gate logout — clears token and returns to login */
  function onLogout() {
    clearToken()
    clearSettingsBack()
    navigate('/login', { replace: true })
  }

  return (
    <PageShell title={t('settings.title')} backTo={backTo}>
      <SettingsPageBody>
        {error ? <p className="error-banner">{error}</p> : null}

        <SettingsGroup title={t('settings.section.app')}>
          <SettingsRow
            icon={<SettingsIconLayers />}
            title={t('settings.relayVersion')}
            value={version}
            chevron={false}
            readOnly
          />
          <SettingsRow
            icon={<SettingsIconGlobe />}
            title={t('settings.language')}
            value={currentLocaleLabel(locale)}
            onClick={() => navigate('/settings/language')}
          />
        </SettingsGroup>

        <SettingsGroup title={t('settings.section.connection')}>
          <SettingsRow
            icon={<SettingsIconMail />}
            title={t('settings.otpLogin')}
            value={formatEmailSummary(emailMasked, email)}
            onClick={() => navigate('/settings/otp')}
          />
          <SettingsRow
            icon={<SettingsIconNetwork />}
            title={t('settings.relayServer')}
            value={formatApiBaseSummary(apiBase)}
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
