import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../api'
import { ACCENTS } from '../theme'
import { useStore } from '../store'
import { Field } from './Login'

function Row({ name, desc, children }: { name: string; desc: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottom: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{name}</div>
        <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 2 }}>{desc}</div>
      </div>
      {children}
    </div>
  )
}

const selectStyle = { background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 11px', fontSize: 13, outline: 'none' } as const

function ChangePasswordCard() {
  const changePassword = useStore((s) => s.changePassword)
  const user = useStore((s) => s.user)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user?.is_sso) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 12 }}>Change password</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
        <Field label="Current password" type="password" value={current} onChange={setCurrent} />
        <Field label="New password" type="password" value={next} onChange={setNext} />
        <button type="submit" disabled={busy || !current || next.length < 8} className="btn-primary" style={{ marginBottom: 14, opacity: current && next.length >= 8 ? 1 : 0.6 }}>
          Update
        </button>
      </div>
      {error && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{error}</div>}
    </form>
  )
}

function CookiesCard() {
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const [text, setText] = useState('')
  const saved = settings?.cookies_txt === '•••••'

  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', fontSize: 14.5, fontWeight: 600 }}>
        YouTube cookies
      </div>
      <div style={{ padding: '18px 20px' }}>
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
          Unlocks age-restricted videos and ones where the owner disabled playback outside YouTube.
          On youtube.com while signed in, export cookies with a browser extension such as
          “Get cookies.txt LOCALLY”, then paste the whole file here.
        </p>
        {saved && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--green)', marginBottom: 12 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)' }} />
            Cookies are saved — downloads use them automatically.
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={saved ? 'Paste new cookies here to replace the saved ones…' : '# Netscape HTTP Cookie File…'}
          aria-label="YouTube cookies"
          rows={5}
          spellCheck={false}
          style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 9, padding: '10px 12px', fontSize: 12, fontFamily: 'ui-monospace, monospace', outline: 'none', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
          {saved && (
            <button
              onClick={() => {
                setText('')
                void saveSettings({ cookies_txt: '' })
              }}
              style={{ padding: '9px 16px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--red)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
            >
              Clear cookies
            </button>
          )}
          <button
            className="btn-primary"
            disabled={!text.trim()}
            style={{ opacity: text.trim() ? 1 : 0.6 }}
            onClick={() => {
              void saveSettings({ cookies_txt: text }).then((ok) => ok && setText(''))
            }}
          >
            Save cookies
          </button>
        </div>
      </div>
    </div>
  )
}

function SsoCard() {
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const [issuer, setIssuer] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (settings && !loaded) {
      setIssuer(settings.sso_issuer)
      setClientId(settings.sso_client_id)
      setClientSecret(settings.sso_client_secret)
      setLoaded(true)
    }
  }, [settings, loaded])

  if (!settings) return null
  const enabled = settings.sso_enabled

  return (
    <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', fontSize: 14.5, fontWeight: 600 }}>
        Single sign-on (Authentik)
      </div>
      <Row name="Enable SSO" desc="Adds a “Sign in with SSO” button to the login page.">
        <label className="toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => void saveSettings({ sso_enabled: e.target.checked })}
            aria-label="Enable SSO"
          />
          <span className="track" />
          <span className="knob" />
        </label>
      </Row>
      <div style={{ padding: '18px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0 }}>
          <Field label="Issuer URL (from your Authentik provider, e.g. https://auth.example.com/application/o/mediaflow)" value={issuer} onChange={setIssuer} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Client ID" value={clientId} onChange={setClientId} />
            <Field label="Client secret" type="password" value={clientSecret} onChange={setClientSecret} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn-primary"
            onClick={() => void saveSettings({ sso_issuer: issuer, sso_client_id: clientId, sso_client_secret: clientSecret })}
          >
            Save SSO settings
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 12, lineHeight: 1.5 }}>
          In Authentik, create an OAuth2/OpenID provider with redirect URI
          <code style={{ background: 'var(--surface2)', padding: '1px 6px', borderRadius: 5, margin: '0 4px' }}>
            {location.origin}/api/auth/sso/callback
          </code>
          and paste its issuer, client ID and secret here.
        </div>
      </div>
    </div>
  )
}

export default function Settings() {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const accent = useStore((s) => s.accent)
  const setAccent = useStore((s) => s.setAccent)
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const recipes = useStore((s) => s.recipes)
  const loadSettings = useStore((s) => s.loadSettings)

  useEffect(() => {
    if (!settings) void loadSettings().catch(() => {})
  }, [settings, loadSettings])

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub" style={{ marginBottom: 22 }}>
        Configure MediaFlow for your server.
      </p>

      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', fontSize: 14.5, fontWeight: 600 }}>
          Appearance
        </div>
        <Row name="Theme" desc="Choose light or dark.">
          <div className="seg" style={{ background: 'var(--surface2)', borderRadius: 9 }}>
            <button className={'seg-btn' + (theme === 'dark' ? ' accent-on' : '')} style={{ padding: '6px 15px', borderRadius: 7 }} onClick={() => setTheme('dark')}>
              Dark
            </button>
            <button className={'seg-btn' + (theme === 'light' ? ' accent-on' : '')} style={{ padding: '6px 15px', borderRadius: 7 }} onClick={() => setTheme('light')}>
              Light
            </button>
          </div>
        </Row>
        <Row name="Accent color" desc="Used for highlights and primary buttons.">
          <div style={{ display: 'flex', gap: 8 }}>
            {ACCENTS.map((a) => (
              <button
                key={a.h}
                title={a.name}
                aria-label={`${a.name} accent`}
                onClick={() => setAccent(a)}
                style={{ width: 26, height: 26, borderRadius: '50%', cursor: 'pointer', background: a.h, border: `2px solid ${accent.h === a.h ? 'var(--text)' : 'transparent'}`, boxShadow: '0 0 0 2px var(--surface)' }}
              />
            ))}
          </div>
        </Row>
      </div>

      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', fontSize: 14.5, fontWeight: 600 }}>
          Downloads
        </div>
        <Row name="Default recipe" desc="Pre-selected after every analyze.">
          <select
            value={settings?.default_recipe ?? 'universal'}
            onChange={(e) => void saveSettings({ default_recipe: e.target.value })}
            style={selectStyle}
            aria-label="Default recipe"
          >
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </Row>
        <Row name="Concurrent downloads" desc="How many run at once.">
          <select
            value={settings?.concurrent_downloads ?? 3}
            onChange={(e) => void saveSettings({ concurrent_downloads: Number(e.target.value) })}
            style={selectStyle}
            aria-label="Concurrent downloads"
          >
            {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </Row>
        <Row name="Notifications" desc="On completion and failures.">
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings?.notifications ?? true}
              onChange={(e) => void saveSettings({ notifications: e.target.checked })}
              aria-label="Notifications"
            />
            <span className="track" />
            <span className="knob" />
          </label>
        </Row>
      </div>

      <CookiesCard />

      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)', fontSize: 14.5, fontWeight: 600 }}>
          Security
        </div>
        <ChangePasswordCard />
      </div>

      <SsoCard />
    </div>
  )
}
