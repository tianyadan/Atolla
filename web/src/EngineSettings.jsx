import { useEffect, useMemo, useState } from 'react'
import { copyText, fetchSetupStatus, installCommand } from './engineCatalog.js'
import { EngineLogo } from './engineLogos.jsx'
import SettingsFold from './SettingsFold.jsx'
import { useLocale } from './i18n/useLocale.js'

const API = '/api'
/** 前端兜底 TTL；以服务端 ttl_seconds 为准。 */
const USAGE_TTL_MS = 5 * 60 * 1000

/** 模块级用量缓存：切换设置页不重复打三家接口。 */
let usageMem = {
  at: 0,
  ttlMs: USAGE_TTL_MS,
  byId: /** @type {Record<string, object>} */ ({}),
}

/** 夹紧用量百分比。 */
function clampPct(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, Math.round(v)))
}

/** 进度条填充色：越高越偏警示。 */
function barTone(pct) {
  if (pct >= 90) return 'hot'
  if (pct >= 70) return 'warm'
  return 'ok'
}

/** 模块缓存是否仍在 TTL 内。 */
function usageCacheFresh() {
  if (!usageMem.at || !Object.keys(usageMem.byId).length) return false
  return Date.now() - usageMem.at < (usageMem.ttlMs || USAGE_TTL_MS)
}

/** 写入模块缓存。 */
function rememberUsage(d) {
  const map = {}
  for (const row of d.engines || []) {
    if (row?.id) map[row.id] = row
  }
  const ttlSec = Number(d.ttl_seconds)
  usageMem = {
    at: Date.now(),
    ttlMs: Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec * 1000 : USAGE_TTL_MS,
    byId: map,
  }
  return map
}

/** 设置页「工作引擎」：安装状态 + 订阅额度进度条，点击看详情。 */
export default function EngineSettings({ authHeaders, onUnauthorized, active }) {
  const { t } = useLocale()
  const [engines, setEngines] = useState([])
  const [usageById, setUsageById] = useState(() => ({ ...usageMem.byId }))
  const [detailId, setDetailId] = useState('')
  const [china, setChina] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showInstall, setShowInstall] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(true)
  const [usageCached, setUsageCached] = useState(() => usageCacheFresh())

  /**
   * 拉取安装检测与用量。
   * force=false：5 分钟内复用缓存；force=true：重新检查环境时打 fresh=1。
   */
  async function load(opts = {}) {
    const force = !!opts.force
    setBusy(true)
    setErr('')
    try {
      const data = await fetchSetupStatus(force)
      setEngines(data.engines)

      if (typeof authHeaders !== 'function') return

      if (!force && usageCacheFresh()) {
        setUsageById({ ...usageMem.byId })
        setUsageCached(true)
        return
      }

      const q = force ? '?fresh=1' : ''
      const res = await fetch(`${API}/admin/engines/usage${q}`, { headers: authHeaders() })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || t('settings.engine.usageLoadFail', { status: res.status }))
      setUsageById(rememberUsage(d))
      setUsageCached(false)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (active) void load({ force: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const detailed = useMemo(
    () => engines.find((e) => e.id === detailId) || null,
    [engines, detailId],
  )
  const detailUsage = detailId ? usageById[detailId] : null
  const command = installCommand(detailed, china)

  /** 复制当前弹层里的安装命令。 */
  async function copyCmd() {
    if (!command) return
    await copyText(command)
    setCopied(true)
  }

  return (
    <SettingsFold
      title={t('settings.engine')}
      desc={t('settings.engineDesc')}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="engine-card-grid engine-settings-grid">
        {engines.map((e) => {
          const u = usageById[e.id]
          const windows = (u?.ok && Array.isArray(u.windows) ? u.windows : []).slice(0, 2)
          return (
            <button
              key={e.id}
              type="button"
              className={`engine-pick engine-status${e.installed ? '' : ' is-off'}`}
              onClick={() => {
                setDetailId(e.id)
                setCopied(false)
                setShowInstall(!e.installed)
              }}
            >
              <EngineLogo id={e.id} />
              <strong>{e.name}</strong>
              <i className={`engine-dot ${e.installed ? 'ok' : 'off'}`} aria-hidden="true" />
              <span>{e.installed ? t('settings.engine.installed') : t('settings.engine.notInstalled')}</span>
              {e.version ? <span className="engine-lock-ver">{t('settings.engine.lockedVer', { version: e.version })}</span> : null}
              <div className="engine-usage-stack">
                {windows.length > 0 ? (
                  windows.map((w) => {
                    const pct = clampPct(w.used_percent)
                    return (
                      <div key={`${e.id}-${w.kind}-${w.label}`} className="engine-usage-row">
                        <div className="engine-usage-meta">
                          <em className="engine-usage-tag">{w.label || w.kind}</em>
                          <em className="engine-usage-tag is-muted">{pct}%</em>
                        </div>
                        <div className="engine-usage-bar" title={w.hint || w.label}>
                          <div className={`engine-usage-fill tone-${barTone(pct)}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <p className="engine-usage-empty">
                    {u?.error ? t('settings.engine.quotaUnread') : (busy ? t('settings.engine.readingQuota') : t('settings.engine.clickQuota'))}
                  </p>
                )}
              </div>
              <span className="engine-usage-cta">{t('settings.engine.viewUsage')}</span>
            </button>
          )
        })}
      </div>
      <div className="engine-recheck-row">
        <button type="button" className="engine-recheck" onClick={() => load({ force: true })} disabled={busy}>
          {busy ? t('settings.engine.rechecking') : t('settings.engine.recheckEnv')}
        </button>
        {usageCached ? (
          <em className="engine-usage-tag is-muted">{t('settings.engine.cachedHint')}</em>
        ) : null}
      </div>
      {err && <p className="engine-hint">{err}</p>}

      {detailed && (
        <div className="modal-mask" onClick={() => setDetailId('')}>
          <div
            className="modal-card engine-pop engine-usage-pop"
            onClick={(ev) => ev.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="engine-usage-title"
          >
            <h2 id="engine-usage-title">{t('settings.engine.usageTitle', { name: detailed.name })}</h2>
            <p className="engine-usage-sub">
              {detailed.installed
                ? t('settings.engine.installedPath', { path: detailed.path || detailed.bin })
                : t('settings.engine.cliMissing')}
              {detailed.version ? t('settings.engine.atollaLocked', { version: detailed.version }) : ''}
              {detailUsage?.plan ? t('settings.engine.plan', { plan: detailUsage.plan }) : ''}
            </p>

            {detailUsage?.ok && (detailUsage.windows || []).length > 0 ? (
              <ul className="engine-usage-detail-list">
                {(detailUsage.windows || []).map((w) => {
                  const pct = clampPct(w.used_percent)
                  return (
                    <li key={`${w.kind}-${w.label}`}>
                      <div className="engine-usage-detail-head">
                        <strong>{w.label || w.kind}</strong>
                        <span>{t('settings.engine.usedPct', { pct })}</span>
                      </div>
                      <div className="engine-usage-bar is-lg">
                        <div className={`engine-usage-fill tone-${barTone(pct)}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="engine-usage-hints">
                        {w.hint ? <em className="engine-usage-tag is-muted">{w.hint}</em> : null}
                        {w.reset_hint ? <em className="engine-usage-tag is-muted">{w.reset_hint}</em> : null}
                        {!w.reset_hint && w.resets_at ? (
                          <em className="engine-usage-tag is-muted">{t('settings.engine.resetAt', { time: w.resets_at })}</em>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="engine-note">
                {detailUsage?.error || t('settings.engine.noQuota')}
              </p>
            )}
            {detailUsage?.source ? (
              <p className="engine-usage-source">{t('settings.engine.source', { source: detailUsage.source })}</p>
            ) : null}

            {showInstall && (
              <>
                <h3 className="engine-usage-install-title">
                  {detailed.version
                    ? t('settings.engine.installCmdLocked', { version: detailed.version })
                    : t('settings.engine.installCmd')}
                </h3>
                <label className="engine-mirror">
                  <input
                    type="checkbox"
                    checked={china}
                    onChange={(ev) => { setChina(ev.target.checked); setCopied(false) }}
                  />
                  China-mirror
                </label>
                <pre className="engine-pop-cmd">{command}</pre>
                {detailed.note && <p className="engine-note">{detailed.note}</p>}
              </>
            )}

            <div className="modal-actions">
              <button type="button" onClick={() => setDetailId('')}>{t('settings.common.close')}</button>
              <button
                type="button"
                className="ghost"
                onClick={() => setShowInstall((v) => !v)}
              >
                {showInstall ? t('settings.engine.collapseInstall') : t('settings.engine.installCmd')}
              </button>
              {showInstall && (
                <button type="button" className="engine-copy" onClick={copyCmd}>
                  {copied ? t('settings.common.copied') : t('settings.engine.copyCmd')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </SettingsFold>
  )
}
