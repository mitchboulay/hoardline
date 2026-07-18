import { create } from 'zustand'
import {
  api, ApiError, clearToken, getToken, setToken,
  type AdvField, type Analysis, type Capabilities, type ConversionProfile, type Job,
  type LibItem, type Recipe, type Settings, type Stats, type StorageLocation,
  type Subscription, type SystemInfo, type WatchedFolder,
} from './api'
import { ACCENTS, type Accent } from './theme'
import type { QueueFilter } from './lib/jobs'

export type Theme = 'dark' | 'light'
export type ToastKind = 'ok' | 'info' | 'warn'

export interface Toast { msg: string; kind: ToastKind }
export interface Confirm { title: string; body: string; action: string; onConfirm: () => void }
export interface User { username: string; is_sso: boolean; must_change_password: boolean }

function applyThemeDom(theme: Theme, accent: Accent) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.setProperty('--accent', accent.h)
  root.style.setProperty('--accent2', accent.h2)
  const n = parseInt(accent.h.slice(1), 16)
  const alpha = theme === 'dark' ? 0.16 : 0.11
  root.style.setProperty('--accent-soft', `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`)
}

const savedTheme: Theme = localStorage.getItem('hl-theme') === 'light' ? 'light' : 'dark'
const savedAccent = ACCENTS.find((a) => a.h === localStorage.getItem('hl-accent')) ?? ACCENTS[0]
applyThemeDom(savedTheme, savedAccent)

interface State {
  // theme (client-side only)
  theme: Theme
  accent: Accent
  setTheme: (theme: Theme) => void
  setAccent: (accent: Accent) => void

  // toast / confirm
  toast: Toast | null
  showToast: (msg: string, kind?: ToastKind) => void
  closeToast: () => void
  confirm: Confirm | null
  openConfirm: (confirm: Confirm) => void
  closeConfirm: () => void

  // auth
  token: string | null
  user: User | null
  ssoEnabled: boolean
  login: (username: string, password: string) => Promise<void>
  acceptSsoToken: (token: string) => Promise<void>
  logout: () => void
  loadMe: () => Promise<void>
  loadAuthConfig: () => Promise<void>
  changePassword: (current: string, next: string) => Promise<void>

  // server data
  jobs: Job[]
  setJobs: (jobs: Job[]) => void
  profiles: ConversionProfile[]
  capabilities: Capabilities | null
  watchedFolders: WatchedFolder[]
  loadProfiles: () => Promise<void>
  loadCapabilities: () => Promise<void>
  loadWatchedFolders: () => Promise<void>
  stats: Stats | null
  system: SystemInfo | null
  library: LibItem[]
  locations: StorageLocation[]
  subs: Subscription[]
  recipes: Recipe[]
  advFields: AdvField[]
  settings: Settings | null
  loadJobs: () => Promise<void>
  loadStats: () => Promise<void>
  loadSystem: () => Promise<void>
  loadLibrary: () => Promise<void>
  loadLocations: () => Promise<void>
  loadSubs: () => Promise<void>
  loadRecipes: () => Promise<void>
  loadSettings: () => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<boolean>

  // quick download flow
  url: string
  analyzing: boolean
  analysis: Analysis | null
  selectedIntent: string
  showAdvanced: boolean
  advChoices: Record<string, string>
  selectedLocationId: number | null
  convertMode: 'none' | 'when_needed' | 'always'
  convertProfileId: string
  convertRetention: 'keep' | 'delete'
  setConvertMode: (mode: 'none' | 'when_needed' | 'always') => void
  setConvertProfileId: (id: string) => void
  setConvertRetention: (r: 'keep' | 'delete') => void
  setUrl: (url: string) => void
  clearUrl: () => void
  analyze: () => Promise<void>
  selectIntent: (id: string) => void
  toggleAdvanced: () => void
  setAdvChoice: (key: string, value: string) => void
  setLocation: (id: number) => void
  effectiveLocationId: () => number | undefined
  download: (startPaused?: boolean) => Promise<boolean>

  // queue / library actions
  queueFilter: QueueFilter
  setQueueFilter: (filter: QueueFilter) => void
  jobAction: (id: number, action: 'pause' | 'resume' | 'retry' | 'cancel' | 'up' | 'down') => void
  clearJobs: (ids?: number[]) => Promise<void>
  deleteLibItem: (id: number) => void

  // storage actions
  addLocation: (body: { name: string; host: string; share: string; subpath: string; username: string; password: string }) => Promise<boolean>
  updateLocation: (id: number, body: { name: string; host?: string; share?: string; subpath: string; username?: string; password?: string }) => Promise<boolean>
  testLocation: (body: { host: string; share: string; subpath: string; username: string; password: string }) => Promise<string | null>
  deleteLocation: (id: number) => void

  // subscription actions
  addSubscription: (body: { name: string; url: string; freq: string; recipe_id: string; location_id: number; backfill: number }) => Promise<boolean>
  toggleSubscription: (id: number, enabled: boolean) => Promise<void>
  deleteSubscription: (id: number) => void
  checkSubscription: (id: number) => Promise<void>
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong — is the server up?')

export const useStore = create<State>((set, get) => {
  const toastError = (e: unknown) => get().showToast(errMsg(e), 'warn')

  return {
    theme: savedTheme,
    accent: savedAccent,
    setTheme: (theme) => {
      localStorage.setItem('hl-theme', theme)
      applyThemeDom(theme, get().accent)
      set({ theme })
    },
    setAccent: (accent) => {
      localStorage.setItem('hl-accent', accent.h)
      applyThemeDom(get().theme, accent)
      set({ accent })
    },

    toast: null,
    showToast: (msg, kind = 'ok') => {
      set({ toast: { msg, kind } })
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => set({ toast: null }), 3200)
    },
    closeToast: () => set({ toast: null }),
    confirm: null,
    openConfirm: (confirm) => set({ confirm }),
    closeConfirm: () => set({ confirm: null }),

    token: getToken(),
    user: null,
    ssoEnabled: false,
    login: async (username, password) => {
      const resp = await api.post<{ token: string; username: string; must_change_password: boolean }>(
        '/api/auth/login', { username, password })
      setToken(resp.token)
      set({ token: resp.token, user: { username: resp.username, is_sso: false, must_change_password: resp.must_change_password } })
    },
    acceptSsoToken: async (token) => {
      setToken(token)
      set({ token })
      await get().loadMe()
    },
    logout: () => {
      clearToken()
      set({ token: null, user: null })
    },
    loadMe: async () => {
      try {
        set({ user: await api.get<User>('/api/auth/me') })
      } catch {
        /* 401 path already handled by api client */
      }
    },
    loadAuthConfig: async () => {
      try {
        const cfg = await api.get<{ sso_enabled: boolean }>('/api/auth/config')
        set({ ssoEnabled: cfg.sso_enabled })
      } catch {
        /* server unreachable; login form still works */
      }
    },
    changePassword: async (current, next) => {
      await api.post('/api/auth/change-password', { current_password: current, new_password: next })
      const user = get().user
      if (user) set({ user: { ...user, must_change_password: false } })
      get().showToast('Password updated')
    },

    jobs: [],
    setJobs: (jobs) => set({ jobs }),
    profiles: [],
    capabilities: null,
    watchedFolders: [],
    loadProfiles: async () => set({ profiles: await api.get<ConversionProfile[]>('/api/profiles') }),
    loadCapabilities: async () => set({ capabilities: await api.get<Capabilities>('/api/capabilities') }),
    loadWatchedFolders: async () =>
      set({ watchedFolders: await api.get<WatchedFolder[]>('/api/watched-folders') }),
    stats: null,
    system: null,
    library: [],
    locations: [],
    subs: [],
    recipes: [],
    advFields: [],
    settings: null,
    loadJobs: async () => set({ jobs: await api.get<Job[]>('/api/jobs') }),
    loadStats: async () => set({ stats: await api.get<Stats>('/api/stats') }),
    loadSystem: async () => set({ system: await api.get<SystemInfo>('/api/system') }),
    loadLibrary: async () => set({ library: await api.get<LibItem[]>('/api/library') }),
    loadLocations: async () => set({ locations: await api.get<StorageLocation[]>('/api/storage-locations') }),
    loadSubs: async () => set({ subs: await api.get<Subscription[]>('/api/subscriptions') }),
    loadRecipes: async () => {
      const data = await api.get<{ recipes: Recipe[]; adv_fields: AdvField[] }>('/api/recipes')
      set({ recipes: data.recipes, advFields: data.adv_fields })
    },
    loadSettings: async () => set({ settings: await api.get<Settings>('/api/settings') }),
    saveSettings: async (patch) => {
      try {
        set({ settings: await api.put<Settings>('/api/settings', patch) })
        get().showToast('Settings saved')
        return true
      } catch (e) {
        toastError(e)
        return false
      }
    },

    url: '',
    analyzing: false,
    analysis: null,
    selectedIntent: 'universal',
    showAdvanced: false,
    advChoices: {},
    selectedLocationId: null,
    convertMode: 'none',
    convertProfileId: 'universal-1080p',
    convertRetention: 'keep',
    setConvertMode: (convertMode) => set({ convertMode }),
    setConvertProfileId: (convertProfileId) => set({ convertProfileId }),
    setConvertRetention: (convertRetention) => set({ convertRetention }),
    setUrl: (url) => set({ url }),
    clearUrl: () => set({ url: '', analysis: null }),
    analyze: async () => {
      const url = get().url.trim()
      if (!url) return
      set({ analyzing: true, analysis: null })
      try {
        const analysis = await api.post<Analysis>('/api/analyze', { url })
        const defaultRecipe = get().settings?.default_recipe ?? 'universal'
        set({ analysis, selectedIntent: defaultRecipe, advChoices: {} })
      } catch (e) {
        toastError(e)
      } finally {
        set({ analyzing: false })
      }
    },
    selectIntent: (id) =>
      set((s) => ({ selectedIntent: id, showAdvanced: id === 'custom' ? true : s.showAdvanced })),
    toggleAdvanced: () => set((s) => ({ showAdvanced: !s.showAdvanced })),
    setAdvChoice: (key, value) => set((s) => ({ advChoices: { ...s.advChoices, [key]: value } })),
    setLocation: (id) => set({ selectedLocationId: id }),
    effectiveLocationId: () => {
      const { selectedLocationId, settings, locations } = get()
      const preferred = settings?.default_location_id
      return selectedLocationId
        ?? (preferred && locations.some((l) => l.id === preferred) ? preferred : undefined)
        ?? locations[0]?.id
    },
    download: async (startPaused = false) => {
      const { analysis, selectedIntent, advChoices,
              convertMode, convertProfileId, convertRetention } = get()
      if (!analysis) return false
      const locationId = get().effectiveLocationId()
      if (!locationId) {
        get().showToast('Add a storage location first', 'warn')
        return false
      }
      try {
        const resp = await api.post<{ playlist?: boolean; created?: number; capped?: boolean }>('/api/jobs', {
          url: analysis.url,
          recipe_id: selectedIntent,
          location_id: locationId,
          title: analysis.title,
          uploader: analysis.uploader,
          thumbnail: analysis.thumbnail,
          overrides: advChoices,
          convert: convertMode === 'none'
            ? null
            : { mode: convertMode, profile_id: convertProfileId, retention: convertRetention },
          start_paused: startPaused,
        })
        const name = analysis.intents.find((i) => i.id === selectedIntent)?.name ?? selectedIntent
        set({ url: '', analysis: null, showAdvanced: false, advChoices: {} })
        if (resp.playlist) {
          get().showToast(
            `Queued ${resp.created} videos from the playlist${resp.capped ? ' (first 300)' : ''}` +
            (startPaused ? ' — paused until you resume them' : ''))
        } else {
          get().showToast(startPaused
            ? `Queued (paused) — "${name}". Resume it from the queue whenever you're ready.`
            : `Added to queue — "${name}"`)
        }
        void get().loadJobs()
        return true
      } catch (e) {
        toastError(e)
        return false
      }
    },

    queueFilter: 'all',
    setQueueFilter: (queueFilter) => set({ queueFilter }),
    jobAction: (id, action) => {
      const run = async () => {
        try {
          await api.post(`/api/jobs/${id}/${action}`)
          await get().loadJobs()
          if (action === 'retry') get().showToast('Retrying download…', 'info')
        } catch (e) {
          toastError(e)
        }
      }
      if (action === 'cancel') {
        const job = get().jobs.find((j) => j.id === id)
        get().openConfirm({
          title: 'Cancel this download?',
          body: `"${(job?.title ?? '').slice(0, 48)}…" will be removed from the queue. This can't be undone.`,
          action: 'Cancel download',
          onConfirm: () => {
            get().closeConfirm()
            void run().then(() => get().showToast('Download cancelled', 'info'))
          },
        })
        return
      }
      void run()
    },

    clearJobs: async (ids) => {
      try {
        const resp = await api.post<{ cleared: number }>('/api/jobs/clear', { ids: ids ?? null })
        get().showToast(resp.cleared
          ? `Cleared ${resp.cleared} finished job${resp.cleared === 1 ? '' : 's'}`
          : 'Nothing to clear — only finished jobs can be cleared', 'info')
        await get().loadJobs()
      } catch (e) {
        toastError(e)
      }
    },

    deleteLibItem: (id) => {
      const item = get().library.find((l) => l.id === id)
      get().openConfirm({
        title: 'Delete this file?',
        body: `"${(item?.title ?? '').slice(0, 44)}…" will be permanently removed from disk.`,
        action: 'Delete file',
        onConfirm: () => {
          get().closeConfirm()
          void api.del(`/api/library/${id}`)
            .then(() => {
              get().showToast('File deleted', 'info')
              return get().loadLibrary()
            })
            .catch(toastError)
        },
      })
    },

    addLocation: async (body) => {
      try {
        await api.post('/api/storage-locations', body)
        await get().loadLocations()
        get().showToast(`Storage location "${body.name}" connected`)
        return true
      } catch (e) {
        toastError(e)
        return false
      }
    },
    updateLocation: async (id, body) => {
      try {
        await api.patch(`/api/storage-locations/${id}`, body)
        await get().loadLocations()
        get().showToast(`"${body.name}" updated — connection verified`)
        return true
      } catch (e) {
        toastError(e)
        return false
      }
    },
    testLocation: async (body) => {
      try {
        await api.post('/api/storage-locations/test', body)
        return null
      } catch (e) {
        return errMsg(e)
      }
    },
    deleteLocation: (id) => {
      const loc = get().locations.find((l) => l.id === id)
      get().openConfirm({
        title: 'Remove this storage location?',
        body: `"${loc?.name ?? ''}" will be disconnected. Files already saved there stay on the drive.`,
        action: 'Remove location',
        onConfirm: () => {
          get().closeConfirm()
          void api.del(`/api/storage-locations/${id}`)
            .then(() => {
              get().showToast('Location removed', 'info')
              return get().loadLocations()
            })
            .catch(toastError)
        },
      })
    },

    addSubscription: async (body) => {
      try {
        const resp = await api.post<{ backfilled: number }>('/api/subscriptions', body)
        await Promise.all([get().loadSubs(), get().loadJobs()])
        get().showToast(resp.backfilled
          ? `Subscribed to "${body.name}" — queued ${resp.backfilled} older video(s), new uploads follow automatically`
          : `Subscribed to "${body.name}" — new uploads download automatically`)
        return true
      } catch (e) {
        toastError(e)
        return false
      }
    },
    toggleSubscription: async (id, enabled) => {
      try {
        await api.patch(`/api/subscriptions/${id}`, { enabled })
        await get().loadSubs()
      } catch (e) {
        toastError(e)
      }
    },
    deleteSubscription: (id) => {
      const sub = get().subs.find((s) => s.id === id)
      get().openConfirm({
        title: 'Delete this subscription?',
        body: `"${sub?.name ?? ''}" will stop checking for new uploads. Downloaded files are kept.`,
        action: 'Delete subscription',
        onConfirm: () => {
          get().closeConfirm()
          void api.del(`/api/subscriptions/${id}`)
            .then(() => {
              get().showToast('Subscription deleted', 'info')
              return get().loadSubs()
            })
            .catch(toastError)
        },
      })
    },
    checkSubscription: async (id) => {
      try {
        const resp = await api.post<{ queued: number }>(`/api/subscriptions/${id}/check`)
        get().showToast(resp.queued ? `Queued ${resp.queued} new download(s)` : 'Nothing new since last check', 'info')
        await Promise.all([get().loadSubs(), get().loadJobs()])
      } catch (e) {
        toastError(e)
      }
    },
  }
})
