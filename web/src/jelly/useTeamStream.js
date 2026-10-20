import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyTeamEvent,
  emptyTeamState,
  parseTeamSSE,
  snapshotFromClassic,
} from './teamStreamAdapter.js'

const API = '/api'

/**
 * 订阅团队 SSE；404/失败时回落轮询（由外部 pushFallback 喂 snapshot）。
 * @param {string|number|null} teamId 工作组/文件夹 id
 * @param {{ authHeaders: Function, enabled?: boolean, onUnauthorized?: Function }} opts
 */
export function useTeamStream(teamId, { authHeaders, enabled = true, onUnauthorized } = {}) {
  const [state, setState] = useState(emptyTeamState)
  const [transport, setTransport] = useState('idle') // idle | sse | poll
  const lastIdRef = useRef('')
  const esRef = useRef(null)
  const abortRef = useRef(null)

  const apply = useCallback((ev) => {
    setState((prev) => applyTeamEvent(prev, ev))
    if (ev?.seq != null) lastIdRef.current = String(ev.seq)
  }, [])

  /** 外部轮询得到的经典数据 → 灌进 reducer */
  const pushFallbackSnapshot = useCallback((payload) => {
    apply(snapshotFromClassic(payload))
    setTransport((t) => (t === 'sse' ? t : 'poll'))
  }, [apply])

  useEffect(() => {
    if (!enabled || teamId == null || teamId === '') {
      setTransport('idle')
      return undefined
    }
    let cancelled = false
    const headers = authHeaders?.() || {}
    const ctrl = new AbortController()
    abortRef.current = ctrl

    async function connect() {
      const url = `${API}/teams/${encodeURIComponent(teamId)}/stream`
      const h = { ...headers, Accept: 'text/event-stream' }
      if (lastIdRef.current) h['Last-Event-ID'] = lastIdRef.current
      try {
        const res = await fetch(url, { headers: h, signal: ctrl.signal })
        if (cancelled) return
        if (res.status === 401) {
          onUnauthorized?.()
          setTransport('poll')
          return
        }
        if (!res.ok || !res.body) {
          setTransport('poll')
          return
        }
        setTransport('sse')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (!cancelled) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const parsed = parseTeamSSE(buf)
          buf = parsed.rest
          if (parsed.lastId) lastIdRef.current = parsed.lastId
          for (const ev of parsed.events) apply(ev)
        }
        if (!cancelled) setTransport('poll')
      } catch (err) {
        if (err?.name === 'AbortError') return
        if (!cancelled) setTransport('poll')
      }
    }

    connect()
    return () => {
      cancelled = true
      ctrl.abort()
      esRef.current?.close?.()
    }
  }, [teamId, enabled, authHeaders, onUnauthorized, apply])

  return { state, transport, applyEvent: apply, pushFallbackSnapshot, lastSeq: state.seq }
}
