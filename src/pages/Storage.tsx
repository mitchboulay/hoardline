import { useEffect, useState, type FormEvent } from 'react'
import { IconButton } from '../components'
import { Ic } from '../icons'
import { useStore } from '../store'
import { Field } from './Login'

function AddLocationDialog({ onClose }: { onClose: () => void }) {
  const addLocation = useStore((s) => s.addLocation)
  const testLocation = useStore((s) => s.testLocation)
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [share, setShare] = useState('')
  const [subpath, setSubpath] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const canSubmit = name && host && share && username && password

  const test = async () => {
    setBusy(true)
    setTestResult(null)
    const error = await testLocation({ host, share, subpath, username, password })
    setBusy(false)
    setTestResult(error ? { ok: false, msg: error } : { ok: true, msg: 'Connected — credentials verified and the share is writable.' })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const ok = await addLocation({ name, host, share, subpath, username, password })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pop .18s both', overflowY: 'auto', padding: 20 }}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 460, maxWidth: '100%', boxShadow: '0 24px 60px rgba(0,0,0,.5)', margin: 'auto' }}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600 }}>Add network storage</h3>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
          Connect an SMB share (NAS). Credentials are verified before saving, then reused for every download.
        </p>
        <Field label="Name (e.g. UNAS Media)" value={name} onChange={setName} autoFocus />
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12 }}>
          <Field label="Server address" value={host} onChange={setHost} />
          <Field label="Share name" value={share} onChange={setShare} />
        </div>
        <Field label="Folder inside the share (optional)" value={subpath} onChange={setSubpath} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Username" value={username} onChange={setUsername} />
          <Field label="Password" type="password" value={password} onChange={setPassword} />
        </div>
        {testResult && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, lineHeight: 1.45, color: testResult.ok ? 'var(--green)' : 'var(--red)', marginBottom: 14, padding: '10px 12px', borderRadius: 9, background: testResult.ok ? 'rgba(52,211,153,.1)' : 'rgba(248,113,113,.1)' }}>
            <span style={{ display: 'flex', width: 15, height: 15, flexShrink: 0, marginTop: 1 }}>
              {testResult.ok ? <Ic.check /> : <Ic.warn />}
            </span>
            {testResult.msg}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '9px 16px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void test()}
            disabled={busy || !host || !share || !username || !password}
            style={{ padding: '9px 16px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--accent2)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
          >
            {busy ? 'Working…' : 'Test connection'}
          </button>
          <button type="submit" disabled={busy || !canSubmit} className="btn-primary" style={{ opacity: canSubmit ? 1 : 0.6 }}>
            Save location
          </button>
        </div>
      </form>
    </div>
  )
}

function PolicyRow({ name, desc, settingKey }: { name: string; desc: string; settingKey: 'policy_delete_old' | 'policy_keep_recent' | 'policy_low_disk_warn' }) {
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const on = Boolean(settings?.[settingKey])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{name}</div>
        <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 3 }}>{desc}</div>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={on} onChange={(e) => void saveSettings({ [settingKey]: e.target.checked })} aria-label={name} />
        <span className="track" />
        <span className="knob" />
      </label>
    </div>
  )
}

export default function Storage() {
  const locations = useStore((s) => s.locations)
  const loadLocations = useStore((s) => s.loadLocations)
  const deleteLocation = useStore((s) => s.deleteLocation)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    void loadLocations().catch(() => {})
  }, [loadLocations])

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Storage</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Where your downloads live, and how much space is left.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          <Ic.plus />
          Add location
        </button>
      </div>

      <div className="grid-roots" style={{ marginBottom: 16 }}>
        {locations.map((loc) => {
          const pct = loc.usage.total > 0 ? Math.round((loc.usage.used / loc.usage.total) * 100) : 0
          return (
            <div key={loc.id} className="card" style={{ padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span style={{ display: 'flex', width: 18, height: 18, color: 'var(--accent2)' }}>
                  <Ic.storage />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{loc.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {loc.type === 'local' ? '/data/downloads' : `//${loc.host}/${loc.share}${loc.subpath ? '/' + loc.subpath : ''}`}
                  </div>
                </div>
                <span
                  className="badge"
                  style={loc.usage.healthy
                    ? { color: 'var(--green)', background: 'rgba(52,211,153,.14)' }
                    : { color: 'var(--red)', background: 'rgba(248,113,113,.14)' }}
                >
                  {loc.usage.healthy ? 'Healthy' : 'Unreachable'}
                </span>
                {loc.type === 'smb' && (
                  <IconButton label="Remove location" onClick={() => deleteLocation(loc.id)}>
                    <Ic.trash />
                  </IconButton>
                )}
              </div>
              <div style={{ height: 9, borderRadius: 6, background: 'var(--surface3)', overflow: 'hidden', display: 'flex' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,var(--accent),var(--accent2))' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginTop: 9 }}>
                <span>{loc.usage.used_str} used</span>
                <span>{loc.usage.free_str} free</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 14.5, fontWeight: 600 }}>
          Cleanup policies
        </div>
        <PolicyRow name="Delete files older than 90 days" desc="Applies to video downloads only" settingKey="policy_delete_old" />
        <PolicyRow name="Keep the 5 most recent per subscription" desc="Older episodes are removed automatically" settingKey="policy_keep_recent" />
        <PolicyRow name="Warn when a disk drops below 10% free" desc="Sends a notification, deletes nothing" settingKey="policy_low_disk_warn" />
      </div>

      {adding && <AddLocationDialog onClose={() => setAdding(false)} />}
    </div>
  )
}
