import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { StatusBadge, Thumb } from '../components'
import { Ic } from '../icons'
import { gradientFor } from '../lib/jobs'
import { useStore } from '../store'

function humanBytes(n: number): string {
  if (!n) return '0 GB'
  let v = n
  for (const unit of ['B', 'KB', 'MB', 'GB', 'TB']) {
    if (v < 1024 || unit === 'TB') return `${v.toFixed(unit === 'B' || unit === 'KB' ? 0 : 1)} ${unit}`
    v /= 1024
  }
  return '—'
}

export default function Dashboard() {
  const nav = useNavigate()
  const stats = useStore((s) => s.stats)
  const system = useStore((s) => s.system)
  const loadStats = useStore((s) => s.loadStats)
  const loadSystem = useStore((s) => s.loadSystem)
  const showToast = useStore((s) => s.showToast)
  const activeNow = useStore(
    (s) => s.jobs.filter((j) => j.status === 'downloading' || j.status === 'queued').length,
  )

  useEffect(() => {
    void loadStats().catch(() => {})
    void loadSystem().catch(() => {})
    const poll = setInterval(() => void loadStats().catch(() => {}), 5000)
    return () => clearInterval(poll)
  }, [loadStats, loadSystem])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const cards = [
    { label: 'Active downloads', value: String(stats?.active ?? activeNow), sub: 'in progress now', Icon: Ic.activity, color: 'var(--accent2)' },
    { label: 'Completed today', value: String(stats?.completed_today ?? '—'), sub: 'finished since midnight', Icon: Ic.check, color: 'var(--green)' },
    { label: 'Failed jobs', value: String(stats?.failed ?? '—'), sub: stats?.failed ? 'needs attention' : 'all clear', Icon: Ic.warn, color: stats?.failed ? 'var(--red)' : 'var(--muted)' },
    { label: 'Library size', value: stats?.library_bytes_str ?? '—', sub: 'across all locations', Icon: Ic.disk, color: 'var(--amber)' },
  ]

  const usedPct = stats && stats.storage_total > 0
    ? Math.round(((stats.storage_total - stats.storage_free) / stats.storage_total) * 100)
    : 0

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">{greeting}</h1>
          <p className="page-sub" style={{ margin: '6px 0 0' }}>
            Here's what's happening on your server right now.
          </p>
        </div>
        <button
          className="btn-primary"
          style={{ padding: '11px 18px', fontSize: 14, boxShadow: '0 6px 18px var(--accent-soft)' }}
          onClick={() => nav('/quick')}
        >
          <Ic.quick width={17} height={17} strokeWidth={2} />
          Paste URL
        </button>
      </div>

      <div className="grid-stats" style={{ marginBottom: 16 }}>
        {cards.map(({ label, value, sub, Icon, color }) => (
          <div key={label} className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 500 }}>{label}</span>
              <span style={{ display: 'flex', width: 16, height: 16, color }}>
                <Icon />
              </span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 10 }}>{value}</div>
            <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      <div className="dash-cols">
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>Recent downloads</h3>
            <button className="link-btn" onClick={() => nav('/library')}>
              View library →
            </button>
          </div>
          {(stats?.recent_jobs ?? []).map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '11px 18px', borderBottom: '1px solid var(--border)' }}>
              <Thumb src={r.thumbnail} fallback={gradientFor(r.id)} style={{ width: 56, height: 34, borderRadius: 6 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--faint)' }}>
                  {r.recipe_name} · {r.res || '—'} · {r.dest_display}
                </div>
              </div>
              <StatusBadge status={r.status} />
            </div>
          ))}
          {stats && stats.recent_jobs.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--faint)', fontSize: 13 }}>
              Nothing downloaded yet — paste a URL to get started.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: '16px 18px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 14.5, fontWeight: 600 }}>System</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>yt-dlp</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: system ? 'var(--green)' : 'var(--faint)' }} />
                  {system?.ytdlp_version ?? '…'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>ffmpeg</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: system?.ffmpeg ? 'var(--green)' : 'var(--red)' }} />
                  {system ? (system.ffmpeg ? system.ffmpeg_version ?? 'Ready' : 'Missing') : '…'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Status</span>
                <button
                  onClick={() => showToast(system?.ffmpeg ? 'All systems ready' : 'ffmpeg is missing — merging and audio extraction will fail', system?.ffmpeg ? 'ok' : 'warn')}
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent2)', background: 'var(--accent-soft)', border: 'none', padding: '4px 10px', borderRadius: 7, cursor: 'pointer' }}
                >
                  Check
                </button>
              </div>
            </div>
          </div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>Storage</h3>
              <span style={{ fontSize: 12, color: 'var(--faint)' }}>
                {stats ? `${humanBytes(stats.storage_total - stats.storage_free)} / ${humanBytes(stats.storage_total)}` : '…'}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 5, background: 'var(--surface3)', overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${usedPct}%`, background: 'linear-gradient(90deg,var(--accent),var(--accent2))' }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 9 }}>
              {stats ? `${humanBytes(stats.storage_free)} free across ${stats.roots_count} location${stats.roots_count === 1 ? '' : 's'}` : '…'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
