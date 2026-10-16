import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { agentAvatarUrl } from './agentAvatar.js'
import {
  MAX_CHAT_IMAGES,
  appendPendingImages,
  ensureUploadedAttachments,
  imageFilesFromDataTransfer,
  revokePendingImages,
} from './chatImages.js'
import { ChatAttachPreview, ChatLightbox, ChatMessageImages } from './ChatImageUI.jsx'

const API = '/api'
marked.setOptions({ breaks: true, gfm: true })

/** 解析 SSE buffer（与管理台 Ask 同一格式）。 */
function parseSSE(buf) {
  const events = []
  let rest = buf
  while (true) {
    const i = rest.indexOf('\n\n')
    if (i < 0) break
    const block = rest.slice(0, i)
    rest = rest.slice(i + 2)
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue
      try { events.push(JSON.parse(line.slice(5).trim())) } catch { /* ignore */ }
    }
  }
  return { events, rest }
}

/**
 * 首页前台对话：Kimi 风黑白布局 + 访客登记 + 唯一前台助理。
 */
export default function PublicHome({ authToken, onLogin, onOpenAdmin, guideLogin = false }) {
  const [receptionist, setReceptionist] = useState(null) // null=loading
  const [visitor, setVisitor] = useState({ registered: false, name: '' })
  const [registerOpen, setRegisterOpen] = useState(false)
  const [registerName, setRegisterName] = useState('')
  const [registerBusy, setRegisterBusy] = useState(false)
  const [registerErr, setRegisterErr] = useState('')
  const [chatLog, setChatLog] = useState([])
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ctxUsed, setCtxUsed] = useState(0)
  const [ctxWindow, setCtxWindow] = useState(0)
  const [ctxEstimated, setCtxEstimated] = useState(true)
  const [showJumpBottom, setShowJumpBottom] = useState(false)
  const [pendingImages, setPendingImages] = useState([])
  const [lightboxSrc, setLightboxSrc] = useState('')
  const [attachBusy, setAttachBusy] = useState(false)
  const boxRef = useRef(null)
  const abortRef = useRef(null)
  const stickBottom = useRef(true)

  const configured = !!(receptionist && receptionist.configured)
  const ctxPct = ctxWindow > 0 ? Math.min(100, Math.round((ctxUsed / ctxWindow) * 100)) : 0
  const recvAvatar = agentAvatarUrl(receptionist || {})
  const ctxTip = ctxWindow > 0
    ? `${ctxEstimated ? '约 ' : ''}${ctxPct}%`
    : '上下文用量未知'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [rRes, vRes] = await Promise.all([
          fetch(`${API}/public/receptionist`),
          fetch(`${API}/public/visitor/me`, { credentials: 'include' }),
        ])
        const r = await rRes.json().catch(() => ({}))
        const v = await vRes.json().catch(() => ({ registered: false }))
        if (cancelled) return
        setReceptionist(r)
        setVisitor({ registered: !!v.registered, name: v.name || '' })
        if (v.registered) {
          await loadMessages()
          await refreshContext()
        }
      } catch {
        if (!cancelled) setReceptionist({ configured: false })
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    if (stickBottom.current) {
      el.scrollTop = el.scrollHeight
      setShowJumpBottom(false)
    } else {
      setShowJumpBottom(el.scrollHeight > el.clientHeight + 40)
    }
  }, [chatLog, loading])

  // 根据滚动位置决定是否显示「回到底部」
  function updateStickFromScroll() {
    const el = boxRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stickBottom.current = nearBottom
    setShowJumpBottom(!nearBottom && el.scrollHeight > el.clientHeight + 40)
  }

  function jumpToBottom() {
    const el = boxRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    stickBottom.current = true
    setShowJumpBottom(false)
  }

  async function loadMessages() {
    try {
      const res = await fetch(`${API}/public/messages`, { credentials: 'include' })
      if (res.status === 401) return
      const d = await res.json()
      const items = (d.items || []).filter((m) => m.role === 'user' || m.role === 'assistant')
      setChatLog(items.map((m) => {
        let meta = null
        if (m.meta_json) {
          try { meta = typeof m.meta_json === 'string' ? JSON.parse(m.meta_json) : m.meta_json } catch { /* ignore */ }
        }
        return {
          role: m.role,
          content: m.content || '',
          attachments: Array.isArray(meta?.attachments) ? meta.attachments : [],
          error: m.status === 'error',
          time: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
        }
      }))
    } catch { /* ignore */ }
  }

  async function refreshContext() {
    try {
      const res = await fetch(`${API}/public/context`, { credentials: 'include' })
      if (!res.ok) return
      const d = await res.json()
      setCtxUsed(Number(d.used_tokens) || 0)
      setCtxWindow(Number(d.window_tokens) || 0)
      setCtxEstimated(d.estimated !== false)
    } catch { /* ignore */ }
  }

  function ensureRegistered() {
    if (visitor.registered) return true
    setRegisterOpen(true)
    return false
  }

  async function submitRegister(e) {
    e?.preventDefault?.()
    const name = registerName.trim()
    if (!name || registerBusy) return
    setRegisterBusy(true)
    setRegisterErr('')
    try {
      const res = await fetch(`${API}/public/visitor/register`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || '登记失败')
      setVisitor({ registered: true, name: d.name || name })
      setRegisterOpen(false)
      setRegisterName('')
    } catch (err) {
      setRegisterErr(String(err.message || err))
    } finally {
      setRegisterBusy(false)
    }
  }

  async function newConversation() {
    if (!configured || !ensureRegistered() || loading) return
    try {
      const res = await fetch(`${API}/public/conversations/new`, {
        method: 'POST',
        credentials: 'include',
      })
      if (res.status === 401) { setRegisterOpen(true); return }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || '新建失败')
        return
      }
      setChatLog([])
      setCtxUsed(0)
      setError('')
      setPendingImages((prev) => {
        revokePendingImages(prev)
        return []
      })
    } catch (err) {
      setError(String(err))
    }
  }

  /** 粘贴/拖入图片 */
  function ingestComposerImages(files) {
    if (!files?.length) return
    setPendingImages((prev) => {
      const { next, overflow } = appendPendingImages(prev, files)
      if (overflow) setError(`最多附带 ${MAX_CHAT_IMAGES} 张图片`)
      return next
    })
  }

  function onComposerPaste(e) {
    const files = imageFilesFromDataTransfer(e.clipboardData)
    if (!files.length) return
    e.preventDefault()
    if (!ensureRegistered()) return
    ingestComposerImages(files)
  }

  function onComposerDragOver(e) {
    if (![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function onComposerDrop(e) {
    const files = imageFilesFromDataTransfer(e.dataTransfer)
    if (!files.length) return
    e.preventDefault()
    if (!ensureRegistered()) return
    ingestComposerImages(files)
  }

  function removePendingImage(localId) {
    setPendingImages((prev) => {
      const hit = prev.find((x) => x.localId === localId)
      if (hit) revokePendingImages([hit])
      return prev.filter((x) => x.localId !== localId)
    })
  }

  async function sendQuestion(q) {
    if (!configured) return
    if (!ensureRegistered()) return
    q = (q || '').trim()
    const pending = pendingImages
    if ((!q && !pending.length) || loading || attachBusy) return
    let atts = []
    if (pending.length) {
      setAttachBusy(true)
      setError('')
      try {
        atts = await ensureUploadedAttachments(
          pending,
          (localId, patch) => {
            setPendingImages((prev) => prev.map((x) => (x.localId === localId ? { ...x, ...patch } : x)))
          },
          { endpoint: `${API}/public/chat-images`, credentials: 'include' },
        )
      } catch (err) {
        setError(String(err.message || err))
        setAttachBusy(false)
        return
      }
      setAttachBusy(false)
    }
    setLoading(true)
    setError('')
    setQuestion('')
    revokePendingImages(pending)
    setPendingImages([])
    stickBottom.current = true
    setChatLog((prev) => [
      ...prev,
      { role: 'user', content: q, attachments: atts, time: Date.now() },
      { role: 'assistant', content: '', time: Date.now() },
    ])
    const ac = new AbortController()
    abortRef.current = ac
    let answer = ''
    try {
      const res = await fetch(`${API}/public/ask`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, attachments: atts }),
        signal: ac.signal,
      })
      if (res.status === 401) {
        setRegisterOpen(true)
        setChatLog((prev) => prev.slice(0, -2))
        return
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parsed = parseSSE(buf)
        buf = parsed.rest
        for (const ev of parsed.events) {
          if (ev.type === 'chunk') {
            const piece = (ev.content || '').replace(/\\n/g, '\n')
            answer += piece
            setChatLog((prev) => {
              const n = [...prev]
              const last = n[n.length - 1]
              if (last?.role === 'assistant') {
                n[n.length - 1] = { ...last, content: (last.content || '') + piece }
              }
              return n
            })
          } else if (ev.type === 'usage') {
            if (ev.used_tokens != null) setCtxUsed(Number(ev.used_tokens) || 0)
            if (ev.window_tokens != null) setCtxWindow(Number(ev.window_tokens) || 0)
            if (ev.estimated != null) setCtxEstimated(!!ev.estimated)
          } else if (ev.type === 'error') {
            setChatLog((prev) => {
              const n = [...prev]
              const last = n[n.length - 1]
              if (last?.role === 'assistant') {
                n[n.length - 1] = {
                  ...last,
                  content: answer ? `${answer}\n\n❌ ${ev.message || '出错了'}` : `❌ ${ev.message || '出错了'}`,
                  error: true,
                }
              }
              return n
            })
          }
        }
      }
      await refreshContext()
    } catch (err) {
      if (err?.name === 'AbortError') {
        setChatLog((prev) => {
          const n = [...prev]
          const last = n[n.length - 1]
          if (last?.role === 'assistant') {
            n[n.length - 1] = { ...last, content: (last.content || '') + '\n\n⏹ 已停止' }
          }
          return n
        })
      } else {
        setError(String(err.message || err))
        setChatLog((prev) => {
          const n = [...prev]
          const last = n[n.length - 1]
          if (last?.role === 'assistant' && !last.content) {
            n[n.length - 1] = { ...last, content: `❌ ${err.message || err}`, error: true }
          }
          return n
        })
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  function onComposerFocus() {
    if (configured && !visitor.registered) setRegisterOpen(true)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendQuestion(question)
    }
  }

  const canSend = !!(question.trim() || pendingImages.length) && !loading && !attachBusy && configured

  return (
    <div className="ph-app">
      <header className="ph-top">
        <img className="brand-logo ph-logo" src="/brand-jellyfish-white.png" alt="Atolla" width="28" height="28" />
        <div className="ph-brand">
          <div className="ph-avatar">
            {configured
              ? <img src={recvAvatar} alt="" />
              : (receptionist?.name || '前').slice(0, 1)}
          </div>
          <div>
            <div className="ph-name">{configured ? receptionist.name : '数字人前台'}</div>
            <div className="ph-sub">
              {configured
                ? (visitor.registered ? `前台助理 · 来访者 ${visitor.name}` : '前台助理 · 请先登记')
                : '暂未设置前台助理'}
            </div>
          </div>
        </div>
        <div className="ph-top-actions">
          {configured && visitor.registered && (
            <button type="button" className="ph-ghost" onClick={newConversation} disabled={loading}>新建对话</button>
          )}
          {authToken ? (
            <button type="button" className="ph-ghost" onClick={onOpenAdmin}>管理台</button>
          ) : (
            <span className="ph-login-wrap">
              <button
                type="button"
                className={`ph-ghost${guideLogin ? ' ph-login-guide' : ''}`}
                onClick={onLogin}
                aria-describedby={guideLogin ? 'login-guide-tip' : undefined}
              >
                登录
              </button>
              {guideLogin && (
                <span id="login-guide-tip" className="ph-login-tip" role="status">点这里登录。首次需要注册管理员账号。</span>
              )}
            </span>
          )}
        </div>
      </header>

      {!configured ? (
        <div className="ph-empty">
          <h2>暂未设置前台助理</h2>
          <p>管理员可在后台「数字人 → 数字人管理」中指定一位数字人站在前台接待来访者。</p>
        </div>
      ) : (
        <>
          <div className="ph-chat-wrap">
            <div
              className="ph-chat"
              ref={boxRef}
              onScroll={updateStickFromScroll}
            >
              {chatLog.length === 0 && (
                <div className="ph-opening ph-rise">
                  你好，我是 <strong>{receptionist.name}</strong>。有问题可以直接问我。
                </div>
              )}
              {chatLog.map((m, i) => (
                <div key={i} className={`ph-msg ${m.role} ph-rise`} style={{ animationDelay: `${Math.min(i, 6) * 0.04}s` }}>
                  <div className="ph-who">
                    {m.role === 'user'
                      ? '访'
                      : <img src={recvAvatar} alt="" />}
                  </div>
                  <div className={`ph-bubble ${m.error ? 'err' : ''}`}>
                    {m.role === 'user' && (m.attachments || []).length > 0 && (
                      <ChatMessageImages attachments={m.attachments} onOpen={setLightboxSrc} />
                    )}
                    {m.role === 'assistant' && !m.content && loading && i === chatLog.length - 1 ? (
                      <span className="ph-typing"><i /><i /><i /></span>
                    ) : m.content ? (
                      <div dangerouslySetInnerHTML={{ __html: marked.parse(m.content || '') }} />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {showJumpBottom && (
              <button
                type="button"
                className="ph-jump-bottom"
                onClick={jumpToBottom}
                title="回到底部"
                aria-label="回到底部"
              >
                <span className="ph-jump-arrow" aria-hidden>↓</span>
              </button>
            )}
          </div>

          {error && <p className="ph-error">{error}</p>}

          <div className="ph-composer-wrap">
            <div
              className={`ph-composer ${!visitor.registered ? 'locked' : ''}`}
              onDragOver={onComposerDragOver}
              onDrop={onComposerDrop}
            >
              <ChatAttachPreview items={pendingImages} onRemove={removePendingImage} />
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onFocus={onComposerFocus}
                onKeyDown={onKeyDown}
                onPaste={onComposerPaste}
                placeholder={visitor.registered ? '有问题尽管问…可粘贴图片' : '登记后来访再提问…'}
                disabled={!configured}
                rows={2}
              />
              <div className="ph-composer-bar">
                <div className="ph-ctx" title={ctxTip} aria-label={ctxTip}>
                  <div className="ph-ring" style={{ '--p': ctxPct }} />
                </div>
                <div className="ph-actions">
                  {loading ? (
                    <button
                      type="button"
                      className="ph-send ph-stop"
                      onClick={() => abortRef.current?.abort()}
                      aria-label="终止"
                      title="终止"
                    >■</button>
                  ) : (
                    <button
                      type="button"
                      className="ph-send"
                      disabled={!canSend}
                      onClick={() => sendQuestion(question)}
                      aria-label="发送"
                      title={attachBusy ? '上传中…' : '发送'}
                    >{attachBusy ? '…' : '↑'}</button>
                  )}
                </div>
              </div>
            </div>
            <div className="ph-hint">Enter 发送 · Shift+Enter 换行 · 可粘贴/拖入图片</div>
          </div>
        </>
      )}

      <ChatLightbox src={lightboxSrc} onClose={() => setLightboxSrc('')} />

      {registerOpen && (
        <div className="ph-modal-mask" onClick={() => !registerBusy && setRegisterOpen(false)}>
          <form className="ph-modal" onClick={(e) => e.stopPropagation()} onSubmit={submitRegister}>
            <h3>来访登记</h3>
            <p>请填写姓名后开始对话。凭证保存在 Cookie，7 天内有效；期间有对话会自动续期。</p>
            <input
              value={registerName}
              onChange={(e) => setRegisterName(e.target.value)}
              placeholder="来访者姓名"
              maxLength={32}
              autoFocus
              disabled={registerBusy}
            />
            {registerErr && <p className="ph-error">{registerErr}</p>}
            <div className="ph-modal-actions">
              <button type="button" disabled={registerBusy} onClick={() => setRegisterOpen(false)}>取消</button>
              <button type="submit" className="ph-primary" disabled={registerBusy || !registerName.trim()}>
                {registerBusy ? '登记中…' : '开始对话'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
