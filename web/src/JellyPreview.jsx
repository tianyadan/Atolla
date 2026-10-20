import { useState } from 'react'
import JellyAvatar from './JellyAvatar.jsx'
import JellyColorPicker from './JellyColorPicker.jsx'
import { JELLY_COLORS, assignJellyColor } from './jellyColor.js'

const DEMO_AGENTS = JELLY_COLORS.map((color, i) => ({
  id: i + 1,
  name: ({ orange: '橙汁同学', yellow: '柠檬 intern', blue: '蓝莓助手', green: '青苔运维', purple: '紫晶助理', red: '赤焰销售' })[color],
  jelly_color: color,
  status: i === 4 ? 'running' : 'idle',
}))

/**
 * 本地预览页：用真实 JellyAvatar / JellyColorPicker 组件截图用。
 * 访问 /?jellyPreview=1
 */
export default function JellyPreview() {
  const [color, setColor] = useState(() => assignJellyColor('preview'))

  return (
    <div style={{ padding: 24, background: '#0a0a0a', minHeight: '100vh', color: '#f5f5f5', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <section className="modal-card ma-settings" style={{ maxWidth: 480, marginBottom: 24 }} data-shot="picker">
        <h2>自定义招聘</h2>
        <JellyColorPicker value={color} onChange={setColor} />
        <label>
          名称
          <input value="新同事" readOnly />
        </label>
        <label>
          引擎
          <select disabled defaultValue="claude">
            <option value="claude">Claude</option>
          </select>
        </label>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <JellyAvatar color={color} size={72} state="idle" />
          <span className="muted">预览 · {color}</span>
        </div>
      </section>

      <section style={{ maxWidth: 420, marginBottom: 24 }} data-shot="list">
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>数字员工列表</h2>
        {DEMO_AGENTS.map((a) => (
          <div key={a.id} className="ma-item" style={{ marginBottom: 8 }}>
            <div className="ma-item-head">
              <JellyAvatar
                className="ma-avatar ma-avatar-sm"
                color={a.jelly_color}
                size={28}
                state={a.status === 'running' ? 'working' : 'idle'}
              />
              <strong className="ma-item-name">{a.name}</strong>
              <span className={`ma-status st-${a.status === 'running' ? 'running' : 'idle'}`}>
                {a.status === 'running' ? '忙碌中' : '空闲中'}
              </span>
            </div>
          </div>
        ))}
      </section>

      <section className="chatbox ma-chatbox" style={{ maxWidth: 480, marginBottom: 24 }} data-shot="chat-idle">
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>对话 · 漂浮态</h2>
        <div className="msg assistant ma-flat">
          <div className="msg-label">
            <span>
              <JellyAvatar className="ma-msg-jelly" color="blue" size={16} state="idle" />
              蓝莓助手
            </span>
          </div>
          <div className="ma-timeline-assistant">好的，我先看一下今天的任务清单。</div>
        </div>
      </section>

      <section className="chatbox ma-chatbox" style={{ maxWidth: 480, marginBottom: 24 }} data-shot="chat-typing">
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>对话 · 输出中（跳动）</h2>
        <div className="msg assistant ma-flat">
          <div className="msg-label">
            <span>
              <JellyAvatar className="ma-msg-jelly" color="purple" size={16} state="typing" />
              紫晶助理
            </span>
          </div>
          <div className="ma-run-status">
            <div className="ma-thinking">
              <JellyAvatar className="ma-thinking-jelly" color="purple" size={18} state="typing" />
              <span className="ma-thinking-text">brewing ideas</span>
            </div>
          </div>
        </div>
      </section>

      <section data-shot="cards">
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>数字人管理</h2>
        <div className="dh-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 180px)', gap: 12 }}>
          {DEMO_AGENTS.slice(0, 4).map((a) => (
            <article key={a.id} className="dh-card" style={{ padding: 14, background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12, textAlign: 'center' }}>
              <div className="dh-avatar" style={{ margin: '0 auto' }}>
                <JellyAvatar color={a.jelly_color} size={48} state="idle" />
              </div>
              <h3 className="dh-name" style={{ margin: '8px 0 4px', fontSize: 14 }}>{a.name}</h3>
              <p className="dh-folder" style={{ margin: 0, fontSize: 12, color: '#8a8a8a' }}>未入组</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
