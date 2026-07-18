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

const STAGE_LABELS: Record<string, string> = {
  queued: 'Queued', inspecting: 'Inspecting', downloading: 'Downloading',
  encoding: 'Encoding', verifying: 'Verifying', moving: 'Moving',
  completed: 'Completed', failed: 'Failed', paused: 'Paused',
}

function humanBytes(n: number): string {
  if (!n) return '—'
  let v = n
  for (const unit of ['B', 'KB', 'MB', 'GB', 'TB']) {
    if (v < 1024 || unit === 'TB') return `${v.toFixed(unit === 'B' || unit === 'KB' ? 0 : 1)} ${unit}`
    v /= 1024
  }
  return '—'
}

function JobActions({ job }: { job: Job }) {
  const jobAction = useStore((s) => s.jobAction)
  const busy = job.status === 'downloading'
  return (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      {job.status === 'queued' && (
        <>
          <IconButton label="Move up" onClick={() => jobAction(job.id, 'up')}>
            <Ic.chevron style={{ transform: 'rotate(-90deg)' }} />
          </IconButton>
          <IconButton label="Move down" onClick={() => jobAction(job.id, 'down')}>
            <Ic.chevron style={{ transform: 'rotate(90deg)' }} />
          </IconButton>
        </>
      )}
      {busy && (
        <IconButton label="Pause" onClick={() => jobAction(job.id, 'pause')}>
          <Ic.pause />
        </IconButton>
      )}
      {(job.status === 'paused' || job.status === 'queued') && job.status === 'paused' && (
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

function JobRow({ job, selected, onToggle }: { job: Job; selected: boolean; onToggle: () => void }) {
  const [showLog, setShowLog] = useState(false)
  const active = job.status === 'downloading' || job.status === 'paused'
  const isConvert = job.kind === 'convert'
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px' }}>
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${job.title}`} />
        {isConvert ? (
          <span style={{ display: 'flex', width: 72, height: 44, borderRadius: 7, background: 'var(--accent-soft)', color: 'var(--accent2)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Ic.hq width={20} height={20} />
          </span>
        ) : (
          <Thumb src={job.thumbnail} fallback={gradientFor(job.id)} style={{ width: 72, height: 44, borderRadius: 7 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span className="badge" style={{ color: isConvert ? 'var(--accent2)' : 'var(--muted)', background: isConvert ? 'var(--accent-soft)' : 'var(--surface3)' }}>
              {isConvert ? 'Convert' : 'Download'}
            </span>
            <StatusBadge status={job.status} />
            {job.stage && !['completed', 'failed', 'queued', 'downloading', 'paused'].includes(job.stage) && (
              <span className="badge" style={{ color: 'var(--amber)', background: 'rgba(251,191,36,.14)' }}>
                {STAGE_LABELS[job.stage] ?? job.stage}
              </span>
            )}
            <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {job.title}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 5, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span>{isConvert ? job.profile_name : job.recipe_name}</span>
            {!isConvert && job.profile_name && <span>then {job.profile_name}</span>}
            {job.res && <span>{job.res}</span>}
            <span>{job.dest_display}</span>
            {job.src_size > 0 && (
              <span>
                {humanBytes(job.src_size)}
                {job.out_size > 0 && ` → ${humanBytes(job.out_size)}`}
              </span>
            )}
            {job.worker && active && <span>{job.worker}</span>}
          </div>
          {active && (
            <>
              <div
                role="progressbar"
                aria-valuenow={Math.round(job.progress)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${job.title} progress`}
                style={{ height: 6, borderRadius: 4, background: 'var(--surface3)', overflow: 'hidden', marginTop: 9 }}
              >
                <div
                  style={{
                    height: '100%', width: `${job.progress}%`,
                    background: job.status === 'paused' ? 'var(--amber)' : 'linear-gradient(90deg,var(--accent),var(--accent2))',
                    borderRadius: 4, transition: 'width .8s linear',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
                <span>{Math.round(job.progress)}% · {STAGE_LABELS[job.stage] ?? job.stage}</span>
                <span>
                  {job.stage === 'encoding' ? job.fps : job.speed} · ETA {job.eta}
                </span>
              </div>
            </>
          )}
          {job.error && (
            <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Ic.alert width={14} height={14} strokeWidth={2} />
              {job.error}
            </div>
          )}
          {job.log && (
            <button className="link-btn" style={{ fontSize: 11.5, marginTop: 6, padding: 0 }} onClick={() => setShowLog(!showLog)}>
              {showLog ? 'Hide log' : 'Show log'}
            </button>
          )}
        </div>
        <JobActions job={job} />
      </div>
      {showLog && job.log && (
        <pre style={{ margin: 0, padding: '10px 18px 14px 62px', fontSize: 11, lineHeight: 1.5, color: 'var(--muted)', background: 'var(--surface2)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
          {job.log.trim()}
        </pre>
      )}
    </div>
  )
}

export default function Queue() {
  const jobs = useStore((s) => s.jobs)
  const queueFilter = useStore((s) => s.queueFilter)
  const setQueueFilter = useStore((s) => s.setQueueFilter)
  const jobAction = useStore((s) => s.jobAction)
  const clearJobs = useStore((s) => s.clearJobs)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const counts = filterCounts(jobs)
  const visible = jobs
    .filter((j) => matchesFilter(j, queueFilter))
    .filter((j) => j.title.toLowerCase().includes(search.toLowerCase()))

  const toggle = (id: number) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }
  const allVisibleSelected = visible.length > 0 && visible.every((j) => selectedIds.has(j.id))
  const toggleAll = () =>
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visible.map((j) => j.id)))
  const selectedJobs = visible.filter((j) => selectedIds.has(j.id))
  const finishedCount = counts.completed + counts.failed
  const bulk = (action: 'cancel' | 'retry' | 'pause' | 'resume') => {
    selectedJobs.forEach((j) => jobAction(j.id, action))
    setSelectedIds(new Set())
  }
  const bulkClear = () => {
    void clearJobs(selectedJobs.map((j) => j.id))
    setSelectedIds(new Set())
  }

  return (
    <div className="page">
      <h1 className="page-title">Queue</h1>
      <p className="page-sub">Downloads and conversions, one queue. Updates live.</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="seg">
          {FILTERS.map(([id, label]) => (
            <button key={id} className={'seg-btn' + (queueFilter === id ? ' on' : '')} onClick={() => setQueueFilter(id)}>
              {label}
              <span style={{ opacity: 0.6, marginLeft: 5 }}>{counts[id]}</span>
            </button>
          ))}
        </div>
        {selectedJobs.length > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{selectedJobs.length} selected:</span>
            <button className="seg-btn on" onClick={bulkClear} title="Remove finished jobs from the list — files are untouched">Clear</button>
            <button className="seg-btn on" onClick={() => bulk('retry')}>Retry</button>
            <button className="seg-btn on" onClick={() => bulk('pause')}>Pause</button>
            <button className="seg-btn on" onClick={() => bulk('resume')}>Resume</button>
            <button className="seg-btn on" style={{ color: 'var(--red)' }} onClick={() => bulk('cancel')}>Cancel</button>
          </div>
        )}
        <div style={{ flex: 1 }} />
        {selectedJobs.length === 0 && finishedCount > 0 && (
          <button
            className="seg-btn on"
            onClick={() => void clearJobs()}
            title="Removes all completed and failed jobs from the list — files and library are untouched"
          >
            Clear finished ({finishedCount})
          </button>
        )}
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
        {visible.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--border)', fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all visible jobs" />
            Select all {visible.length} shown
          </label>
        )}
        {visible.map((j) => (
          <JobRow key={j.id} job={j} selected={selectedIds.has(j.id)} onToggle={() => toggle(j.id)} />
        ))}
        {visible.length === 0 && (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--faint)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--muted)' }}>Nothing in the queue.</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>Paste a URL or queue a conversion to get started.</div>
          </div>
        )}
      </div>
    </div>
  )
}
