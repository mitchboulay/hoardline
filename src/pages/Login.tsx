import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../api'
import { Ic } from '../icons'
import { useStore } from '../store'

const inputStyle = {
  width: '100%',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: 9,
  padding: '11px 12px',
  fontSize: 14,
  outline: 'none',
} as const

export function Field({
  label, type = 'text', value, onChange, autoFocus,
}: {
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
}) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        style={inputStyle}
      />
    </label>
  )
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 20 }}>
      <div style={{ width: 380, maxWidth: '100%', animation: 'pop .25s both' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, justifyContent: 'center', marginBottom: 22 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(135deg,var(--accent),var(--accent2))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 18px var(--accent-soft)' }}>
            <Ic.down width={20} height={20} stroke="#fff" strokeWidth={2.2} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>MediaFlow</span>
        </div>
        <div className="card" style={{ borderRadius: 14, padding: 24, boxShadow: 'var(--shadow)' }}>{children}</div>
      </div>
    </div>
  )
}

export function Login() {
  const login = useStore((s) => s.login)
  const ssoEnabled = useStore((s) => s.ssoEnabled)
  const loadAuthConfig = useStore((s) => s.loadAuthConfig)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadAuthConfig()
  }, [loadAuthConfig])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(username, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <h1 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>Sign in</h1>
      <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--muted)' }}>Welcome back to your server.</p>
      <form onSubmit={submit}>
        <Field label="Username" value={username} onChange={setUsername} autoFocus />
        <Field label="Password" type="password" value={password} onChange={setPassword} />
        {error && (
          <div style={{ fontSize: 12.5, color: 'var(--red)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Ic.alert width={14} height={14} strokeWidth={2} />
            {error}
          </div>
        )}
        <button type="submit" disabled={busy} className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: 12, fontSize: 14 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {ssoEnabled && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0', color: 'var(--faint)', fontSize: 11.5 }}>
            <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            or
            <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>
          <button
            onClick={() => location.assign('/api/auth/sso/login')}
            style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
          >
            Sign in with SSO
          </button>
        </>
      )}
    </AuthShell>
  )
}

export function ForceChangePassword() {
  const changePassword = useStore((s) => s.changePassword)
  const logout = useStore((s) => s.logout)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next !== confirm) {
      setError('New passwords don’t match')
      return
    }
    setBusy(true)
    setError('')
    try {
      await changePassword(current, next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <h1 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>Choose a new password</h1>
      <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
        You're still using the default password. Set your own before continuing.
      </p>
      <form onSubmit={submit}>
        <Field label="Current password" type="password" value={current} onChange={setCurrent} autoFocus />
        <Field label="New password (min 8 characters)" type="password" value={next} onChange={setNext} />
        <Field label="Confirm new password" type="password" value={confirm} onChange={setConfirm} />
        {error && (
          <div style={{ fontSize: 12.5, color: 'var(--red)', marginBottom: 12 }}>{error}</div>
        )}
        <button type="submit" disabled={busy} className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: 12, fontSize: 14 }}>
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
      </form>
      <button onClick={logout} className="link-btn" style={{ width: '100%', marginTop: 14 }}>
        Sign out
      </button>
    </AuthShell>
  )
}
