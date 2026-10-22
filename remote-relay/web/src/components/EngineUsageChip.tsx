import { useEffect, useMemo, useState } from 'react'
import { fetchEnginesUsage } from '../api'
import {
  clampUsagePct,
  enginesUsageCacheFresh,
  peekEnginesUsageCache,
  pickPrimaryWindow,
  primaryWindowShortLabel,
  rememberEnginesUsage,
  usageEngineId,
  type EngineUsageRow,
  type EnginesUsageResponse,
} from '../utils/engineUsage'
import { Modal } from './Modal'

type Props = {
  instanceId: string
  engine?: string | null
}

/** 进度条色阶 */
function tone(pct: number): string {
  if (pct >= 90) return 'hot'
  if (pct >= 70) return 'warm'
  return 'ok'
}

/** 引擎标签旁的小用量条；点击打开详情弹窗 */
export function EngineUsageChip({ instanceId, engine }: Props) {
  const [data, setData] = useState<EnginesUsageResponse | null>(() => peekEnginesUsageCache())
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /** 拉取用量；默认吃 5 分钟缓存 */
  async function load(force = false) {
    if (!instanceId) return
    if (!force && enginesUsageCacheFresh() && peekEnginesUsageCache()) {
      setData(peekEnginesUsageCache())
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const next = rememberEnginesUsage(await fetchEnginesUsage(instanceId, { fresh: force }))
      setData(next)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '用量加载失败')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId])

  const row: EngineUsageRow | null = useMemo(() => {
    const id = usageEngineId(engine)
    return data?.engines?.find((e) => e.id === id) ?? null
  }, [data, engine])

  const primary = pickPrimaryWindow(engine, row)
  const pct = primary ? clampUsagePct(primary.used_percent) : 0
  const short = primaryWindowShortLabel(primary)

  return (
    <>
      <button
        type="button"
        className="engine-usage-chip"
        title={primary ? `${primary.label} · 已用 ${pct}%` : row?.error || '查看 CLI 用量'}
        onClick={() => {
          setOpen(true)
          void load(false)
        }}
      >
        {primary ? (
          <>
            <span className="engine-usage-chip-label">{short}</span>
            <span className="engine-usage-chip-bar" aria-hidden>
              <span
                className={`engine-usage-chip-fill tone-${tone(pct)}`}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="engine-usage-chip-pct">{pct}%</span>
          </>
        ) : (
          <span className="engine-usage-chip-label muted">
            {busy ? '…' : row?.error ? '额度' : '用量'}
          </span>
        )}
      </button>

      <Modal
        open={open}
        title="CLI 用量"
        onClose={() => setOpen(false)}
        footer={
          <div className="modal-actions-row">
            <button type="button" className="btn outline small" onClick={() => setOpen(false)}>
              关闭
            </button>
            <button
              type="button"
              className="btn primary small"
              disabled={busy}
              onClick={() => void load(true)}
            >
              {busy ? '刷新中…' : '刷新'}
            </button>
          </div>
        }
      >
        {err ? <p className="error-banner">{err}</p> : null}
        {!row ? (
          <p className="muted">暂无该引擎用量数据</p>
        ) : !row.ok ? (
          <p className="muted">{row.error || '未能读取额度（请确认本机已登录对应 CLI）'}</p>
        ) : (
          <>
            <p className="engine-usage-detail-sub">
              {row.plan ? `套餐 ${row.plan}` : '已连接'}
              {row.source ? ` · ${row.source}` : ''}
            </p>
            <ul className="engine-usage-detail-list">
              {(row.windows || []).map((w) => {
                const p = clampUsagePct(w.used_percent)
                return (
                  <li key={`${w.kind}-${w.label}`}>
                    <div className="engine-usage-detail-head">
                      <strong>{w.label || w.kind}</strong>
                      <span>{p}% 已用</span>
                    </div>
                    <div className="engine-usage-detail-bar">
                      <span
                        className={`engine-usage-chip-fill tone-${tone(p)}`}
                        style={{ width: `${p}%` }}
                      />
                    </div>
                    <div className="engine-usage-detail-hints">
                      {w.hint ? <em>{w.hint}</em> : null}
                      {w.reset_hint ? <em>{w.reset_hint}</em> : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
        <p className="engine-usage-detail-note muted">
          Codex 优先看 5 小时窗；Cursor 优先看 Auto；Claude 优先看 5 小时。默认缓存约 5 分钟。
        </p>
      </Modal>
    </>
  )
}
