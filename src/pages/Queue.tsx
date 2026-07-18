import { useState } from 'react'
import type { Job } from '../api'
import { IconButton, StatusBadge, Thumb } from '../components'
import { Ic } from '../icons'
import { filterCounts, gradientFor, matchesFilter, type QueueFilter } from '../lib/jobs'
import { useStore } from '../store'

const FILTERS: [QueueFilter, string][] = [
  ['all', 'All'],
  ['active', 'Active'],
  ['completed', 'Completed'],
  ['failed', 'Failed'],
]

function JobActions({ job }: { job: Job }) {
  const jobAction = useStore((s) => s.jobAction)
  return (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      {job.status === 'downloading' && (
        <IconButton label="Pause" onClick={() => jobAction(job.id, 'pause')}>
          <Ic.pause />
        </IconButton>
      )}
      {job.status === 'paused' && (
        <IconButton label="Resume" onClick={() => jobAction(job.id, 'resume')}>
          <Ic.play />
        </IconButton>
      )}
      {job.status === 'failed' && (
        <IconButton label="Retry" onClick={() => jobAction(job.id, 'retry')}>
          <Ic.retry />
        </IconButton>
      )}
      <IconButton label={job.status === 'completed' ? 'Remove from queue' : 'Cancel'} onClick={() => jobAction(job.id, 'cancel')}>
        <Ic.cancel />
      </IconButton>
    </div>
  )
}

export default function Queue() {
  const jobs = useStore((s) => s.jobs)
  const queueFilter = useStore((s) => s.queueFilter)
  const setQueueFilter = useStore((s) => s.setQueueFilter)
  const [search, setSearch] = useState('')

  const counts = filterCounts(jobs)
  const visible = jobs
    .filter((j) => matchesFilter(j, queueFilter))
    .filter((j) => j.title.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="page">
      <h1 className="page-title">Queue</h1>
      <p className="page-sub">Live progress for everything in flight. Updates in real time.</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="seg">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              className={'seg-btn' + (queueFilter === id ? ' on' : '')}
              onClick={() => setQueueFilter(id)}
            >
              {label}
              <span style={{ opacity: 0.6, marginLeft: 5 }}>{counts[id]}</span>
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10, padding: '8px 12px', width: 220 }}>
          <span style={{ display: 'flex', color: 'var(--faint)' }}>
            <Ic.search />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search queue…"
            aria-label="Search queue"
            style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 13, width: '100%' }}
          />
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {visible.map((j) => (
          <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <Thumb src={j.thumbnail} fallback={gradientFor(j.id)} style={{ width: 72, height: 44, borderRadius: 7 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <StatusBadge status={j.status} />
                <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {j.title}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 5, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>{j.recipe_name}</span>
                <span>{j.res || '—'}</span>
                <span>{j.dest_display}</span>
              </div>
              {(j.status === 'downloading' || j.status === 'paused') && (
                <>
                  <div
                    role="progressbar"
                    aria-valuenow={Math.round(j.progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${j.title} progress`}
                    style={{ height: 6, borderRadius: 4, background: 'var(--surface3)', overflow: 'hidden', marginTop: 9, position: 'relative' }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${j.progress}%`,
                        background: j.status === 'paused' ? 'var(--amber)' : 'linear-gradient(90deg,var(--accent),var(--accent2))',
                        borderRadius: 4,
                        transition: 'width .8s linear',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
                    <span>{Math.round(j.progress)}%</span>
                    <span>
                      {j.speed} · ETA {j.eta}
                    </span>
                  </div>
                </>
              )}
              {j.error && (
                <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Ic.alert width={14} height={14} strokeWidth={2} />
                  {j.error}
                </div>
              )}
            </div>
            <JobActions job={j} />
          </div>
        ))}
        {visible.length === 0 && (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--faint)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--muted)' }}>Nothing is downloading.</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>Paste a URL to get started.</div>
          </div>
        )}
      </div>
    </div>
  )
}
