import { useEffect, useState, type FormEvent } from 'react'
import { IconButton, Thumb } from '../components'
import { Ic } from '../icons'
import { gradientFor } from '../lib/jobs'
import { useStore } from '../store'
import { Field } from './Login'

const FREQS = ['hourly', 'every 6 hours', 'daily', 'weekly']

const BACKFILL_OPTIONS: [number, string][] = [
  [0, 'New uploads only'],
  [5, 'Also grab the last 5 videos'],
  [10, 'Also grab the last 10 videos'],
  [25, 'Also grab the last 25 videos'],
  [200, 'Backfill everything (up to 200)'],
]

function AddSubscriptionDialog({ onClose }: { onClose: () => void }) {
  const recipes = useStore((s) => s.recipes)
  const locations = useStore((s) => s.locations)
  const settings = useStore((s) => s.settings)
  const addSubscription = useStore((s) => s.addSubscription)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [freq, setFreq] = useState('daily')
  const [recipeId, setRecipeId] = useState('universal')
  const [locationId, setLocationId] = useState(settings?.default_location_id ?? locations[0]?.id ?? 0)
  const [backfill, setBackfill] = useState(0)
  const [busy, setBusy] = useState(false)

  const selectStyle = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 9, padding: '10px 11px', fontSize: 13.5, outline: 'none' } as const

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const ok = await addSubscription({ name, url, freq, recipe_id: recipeId, location_id: locationId, backfill })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pop .18s both' }}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 440, maxWidth: 'calc(100vw - 32px)', boxShadow: '0 24px 60px rgba(0,0,0,.5)' }}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600 }}>Add subscription</h3>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
          Paste a channel or playlist link. New uploads download automatically — existing videos aren't backfilled.
        </p>
        <Field label="Name" value={name} onChange={setName} autoFocus />
        <Field label="Channel or playlist URL" value={url} onChange={setUrl} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <label>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Check</span>
            <select value={freq} onChange={(e) => setFreq(e.target.value)} style={selectStyle}>
              {FREQS.map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Recipe</span>
            <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)} style={selectStyle}>
              {recipes.filter((r) => r.id !== 'custom').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <label>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Save to</span>
            <select value={locationId} onChange={(e) => setLocationId(Number(e.target.value))} style={selectStyle}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Catch up on older videos?</span>
            <select value={backfill} onChange={(e) => setBackfill(Number(e.target.value))} style={selectStyle}>
              {BACKFILL_OPTIONS.map(([n, label]) => <option key={n} value={n}>{label}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '9px 16px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !name || !url} className="btn-primary" style={{ opacity: !name || !url ? 0.6 : 1 }}>
            {busy ? 'Checking channel…' : 'Subscribe'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function Subscriptions() {
  const subs = useStore((s) => s.subs)
  const loadSubs = useStore((s) => s.loadSubs)
  const toggleSubscription = useStore((s) => s.toggleSubscription)
  const deleteSubscription = useStore((s) => s.deleteSubscription)
  const checkSubscription = useStore((s) => s.checkSubscription)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    void loadSubs().catch(() => {})
  }, [loadSubs])

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Subscriptions</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Automatically grab new uploads from channels and playlists.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          <Ic.plus />
          Add subscription
        </button>
      </div>

      {subs.length === 0 && (
        <div className="card" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--faint)' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--muted)' }}>No subscriptions yet.</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Subscribe to a channel and new uploads arrive on their own.</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {subs.map((sb) => {
          const on = Boolean(sb.enabled)
          return (
            <div key={sb.id} className="card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <Thumb src={null} fallback={gradientFor(sb.id)} style={{ width: 46, height: 46, borderRadius: 12 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600 }}>{sb.name}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--muted)', border: '1px solid var(--border)', padding: '1px 7px', borderRadius: 5 }}>
                    {sb.type}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--faint)', marginTop: 5, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <span>Checks {sb.freq}</span>
                  <span>{sb.recipe_name}</span>
                  <span>{sb.location_name}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: on ? 'var(--green)' : 'var(--faint)' }}>
                  {on ? 'Active' : 'Paused'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>
                  {sb.last_checked ? `Last checked ${sb.last_checked.slice(0, 16)} UTC` : 'Never checked'}
                </div>
              </div>
              <IconButton label="Check now" onClick={() => void checkSubscription(sb.id)}>
                <Ic.retry />
              </IconButton>
              <IconButton label="Delete" onClick={() => deleteSubscription(sb.id)}>
                <Ic.trash />
              </IconButton>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => void toggleSubscription(sb.id, e.target.checked)}
                  aria-label={`Enable ${sb.name}`}
                />
                <span className="track" />
                <span className="knob" />
              </label>
            </div>
          )
        })}
      </div>

      {adding && <AddSubscriptionDialog onClose={() => setAdding(false)} />}
    </div>
  )
}
