import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  clearToken,
  fetchInstances,
  hasUnlockToken,
  type PublicInstance,
} from '../../api'
import { PageShell } from '../../components/PageShell'
import { SettingsGroup, SettingsPageBody, SettingsRow } from '../../components/settings/SettingsList'
import { SettingsIconMonitor } from '../../components/settings/SettingsIcons'
import { useLocale } from '../../i18n/useLocale'
import { isInstanceOnline } from '../../utils/instance'

/**
 * Preferences entry: pick an unlocked computer, then open its Notify/JEV settings.
 * Keeps existing InstanceSettings capabilities without reimplementing them.
 */
export function SettingsPreferencesPage() {
  const navigate = useNavigate()
  const { t } = useLocale()
  const [rows, setRows] = useState<PublicInstance[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const list = await fetchInstances()
        setRows(list.filter((row) => hasUnlockToken(row.instance_id)))
      } catch (err) {
        const status = (err as { status?: number })?.status
        if (status === 401) {
          clearToken()
          navigate('/login', { replace: true })
          return
        }
        setError(err instanceof Error ? err.message : 'Load failed')
      } finally {
        setLoading(false)
      }
    })()
  }, [navigate])

  return (
    <PageShell title={t('settings.preferencesNotifyJev')} backTo="/settings">
      <SettingsPageBody>
        <p className="ios-settings-hint">{t('settings.preferencesHint')}</p>
        {error ? <p className="error-banner">{error}</p> : null}
        {loading ? <p className="ios-settings-hint">{t('settings.loading')}</p> : null}

        {!loading && rows.length === 0 ? (
          <p className="ios-settings-hint">{t('settings.preferencesEmpty')}</p>
        ) : null}

        {!loading && rows.length > 0 ? (
          <SettingsGroup title={t('settings.section.computers')}>
            {rows.map((row) => {
              const online = isInstanceOnline(row.last_heartbeat_at)
              return (
                <SettingsRow
                  key={row.instance_id}
                  icon={<SettingsIconMonitor />}
                  title={row.display_name || row.instance_id}
                  value={online ? t('settings.online') : t('settings.offline')}
                  onClick={() =>
                    navigate(
                      `/instances/${encodeURIComponent(row.instance_id)}/settings?from=settings`,
                    )
                  }
                />
              )
            })}
          </SettingsGroup>
        ) : null}
      </SettingsPageBody>
    </PageShell>
  )
}
