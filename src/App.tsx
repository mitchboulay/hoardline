import { useEffect } from 'react'
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { getToken } from './api'
import { ConfirmDialog, Toast } from './components'
import { Ic, type IconName } from './icons'
import { useStore } from './store'
import Dashboard from './pages/Dashboard'
import Quick from './pages/Quick'
import Convert from './pages/Convert'
import Queue from './pages/Queue'
import Library from './pages/Library'
import Recipes from './pages/Recipes'
import Profiles from './pages/Profiles'
import Subscriptions from './pages/Subscriptions'
import WatchedFolders from './pages/WatchedFolders'
import Storage from './pages/Storage'
import Settings from './pages/Settings'
import { ForceChangePassword, Login } from './pages/Login'

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/quick', label: 'Quick Download', icon: 'quick' },
  { to: '/convert', label: 'Convert', icon: 'hq' },
  { to: '/queue', label: 'Queue', icon: 'queue' },
  { to: '/library', label: 'Library', icon: 'library' },
  { to: '/recipes', label: 'Recipes', icon: 'recipes' },
  { to: '/profiles', label: 'Profiles', icon: 'sliders' },
  { to: '/subscriptions', label: 'Subscriptions', icon: 'subs' },
  { to: '/watched-folders', label: 'Watched folders', icon: 'folder' },
  { to: '/storage', label: 'Storage', icon: 'storage' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

function Sidebar() {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const user = useStore((s) => s.user)
  const logout = useStore((s) => s.logout)
  const activeCount = useStore(
    (s) => s.jobs.filter((j) => j.status === 'downloading' || j.status === 'queued').length,
  )
  const ThemeIcon = theme === 'dark' ? Ic.sun : Ic.moon

  return (
    <aside className="sidebar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px 20px' }}>
        <div
          style={{
            width: 32, height: 32, borderRadius: 9,
            background: 'linear-gradient(135deg,var(--accent),var(--accent2))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 12px var(--accent-soft)', flexShrink: 0,
          }}
        >
          <Ic.down width={18} height={18} stroke="#fff" strokeWidth={2.2} />
        </div>
        <div className="hide-collapsed" style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em' }}>
          MediaFlow
        </div>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(({ to, label, icon }) => {
          const Icon = Ic[icon]
          return (
            <NavLink key={to} to={to} className={({ isActive }) => 'nav-btn' + (isActive ? ' active' : '')}>
              <span style={{ display: 'flex', width: 18, height: 18 }}>
                <Icon />
              </span>
              <span className="hide-collapsed">{label}</span>
              {to === '/queue' && activeCount > 0 && (
                <span className="nav-badge hide-collapsed">{activeCount}</span>
              )}
            </NavLink>
          )
        })}
      </nav>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: 6 }}>
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            padding: '9px 10px', borderRadius: 9, border: '1px solid var(--border)',
            background: 'var(--surface2)', color: 'var(--muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}
        >
          <span style={{ display: 'flex', width: 16, height: 16 }}>
            <ThemeIcon />
          </span>
          <span className="hide-collapsed">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
        <div className="hide-collapsed" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 6px' }}>
          <div
            style={{
              width: 30, height: 30, borderRadius: '50%',
              background: 'linear-gradient(135deg,#f59e0b,#ef4444)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
            }}
          >
            {(user?.username ?? '?').slice(0, 1)}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.username ?? '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--faint)' }}>{user?.is_sso ? 'SSO' : 'Self-hosted'}</div>
          </div>
          <button onClick={logout} className="icon-btn" title="Sign out" aria-label="Sign out" style={{ width: 28, height: 28 }}>
            <Ic.cancel width={13} height={13} />
          </button>
        </div>
      </div>
    </aside>
  )
}

function AuthedApp() {
  const loadJobs = useStore((s) => s.loadJobs)
  const setJobs = useStore((s) => s.setJobs)
  const loadMe = useStore((s) => s.loadMe)
  const loadRecipes = useStore((s) => s.loadRecipes)
  const loadLocations = useStore((s) => s.loadLocations)
  const loadSettings = useStore((s) => s.loadSettings)
  const loadProfiles = useStore((s) => s.loadProfiles)
  const loadCapabilities = useStore((s) => s.loadCapabilities)

  useEffect(() => {
    void loadMe()
    void loadRecipes()
    void loadLocations()
    void loadSettings()
    void loadProfiles().catch(() => {})
    void loadCapabilities().catch(() => {})
    void loadJobs()

    // Live queue updates over SSE; falls back to polling if the stream dies.
    let es: EventSource | null = null
    let poll: ReturnType<typeof setInterval> | undefined
    const startPolling = () => {
      if (!poll) poll = setInterval(() => void loadJobs().catch(() => {}), 1500)
    }
    const token = getToken()
    if (token && 'EventSource' in window) {
      es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)
      es.onmessage = (e) => setJobs(JSON.parse(e.data))
      es.onerror = () => {
        es?.close()
        es = null
        startPolling()
      }
    } else {
      startPolling()
    }
    return () => {
      es?.close()
      if (poll) clearInterval(poll)
    }
  }, [loadJobs, setJobs, loadMe, loadRecipes, loadLocations, loadSettings, loadProfiles, loadCapabilities])

  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <div className="main-inner">
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/quick" element={<Quick />} />
            <Route path="/convert" element={<Convert />} />
            <Route path="/queue" element={<Queue />} />
            <Route path="/library" element={<Library />} />
            <Route path="/recipes" element={<Recipes />} />
            <Route path="/profiles" element={<Profiles />} />
            <Route path="/subscriptions" element={<Subscriptions />} />
            <Route path="/watched-folders" element={<WatchedFolders />} />
            <Route path="/storage" element={<Storage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>
      </main>
      <Toast />
      <ConfirmDialog />
    </div>
  )
}

export default function App() {
  const token = useStore((s) => s.token)
  const user = useStore((s) => s.user)
  const acceptSsoToken = useStore((s) => s.acceptSsoToken)

  // The SSO callback lands on /#sso_token=<jwt>
  useEffect(() => {
    const match = location.hash.match(/sso_token=([^&]+)/)
    if (match) {
      history.replaceState(null, '', location.pathname)
      void acceptSsoToken(match[1])
    }
  }, [acceptSsoToken])

  if (!token) return <><Login /><Toast /></>
  if (user?.must_change_password) return <><ForceChangePassword /><Toast /></>

  return (
    <BrowserRouter>
      <AuthedApp />
    </BrowserRouter>
  )
}
