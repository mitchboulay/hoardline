import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type ConvertPlan } from '../api'
import { Ic, type IconName } from '../icons'
import { useStore } from '../store'

const icon = (name: string) => Ic[(name in Ic ? name : 'film') as IconName]

const smallSelect = {
  background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none', width: '100%',
} as const

function PostDownloadConversion() {
  const profiles = useStore((s) => s.profiles)
  const convertMode = useStore((s) => s.convertMode)
  const setConvertMode = useStore((s) => s.setConvertMode)
  const convertProfileId = useStore((s) => s.convertProfileId)
  const setConvertProfileId = useStore((s) => s.setConvertProfileId)
  const convertRetention = useStore((s) => s.convertRetention)
  const setConvertRetention = useStore((s) => s.setConvertRetention)
  const [plan, setPlan] = useState<ConvertPlan | null>(null)

  useEffect(() => {
    if (convertMode === 'none') {
      setPlan(null)
      return
    }
    void api.get<ConvertPlan>(`/api/convert/plan?profile_id=${convertProfileId}`).then(setPlan).catch(() => setPlan(null))
  }, [convertMode, convertProfileId])

  return (
    <div className="card" style={{ marginTop: 14, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: convertMode === 'none' ? 0 : 14 }}>
        <span style={{ display: 'flex', width: 17, height: 17, color: 'var(--accent2)' }}>
          <Ic.hq width={17} height={17} />
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>Post-download conversion</span>
        <select
          aria-label="Post-download conversion mode"
          value={convertMode}
          onChange={(e) => setConvertMode(e.target.value as typeof convertMode)}
          style={{ ...smallSelect, width: 'auto' }}
        >
          <option value="none">No conversion</option>
          <option value="when_needed">Convert only when needed</option>
          <option value="always">Always convert</option>
        </select>
      </div>
      {convertMode !== 'none' && (
        <div style={{ animation: 'fadeup .2s both' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Profile</span>
              <select value={convertProfileId} onChange={(e) => setConvertProfileId(e.target.value)} style={smallSelect}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.name}{p.available ? '' : ' (unavailable)'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>Downloaded original</span>
              <select value={convertRetention} onChange={(e) => setConvertRetention(e.target.value as 'keep' | 'delete')} style={smallSelect}>
                <option value="delete">Keep only the converted file</option>
                <option value="keep">Keep both files</option>
              </select>
            </label>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10, lineHeight: 1.45 }}>
            {convertMode === 'when_needed'
              ? 'The download is inspected first: if it already matches the profile it\'s kept as-is; matching video in the wrong container is remuxed losslessly; otherwise it\'s transcoded.'
              : plan?.explanation ?? 'The downloaded file is always re-encoded with this profile.'}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Quick() {
  const nav = useNavigate()
  const url = useStore((s) => s.url)
  const setUrl = useStore((s) => s.setUrl)
  const clearUrl = useStore((s) => s.clearUrl)
  const analyze = useStore((s) => s.analyze)
  const analyzing = useStore((s) => s.analyzing)
  const analysis = useStore((s) => s.analysis)
  const selectedIntent = useStore((s) => s.selectedIntent)
  const selectIntent = useStore((s) => s.selectIntent)
  const showAdvanced = useStore((s) => s.showAdvanced)
  const toggleAdvanced = useStore((s) => s.toggleAdvanced)
  const advFields = useStore((s) => s.advFields)
  const advChoices = useStore((s) => s.advChoices)
  const setAdvChoice = useStore((s) => s.setAdvChoice)
  const locations = useStore((s) => s.locations)
  const setLocation = useStore((s) => s.setLocation)
  const download = useStore((s) => s.download)

  const effectiveLocationId = useStore((s) => s.effectiveLocationId)

  const sel = analysis?.intents.find((i) => i.id === selectedIntent) ?? analysis?.intents[0]
  const locationId = effectiveLocationId()
  const location = locations.find((l) => l.id === locationId)
  const channel = analysis?.uploader?.replace(/^📺\s*/, '') ?? '{channel}'
  const destDisplay = location
    ? location.type === 'local'
      ? `Local storage · /downloads/${channel}/`
      : `${location.name} · //${location.host}/${location.share}${location.subpath ? '/' + location.subpath : ''}/${channel}/`
    : 'No storage location'

  return (
    <div className="page">
      <div style={{ textAlign: 'center', maxWidth: 680, margin: '14px auto 26px' }}>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: '-0.025em' }}>
          What would you like to save?
        </h1>
        <p style={{ margin: '9px 0 0', color: 'var(--muted)', fontSize: 15 }}>
          Paste a link from YouTube, Vimeo, or 1,800+ other sites. We'll figure out the rest.
        </p>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex', gap: 10, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 14, padding: '9px 9px 9px 16px', boxShadow: 'var(--shadow)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', color: 'var(--faint)' }}>
            <Ic.quick width={19} height={19} />
          </span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void analyze()}
            placeholder="Paste a video or playlist URL…"
            aria-label="Video or playlist URL"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 15, minWidth: 0 }}
          />
          {url && (
            <button
              onClick={clearUrl}
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 9, padding: '0 14px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' }}
            >
              Clear
            </button>
          )}
          <button
            onClick={() => void analyze()}
            disabled={analyzing || !url.trim()}
            style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', opacity: url.trim() ? 1 : 0.6 }}
          >
            {analyzing ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>

        {analyzing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', color: 'var(--muted)', fontSize: 14, marginTop: 28, animation: 'pop .2s both' }}>
            <span style={{ width: 18, height: 18, border: '2.5px solid var(--border2)', borderTopColor: 'var(--accent)', borderRadius: '50%', display: 'inline-block', animation: 'spin .7s linear infinite' }} />
            Reading the page and checking available formats…
          </div>
        )}
      </div>

      {analysis && sel && (
        <div style={{ maxWidth: 960, margin: '26px auto 0', animation: 'pop .28s both' }}>
          <div className="card" style={{ display: 'flex', gap: 18, borderRadius: 14, padding: 16 }}>
            <div
              style={{ width: 200, height: 112, borderRadius: 10, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', flexShrink: 0, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'flex-end', padding: 8 }}
            >
              {analysis.thumbnail && (
                <img src={analysis.thumbnail} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              <span style={{ background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 11.5, fontWeight: 600, padding: '2px 6px', borderRadius: 5, zIndex: 1 }}>
                {analysis.duration_str}
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, lineHeight: 1.3 }}>{analysis.title}</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                <span className="chip">{analysis.uploader}</span>
                <span className="chip">{analysis.platform}</span>
                <span className="chip">{analysis.duration_str}</span>
                <span className="chip">{analysis.formats_count} formats found</span>
                <span className="chip" style={{ color: 'var(--accent2)', background: 'var(--accent-soft)', borderColor: 'var(--accent-soft)', fontWeight: 600 }}>
                  {analysis.is_playlist ? `Playlist · ${analysis.entries_count} videos` : 'Single video'}
                </span>
              </div>
            </div>
          </div>

          <h3 style={{ margin: '26px 0 4px', fontSize: 16, fontWeight: 600 }}>How should we save it?</h3>
          <p style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: 13.5 }}>
            Pick the outcome you want — we'll choose the right formats behind the scenes.
          </p>

          <div className="grid-intents">
            {analysis.intents.map((c) => {
              const Icon = icon(c.icon)
              const checked = c.id === selectedIntent
              return (
                <button
                  key={c.id}
                  onClick={() => selectIntent(c.id)}
                  aria-pressed={checked}
                  style={{
                    position: 'relative', display: 'flex', gap: 12, alignItems: 'flex-start', padding: 15,
                    borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                    background: checked ? 'var(--accent-soft)' : 'var(--surface)',
                    border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
                    color: 'var(--text)',
                  }}
                >
                  <span style={{ display: 'flex', width: 22, height: 22, color: c.color, flexShrink: 0 }}>
                    <Icon width={22} height={22} />
                  </span>
                  <span>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{c.name}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 2, lineHeight: 1.35 }}>
                      {c.tag}
                    </span>
                  </span>
                  {checked && (
                    <span style={{ position: 'absolute', top: 10, right: 10, color: 'var(--accent2)' }}>
                      <svg width={17} height={17} viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.5-4.5 1.4 1.4z" />
                      </svg>
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px', marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
              <span style={{ display: 'flex', width: 18, height: 18, color: 'var(--accent2)' }}>
                <Ic.info />
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Here's what "{sel.name}" will do</span>
            </div>
            <div className="grid-explain">
              {sel.rows.map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 11.5, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                    {k}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 500, marginTop: 3 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={toggleAdvanced}
            aria-expanded={showAdvanced}
            style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', marginTop: 14, padding: '13px 16px', borderRadius: showAdvanced ? '12px 12px 0 0' : 12, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
          >
            <span style={{ display: 'flex', width: 16, height: 16, transition: 'transform .2s', transform: showAdvanced ? 'rotate(90deg)' : 'none' }}>
              <Ic.chevron />
            </span>
            Advanced options
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--faint)', marginLeft: 2 }}>
              Quality, container, subtitles, SponsorBlock…
            </span>
          </button>
          {showAdvanced && (
            <div style={{ border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: 20, background: 'var(--surface)', animation: 'fadeup .2s both' }}>
              <div className="grid-adv">
                {advFields.map((a) => (
                  <div key={a.key}>
                    <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>{a.label}</label>
                    <select
                      aria-label={a.label}
                      value={advChoices[a.key] ?? a.opts[0]}
                      onChange={(e) => setAdvChoice(a.key, e.target.value)}
                      style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '9px 10px', fontSize: 13, outline: 'none' }}
                    >
                      {a.opts.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                    <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 5, lineHeight: 1.4 }}>{a.help}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                These map to yt-dlp settings automatically — you never touch raw flags.
              </div>
            </div>
          )}

          <PostDownloadConversion />

          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, padding: '14px 16px' }}>
            <span style={{ display: 'flex', width: 18, height: 18, color: 'var(--muted)' }}>
              <Ic.folder width={18} height={18} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--faint)' }}>Saving to</div>
              <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{destDisplay}</div>
            </div>
            {locations.length > 1 && (
              <select
                aria-label="Storage location"
                value={locationId}
                onChange={(e) => setLocation(Number(e.target.value))}
                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none' }}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
            {locations.length <= 1 && (
              <button className="link-btn" style={{ fontWeight: 600 }} onClick={() => nav('/storage')}>
                Manage
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <button
              onClick={() => void download(true)}
              title="Adds this download to the queue paused — nothing starts until you resume it"
              style={{ flex: 1, padding: 15, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Ic.pause width={15} height={15} />
              Add to queue
            </button>
            <button
              onClick={() => void download().then((ok) => ok && nav('/queue'))}
              className="btn-primary"
              style={{ flex: 2, padding: 15, borderRadius: 12, fontSize: 15, fontWeight: 700, justifyContent: 'center', gap: 9, boxShadow: '0 8px 22px var(--accent-soft)' }}
            >
              <Ic.down width={18} height={18} strokeWidth={2.2} />
              Download now · {sel.name}{sel.est_size_str !== '—' ? ` · ~${sel.est_size_str}` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
