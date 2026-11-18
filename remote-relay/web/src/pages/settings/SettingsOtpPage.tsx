import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearToken, fetchReceiveEmail, saveReceiveEmail } from '../../api'
import { PageShell } from '../../components/PageShell'
import { SettingsPageBody } from '../../components/settings/SettingsList'
import { useLocale } from '../../i18n/useLocale'

/** Secondary: OTP login receive email */
export function SettingsOtpPage() {
  const navigate = useNavigate()
  const { t } = useLocale()
  const [email, setEmail] = useState('')
  const [masked, setMasked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const re = await fetchReceiveEmail()
        setEmail(re.email || '')
        setMasked(re.email_masked || '')
      } catch (err) {
        const status = (err as { status?: number })?.status
        if (status === 401) {
          clearToken()
          navigate('/login', { replace: true })
          return
        }
        setError(err instanceof Error ? err.message : 'Load failed')
      }
    })()
  }, [navigate])

  async function onSave() {
    if (busy) return
    setBusy(true)
    setError(null)
    setOkMsg(null)
    try {
      const out = await saveReceiveEmail(email.trim())
      setEmail(out.email || '')
      setMasked(out.email_masked || '')
      setOkMsg(out.set ? t('settings.otpSaved') : t('settings.otpCleared'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell title={t('settings.otpLogin')} backTo="/settings">
      <SettingsPageBody>
        <p className="ios-settings-hint">{t('settings.otpHint')}</p>
        {masked ? (
          <p className="ios-settings-hint">
            {t('settings.otpCurrent', { email: masked })}
          </p>
        ) : null}
        {error ? <p className="error-banner">{error}</p> : null}
        {okMsg ? <p className="ios-settings-ok">{okMsg}</p> : null}

        <label className="ios-settings-field">
          <span>{t('settings.receiveEmail')}</span>
          <input
            type="email"
            inputMode="email"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <button
          type="button"
          className="ios-settings-save"
          disabled={busy}
          onClick={() => void onSave()}
        >
          {busy ? t('settings.saving') : t('settings.save')}
        </button>
      </SettingsPageBody>
    </PageShell>
  )
}
