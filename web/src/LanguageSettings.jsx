import { useState } from 'react'
import SettingsFold from './SettingsFold.jsx'
import { LOCALES } from './i18n/locale.js'
import { useLocale } from './i18n/useLocale.js'

/** 设置 · 语言：简体中文 / English */
export default function LanguageSettings() {
  const { locale, setLocale, t } = useLocale()
  const [open, setOpen] = useState(true)

  return (
    <SettingsFold
      title={t('settings.language')}
      desc={t('settings.languageDesc')}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="ma-capsule-row">
        <div className="ma-capsule-text">
          <span className="ma-capsule-label">{t('settings.languageLabel')}</span>
        </div>
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
      </div>
    </SettingsFold>
  )
}
