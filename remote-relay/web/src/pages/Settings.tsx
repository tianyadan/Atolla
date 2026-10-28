import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  clearToken,
  fetchReceiveEmail,
  fetchVersion,
  saveReceiveEmail,
} from '../api'
import { PageShell } from '../components/PageShell'
import { LOCALES } from '../i18n/locale'
import { useLocale } from '../i18n/useLocale'
import { getApiBase, setApiBase } from '../utils/apiBase'

/**
 * 全局 / 实例大门设置：版本、语言、中继地址、接收邮箱、更新记录。
 * 通知与 JEV 已迁到「进入实例 → 功能 → 设置」。
 */
export function SettingsPage() {
  const navigate = useNavigate()
  const { locale, setLocale, t } = useLocale()
  const [version, setVersion] = useState<string>('…')
  const [error, setError] = useState<string | null>(null)
  const [apiBaseDraft, setApiBaseDraft] = useState(() => getApiBase())
  const [apiSaved, setApiSaved] = useState(false)
  const [receiveEmail, setReceiveEmail] = useState('')
  const [receiveMasked, setReceiveMasked] = useState('')
  const [receiveBusy, setReceiveBusy] = useState(false)
  const [receiveMsg, setReceiveMsg] = useState<string | null>(null)
  const showApiBase = Capacitor.isNativePlatform() || !!getApiBase() || !!import.meta.env.VITE_API_BASE

  useEffect(() => {
    void (async () => {
      try {
        const v = await fetchVersion()
        setVersion(v.startsWith('v') ? v : `v${v}`)
        const re = await fetchReceiveEmail()
        setReceiveEmail(re.email || '')
        setReceiveMasked(re.email_masked || '')
      } catch (err) {
        const status = (err as { status?: number })?.status
        if (status === 401) {
          clearToken()
          navigate('/login', { replace: true })
          return
        }
        setError(err instanceof Error ? err.message : '加载失败')
        setVersion('—')
      }
    })()
  }, [navigate])

  /** 保存中继地址 */
  function saveApiBase() {
    setApiBase(apiBaseDraft)
    setApiSaved(true)
    window.setTimeout(() => setApiSaved(false), 1600)
  }

  /** 保存验证码登录收件邮箱 */
  async function onSaveReceiveEmail() {
    if (receiveBusy) return
    setReceiveBusy(true)
    setReceiveMsg(null)
    setError(null)
    try {
      const out = await saveReceiveEmail(receiveEmail.trim())
      setReceiveEmail(out.email || '')
      setReceiveMasked(out.email_masked || '')
      setReceiveMsg(out.set ? '接收邮箱已保存' : '已清除接收邮箱')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setReceiveBusy(false)
    }
  }

  return (
    <PageShell title={t('settings.title')} backTo="/instances">
      {error ? <p className="error-banner">{error}</p> : null}
      {receiveMsg ? <p className="muted">{receiveMsg}</p> : null}

      <h2 className="settings-section-title">{t('settings.app')}</h2>
      <div className="settings-block">
        <div className="settings-row">
          <span className="settings-label">{t('settings.relayVersion')}</span>
          <span className="settings-value">{version}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">{t('settings.appUi')}</span>
          <span className="settings-value">v0.0.25</span>
        </div>
        <label className="settings-row" style={{ alignItems: 'center' }}>
          <span className="settings-label">{t('settings.languageLabel')}</span>
          <select
            className="settings-locale-select"
            value={locale}
            aria-label={t('settings.languageLabel')}
            onChange={(e) => setLocale(e.target.value)}
          >
            {LOCALES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <h2 className="settings-section-title">{t('settings.otpLogin')}</h2>
      <p className="settings-section-hint">
        {t('settings.otpHint')}
        {receiveMasked ? ` ${t('settings.otpCurrent', { email: receiveMasked })}` : ''}
      </p>
      <div className="settings-block">
        <label className="field" style={{ display: 'block', padding: '0.75rem 0' }}>
          <span className="settings-label">{t('settings.receiveEmail')}</span>
          <input
            type="email"
            inputMode="email"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="email"
            placeholder="you@example.com"
            value={receiveEmail}
            onChange={(e) => setReceiveEmail(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={receiveBusy}
          onClick={() => void onSaveReceiveEmail()}
        >
          {receiveBusy ? t('settings.saving') : t('settings.saveReceive')}
        </button>
      </div>

      {showApiBase ? (
        <>
          <h2 className="settings-section-title">{t('settings.relayService')}</h2>
          <p className="settings-section-hint">{t('settings.relayHint')}</p>
          <div className="settings-block">
            <label className="field" style={{ display: 'block', padding: '0.75rem 0' }}>
              <span className="settings-label">{t('settings.apiBase')}</span>
              <input
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                placeholder="https://your-relay.example.com"
                value={apiBaseDraft}
                onChange={(e) => setApiBaseDraft(e.target.value)}
              />
            </label>
            <button type="button" className="btn primary" onClick={saveApiBase}>
              {apiSaved ? t('settings.saved') : t('settings.save')}
            </button>
          </div>
        </>
      ) : null}

      <h2 className="settings-section-title">{t('settings.other')}</h2>
      <p className="settings-section-hint">{t('settings.otherHint')}</p>
      <ul className="list settings-menu">
        <li className="list-item">
          <Link to="/settings/changelog" className="list-link">
            <div className="list-title">{t('settings.changelog')}</div>
            <div className="list-sub">{t('settings.changelogSub')}</div>
          </Link>
        </li>
      </ul>
    </PageShell>
  )
}
