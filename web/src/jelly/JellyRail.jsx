/** 水母界面左侧窄轨：工作 / 治理 / 系统，悬停展开。 */
export default function JellyRail({ activeId, onNavigate, badges = {} }) {
  const groups = [
    {
      key: 'work',
      title: '工作',
      items: [
        { id: 'agents', label: '数字人', icon: 'jelly' },
        { id: 'plans', label: '项目协作', icon: 'list' },
        { id: 'legacy-memories', label: '备忘录', icon: 'book' },
        { id: 'analytics', label: '数据分析', icon: 'chart' },
      ],
    },
    {
      key: 'gov',
      title: '治理',
      items: [
        { id: 'audit-agents', label: '审计', icon: 'shield' },
        { id: 'network-allowlist', label: '网络白名单', icon: 'globe' },
        { id: 'remote-relay', label: '远程中继', icon: 'exit' },
      ],
    },
    {
      key: 'sys',
      title: '系统',
      items: [
        { id: 'settings', label: '设置', icon: 'gear' },
        { id: 'manual', label: '产品手册', icon: 'doc' },
      ],
    },
  ]

  return (
    <nav className="jelly-rail" aria-label="水母导航">
      <div className="jelly-logo">
        <i />
        <span>ATOLLA</span>
      </div>
      {groups.map((g) => (
        <div key={g.key} className="jelly-grp">
          <div className="jelly-gt">{g.title}</div>
          {g.items.map((it) => (
            <button
              key={it.id}
              type="button"
              className={`jelly-nav ${activeId === it.id ? 'on' : ''}`}
              onClick={() => onNavigate?.(it.id)}
              title={it.label}
            >
              <RailIcon name={it.icon} />
              <em>{it.label}</em>
              {badges[it.id] > 0 && <span className="jelly-rail-badge">{badges[it.id]}</span>}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}

function RailIcon({ name }) {
  const common = { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': true }
  switch (name) {
    case 'jelly':
      return (
        <svg {...common}>
          <path d="M5 11a7 6 0 0 1 14 0H5zM8 11v7M12 11v9M16 11v6" />
        </svg>
      )
    case 'list':
      return (
        <svg {...common}>
          <path d="M4 6h16M4 12h10M4 18h7" />
        </svg>
      )
    case 'book':
      return (
        <svg {...common}>
          <rect x="5" y="4" width="14" height="16" rx="2" />
          <path d="M9 9h6M9 13h6" />
        </svg>
      )
    case 'chart':
      return (
        <svg {...common}>
          <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
        </svg>
      )
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
        </svg>
      )
    case 'globe':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h16M12 4c3 3 3 13 0 16" />
        </svg>
      )
    case 'exit':
      return (
        <svg {...common}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      )
    case 'gear':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
        </svg>
      )
    case 'doc':
      return (
        <svg {...common}>
          <path d="M6 4h9l3 3v13H6z" />
        </svg>
      )
    default:
      return <svg {...common}><circle cx="12" cy="12" r="4" /></svg>
  }
}
