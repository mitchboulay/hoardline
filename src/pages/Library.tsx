import { useEffect, useMemo, useState } from 'react'
import type { LibItem } from '../api'
import { IconButton, Thumb } from '../components'
import { Ic } from '../icons'
import { gradientFor } from '../lib/jobs'
import { useStore } from '../store'

const OTHER = 'Other'
const channelOf = (item: LibItem) => (item.uploader ?? '').replace(/^📺\s*/, '').trim() || OTHER

function LibActions({ item }: { item: LibItem }) {
  const showToast = useStore((s) => s.showToast)
  const deleteLibItem = useStore((s) => s.deleteLibItem)
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(item.remote_path)
      showToast('Path copied to clipboard')
    } catch {
      showToast(item.remote_path, 'info')
    }
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      <IconButton label="Show path" onClick={() => showToast(item.remote_path, 'info')}>
        <Ic.folder />
      </IconButton>
      <IconButton label="Copy path" onClick={() => void copyPath()}>
        <Ic.copy />
      </IconButton>
      <IconButton label="Delete" onClick={() => deleteLibItem(item.id)}>
        <Ic.trash />
      </IconButton>
    </div>
  )
}

export default function Library() {
  const library = useStore((s) => s.library)
  const loadLibrary = useStore((s) => s.loadLibrary)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [channel, setChannel] = useState<string | null>(null)

  useEffect(() => {
    void loadLibrary().catch(() => {})
  }, [loadLibrary])

  const channels = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of library) {
      const c = channelOf(item)
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    // Biggest channels first; the grab-bag bucket always last.
    return [...counts.entries()].sort(
      (a, b) => (a[0] === OTHER ? 1 : b[0] === OTHER ? -1 : b[1] - a[1] || a[0].localeCompare(b[0])))
  }, [library])

  const visible = channel ? library.filter((l) => channelOf(l) === channel) : library

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Library</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Everything you've saved, in one place.
          </p>
        </div>
        <div className="seg">
          <button
            className={'seg-btn' + (view === 'grid' ? ' on' : '')}
            aria-label="Grid view"
            onClick={() => setView('grid')}
            style={{ padding: '7px 10px' }}
          >
            <Ic.library width={16} height={16} strokeWidth={2} />
          </button>
          <button
            className={'seg-btn' + (view === 'list' ? ' on' : '')}
            aria-label="List view"
            onClick={() => setView('list')}
            style={{ padding: '7px 10px' }}
          >
            <Ic.queue width={16} height={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      {channels.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setChannel(null)}
            className="chip"
            style={channel === null
              ? { cursor: 'pointer', color: 'var(--accent2)', background: 'var(--accent-soft)', borderColor: 'var(--accent)', fontWeight: 600 }
              : { cursor: 'pointer' }}
          >
            All <span style={{ opacity: 0.65 }}>{library.length}</span>
          </button>
          {channels.map(([name, count]) => (
            <button
              key={name}
              onClick={() => setChannel(channel === name ? null : name)}
              className="chip"
              style={channel === name
                ? { cursor: 'pointer', color: 'var(--accent2)', background: 'var(--accent-soft)', borderColor: 'var(--accent)', fontWeight: 600 }
                : { cursor: 'pointer' }}
            >
              {name} <span style={{ opacity: 0.65 }}>{count}</span>
            </button>
          ))}
        </div>
      )}

      {library.length === 0 && (
        <div className="card" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--faint)' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--muted)' }}>No downloads yet.</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Anything you save will show up here.</div>
        </div>
      )}

      {view === 'grid' ? (
        <div className="grid-lib">
          {visible.map((l) => (
            <div key={l.id} className="card" style={{ overflow: 'hidden' }}>
              <div style={{ height: 132, position: 'relative' }}>
                <Thumb src={l.thumbnail} fallback={gradientFor(l.id)} style={{ position: 'absolute', inset: 0 }} />
                <span style={{ position: 'absolute', left: 9, bottom: 9, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 5 }}>
                  {l.duration_str}
                </span>
              </div>
              <div style={{ padding: '13px 14px' }}>
                <div
                  style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                >
                  {l.title}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 3 }}>{channelOf(l)}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  <span className="chip chip-sm">{l.recipe_name}</span>
                  <span className="chip chip-sm">{l.res}</span>
                  <span className="chip chip-sm">{l.size_str}</span>
                </div>
                <div style={{ marginTop: 13 }}>
                  <LibActions item={l} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        visible.length > 0 && (
          <div className="card" style={{ overflow: 'hidden' }}>
            {visible.map((l) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
                <Thumb src={l.thumbnail} fallback={gradientFor(l.id)} style={{ width: 64, height: 38, borderRadius: 6 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {l.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 3 }}>
                    {channelOf(l)} · {l.created_at.slice(0, 10)} · {l.recipe_name} · {l.res} · {l.size_str}
                  </div>
                </div>
                <LibActions item={l} />
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
