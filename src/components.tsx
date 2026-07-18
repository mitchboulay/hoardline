import type { CSSProperties, ReactNode } from 'react'
import type { JobStatus } from './api'
import { Ic } from './icons'
import { useStore, type ToastKind } from './store'

const BADGES: Record<JobStatus, [string, string, string]> = {
  downloading: ['Downloading', 'var(--accent2)', 'var(--accent-soft)'],
  queued: ['Queued', 'var(--muted)', 'var(--surface3)'],
  completed: ['Completed', 'var(--green)', 'rgba(52,211,153,.14)'],
  failed: ['Failed', 'var(--red)', 'rgba(248,113,113,.14)'],
  paused: ['Paused', 'var(--amber)', 'rgba(251,191,36,.14)'],
}

export function StatusBadge({ status }: { status: JobStatus }) {
  const [label, color, background] = BADGES[status]
  return (
    <span className="badge" style={{ color, background }}>
      {label}
    </span>
  )
}

export function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button className="icon-btn" title={label} aria-label={label} onClick={onClick}>
      {children}
    </button>
  )
}

export function Thumb({
  src,
  fallback,
  style,
}: {
  src?: string | null
  fallback: string
  style: CSSProperties
}) {
  return (
    <div aria-hidden style={{ background: fallback, flexShrink: 0, overflow: 'hidden', ...style }}>
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
        />
      )}
    </div>
  )
}

const TOAST_STYLE: Record<ToastKind, [typeof Ic.check, string]> = {
  ok: [Ic.check, 'var(--green)'],
  info: [Ic.alert, 'var(--accent2)'],
  warn: [Ic.warn, 'var(--amber)'],
}

export function Toast() {
  const toast = useStore((s) => s.toast)
  const closeToast = useStore((s) => s.closeToast)
  if (!toast) return null
  const [Icon, color] = TOAST_STYLE[toast.kind]
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        animation: 'pop .22s both',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          background: 'var(--surface3)',
          border: '1px solid var(--border2)',
          borderRadius: 11,
          padding: '12px 16px',
          boxShadow: '0 12px 32px rgba(0,0,0,.4)',
          minWidth: 280,
        }}
      >
        <span style={{ display: 'flex', width: 18, height: 18, color }}>
          <Icon />
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{toast.msg}</span>
        <button
          onClick={closeToast}
          aria-label="Dismiss"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--faint)',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}

export function ConfirmDialog() {
  const confirm = useStore((s) => s.confirm)
  const closeConfirm = useStore((s) => s.closeConfirm)
  if (!confirm) return null
  return (
    <div
      onClick={closeConfirm}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'pop .18s both',
      }}
    >
      <div
        role="alertdialog"
        aria-label={confirm.title}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border2)',
          borderRadius: 14,
          padding: 24,
          width: 400,
          maxWidth: 'calc(100vw - 32px)',
          boxShadow: '0 24px 60px rgba(0,0,0,.5)',
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 11,
            background: 'rgba(248,113,113,.14)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--red)',
            marginBottom: 14,
          }}
        >
          <Ic.trash width={22} height={22} strokeWidth={2} />
        </div>
        <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 600 }}>{confirm.title}</h3>
        <p style={{ margin: '0 0 20px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.5 }}>
          {confirm.body}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={closeConfirm}
            style={{
              padding: '9px 16px',
              borderRadius: 9,
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              color: 'var(--text)',
              fontSize: 13.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={confirm.onConfirm}
            style={{
              padding: '9px 16px',
              borderRadius: 9,
              border: 'none',
              background: 'var(--red)',
              color: '#fff',
              fontSize: 13.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {confirm.action}
          </button>
        </div>
      </div>
    </div>
  )
}
