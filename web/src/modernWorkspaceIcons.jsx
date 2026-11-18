export function ModernIcon({ name, size = 18 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  if (name === 'plus') return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>
  // 侧栏品牌：双人剪影
  if (name === 'agents') {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.2 19c.4-3.2 2.6-5.2 5.8-5.2s5.4 2 5.8 5.2" />
        <circle cx="16.5" cy="8.5" r="2.6" />
        <path d="M14.2 19c.2-2.2 1.5-3.6 3.6-3.8 2.2.2 3.6 1.7 3.9 3.8" />
      </svg>
    )
  }
  if (name === 'chevron-down') return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>
  if (name === 'search') return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
  if (name === 'pin') return <svg {...common}><path d="m14 4 6 6-3 1-4 4-1 5-2-2-4-4-2-2 5-1 4-4z" /></svg>
  if (name === 'archive') return <svg {...common}><path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6" /></svg>
  if (name === 'menu') return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></svg>
  if (name === 'panel') return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
  if (name === 'settings') return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.55v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.3V9.55h.1A1.7 1.7 0 0 0 4.1 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.56 3.7l.06.06A1.7 1.7 0 0 0 8.5 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1v-.1h4.05v.1A1.7 1.7 0 0 0 15 4.1a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.5a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4.05h-.1A1.7 1.7 0 0 0 19.4 15Z" /></svg>
  if (name === 'robot') return <svg {...common}><rect x="5" y="7" width="14" height="11" rx="3" /><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6M3 11v4M21 11v4" /></svg>
  if (name === 'chat') return <svg {...common}><path d="M5 18.5 3.5 21l.7-4A8 8 0 1 1 7 19.2" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></svg>
  if (name === 'folder') return <svg {...common}><path d="M3 7.5h7l2-2h9v13H3z" /></svg>
  if (name === 'shield') return <svg {...common}><path d="M12 3 5 6v5c0 4.6 2.7 7.8 7 10 4.3-2.2 7-5.4 7-10V6z" /><path d="m9.5 12 1.7 1.7 3.6-4" /></svg>
  if (name === 'document') return <svg {...common}><path d="M6 3h8l4 4v14H6zM14 3v5h5M9 12h6M9 16h6" /></svg>
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  if (name === 'monitor') return <svg {...common}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
  if (name === 'phone') return <svg {...common}><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>
  if (name === 'globe') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
  if (name === 'book') return <svg {...common}><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22zM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22z" /></svg>
  if (name === 'info') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg>
  // 人员减号表达“解聘/移出团队”，避免垃圾桶造成“删除数据”的误解。
  if (name === 'dismiss') return <svg {...common}><circle cx="9" cy="7" r="3" /><path d="M3.5 20c0-4.2 2.5-7 5.5-7s5.5 2.8 5.5 7M16 11h6" /></svg>
  return null
}
