import { useState } from 'react'
import { PageShell } from '../../components/PageShell'
import { SettingsPageBody } from '../../components/settings/SettingsList'
import { useLocale } from '../../i18n/useLocale'
import { getApiBase, setApiBase } from '../../utils/apiBase'
import { validateApiBase } from '../../utils/settingsDisplay'

/** Secondary: Relay API base URL */
export function SettingsRelayPage() {
  const { t } = useLocale()
  const [draft, setDraft] = useState(() => getApiBase())
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function onSave() {
    const invalid = validateApiBase(draft)
    if (invalid) {
      setError(t('settings.relayInvalid'))
      setSaved(false)
      return
    }
    setApiBase(draft)
    setError(null)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1600)
  }

  return (
    <PageShell title={t('settings.relayServer')} backTo="/settings">
      <SettingsPageBody>
        <p className="ios-settings-hint">{t('settings.relayHint')}</p>
        {error ? <p className="error-banner">{error}</p> : null}

        <label className="ios-settings-field">
          <span>{t('settings.apiBase')}</span>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="https://your-relay.example.com"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setSaved(false)
            }}
          />
        </label>

        <button type="button" className="ios-settings-save" onClick={onSave}>
          {saved ? t('settings.saved') : t('settings.save')}
        </button>
      </SettingsPageBody>
    </PageShell>
  )
}
