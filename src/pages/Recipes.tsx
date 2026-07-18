import { useEffect, useState } from 'react'
import { Ic, type IconName } from '../icons'
import { useStore } from '../store'

const icon = (name: string) => Ic[(name in Ic ? name : 'film') as IconName]

const VALIDATION: { kind: 'ok' | 'warn'; text: string }[] = [
  { kind: 'ok', text: 'All required fields are set — ready to use.' },
  { kind: 'ok', text: 'Selected codec is compatible with the chosen container.' },
  { kind: 'warn', text: 'ffmpeg may re-encode audio, which adds a little processing time.' },
]

export default function Recipes() {
  const recipes = useStore((s) => s.recipes)
  const loadRecipes = useStore((s) => s.loadRecipes)
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (recipes.length === 0) void loadRecipes().catch(() => {})
  }, [recipes.length, loadRecipes])

  const cur = recipes.find((r) => r.id === (selected ?? recipes[0]?.id))

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Recipes</h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Reusable presets. Pick one when downloading, or set a default.
          </p>
        </div>
      </div>

      <div className="recipes-cols">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recipes.map((rc) => {
            const Icon = icon(rc.icon)
            const on = rc.id === cur?.id
            return (
              <button
                key={rc.id}
                onClick={() => setSelected(rc.id)}
                aria-pressed={on}
                style={{
                  padding: '13px 14px', borderRadius: 11, cursor: 'pointer',
                  background: on ? 'var(--accent-soft)' : 'var(--surface)',
                  border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  color: 'var(--text)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ display: 'flex', width: 18, height: 18, color: rc.color }}>
                    <Icon width={18} height={18} />
                  </span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{rc.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{rc.desc}</div>
                  </div>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                    {settings?.default_recipe === rc.id && (
                      <span style={{ fontSize: 10, color: 'var(--accent2)', border: '1px solid var(--accent-soft)', background: 'var(--accent-soft)', padding: '1px 6px', borderRadius: 5, fontWeight: 600 }}>
                        Default
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--faint)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 5 }}>
                      Built-in
                    </span>
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {cur && (
          <div className="card" style={{ overflow: 'hidden', alignSelf: 'start' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{cur.name}</h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>{cur.tag}</p>
              </div>
              {settings?.default_recipe !== cur.id && (
                <button
                  onClick={() => void saveSettings({ default_recipe: cur.id })}
                  style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent2)', background: 'var(--accent-soft)', border: 'none', padding: '7px 12px', borderRadius: 8, cursor: 'pointer' }}
                >
                  Make default
                </button>
              )}
            </div>
            <div className="recipe-detail-cols">
              <div style={{ padding: 20, borderRight: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {cur.fields.map(([k, help, v]) => (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{k}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>{help}</div>
                      </div>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', padding: '5px 11px', borderRadius: 8, whiteSpace: 'nowrap' }}>
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ padding: 20, background: 'var(--surface2)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 12 }}>Validation</div>
                {VALIDATION.map((v) => (
                  <div key={v.text} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 11 }}>
                    <span style={{ display: 'flex', width: 15, height: 15, color: v.kind === 'ok' ? 'var(--green)' : 'var(--amber)', flexShrink: 0, marginTop: 1 }}>
                      {v.kind === 'ok' ? <Ic.check /> : <Ic.warn />}
                    </span>
                    <span style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.4 }}>{v.text}</span>
                  </div>
                ))}
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.5 }}>
                  Exact estimated sizes appear per-video after Analyze, computed from the real format list.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
