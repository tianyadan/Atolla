import { useEffect, useRef } from 'react'

const RAIL = 56
const DRAWER = 480

/**
 * 深海水母 Canvas：铃呼吸、触手弹簧、脉冲与报警环。
 * 视觉与物理来自 uploads/index.html 原型。
 */
export default function JellyCanvas({
  agents = [],
  hasAlarm = false,
  drawerOpen = false,
  handoffs = [],
  onSelectAgent,
  onEmptyClick,
  askValue,
  onAskChange,
  onAskSubmit,
  askPlaceholder = '轻轻说一句，交给团队…',
}) {
  const canvasRef = useRef(null)
  const askRef = useRef(null)
  const labelsRef = useRef(null)
  const worldRef = useRef(null)
  const agentsRef = useRef(agents)
  const alarmRef = useRef(hasAlarm)
  const drawerRef = useRef(drawerOpen)
  const handoffsRef = useRef(handoffs)
  const hoverRef = useRef(null)
  const drawerAgentRef = useRef(null)
  const callbacksRef = useRef({ onSelectAgent, onEmptyClick })

  // 动画循环读 ref，避免每帧触发 React 重渲染
  useEffect(() => {
    agentsRef.current = agents
    alarmRef.current = hasAlarm
    drawerRef.current = drawerOpen
    handoffsRef.current = handoffs
    callbacksRef.current = { onSelectAgent, onEmptyClick }
  }, [agents, hasAlarm, drawerOpen, handoffs, onSelectAgent, onEmptyClick])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return undefined
    const g = cv.getContext('2d')
    let W = 0
    let H = 0
    let DPR = Math.min(2, window.devicePixelRatio || 1)
    let T = 0
    let last = performance.now()
    let raf = 0
    let stageCx = 0
    let stageS = 1
    let baseA = 0
    let baseB = 0
    let bell = { cx: 0, cy: 0, a: 0, b: 0 }
    let tents = []
    let fine = []
    let snow = []

    function stageTarget() {
      const right = drawerRef.current ? DRAWER : 0
      return { cx: RAIL + (W - RAIL - right) / 2, s: drawerRef.current ? 0.86 : 1 }
    }

    function rim(u, br) {
      const { cx, cy, a } = bell
      const th = Math.PI * (1 - u)
      const w = a * (1 + 0.05 * br)
      return { x: cx + Math.cos(th) * w, y: cy + Math.sin(th) * bell.b * 0.16 + 6 }
    }

    function mkT(u, len, a) {
      const n = a ? 34 : 18
      const seg = len / n
      const p = []
      const r = rim(u, 0)
      for (let i = 0; i < n; i++) p.push({ x: r.x, y: r.y + i * seg, px: r.x, py: r.y + i * seg })
      return { u, p, seg, a, ph: u * 2.2 + (a ? 0 : Math.random() * 0.6), pulse: Math.random() }
    }

    function syncAgents() {
      const list = agentsRef.current || []
      const byId = new Map(tents.filter((t) => t.a).map((t) => [String(t.a.id), t]))
      const next = []
      list.forEach((a) => {
        const id = String(a.id)
        const old = byId.get(id)
        if (old) {
          old.a = a
          // 平滑挪 rim 参数
          old.u += (a.u - old.u) * 0.15
          next.push(old)
          byId.delete(id)
        } else {
          next.push(mkT(a.u, a.len * H * (a.lead ? 1.05 : 0.9), a))
        }
      })
      tents = next
      // 标签 DOM
      const L = labelsRef.current
      if (L) {
        L.innerHTML = ''
        tents.forEach((t) => {
          const d = document.createElement('div')
          L.appendChild(d)
          t.el = d
        })
      }
    }

    function build() {
      const st = stageTarget()
      stageCx = st.cx
      stageS = st.s
      baseA = Math.min(215, W * 0.16)
      baseB = Math.min(135, H * 0.16)
      bell = { cx: stageCx, cy: H * 0.32, a: baseA * stageS, b: baseB * stageS }
      tents = []
      fine = []
      for (let i = 0; i < 34; i++) {
        const u = (i + 0.5) / 34
        fine.push(mkT(u, H * (0.18 + 0.22 * Math.abs(Math.sin(i * 1.7))), null))
      }
      snow = []
      for (let i = 0; i < 140; i++) {
        snow.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: Math.random() * 1.3 + 0.2,
          v: Math.random() * 0.15 + 0.03,
          o: Math.random() * 0.5 + 0.1,
        })
      }
      syncAgents()
      for (let i = 0; i < 600; i++) step(1 / 60)
      renderLabels()
    }

    function rs() {
      W = cv.clientWidth || window.innerWidth
      H = cv.clientHeight || window.innerHeight
      DPR = Math.min(2, window.devicePixelRatio || 1)
      cv.width = W * DPR
      cv.height = H * DPR
      g.setTransform(DPR, 0, 0, DPR, 0, 0)
    }

    function step(dt) {
      T += dt
      const br = Math.sin(T * 1.1)
      const st = stageTarget()
      const e = 1 - Math.pow(0.002, dt)
      stageCx += (st.cx - stageCx) * e
      stageS += (st.s - stageS) * e
      bell.cx = stageCx
      bell.a = baseA * stageS
      bell.b = baseB * stageS
      const curr = Math.sin(T * 0.35) * 0.6
      for (const t of [...fine, ...tents]) {
        const r = rim(t.u, br)
        t.p[0].x = r.x
        t.p[0].y = r.y
        const idle = t.a && t.a.s === 'idle'
        const spread = (t.u - 0.5) * (t.a ? 1.0 : 0.8)
        for (let i = 1; i < t.p.length; i++) {
          const q = t.p[i]
          const vx = (q.x - q.px) * 0.96
          const vy = (q.y - q.py) * 0.96
          q.px = q.x
          q.py = q.y
          const k = i / t.p.length
          const sway = Math.sin(T * (idle ? 0.6 : 1.0) + t.ph + k * 3.6) * (idle ? 0.06 : 0.11) * k
            + curr * 0.05 * k
            + spread * 0.17 * (1 - k * 0.7)
          const kick = Math.max(0, Math.sin(T * 1.1 - k * 4)) * 0.04 * (1 - k)
          q.x += vx + sway
          q.y += vy + (idle ? 0.06 : 0.045) - kick
        }
        for (let it = 0; it < 6; it++) {
          for (let i = 1; i < t.p.length; i++) {
            const A = t.p[i - 1]
            const B = t.p[i]
            const dx = B.x - A.x
            const dy = B.y - A.y
            const d = Math.hypot(dx, dy) || 1
            const df = (d - t.seg) / d
            if (i === 1) {
              B.x -= dx * df
              B.y -= dy * df
            } else {
              A.x += dx * df * 0.5
              A.y += dy * df * 0.5
              B.x -= dx * df * 0.5
              B.y -= dy * df * 0.5
            }
          }
        }
        t.pulse = (t.pulse + dt * (t.a && t.a.lead ? 0.34 : 0.24)) % 1
      }
      for (const s of snow) {
        s.y -= s.v
        s.x += Math.sin(T * 0.3 + s.y * 0.01) * 0.08
        if (s.y < -5) {
          s.y = H + 5
          s.x = Math.random() * W
        }
      }
    }

    function curve(p) {
      g.beginPath()
      g.moveTo(p[0].x, p[0].y)
      for (let i = 1; i < p.length - 1; i++) {
        const mx = (p[i].x + p[i + 1].x) / 2
        const my = (p[i].y + p[i + 1].y) / 2
        g.quadraticCurveTo(p[i].x, p[i].y, mx, my)
      }
      g.lineTo(p[p.length - 1].x, p[p.length - 1].y)
    }

    function drawBell(br) {
      const { cx, cy, a, b } = bell
      const w = a * (1 + 0.05 * br)
      const h = b * (1 - 0.07 * br)
      const N = 26
      function top(th) {
        const s = Math.sin(th)
        return {
          x: cx + Math.cos(th) * w,
          y: cy - Math.pow(s, 0.55) * h * (1 - 0.08 * Math.pow(Math.cos(th), 2)),
        }
      }
      g.save()
      g.beginPath()
      for (let i = 0; i <= 120; i++) {
        const th = (Math.PI * i) / 120
        const q = top(th)
        if (i) g.lineTo(q.x, q.y)
        else g.moveTo(q.x, q.y)
      }
      for (let i = 0; i <= N * 8; i++) {
        const u = 1 - i / (N * 8)
        const th = Math.PI * (1 - u)
        const lap = Math.pow(Math.abs(Math.sin(u * N * Math.PI)), 0.6)
        const x = cx + Math.cos(th) * w * (1 - 0.015 * lap)
        const y = cy + Math.sin(th) * b * 0.16 + lap * (10 + 3 * Math.sin(T * 2 + u * 20))
        g.lineTo(x, y)
      }
      g.closePath()
      let gr = g.createRadialGradient(cx, cy - h * 0.35, 4, cx, cy, w * 1.05)
      gr.addColorStop(0, 'rgba(150,28,48,.70)')
      gr.addColorStop(0.35, 'rgba(110,22,46,.42)')
      gr.addColorStop(0.7, 'rgba(70,40,90,.18)')
      gr.addColorStop(1, 'rgba(90,120,200,.06)')
      g.fillStyle = gr
      g.fill()
      g.strokeStyle = 'rgba(255,190,210,.22)'
      g.lineWidth = 1
      g.stroke()
      g.clip()
      g.beginPath()
      g.ellipse(cx, cy - h * 0.18, w * 0.62, h * 0.42, 0, Math.PI, 2 * Math.PI)
      g.strokeStyle = 'rgba(255,170,190,.18)'
      g.lineWidth = 2
      g.stroke()
      for (let i = 0; i < N; i++) {
        const u = (i + 0.5) / N
        const th = Math.PI * (1 - u)
        const x1 = cx + Math.cos(th) * w * 0.62
        const y1 = cy - h * 0.18 - Math.sin(th) * h * 0.42
        const x2 = cx + Math.cos(th) * w * 0.99
        const y2 = cy + Math.sin(th) * b * 0.16 + 8
        g.beginPath()
        g.moveTo(x1, y1)
        g.quadraticCurveTo((x1 + x2) / 2 + Math.cos(th) * 8, (y1 + y2) / 2, x2, y2)
        g.strokeStyle = 'rgba(255,200,220,.07)'
        g.lineWidth = 6
        g.stroke()
      }
      let sg = g.createRadialGradient(cx, cy - h * 0.2, 2, cx, cy - h * 0.2, w * 0.45)
      sg.addColorStop(0, 'rgba(200,40,70,.35)')
      sg.addColorStop(1, 'rgba(200,40,70,0)')
      g.fillStyle = sg
      g.fillRect(cx - w, cy - h * 1.2, w * 2, h * 2)
      let sh = g.createLinearGradient(0, cy - h, 0, cy)
      sh.addColorStop(0, 'rgba(255,255,255,.10)')
      sh.addColorStop(0.4, 'rgba(255,255,255,0)')
      g.fillStyle = sh
      g.fillRect(cx - w, cy - h * 1.2, w * 2, h * 1.2)
      g.restore()

      if (alarmRef.current) {
        for (let i = 0; i < N; i++) {
          const u = (i + 0.5) / N
          const th = Math.PI * (1 - u)
          const x = cx + Math.cos(th) * w * 0.99
          const y = cy + Math.sin(th) * b * 0.16 + 12
          const ph = (u - ((T * 0.35) % 1) + 1) % 1
          const I = Math.pow(Math.max(0, 1 - ph * 3.2), 2)
          g.globalCompositeOperation = 'lighter'
          const rr = g.createRadialGradient(x, y, 0, x, y, 18)
          rr.addColorStop(0, `rgba(120,200,255,${0.08 + 0.75 * I})`)
          rr.addColorStop(1, 'rgba(120,200,255,0)')
          g.fillStyle = rr
          g.fillRect(x - 18, y - 18, 36, 36)
          g.globalCompositeOperation = 'source-over'
        }
      }
    }

    function drawTent(t) {
      const a = t.a
      const hover = hoverRef.current
      const drawerAgent = drawerAgentRef.current
      if (!a) {
        curve(t.p)
        g.strokeStyle = 'rgba(210,170,200,.10)'
        g.lineWidth = 0.7
        g.stroke()
        return
      }
      const col = a.s === 'working' ? [160, 230, 255] : a.s === 'wait' ? [110, 190, 255] : [180, 190, 215]
      const al = (a.s === 'idle' ? 0.22 : 0.75) * (hover === t || drawerAgent === a ? 1.35 : 1)
      g.globalCompositeOperation = 'lighter'
      curve(t.p)
      g.strokeStyle = `rgba(${col},${al * 0.18})`
      g.lineWidth = a.lead ? 7 : 5
      g.stroke()
      curve(t.p)
      g.strokeStyle = `rgba(${col},${al})`
      g.lineWidth = a.lead ? 1.8 : 1.3
      g.stroke()
      if (a.s !== 'idle') {
        const n = t.p.length
        for (let j = 0; j < 3; j++) {
          const f = (t.pulse + j / 3) % 1
          const q = t.p[Math.floor(f * (n - 1))]
          const rr = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, 12)
          rr.addColorStop(0, `rgba(${col},.9)`)
          rr.addColorStop(1, `rgba(${col},0)`)
          g.fillStyle = rr
          g.fillRect(q.x - 12, q.y - 12, 24, 24)
        }
      }
      const eTip = t.p[t.p.length - 1]
      if (a.s === 'wait') {
        for (let k = 0; k < 3; k++) {
          const r = (T * 0.6 + k / 3) % 1
          g.beginPath()
          g.arc(eTip.x, eTip.y, 6 + r * 26, 0, 7)
          g.strokeStyle = `rgba(${col},${0.5 * (1 - r)})`
          g.lineWidth = 1
          g.stroke()
        }
      }
      g.beginPath()
      g.arc(eTip.x, eTip.y, a.s === 'idle' ? 2.5 : 4, 0, 7)
      g.fillStyle = `rgba(${col},${a.s === 'idle' ? 0.4 : 1})`
      g.fill()
      g.globalCompositeOperation = 'source-over'
      if (t.el) {
        t.el.style.left = `${eTip.x}px`
        t.el.style.top = `${eTip.y + 12}px`
        t.el.classList.toggle('hov', hover === t || drawerAgent === a)
      }
    }

    function handoff() {
      const hs = handoffsRef.current || []
      if (!hs.length || tents.length < 2) return
      const last = hs[hs.length - 1]
      const A = tents.find((t) => t.a && String(t.a.id) === String(last.from))
      const B = tents.find((t) => t.a && String(t.a.id) === String(last.to))
      if (!A || !B) return
      const a = A.p[Math.min(24, A.p.length - 1)]
      const b = B.p[Math.min(22, B.p.length - 1)]
      g.save()
      g.setLineDash([2, 6])
      g.beginPath()
      g.moveTo(a.x, a.y)
      g.quadraticCurveTo((a.x + b.x) / 2, Math.max(a.y, b.y) + 50, b.x, b.y)
      g.strokeStyle = 'rgba(160,220,255,.35)'
      g.stroke()
      g.restore()
    }

    function renderLabels() {
      tents.forEach((t) => {
        if (!t.el || !t.a) return
        t.el.className = `jelly-lbl ${t.a.s}`
        t.el.innerHTML = `<b>${escapeHtml(t.a.n)}</b><span>${escapeHtml(t.a.t)}</span>`
      })
    }

    function frame(now) {
      const dt = Math.min(0.033, (now - last) / 1000)
      last = now
      // agents 变更时轻量同步
      const ids = (agentsRef.current || []).map((a) => a.id).join(',')
      if (ids !== worldRef.current?._ids) {
        worldRef.current._ids = ids
        syncAgents()
      } else {
        // 刷新任务文案 / 状态
        const byId = new Map((agentsRef.current || []).map((a) => [String(a.id), a]))
        tents.forEach((t) => {
          if (!t.a) return
          const fresh = byId.get(String(t.a.id))
          if (fresh) t.a = fresh
        })
      }
      step(dt)
      g.fillStyle = '#03040a'
      g.fillRect(0, 0, W, H)
      const bg = g.createRadialGradient(W / 2, H * 0.3, 10, W / 2, H * 0.4, H)
      bg.addColorStop(0, 'rgba(40,30,70,.55)')
      bg.addColorStop(1, 'rgba(3,4,10,0)')
      g.fillStyle = bg
      g.fillRect(0, 0, W, H)
      for (const s of snow) {
        g.fillStyle = `rgba(200,220,255,${s.o})`
        g.beginPath()
        g.arc(s.x, s.y, s.r, 0, 7)
        g.fill()
      }
      const br = Math.sin(T * 1.1)
      fine.forEach(drawTent)
      handoff()
      tents.forEach(drawTent)
      drawBell(br)
      renderLabels()
      const askEl = askRef.current
      if (askEl) {
        askEl.style.left = `${bell.cx}px`
        askEl.style.top = `${bell.cy - bell.b * 0.62}px`
        askEl.style.width = `${280 * stageS}px`
      }
      raf = requestAnimationFrame(frame)
    }

    function hit(x, y) {
      let best = null
      let bd = 16
      for (const t of tents) {
        for (let i = 4; i < t.p.length; i += 2) {
          const d = Math.hypot(t.p[i].x - x, t.p[i].y - y)
          if (d < bd) {
            bd = d
            best = t
          }
        }
      }
      for (const t of tents) {
        const eTip = t.p[t.p.length - 1]
        if (x > eTip.x - 50 && x < eTip.x + 50 && y > eTip.y && y < eTip.y + 44) return t
      }
      return best
    }

    function onMove(e) {
      const rect = cv.getBoundingClientRect()
      const t = hit(e.clientX - rect.left, e.clientY - rect.top)
      hoverRef.current = t
      cv.style.cursor = t ? 'pointer' : 'default'
    }

    function onClick(e) {
      const rect = cv.getBoundingClientRect()
      const t = hit(e.clientX - rect.left, e.clientY - rect.top)
      if (t?.a) {
        drawerAgentRef.current = t.a
        callbacksRef.current.onSelectAgent?.(t.a)
      } else if (drawerRef.current) {
        drawerAgentRef.current = null
        callbacksRef.current.onEmptyClick?.()
      }
    }

    function onResize() {
      const w0 = W
      const h0 = H
      rs()
      if (w0 !== W || h0 !== H) build()
    }

    rs()
    build()
    worldRef.current = { tents, rebuild: build, _ids: (agentsRef.current || []).map((a) => a.id).join(',') }
    raf = requestAnimationFrame(frame)
    cv.addEventListener('mousemove', onMove)
    cv.addEventListener('click', onClick)
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      cv.removeEventListener('mousemove', onMove)
      cv.removeEventListener('click', onClick)
      window.removeEventListener('resize', onResize)
      worldRef.current = null
    }
  }, [])

  // drawer 开关时更新 drawerAgent 引用清理
  useEffect(() => {
    if (!drawerOpen) drawerAgentRef.current = null
  }, [drawerOpen])

  return (
    <div className="jelly-stage">
      <canvas ref={canvasRef} className="jelly-canvas" />
      <div ref={labelsRef} className="jelly-labels" />
      <input
        ref={askRef}
        className="jelly-ask"
        value={askValue}
        onChange={(e) => onAskChange?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onAskSubmit?.()
          }
        }}
        placeholder={askPlaceholder}
      />
    </div>
  )
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
