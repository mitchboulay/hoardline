import { useState } from 'react'
import { api, type ConversionProfile, type ProfileSettings } from '../api'
import { Ic } from '../icons'
import { useStore } from '../store'
import { Field } from './Login'

const selectStyle = {
  width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
  color: 'var(--text)', borderRadius: 8, padding: '8px 11px', fontSize: 13, outline: 'none',
} as const

const ENCODER_LABELS: Record<string, string> = {
  x264: 'H.264 (x264)', x265: 'H.265 (x265)', x265_10bit: 'H.265 10-bit',
  svt_av1: 'AV1 (SVT)', qsv_h264: 'H.264 (Intel QSV)', qsv_h265: 'H.265 (Intel QSV)',
  nvenc_h264: 'H.264 (NVENC)', nvenc_h265: 'H.265 (NVENC)',
  vce_h264: 'H.264 (AMD VCE)', vce_h265: 'H.265 (AMD VCE)',
  vt_h264: 'H.264 (VideoToolbox)', vt_h265: 'H.265 (VideoToolbox)',
}

function ProfileEditor({ base, onClose }: { base: ConversionProfile | null; onClose: () => void }) {
  const capabilities = useStore((s) => s.capabilities)
  const loadProfiles = useStore((s) => s.loadProfiles)
  const showToast = useStore((s) => s.showToast)
  const editing = base !== null && !base.builtin
  const [name, setName] = useState(base ? (base.builtin ? `${base.name} (copy)` : base.name) : 'My profile')
  const [desc, setDesc] = useState(base?.desc ?? '')
  const [s, setS] = useState<ProfileSettings>(
    base?.settings ?? {
      container: 'mp4', encoder: 'x264', quality: 20, max_height: 1080, framerate: 'source',
      audio_codec: 'aac', audio_bitrate: 160, all_audio: false, subtitles: 'keep',
      crop: 'auto', deinterlace: false, tune: null,
    })
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const patch = (p: Partial<ProfileSettings>) => setS({ ...s, ...p })
  const encoders = capabilities?.encoders ?? ['x264', 'x265']

  const save = async () => {
    setBusy(true)
    try {
      if (editing && base) await api.put(`/api/profiles/${base.id}`, { name, desc, settings: s })
      else await api.post('/api/profiles', { name, desc, settings: s })
      await loadProfiles()
      showToast(`Profile "${name}" saved`)
      onClose()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save profile', 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pop .18s both', overflowY: 'auto', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 520, maxWidth: '100%', boxShadow: '0 24px 60px rgba(0,0,0,.5)', margin: 'auto' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 17, fontWeight: 600 }}>
          {editing ? 'Edit profile' : 'New profile'}
        </h3>
        <Field label="Name" value={name} onChange={setName} autoFocus />
        <Field label="Description" value={desc} onChange={setDesc} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Container</span>
            <select value={s.container} onChange={(e) => patch({ container: e.target.value as 'mp4' | 'mkv' })} style={selectStyle}>
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
            </select>
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Video encoder</span>
            <select value={s.encoder} onChange={(e) => patch({ encoder: e.target.value })} style={selectStyle}>
              {encoders.map((enc) => (
                <option key={enc} value={enc}>{ENCODER_LABELS[enc] ?? enc}</option>
              ))}
            </select>
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Quality (RF {s.quality} — lower is better)</span>
            <input type="range" min={14} max={30} value={s.quality} onChange={(e) => patch({ quality: Number(e.target.value) })} style={{ width: '100%' }} />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Resolution limit</span>
            <select value={s.max_height ?? ''} onChange={(e) => patch({ max_height: e.target.value ? Number(e.target.value) : null })} style={selectStyle}>
              <option value="">Source</option>
              <option value="2160">2160p</option>
              <option value="1440">1440p</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
            </select>
          </label>
        </div>
        <button
          onClick={() => setAdvanced(!advanced)}
          aria-expanded={advanced}
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', color: 'var(--accent2)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0, margin: '14px 0' }}
        >
          <span style={{ display: 'flex', transition: 'transform .2s', transform: advanced ? 'rotate(90deg)' : 'none' }}><Ic.chevron width={13} height={13} /></span>
          Advanced encoding options
        </button>
        {advanced && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 4, animation: 'fadeup .2s both' }}>
            <label>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Frame rate</span>
              <select value={s.framerate} onChange={(e) => patch({ framerate: e.target.value as ProfileSettings['framerate'] })} style={selectStyle}>
                <option value="source">Source</option>
                <option value="60">60 fps cap</option>
                <option value="30">30 fps cap</option>
              </select>
            </label>
            <label>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Audio</span>
              <select value={s.audio_codec} onChange={(e) => patch({ audio_codec: e.target.value as ProfileSettings['audio_codec'] })} style={selectStyle}>
                <option value="aac">AAC (re-encode)</option>
                <option value="opus">Opus (re-encode)</option>
                <option value="copy">Pass through untouched</option>
              </select>
            </label>
            <label>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Audio tracks</span>
              <select value={s.all_audio ? 'all' : 'first'} onChange={(e) => patch({ all_audio: e.target.value === 'all' })} style={selectStyle}>
                <option value="first">First track only</option>
                <option value="all">All tracks</option>
              </select>
            </label>
            <label>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Subtitles</span>
              <select value={s.subtitles} onChange={(e) => patch({ subtitles: e.target.value as 'keep' | 'none' })} style={selectStyle}>
                <option value="keep">Keep all</option>
                <option value="none">Drop</option>
              </select>
            </label>
            <label>
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Cropping</span>
              <select value={s.crop} onChange={(e) => patch({ crop: e.target.value as 'auto' | 'none' })} style={selectStyle}>
                <option value="auto">Auto-crop black bars</option>
                <option value="none">Never crop</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 22, fontSize: 13 }}>
              <input type="checkbox" checked={s.deinterlace} onChange={(e) => patch({ deinterlace: e.target.checked })} />
              Deinterlace
            </label>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Profiles() {
  const profiles = useStore((s) => s.profiles)
  const capabilities = useStore((s) => s.capabilities)
  const loadProfiles = useStore((s) => s.loadProfiles)
  const openConfirm = useStore((s) => s.openConfirm)
  const closeConfirm = useStore((s) => s.closeConfirm)
  const showToast = useStore((s) => s.showToast)
  const [editor, setEditor] = useState<{ base: ConversionProfile | null } | null>(null)

  const remove = (p: ConversionProfile) => {
    openConfirm({
      title: 'Delete this profile?',
      body: `"${p.name}" will be removed. Completed conversions are unaffected.`,
      action: 'Delete profile',
      onConfirm: () => {
        closeConfirm()
        void api.del(`/api/profiles/${p.id}`)
          .then(() => {
            showToast('Profile deleted', 'info')
            return loadProfiles()
          })
          .catch((e) => showToast(e instanceof Error ? e.message : 'Delete failed', 'warn'))
      },
    })
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Conversion profiles</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Reusable HandBrake presets for conversions.
            {capabilities?.handbrake_version && (
              <span style={{ color: 'var(--faint)' }}> · {capabilities.handbrake_version}</span>
            )}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setEditor({ base: null })}>
          <Ic.plus />
          New profile
        </button>
      </div>

      {capabilities && !capabilities.handbrake && (
        <div className="card" style={{ padding: '14px 18px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', color: 'var(--red)', fontSize: 13 }}>
          <Ic.warn width={16} height={16} />
          HandBrakeCLI isn't installed on this server — conversions can't run.
        </div>
      )}

      <div className="grid-lib">
        {profiles.map((p) => (
          <div key={p.id} className="card" style={{ padding: '16px 18px', opacity: p.available ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 3 }}>{p.desc}</div>
              </div>
              {p.builtin ? (
                <span style={{ fontSize: 10, color: 'var(--faint)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 5, flexShrink: 0 }}>Built-in</span>
              ) : (
                <span style={{ fontSize: 10, color: 'var(--accent2)', border: '1px solid var(--accent-soft)', background: 'var(--accent-soft)', padding: '1px 6px', borderRadius: 5, flexShrink: 0, fontWeight: 600 }}>Custom</span>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              <span className="chip chip-sm">{p.settings.container.toUpperCase()}</span>
              <span className="chip chip-sm">{ENCODER_LABELS[p.settings.encoder] ?? p.settings.encoder}</span>
              <span className="chip chip-sm">RF {p.settings.quality}</span>
              <span className="chip chip-sm">{p.settings.max_height ? `≤${p.settings.max_height}p` : 'Source res'}</span>
              {!p.available && (
                <span className="chip chip-sm" style={{ color: 'var(--red)', borderColor: 'rgba(248,113,113,.3)' }}>
                  Encoder unavailable
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                onClick={() => setEditor({ base: p })}
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent2)', background: 'var(--accent-soft)', border: 'none', padding: '6px 11px', borderRadius: 7, cursor: 'pointer' }}
              >
                {p.builtin ? 'Duplicate & edit' : 'Edit'}
              </button>
              {!p.builtin && (
                <button
                  onClick={() => remove(p)}
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--red)', background: 'rgba(248,113,113,.12)', border: 'none', padding: '6px 11px', borderRadius: 7, cursor: 'pointer' }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {editor && <ProfileEditor base={editor.base} onClose={() => setEditor(null)} />}
    </div>
  )
}
