import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchAgentSettings,
  fetchAgentSkills,
  fetchLegacyMounts,
  fetchSkillStore,
  installAgentSkill,
  uninstallAgentSkill,
  updateAgentSettings,
  type AgentSettings,
  type AgentSkill,
  type LegacyMount,
} from '../api'
import { agentAvatarUrl } from '../utils/agentStatus'

type Tab = 'basic' | 'skills' | 'legacy'
type SkillsSub = 'installed' | 'store'

type Props = {
  open: boolean
  instanceId: string
  agentId: string
  /** Fallback title while settings load */
  agentName?: string
  onClose: () => void
}

const RISK_ZH: Record<string, string> = { low: '低风险', mid: '中风险', high: '高风险' }
const CAT_ZH: Record<string, string> = {
  engine: '引擎',
  data: '数据',
  ops: '运维',
  custom: '自定义',
  general: '通用',
}

/** Full-screen agent settings: rules / skills / legacy mounts (mobile) */
export function AgentSettingsSheet({
  open,
  instanceId,
  agentId,
  agentName,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>('basic')
  const [skillsSub, setSkillsSub] = useState<SkillsSub>('installed')
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [rulesDraft, setRulesDraft] = useState('')
  const [skills, setSkills] = useState<AgentSkill[]>([])
  const [store, setStore] = useState<AgentSkill[]>([])
  const [mounts, setMounts] = useState<LegacyMount[]>([])
  const [storeQ, setStoreQ] = useState('')
  const [storeCat, setStoreCat] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [detail, setDetail] = useState<AgentSkill | null>(null)

  /** Reset when opening a different agent */
  useEffect(() => {
    if (!open) return
    setTab('basic')
    setSkillsSub('installed')
    setErr(null)
    setOkMsg(null)
    setDetail(null)
    setSettings(null)
    setRulesDraft('')
  }, [open, agentId])

  /** Load basic settings */
  const loadSettings = useCallback(async () => {
    if (!instanceId || !agentId) return
    setLoading(true)
    setErr(null)
    try {
      const s = await fetchAgentSettings(instanceId, agentId)
      setSettings(s)
      setRulesDraft(s.rules_prompt ?? '')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载设置失败')
    } finally {
      setLoading(false)
    }
  }, [instanceId, agentId])

  /** Load installed skills list */
  const loadSkills = useCallback(async () => {
    if (!instanceId || !agentId) return
    setLoading(true)
    setErr(null)
    try {
      setSkills(await fetchAgentSkills(instanceId, agentId))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载技能失败')
    } finally {
      setLoading(false)
    }
  }, [instanceId, agentId])

  /** Load skill store */
  const loadStore = useCallback(async () => {
    if (!instanceId || !agentId) return
    setLoading(true)
    setErr(null)
    try {
      setStore(
        await fetchSkillStore(instanceId, agentId, {
          q: storeQ.trim() || undefined,
          category: storeCat || undefined,
        }),
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载商店失败')
    } finally {
      setLoading(false)
    }
  }, [instanceId, agentId, storeQ, storeCat])

  /** Load legacy mounts */
  const loadMounts = useCallback(async () => {
    if (!instanceId || !agentId) return
    setLoading(true)
    setErr(null)
    try {
      setMounts(await fetchLegacyMounts(instanceId, agentId))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载记忆失败')
    } finally {
      setLoading(false)
    }
  }, [instanceId, agentId])

  useEffect(() => {
    if (!open) return
    if (tab === 'basic') void loadSettings()
    else if (tab === 'skills' && skillsSub === 'installed') void loadSkills()
    else if (tab === 'skills' && skillsSub === 'store') void loadStore()
    else if (tab === 'legacy') void loadMounts()
  }, [open, tab, skillsSub, loadSettings, loadSkills, loadStore, loadMounts])

  const installedList = useMemo(() => skills.filter((s) => s.installed), [skills])
  const installedIds = useMemo(() => {
    const m = new Set<string>()
    for (const s of installedList) m.add(s.id)
    return m
  }, [installedList])

  /** Save rules_prompt */
  async function saveRules() {
    if (busy) return
    setBusy(true)
    setErr(null)
    setOkMsg(null)
    try {
      const s = await updateAgentSettings(instanceId, agentId, rulesDraft)
      setSettings(s)
      setRulesDraft(s.rules_prompt ?? '')
      setOkMsg('已保存')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  /** Install skill from store */
  async function onInstall(skillId: string) {
    if (busy) return
    setBusy(true)
    setErr(null)
    setOkMsg(null)
    try {
      const next = await installAgentSkill(instanceId, agentId, skillId)
      setSkills(next)
      setDetail(null)
      setOkMsg('已安装')
      if (skillsSub === 'store') await loadStore()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '安装失败')
    } finally {
      setBusy(false)
    }
  }

  /** Uninstall skill */
  async function onUninstall(skillId: string) {
    if (busy) return
    setBusy(true)
    setErr(null)
    setOkMsg(null)
    try {
      const next = await uninstallAgentSkill(instanceId, agentId, skillId)
      setSkills(next)
      setDetail(null)
      setOkMsg('已卸载')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '卸载失败')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const titleName = settings?.name || agentName || agentId

  return (
    <div className="settings-sheet-mask" role="presentation">
      <div
        className="settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`员工设置 · ${titleName}`}
      >
        <header className="settings-sheet-head">
          <button type="button" className="btn text" onClick={onClose} aria-label="关闭">
            ←
          </button>
          <h2 className="settings-sheet-title">设置 · {titleName}</h2>
          <span className="settings-sheet-spacer" />
        </header>

        <div className="settings-tabs" role="tablist">
          <button
            type="button"
            className={tab === 'basic' ? 'active' : ''}
            onClick={() => setTab('basic')}
          >
            基本
          </button>
          <button
            type="button"
            className={tab === 'skills' ? 'active' : ''}
            onClick={() => setTab('skills')}
          >
            技能
          </button>
          <button
            type="button"
            className={tab === 'legacy' ? 'active' : ''}
            onClick={() => setTab('legacy')}
          >
            继承记忆
          </button>
        </div>

        <div className="settings-sheet-body">
          {err ? <p className="error-banner">{err}</p> : null}
          {okMsg ? <p className="ok-banner">{okMsg}</p> : null}
          {loading && !settings && tab === 'basic' ? <p className="muted">加载中…</p> : null}

          {tab === 'basic' && settings ? (
            <div className="settings-basic">
              <p className="muted settings-meta-line">
                引擎 <strong>{settings.engine || '—'}</strong>
                {settings.skill_count > 0 ? ` · 技能 ${settings.skill_count}` : null}
              </p>
              <label className="settings-label">
                系统提示词
                <textarea
                  className="settings-textarea"
                  rows={12}
                  value={rulesDraft}
                  disabled={busy}
                  onChange={(e) => {
                    setRulesDraft(e.target.value)
                    setOkMsg(null)
                  }}
                />
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void saveRules()}
              >
                {busy ? '保存中…' : '保存'}
              </button>
            </div>
          ) : null}

          {tab === 'skills' ? (
            <div className="settings-skills">
              <div className="settings-subtabs" role="tablist">
                <button
                  type="button"
                  className={skillsSub === 'installed' ? 'active' : ''}
                  onClick={() => setSkillsSub('installed')}
                >
                  已安装
                  {installedList.length > 0 ? (
                    <span className="settings-tab-count">{installedList.length}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className={skillsSub === 'store' ? 'active' : ''}
                  onClick={() => setSkillsSub('store')}
                >
                  技能商店
                </button>
              </div>

              {skillsSub === 'installed' ? (
                loading && installedList.length === 0 ? (
                  <p className="muted">加载中…</p>
                ) : installedList.length === 0 ? (
                  <p className="muted">尚未安装技能。去「技能商店」浏览并安装。</p>
                ) : (
                  <ul className="skill-list">
                    {installedList.map((sk) => (
                      <li key={sk.id} className="skill-row">
                        <button
                          type="button"
                          className="skill-row-main"
                          onClick={() => setDetail(sk)}
                        >
                          <strong>{sk.name}</strong>
                          <span className="muted">{sk.summary || sk.id}</span>
                          {sk.risk ? (
                            <span className={`skill-risk risk-${sk.risk}`}>
                              {RISK_ZH[sk.risk] || sk.risk}
                            </span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          className="btn outline small danger-text"
                          disabled={busy}
                          onClick={() => void onUninstall(sk.id)}
                        >
                          卸载
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <>
                  <div className="skill-store-bar">
                    <input
                      className="agent-search-input"
                      placeholder="搜索技能…"
                      value={storeQ}
                      disabled={busy}
                      onChange={(e) => setStoreQ(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void loadStore()
                        }
                      }}
                    />
                    <select
                      value={storeCat}
                      disabled={busy}
                      onChange={(e) => setStoreCat(e.target.value)}
                    >
                      <option value="">全部分类</option>
                      {Object.entries(CAT_ZH).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn outline small"
                      disabled={busy || loading}
                      onClick={() => void loadStore()}
                    >
                      搜索
                    </button>
                  </div>
                  {loading && store.length === 0 ? (
                    <p className="muted">加载中…</p>
                  ) : store.length === 0 ? (
                    <p className="muted">无匹配技能</p>
                  ) : (
                    <ul className="skill-list">
                      {store.map((sk) => {
                        const has = installedIds.has(sk.id)
                        return (
                          <li key={sk.id} className="skill-row">
                            <button
                              type="button"
                              className="skill-row-main"
                              onClick={() => setDetail(sk)}
                            >
                              <strong>{sk.name}</strong>
                              <span className="muted">{sk.summary || sk.id}</span>
                            </button>
                            {has ? (
                              <span className="muted small">已装</span>
                            ) : (
                              <button
                                type="button"
                                className="btn primary small"
                                disabled={busy}
                                onClick={() => void onInstall(sk.id)}
                              >
                                安装
                              </button>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <p className="muted settings-hint">
                    数据库 / 服务器源配置请在 PC 端完成；本页支持安装与卸载。
                  </p>
                </>
              )}
            </div>
          ) : null}

          {tab === 'legacy' ? (
            <div className="settings-legacy">
              <p className="muted">
                已继承的离职记忆（最多 5 本）。认领请在 PC「数字员工记忆」书架操作。
              </p>
              {loading && mounts.length === 0 ? (
                <p className="muted">加载中…</p>
              ) : mounts.length === 0 ? (
                <p className="muted">尚未继承记忆。</p>
              ) : (
                <ul className="legacy-mount-list">
                  {mounts.map((m) => (
                    <li key={m.id} className="legacy-mount-item">
                      <img
                        className="agent-avatar"
                        src={agentAvatarUrl({ avatar_url: m.source_avatar_url })}
                        alt=""
                      />
                      <div>
                        <strong>{m.source_agent_name}</strong>
                        <span className="muted">{m.source_job_title || '数字员工'}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="btn outline small"
                disabled={busy || loading}
                onClick={() => void loadMounts()}
              >
                刷新
              </button>
            </div>
          ) : null}
        </div>

        {detail ? (
          <div className="modal-mask" onClick={() => setDetail(null)}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <header className="modal-head">
                <h3>{detail.name}</h3>
                <button
                  type="button"
                  className="btn text modal-x"
                  onClick={() => setDetail(null)}
                  aria-label="关闭"
                >
                  ×
                </button>
              </header>
              <div className="modal-body">
                <p className="muted">{detail.summary}</p>
                {detail.description ? <p>{detail.description}</p> : null}
                {detail.category ? (
                  <p className="muted">分类：{CAT_ZH[detail.category] || detail.category}</p>
                ) : null}
              </div>
              <footer className="modal-foot">
                {detail.installed ? (
                  <button
                    type="button"
                    className="btn outline"
                    disabled={busy}
                    onClick={() => void onUninstall(detail.id)}
                  >
                    卸载
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void onInstall(detail.id)}
                  >
                    安装
                  </button>
                )}
              </footer>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
