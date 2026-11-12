import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearToken, fetchVersion } from '../../api'
import { PageShell } from '../../components/PageShell'
import { SettingsGroup, SettingsPageBody, SettingsRow } from '../../components/settings/SettingsList'
import { SettingsIconInfo, SettingsIconLayers } from '../../components/settings/SettingsIcons'
import { useLocale } from '../../i18n/useLocale'

/** Keep aligned with package.json version */
const APP_UI_VERSION = '0.0.26'

/** Secondary: About Atolla */
export function SettingsAboutPage() {
  const navigate = useNavigate()
  const { t } = useLocale()
  const [relayVersion, setRelayVersion] = useState('…')
  const appVersion = APP_UI_VERSION

  useEffect(() => {
    void (async () => {
      try {
        const v = await fetchVersion()
        setRelayVersion(v.startsWith('v') ? v : `v${v}`)
      } catch (err) {
        const status = (err as { status?: number })?.status
        if (status === 401) {
          clearToken()
          navigate('/login', { replace: true })
          return
        }
        setRelayVersion('—')
      }
    })()
  }, [navigate])

  return (
    <PageShell title={t('settings.aboutAtolla')} backTo="/settings">
      <SettingsPageBody>
        <div className="ios-settings-about-hero">
          <img src="/brand-jellyfish.png" alt="" width={56} height={56} draggable={false} />
          <strong>Atolla</strong>
          <span>{t('settings.aboutTagline')}</span>
        </div>

        <SettingsGroup title={t('settings.section.app')}>
          <SettingsRow
            icon={<SettingsIconInfo />}
            title={t('settings.appVersion')}
            value={`v${appVersion}`}
            chevron={false}
            readOnly
          />
          <SettingsRow
            icon={<SettingsIconLayers />}
            title={t('settings.relayVersion')}
            value={relayVersion}
            chevron={false}
            readOnly
          />
        </SettingsGroup>
      </SettingsPageBody>
    </PageShell>
  )
}
