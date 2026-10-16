/** 设置页可折叠模块：点标题展开或收起。 */
export default function SettingsFold({ title, desc, open, onToggle, children }) {
  return (
    <section className={`settings-fold${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="settings-fold-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="settings-fold-text">
          <span className="settings-fold-title">{title}</span>
          {desc ? <span className="settings-fold-desc">{desc}</span> : null}
        </span>
        <svg className="settings-fold-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? <div className="settings-fold-body">{children}</div> : null}
    </section>
  )
}
