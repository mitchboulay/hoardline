import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { IconButton } from '../components'
import { Ic } from '../icons'
import { useStore } from '../store'
import { Field } from './Login'

const selectStyle = {
  width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
  color: 'var(--text)', borderRadius: 9, padding: '10px 11px', fontSize: 13.5, outline: 'none',
} as const

function AddFolderDialog({ onClose }: { onClose: () => void }) {
  const locations = useStore((s) => s.locations)
  const profiles = useStore((s) => s.profiles)
  const loadWatchedFolders = useStore((s) => s.loadWatchedFolders)
  const showToast = useStore((s) => s.showToast)
  const [locationId, setLocationId] = useState(locations[0]?.id ?? 0)
  const [path, setPath] = useState('')
  const [profileId, setProfileId] = useState(profiles.find((p) => p.available)?.id ?? '')
  const [outLocationId, setOutLocationId] = useState(locations[0]?.id ?? 0)
  const [outSubdir, setOutSubdir] = useState('converted')
  const [retention, setRetention] = useState('keep')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/api/watched-folders', {
        location_id: locationId, path, profile_id: profileId,
        out_location_id: outLocationId, out_subdir: outSubdir, retention,
      })
      await loadWatchedFolders()
      showToast('Watched folder added — existing files were marked as seen, only new arrivals convert')
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not add folder', 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pop .18s both', overflowY: 'auto', padding: 20 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 460, maxWidth: '100%', boxShadow: '0 24px 60px rgba(0,0,0,.5)', margin: 'auto' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600 }}>Watch a folder</h3>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
          New video files that appear here are converted automatically. Files already present aren't touched.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <label>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Location</span>
            <select value={locationId} onChange={(e) => setLocationId(Number(e.target.value))} style={selectStyle}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Profile</span>
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)} style={selectStyle}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.name}{p.available ? '' : ' (unavailable)'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Field label="Folder inside the location (blank = root)" value={path} onChange={setPath} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <label>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Output → location / folder</span>
            <select value={outLocationId} onChange={(e) => setOutLocationId(Number(e.target.value))} style={{ ...selectStyle, marginBottom: 8 }}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <input value={outSubdir} onChange={(e) => setOutSubdir(e.target.value)} style={selectStyle} aria-label="Output folder" />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Source after success</span>
            <select value={retention} onChange={(e) => setRetention(e.target.value)} style={selectStyle}>
              <option value="keep">Keep</option>
              <option value="move">Move to “originals”</option>
              <option value="delete">Delete</option>
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '9px 16px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !profileId} className="btn-primary">
            {busy ? 'Scanning…' : 'Watch folder'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function WatchedFolders() {
  const watchedFolders = useStore((s) => s.watchedFolders)
  const loadWatchedFolders = useStore((s) => s.loadWatchedFolders)
  const loadJobs = useStore((s) => s.loadJobs)
  const openConfirm = useStore((s) => s.openConfirm)
  const closeConfirm = useStore((s) => s.closeConfirm)
  const showToast = useStore((s) => s.showToast)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    void loadWatchedFolders().catch(() => {})
  }, [loadWatchedFolders])

  const scanNow = async (id: number) => {
    try {
      const resp = await api.post<{ queued: number }>(`/api/watched-folders/${id}/scan`)
      showToast(resp.queued ? `Queued ${resp.queued} conversion(s)` : 'Nothing new in this folder', 'info')
      await Promise.all([loadWatchedFolders(), loadJobs()])
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Scan failed', 'warn')
    }
  }

  const remove = (id: number, name: string) => {
    openConfirm({
      title: 'Stop watching this folder?',
      body: `"${name}" will no longer convert new files. Existing files and queued jobs are untouched.`,
      action: 'Stop watching',
      onConfirm: () => {
        closeConfirm()
        void api.del(`/api/watched-folders/${id}`)
          .then(() => {
            showToast('Folder removed', 'info')
            return loadWatchedFolders()
          })
          .catch((e) => showToast(e instanceof Error ? e.message : 'Delete failed', 'warn'))
      },
    })
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Watched folders</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Drop files in, get converted files out — checked every couple of minutes.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          <Ic.plus />
          Watch a folder
        </button>
      </div>

      {watchedFolders.length === 0 && (
        <div className="card" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--faint)' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--muted)' }}>No watched folders yet.</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Watch a folder and new videos convert themselves.</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {watchedFolders.map((wf) => {
          const on = Boolean(wf.enabled)
          return (
            <div key={wf.id} className="card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ display: 'flex', width: 34, height: 34, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent2)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Ic.folder width={17} height={17} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {wf.location_name}{wf.path ? ` / ${wf.path}` : ''}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--faint)', marginTop: 4, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <span>{wf.profile_name}</span>
                  <span>→ {wf.out_location_name} / {wf.out_subdir}</span>
                  <span>source: {wf.retention}</span>
                  <span>{wf.last_scanned ? `scanned ${wf.last_scanned.slice(0, 16)} UTC` : 'never scanned'}</span>
                </div>
              </div>
              <IconButton label="Scan now" onClick={() => void scanNow(wf.id)}>
                <Ic.retry />
              </IconButton>
              <IconButton label="Stop watching" onClick={() => remove(wf.id, `${wf.location_name}/${wf.path}`)}>
                <Ic.trash />
              </IconButton>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    void api.patch(`/api/watched-folders/${wf.id}`, { enabled: e.target.checked })
                      .then(() => loadWatchedFolders())
                  }}
                  aria-label="Enable watched folder"
                />
                <span className="track" />
                <span className="knob" />
              </label>
            </div>
          )
        })}
      </div>

      {adding && <AddFolderDialog onClose={() => setAdding(false)} />}
    </div>
  )
}
