// Thin authenticated fetch wrapper. All intelligence lives in the backend;
// this only attaches the Bearer token and surfaces error details.

export class ApiError extends Error {
  status: number
  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
  }
}

export const getToken = () => localStorage.getItem('mf-token')
export const setToken = (t: string) => localStorage.setItem('mf-token', t)
export const clearToken = () => localStorage.removeItem('mf-token')

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const resp = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (resp.status === 401 && !path.startsWith('/api/auth/login')) {
    clearToken()
    if (!location.pathname.startsWith('/login')) location.assign('/login')
    throw new ApiError(401, 'Session expired')
  }
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail ?? resp.statusText)
    throw new ApiError(resp.status, detail)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}

// ------------------------------------------------------------------- types

export type JobStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed'
export type JobKind = 'download' | 'convert'
export type JobStage =
  | 'queued' | 'inspecting' | 'downloading' | 'encoding' | 'verifying'
  | 'moving' | 'completed' | 'failed' | 'paused' | ''

export interface Job {
  id: number
  kind: JobKind
  url: string
  title: string
  thumbnail: string | null
  recipe_id: string
  recipe_name: string
  res: string
  status: JobStatus
  stage: JobStage
  progress: number
  speed: string
  eta: string
  fps: string
  worker: string | null
  priority: number
  location_id: number
  dest_display: string
  src_path: string | null
  src_size: number
  out_size: number
  profile_id: string | null
  profile_name: string | null
  retention: string
  convert_mode: string | null
  est_temp_bytes: number
  log: string
  error: string | null
  created_at: string
  updated_at: string
}

export interface ProfileSettings {
  container: 'mp4' | 'mkv'
  encoder: string
  quality: number
  max_height: number | null
  framerate: 'source' | '60' | '30'
  audio_codec: 'aac' | 'opus' | 'copy'
  audio_bitrate: number | null
  all_audio: boolean
  subtitles: 'keep' | 'none'
  crop: 'auto' | 'none'
  deinterlace: boolean
  tune: string | null
}

export interface ConversionProfile {
  id: string
  name: string
  desc: string
  builtin: boolean
  available: boolean
  settings: ProfileSettings
}

export interface Capabilities {
  handbrake: boolean
  handbrake_version: string | null
  encoders: string[]
  hw_encoders: string[]
  ffprobe: boolean
}

export interface FileEntry {
  name: string
  path: string
  size: number
  size_str: string
  mtime: number
  is_video: boolean
}

export interface FileListing {
  dirs: string[]
  files: FileEntry[]
}

export interface Inspection {
  deferred: boolean
  container?: string
  duration?: number
  size?: number
  vcodec?: string | null
  width?: number | null
  height?: number | null
  acodec?: string | null
  audio_streams?: number
}

export interface WatchedFolder {
  id: number
  location_id: number
  location_name?: string
  path: string
  profile_id: string
  profile_name?: string
  out_location_id: number
  out_location_name?: string
  out_subdir: string
  retention: string
  move_subdir: string
  enabled: number
  last_scanned: string | null
}

export interface ConvertPlan {
  action: 'copy' | 'remux' | 'transcode'
  explanation: string
}

export interface Intent {
  id: string
  name: string
  tag: string
  icon: string
  color: string
  rows: [string, string][]
  est_size: number | null
  est_size_str: string
  subdir: string
}

export interface Analysis {
  url: string
  title: string
  uploader: string
  platform: string
  duration_str: string
  thumbnail: string | null
  formats_count: number
  is_playlist: boolean
  entries_count: number
  intents: Intent[]
}

export interface LibItem {
  id: number
  title: string
  uploader: string | null
  duration_str: string
  recipe_name: string
  res: string
  size_bytes: number
  size_str: string
  remote_path: string
  location_id: number
  thumbnail: string | null
  created_at: string
}

export interface StorageUsage {
  total: number
  free: number
  used: number
  healthy: boolean
  total_str: string
  free_str: string
  used_str: string
}

export interface StorageLocation {
  id: number
  name: string
  type: 'local' | 'smb'
  host: string | null
  share: string | null
  subpath: string
  username: string | null
  usage: StorageUsage
}

export interface Subscription {
  id: number
  name: string
  url: string
  type: string
  freq: string
  recipe_id: string
  recipe_name?: string
  location_id: number
  location_name?: string
  enabled: number
  last_checked: string | null
}

export interface Recipe {
  id: string
  name: string
  tag: string
  icon: string
  color: string
  desc: string
  res: string
  rows: [string, string][]
  fields: [string, string, string][]
}

export interface AdvField {
  key: string
  label: string
  opts: string[]
  help: string
}

export interface Stats {
  active: number
  completed_today: number
  failed: number
  library_bytes: number
  library_bytes_str: string
  storage_total: number
  storage_free: number
  recent_jobs: Job[]
  roots_count: number
}

export interface SystemInfo {
  ytdlp_version: string
  ffmpeg: boolean
  ffmpeg_version: string | null
}

export interface Settings {
  default_recipe: string
  concurrent_downloads: number
  notifications: boolean
  sso_enabled: boolean
  sso_issuer: string
  sso_client_id: string
  sso_client_secret: string
  policy_delete_old: boolean
  policy_keep_recent: boolean
  policy_low_disk_warn: boolean
  cookies_txt: string
}
