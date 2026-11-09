import { useEffect, useMemo, useState } from 'react'
import SettingsFold from './SettingsFold.jsx'
import { useLocale } from './i18n/useLocale.js'

const API = '/api'

const emptyConfig = {
  enabled: false,
  repository: '',
  agent_ids: [],
  has_github_token: false,
  has_webhook_secret: false,
  status: 'disabled',
  last_sync_at: null,
  updated_at: null,
  last_error: '',
  error_logs: [],
}

function displayTime(value) {
  if (!value) return '尚未同步'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

/** 设置页「GitHub Idea」：配置仓库、Keychain 凭据及负责处理 Idea 的数字员工。 */
export default function GitHubIdeaSettings({ authHeaders, onUnauthorized, active }) {
  const { t } = useLocale()
  const [open, setOpen] = useState(true)
  const [config, setConfig] = useState(emptyConfig)
  const [agents, setAgents] = useState([])
  const [dispatches, setDispatches] = useState([])
  const [form, setForm] = useState({
    enabled: false,
    repository: '',
    github_token: '',
    webhook_secret: '',
    agent_ids: [],
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  const [reassignChoices, setReassignChoices] = useState({})
  const [reassigningID, setReassigningID] = useState(0)

  function applyConfig(next) {
    const cfg = { ...emptyConfig, ...(next || {}) }
    setConfig(cfg)
    setForm({
      enabled: !!cfg.enabled,
      repository: cfg.repository || '',
      github_token: '',
      webhook_secret: '',
      agent_ids: Array.isArray(cfg.agent_ids) ? cfg.agent_ids.map(Number) : [],
    })
  }

  async function load() {
    setBusy(true)
    setErr('')
    try {
      const [configRes, agentsRes, dispatchesRes] = await Promise.all([
        fetch(`${API}/admin/plugins/github-idea`, { headers: authHeaders() }),
        fetch(`${API}/admin/agents`, { headers: authHeaders() }),
        fetch(`${API}/admin/plugins/github-idea/dispatches?limit=50`, { headers: authHeaders() }),
      ])
      if (configRes.status === 401 || agentsRes.status === 401 || dispatchesRes.status === 401) {
        onUnauthorized?.()
        return
      }
      const configData = await configRes.json().catch(() => ({}))
      const agentsData = await agentsRes.json().catch(() => ({}))
      const dispatchesData = await dispatchesRes.json().catch(() => ({}))
      if (!configRes.ok) {
        if (configData.config) applyConfig(configData.config)
        throw new Error(configData.error || `插件配置加载失败(${configRes.status})`)
      }
      if (!agentsRes.ok) throw new Error(agentsData.error || `数字员工加载失败(${agentsRes.status})`)
      if (!dispatchesRes.ok) throw new Error(dispatchesData.error || `调度历史加载失败(${dispatchesRes.status})`)
      applyConfig(configData)
      setAgents(Array.isArray(agentsData.items) ? agentsData.items : [])
      setDispatches(Array.isArray(dispatchesData.items) ? dispatchesData.items : [])
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (active) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (!active) setAgentPickerOpen(false)
  }, [active])

  useEffect(() => {
    if (!agentPickerOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setAgentPickerOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [agentPickerOpen])

  const selected = useMemo(() => new Set(form.agent_ids.map(Number)), [form.agent_ids])
  const selectedAgents = useMemo(
    () => agents.filter((agent) => selected.has(Number(agent.id))),
    [agents, selected],
  )
  const dispatchAgents = useMemo(() => {
    const configured = new Set((config.agent_ids || []).map(Number))
    return agents.filter((agent) => configured.has(Number(agent.id)))
  }, [agents, config.agent_ids])

  function toggleAgent(id, checked) {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    setForm((prev) => ({ ...prev, agent_ids: [...next] }))
    setSaved(false)
  }

  async function save() {
    setBusy(true)
    setErr('')
    setSaved(false)
    try {
      const res = await fetch(`${API}/admin/plugins/github-idea`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(form),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `保存失败(${res.status})`)
      applyConfig(data)
      setSaved(true)
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function reassign(dispatchID) {
    const agentID = Number(reassignChoices[dispatchID] || 0)
    if (!agentID || reassigningID) return
    setReassigningID(dispatchID)
    setErr('')
    try {
      const res = await fetch(`${API}/admin/plugins/github-idea/dispatches/${dispatchID}/reassign`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ agent_id: agentID }),
      })
      if (res.status === 401) {
        onUnauthorized?.()
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `重新分派失败(${res.status})`)
      await load()
      setReassignChoices((prev) => ({ ...prev, [dispatchID]: '' }))
    } catch (e) {
      setErr(String(e.message || e))
    } finally {
      setReassigningID(0)
    }
  }

  function dispatchStatusLabel(value) {
    const labels = {
      pending_classification: t('settings.githubIdea.dispatchPendingClassification'),
      pending_assignment: t('settings.githubIdea.dispatchPendingAssignment'),
      dispatching: t('settings.githubIdea.dispatchDispatching'),
      queued: t('settings.githubIdea.dispatchQueued'),
      running: t('settings.githubIdea.dispatchRunning'),
      executing: t('settings.githubIdea.dispatchRunning'),
      done: t('settings.githubIdea.dispatchCompleted'),
      completed: t('settings.githubIdea.dispatchCompleted'),
      failed: t('settings.githubIdea.dispatchFailed'),
      cancelled: t('settings.githubIdea.dispatchCancelled'),
      superseded: t('settings.githubIdea.dispatchSuperseded'),
    }
    return labels[value] || value || t('settings.githubIdea.dispatchUnknown')
  }

  const statusLabel = config.status === 'ready'
    ? t('settings.githubIdea.statusReady')
    : config.status === 'error'
      ? t('settings.githubIdea.statusError')
      : t('settings.githubIdea.statusDisabled')

  return (
    <SettingsFold
      title={t('settings.githubIdea')}
      desc={t('settings.githubIdeaDesc')}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <div className="github-idea-settings">
        <div className="github-idea-status-row">
          <span className={`github-idea-status is-${config.status || 'disabled'}`}>{statusLabel}</span>
          <span>{t('settings.githubIdea.lastSync')}：{displayTime(config.last_sync_at)}</span>
          {config.updated_at ? <span>{t('settings.githubIdea.updatedAt')}：{displayTime(config.updated_at)}</span> : null}
        </div>

        <label className="github-idea-enable">
          <span>
            <strong>{t('settings.githubIdea.enabled')}</strong>
            <small>{t('settings.githubIdea.enabledHint')}</small>
          </span>
          <span className={`auto-switch ma-capsule ${busy ? 'busy' : ''}`}>
            <input
              type="checkbox"
              checked={form.enabled}
              disabled={busy}
              onChange={(e) => { setForm((prev) => ({ ...prev, enabled: e.target.checked })); setSaved(false) }}
            />
            <span className="slider" />
          </span>
        </label>

        <div className="github-idea-grid">
          <label>
            <span>{t('settings.githubIdea.repository')}</span>
            <input
              type="text"
              value={form.repository}
              disabled={busy}
              placeholder="owner/repository"
              autoComplete="off"
              onChange={(e) => { setForm((prev) => ({ ...prev, repository: e.target.value })); setSaved(false) }}
            />
          </label>
          <label>
            <span>{t('settings.githubIdea.credential')}</span>
            <input
              type="password"
              value={form.github_token}
              disabled={busy}
              placeholder={config.has_github_token ? t('settings.githubIdea.secretSaved') : 'github_pat_…'}
              autoComplete="new-password"
              onChange={(e) => { setForm((prev) => ({ ...prev, github_token: e.target.value })); setSaved(false) }}
            />
          </label>
          <label>
            <span>Webhook Secret</span>
            <input
              type="password"
              value={form.webhook_secret}
              disabled={busy}
              placeholder={config.has_webhook_secret ? t('settings.githubIdea.secretSaved') : t('settings.githubIdea.secretPlaceholder')}
              autoComplete="new-password"
              onChange={(e) => { setForm((prev) => ({ ...prev, webhook_secret: e.target.value })); setSaved(false) }}
            />
          </label>
        </div>

        <button
          type="button"
          className="github-idea-agent-trigger"
          disabled={busy}
          aria-haspopup="dialog"
          aria-expanded={agentPickerOpen}
          onClick={() => setAgentPickerOpen(true)}
        >
          <span className="github-idea-agent-trigger-copy">
            <strong>{t('settings.githubIdea.agents')}</strong>
            <small>{t('settings.githubIdea.agentsHint')}</small>
          </span>
          <span className="github-idea-agent-trigger-value">
            <span>{t('settings.githubIdea.selectedCount', { count: selectedAgents.length })}</span>
            {selectedAgents.length ? <small>{selectedAgents.map((agent) => agent.name).join('、')}</small> : null}
          </span>
        </button>

        <div className="github-idea-actions">
          <button type="button" disabled={busy} onClick={() => void load()}>{t('usage.refresh')}</button>
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
            {busy ? t('settings.githubIdea.saving') : t('settings.githubIdea.save')}
          </button>
          {saved ? <span className="github-idea-saved">{t('settings.githubIdea.saved')}</span> : null}
        </div>

        {err ? <p className="form-error">{err}</p> : null}
        {config.last_error && !err ? <p className="form-error">{config.last_error}</p> : null}

        <section className="github-idea-dispatches" aria-labelledby="github-idea-dispatch-title">
          <header>
            <div>
              <h3 id="github-idea-dispatch-title">{t('settings.githubIdea.dispatchTitle')}</h3>
              <p>{t('settings.githubIdea.dispatchHint')}</p>
            </div>
            <span>{dispatches.length}</span>
          </header>
          <div className="github-idea-dispatch-list">
            {dispatches.map((item) => (
              <article key={item.id} className="github-idea-dispatch-item">
                <div className="github-idea-dispatch-main">
                  <div className="github-idea-dispatch-title-row">
                    {item.source_url ? (
                      <a href={item.source_url} target="_blank" rel="noreferrer">{item.task_title || item.source_key}</a>
                    ) : <strong>{item.task_title || item.source_key}</strong>}
                    <span className={`github-idea-dispatch-state is-${item.execution_status || item.status}`}>
                      {dispatchStatusLabel(item.execution_status || item.status)}
                    </span>
                  </div>
                  <div className="github-idea-dispatch-meta">
                    <span>#{item.id}</span>
                    {item.task_type ? <span>{item.task_type}</span> : null}
                    {item.required_role ? <span>{item.required_role}</span> : null}
                    {(item.assigned_agent_name || item.recommended_agent_name) ? (
                      <span>{t('settings.githubIdea.dispatchAgent')}：{item.assigned_agent_name || item.recommended_agent_name}</span>
                    ) : null}
                    <time>{displayTime(item.created_at)}</time>
                  </div>
                  {item.match_reasons?.length ? (
                    <ul className="github-idea-dispatch-reasons">
                      {item.match_reasons.slice(0, 4).map((reason, index) => <li key={`${item.id}-${index}`}>{reason}</li>)}
                    </ul>
                  ) : null}
                  {item.failure_reason ? <p className="github-idea-dispatch-error">{item.failure_reason}</p> : null}
                </div>
                {item.retryable ? (
                  <div className="github-idea-dispatch-reassign">
                    <select
                      value={reassignChoices[item.id] || ''}
                      disabled={reassigningID === item.id}
                      aria-label={t('settings.githubIdea.reassignAgent')}
                      onChange={(event) => setReassignChoices((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    >
                      <option value="">{t('settings.githubIdea.reassignAgent')}</option>
                      {dispatchAgents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name} · {agent.job_role || t('settings.githubIdea.roleMissing')}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!reassignChoices[item.id] || reassigningID === item.id}
                      onClick={() => void reassign(item.id)}
                    >
                      {reassigningID === item.id ? t('settings.githubIdea.reassigning') : t('settings.githubIdea.reassign')}
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
            {!dispatches.length ? <p className="github-idea-dispatch-empty">{t('settings.githubIdea.noDispatches')}</p> : null}
          </div>
        </section>

        <details className="github-idea-logs">
          <summary>{t('settings.githubIdea.errorLogs')}（{config.error_logs?.length || 0}）</summary>
          {config.error_logs?.length ? (
            <ol>
              {[...config.error_logs].reverse().map((row, index) => (
                <li key={`${row.at}-${index}`}><time>{displayTime(row.at)}</time><span>{row.message}</span></li>
              ))}
            </ol>
          ) : <p>{t('settings.githubIdea.noErrors')}</p>}
        </details>
      </div>

      {agentPickerOpen ? (
        <div className="modal-mask github-idea-agent-mask" onMouseDown={() => setAgentPickerOpen(false)}>
          <section
            className="modal-card github-idea-agent-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="github-idea-agent-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="github-idea-agent-dialog-head">
              <div>
                <h2 id="github-idea-agent-title">{t('settings.githubIdea.selectAgents')}</h2>
                <p>{t('settings.githubIdea.agentsHint')}</p>
              </div>
              <button type="button" onClick={() => setAgentPickerOpen(false)} aria-label={t('settings.githubIdea.closePicker')}>×</button>
            </header>

            <fieldset className="github-idea-agent-picker" disabled={busy} aria-label={t('settings.githubIdea.selectAgents')}>
              <div className="github-idea-agent-list">
                {agents.map((agent) => (
                  <label key={agent.id} className="github-idea-agent">
                    <span className="github-idea-agent-copy">
                      <strong>{agent.name}</strong>
                      <small>{agent.folder_name || agent.engine || t('settings.githubIdea.ungrouped')}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={selected.has(Number(agent.id))}
                      onChange={(e) => toggleAgent(Number(agent.id), e.target.checked)}
                    />
                  </label>
                ))}
                {!agents.length ? <span className="engine-note">{t('settings.githubIdea.noAgents')}</span> : null}
              </div>
            </fieldset>

            <div className="github-idea-agent-dialog-foot">
              <span>{t('settings.githubIdea.selectedCount', { count: selectedAgents.length })}</span>
              <button type="button" className="primary" onClick={() => setAgentPickerOpen(false)}>{t('settings.githubIdea.done')}</button>
            </div>
          </section>
        </div>
      ) : null}
    </SettingsFold>
  )
}
