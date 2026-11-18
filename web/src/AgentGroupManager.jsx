import { useEffect, useMemo, useState } from 'react'
import JellyAvatar from './JellyAvatar.jsx'
import { resolveJellyColor } from './jellyColor.js'
import { useLocale } from './i18n/useLocale.js'

const API = '/api'

/** 现代工作台的工作组管理：承接经典列表中的建组、改名、删除和人员归类能力。 */
export default function AgentGroupManager({ open, authHeaders, onUnauthorized, onClose, onChanged }) {
  const { t } = useLocale()
  const [folders, setFolders] = useState([])
  const [agents, setAgents] = useState([])
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(0)
  const [editingName, setEditingName] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const sortedAgents = useMemo(
    () => [...agents].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN')),
    [agents],
  )

  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: authHeaders(options.headers || {}) })
    if (response.status === 401) {
      onUnauthorized?.()
      throw new Error(t('modern.groupManager.expired'))
    }
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || t('modern.groupManager.failed'))
    return data
  }

  async function load() {
    const [folderData, agentData] = await Promise.all([
      request(`${API}/admin/agent-folders`),
      request(`${API}/admin/agents`),
    ])
    setFolders(folderData.items || [])
    setAgents(agentData.items || [])
  }

  useEffect(() => {
    if (!open) return
    setError('')
    setConfirmDeleteId(0)
    void load().catch((err) => setError(err.message))
    // authHeaders 由 App 内联提供；仅以打开状态作为加载边界，避免父级渲染导致重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function run(action) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      await onChanged?.()
    } catch (err) {
      setError(err.message || t('modern.groupManager.failed'))
    } finally {
      setBusy(false)
    }
  }

  function createFolder(event) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return
    void run(async () => {
      await request(`${API}/admin/agent-folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      setNewName('')
    })
  }

  function saveFolder(folderId) {
    const name = editingName.trim()
    if (!name) return
    void run(async () => {
      await request(`${API}/admin/agent-folders/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      setEditingId(0)
      setEditingName('')
    })
  }

  function deleteFolder(folderId) {
    if (confirmDeleteId !== folderId) {
      setConfirmDeleteId(folderId)
      return
    }
    void run(async () => {
      await request(`${API}/admin/agent-folders/${folderId}`, { method: 'DELETE' })
      setConfirmDeleteId(0)
    })
  }

  function moveAgent(agentId, folderId) {
    void run(async () => {
      await request(`${API}/admin/agents/${agentId}/folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: Number(folderId) || 0 }),
      })
    })
  }

  if (!open) return null

  return (
    <div className="modal-mask modern-group-manager-mask" onMouseDown={() => !busy && onClose?.()}>
      <section className="modal-card modern-group-manager" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="modern-group-manager-title">
        <header className="modern-group-manager-head">
          <div>
            <h2 id="modern-group-manager-title">{t('modern.groupManager.title')}</h2>
            <p>{t('modern.groupManager.hint')}</p>
          </div>
          <button type="button" disabled={busy} onClick={onClose} aria-label={t('modern.groupManager.close')}>×</button>
        </header>

        {error && <p className="modern-group-manager-error">{error}</p>}

        <form className="modern-group-create" onSubmit={createFolder}>
          <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t('modern.groupManager.newPlaceholder')} disabled={busy} />
          <button type="submit" disabled={busy || !newName.trim()}>{t('modern.groupManager.create')}</button>
        </form>

        <div className="modern-group-manager-body">
          <section className="modern-group-section">
            <h3>{t('modern.groupManager.groups')}</h3>
            <div className="modern-group-list">
              {folders.map((folder) => (
                <div className="modern-group-row-item" key={folder.id}>
                  {editingId === folder.id ? (
                    <input value={editingName} onChange={(event) => setEditingName(event.target.value)} disabled={busy} autoFocus />
                  ) : (
                    <strong>{folder.name}</strong>
                  )}
                  <span>{agents.filter((agent) => Number(agent.folder_id) === Number(folder.id)).length}</span>
                  {editingId === folder.id ? (
                    <>
                      <button type="button" disabled={busy || !editingName.trim()} onClick={() => saveFolder(folder.id)}>{t('modern.groupManager.save')}</button>
                      <button type="button" disabled={busy} onClick={() => setEditingId(0)}>{t('modern.groupManager.cancel')}</button>
                    </>
                  ) : (
                    <>
                      <button type="button" disabled={busy} onClick={() => { setEditingId(folder.id); setEditingName(folder.name || ''); setConfirmDeleteId(0) }}>{t('modern.groupManager.rename')}</button>
                      <button type="button" className={confirmDeleteId === folder.id ? 'danger-confirm' : ''} disabled={busy} onClick={() => deleteFolder(folder.id)}>
                        {confirmDeleteId === folder.id ? t('modern.groupManager.confirmDelete') : t('modern.groupManager.delete')}
                      </button>
                    </>
                  )}
                </div>
              ))}
              {!folders.length && <p className="modern-group-empty">{t('modern.groupManager.noGroups')}</p>}
            </div>
          </section>

          <section className="modern-group-section modern-group-members">
            <h3>{t('modern.groupManager.members')}</h3>
            <div className="modern-group-member-list">
              {sortedAgents.map((agent) => (
                <label key={agent.id}>
                  <span>
                    <JellyAvatar color={resolveJellyColor(agent)} size={24} state="idle" />
                    <strong>{agent.name}</strong>
                  </span>
                  <select value={Number(agent.folder_id) || 0} disabled={busy} onChange={(event) => moveAgent(agent.id, event.target.value)}>
                    <option value="0">{t('modern.ungrouped')}</option>
                    {folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}
                  </select>
                </label>
              ))}
              {!sortedAgents.length && <p className="modern-group-empty">{t('modern.groupManager.noMembers')}</p>}
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}
