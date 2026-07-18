import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type ConvertPlan, type FileEntry, type FileListing, type Inspection } from '../api'
import { Ic } from '../icons'
import { useStore } from '../store'

const selectStyle = {
  background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 8, padding: '8px 11px', fontSize: 13, outline: 'none',
} as const

function fmtDuration(seconds?: number): string {
  if (!seconds) return '—'
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`
}

export default function Convert() {
  const nav = useNavigate()
  const locations = useStore((s) => s.locations)
  const profiles = useStore((s) => s.profiles)
  const showToast = useStore((s) => s.showToast)

  const [locationId, setLocationId] = useState<number | null>(null)
  const [path, setPath] = useState('')
  const [listing, setListing] = useState<FileListing | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [browseError, setBrowseError] = useState('')
  const [selected, setSelected] = useState<Map<string, FileEntry>>(new Map())
  const [inspections, setInspections] = useState<Record<string, Inspection>>({})
  const [profileId, setProfileId] = useState('')
  const [outLocationId, setOutLocationId] = useState<number | null>(null)
  const [outSubdir, setOutSubdir] = useState('converted')
  const [retention, setRetention] = useState<'keep' | 'move' | 'delete'>('keep')
  const [plan, setPlan] = useState<ConvertPlan | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const curLocation = locations.find((l) => l.id === (locationId ?? locations[0]?.id))
  const availableProfiles = profiles.filter((p) => p.available)
  const profile = profiles.find((p) => p.id === (profileId || availableProfiles[0]?.id))

  const browse = useCallback(async (loc: number, rel: string) => {
    setBrowsing(true)
    setBrowseError('')
    try {
      setListing(await api.get<FileListing>(`/api/files?location_id=${loc}&path=${encodeURIComponent(rel)}`))
    } catch (e) {
      setListing(null)
      setBrowseError(e instanceof Error ? e.message : 'Could not read this folder')
    } finally {
      setBrowsing(false)
    }
  }, [])

  useEffect(() => {
    if (curLocation) void browse(curLocation.id, path)
  }, [curLocation?.id, path, browse]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (profile) {
      void api.get<ConvertPlan>(`/api/convert/plan?profile_id=${profile.id}`).then(setPlan).catch(() => setPlan(null))
    }
  }, [profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFile = (f: FileEntry) => {
    const next = new Map(selected)
    if (next.has(f.path)) {
      next.delete(f.path)
    } else {
      next.set(f.path, f)
      if (curLocation && !(f.path in inspections)) {
        void api
          .get<Inspection>(`/api/files/inspect?location_id=${curLocation.id}&path=${encodeURIComponent(f.path)}`)
          .then((meta) => setInspections((prev) => ({ ...prev, [f.path]: meta })))
          .catch(() => setInspections((prev) => ({ ...prev, [f.path]: { deferred: true } })))
      }
    }
    setSelected(next)
  }

  const validation = useMemo(() => {
    const errors: string[] = []
    if (selected.size === 0) errors.push('Select at least one video file.')
    if (!profile) errors.push('Pick a conversion profile.')
    if (profile && !profile.available) errors.push(`"${profile.name}" uses an encoder this server doesn't have.`)
    if (retention === 'delete' && curLocation && (outLocationId ?? locations[0]?.id) === curLocation.id && !outSubdir.trim()) {
      errors.push('Deleting sources into the same folder they came from needs an output folder name.')
    }
    return errors
  }, [selected, profile, retention, curLocation, outLocationId, outSubdir, locations])

  const submit = async () => {
    if (!curLocation || !profile) return
    setSubmitting(true)
    try {
      const resp = await api.post<{ created: number[]; errors: { path: string; error: string }[]; est_temp_str: string }>(
        '/api/convert', {
          location_id: curLocation.id,
          items: [...selected.values()].map((f) => ({ path: f.path, size: f.size })),
          profile_id: profile.id,
          out_location_id: outLocationId ?? locations[0]?.id,
          out_subdir: outSubdir.trim(),
          retention,
        })
      if (resp.errors.length) {
        showToast(`${resp.created.length} queued, ${resp.errors.length} skipped: ${resp.errors[0].error}`, 'warn')
      } else {
        showToast(`Queued ${resp.created.length} conversion${resp.created.length === 1 ? '' : 's'} (~${resp.est_temp_str} temp space)`)
      }
      if (resp.created.length) {
        setSelected(new Map())
        nav('/queue')
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not queue conversions', 'warn')
    } finally {
      setSubmitting(false)
    }
  }

  const crumbs = path ? path.split('/') : []

  return (
    <div className="page">
      <h1 className="page-title">Convert</h1>
      <p className="page-sub">Pick videos already on your server and re-encode them with a profile.</p>

      <div className="recipes-cols">
        {/* -------- file browser -------- */}
        <div className="card" style={{ overflow: 'hidden', alignSelf: 'start' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              aria-label="Storage location"
              value={curLocation?.id ?? ''}
              onChange={(e) => {
                setLocationId(Number(e.target.value))
                setPath('')
                setSelected(new Map())
              }}
              style={{ ...selectStyle, flex: 1 }}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="link-btn" style={{ fontSize: 12 }} onClick={() => setPath('')}>
              {curLocation?.name ?? '—'}
            </button>
            {crumbs.map((seg, i) => (
              <span key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ color: 'var(--faint)' }}>/</span>
                <button className="link-btn" style={{ fontSize: 12 }} onClick={() => setPath(crumbs.slice(0, i + 1).join('/'))}>
                  {seg}
                </button>
              </span>
            ))}
          </div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {browsing && <div style={{ padding: 20, fontSize: 13, color: 'var(--faint)' }}>Reading folder…</div>}
            {browseError && <div style={{ padding: 20, fontSize: 12.5, color: 'var(--red)' }}>{browseError}</div>}
            {!browsing && listing && listing.dirs.length === 0 && listing.files.length === 0 && (
              <div style={{ padding: 20, fontSize: 13, color: 'var(--faint)' }}>This folder is empty.</div>
            )}
            {!browsing && listing?.dirs.map((d) => (
              <button
                key={d}
                onClick={() => setPath(path ? `${path}/${d}` : d)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
              >
                <span style={{ display: 'flex', color: 'var(--amber)' }}><Ic.folder /></span>
                {d}
              </button>
            ))}
            {!browsing && listing?.files.filter((f) => f.is_video).map((f) => {
              const checked = selected.has(f.path)
              return (
                <label
                  key={f.path}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px', borderBottom: '1px solid var(--border)', fontSize: 13, cursor: 'pointer', background: checked ? 'var(--accent-soft)' : 'transparent' }}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleFile(f)} />
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                  <span style={{ color: 'var(--faint)', fontSize: 12 }}>{f.size_str}</span>
                </label>
              )
            })}
          </div>
        </div>

        {/* -------- selection + options -------- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', fontSize: 14, fontWeight: 600 }}>
              Selected files <span style={{ color: 'var(--faint)', fontWeight: 400 }}>({selected.size})</span>
            </div>
            {selected.size === 0 && (
              <div style={{ padding: '28px 18px', fontSize: 13, color: 'var(--faint)', textAlign: 'center' }}>
                Tick videos on the left to add them here.
              </div>
            )}
            {[...selected.values()].map((f) => {
              const meta = inspections[f.path]
              return (
                <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>
                      {meta == null && 'Inspecting…'}
                      {meta?.deferred && `${f.size_str} · full inspection runs when the job starts`}
                      {meta && !meta.deferred &&
                        `${meta.container ?? '?'} · ${meta.vcodec ?? '?'} · ${meta.height ? meta.height + 'p' : '?'} · ${fmtDuration(meta.duration)} · ${f.size_str}`}
                    </div>
                  </div>
                  <button className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => toggleFile(f)} style={{ width: 26, height: 26 }}>
                    <Ic.cancel width={12} height={12} />
                  </button>
                </div>
              )
            })}
          </div>

          <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Profile</span>
                <select value={profile?.id ?? ''} onChange={(e) => setProfileId(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.available}>
                      {p.name}{p.available ? '' : ' (unavailable)'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Output location</span>
                <select value={outLocationId ?? locations[0]?.id ?? ''} onChange={(e) => setOutLocationId(Number(e.target.value))} style={{ ...selectStyle, width: '100%' }}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Output folder</span>
                <input value={outSubdir} onChange={(e) => setOutSubdir(e.target.value)} style={{ ...selectStyle, width: '100%' }} />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>After verified success, source is…</span>
                <select value={retention} onChange={(e) => setRetention(e.target.value as typeof retention)} style={{ ...selectStyle, width: '100%' }}>
                  <option value="keep">Kept in place</option>
                  <option value="move">Moved to an “originals” folder</option>
                  <option value="delete">Deleted</option>
                </select>
              </label>
            </div>
            {plan && (
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ display: 'flex', width: 15, height: 15, color: 'var(--accent2)', flexShrink: 0, marginTop: 1 }}><Ic.info width={15} height={15} /></span>
                {plan.explanation} Files already matching the profile are copied or remuxed instead of re-encoded.
              </div>
            )}
            {validation.map((v) => (
              <div key={v} style={{ fontSize: 12.5, color: 'var(--red)', display: 'flex', gap: 7, alignItems: 'center' }}>
                <Ic.warn width={13} height={13} />
                {v}
              </div>
            ))}
            <button
              className="btn-primary"
              disabled={submitting || validation.length > 0}
              style={{ justifyContent: 'center', padding: 13, fontSize: 14, opacity: validation.length ? 0.55 : 1 }}
              onClick={() => void submit()}
            >
              <Ic.hq width={16} height={16} />
              {submitting ? 'Queuing…' : `Add ${selected.size || ''} file${selected.size === 1 ? '' : 's'} to the queue`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
