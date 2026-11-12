import { PageShell } from '../../components/PageShell'
import { SettingsGroup, SettingsPageBody, SettingsRow } from '../../components/settings/SettingsList'
import { SettingsIconGlobe } from '../../components/settings/SettingsIcons'
import { LOCALES } from '../../i18n/locale'
import { useLocale } from '../../i18n/useLocale'

/** Secondary: language picker */
export function SettingsLanguagePage() {
  const { locale, setLocale, t } = useLocale()

  return (
    <PageShell title={t('settings.language')} backTo="/settings">
      <SettingsPageBody>
        <SettingsGroup title={t('settings.language')}>
          {LOCALES.map((item) => (
            <SettingsRow
              key={item.id}
              icon={<SettingsIconGlobe />}
              title={item.label}
              value={locale === item.id ? '✓' : undefined}
              chevron={false}
              onClick={() => setLocale(item.id)}
            />
          ))}
        </SettingsGroup>
      </SettingsPageBody>
    </PageShell>
  )
}
