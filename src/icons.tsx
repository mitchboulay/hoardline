import type { ReactNode, SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
const strokeDefaults = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const make = (size: number, content: ReactNode, extra: Partial<P> = {}) =>
  function Icon(p: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" {...strokeDefaults} {...extra} {...p}>
        {content}
      </svg>
    )
  }

export const Ic = {
  dashboard: make(18, <path d="M3 13h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z" />),
  quick: make(
    18,
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>,
  ),
  queue: make(18, <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />),
  library: make(
    18,
    <>
      <rect x={3} y={3} width={7} height={7} rx={1} />
      <rect x={14} y={3} width={7} height={7} rx={1} />
      <rect x={3} y={14} width={7} height={7} rx={1} />
      <rect x={14} y={14} width={7} height={7} rx={1} />
    </>,
  ),
  recipes: make(
    18,
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />,
  ),
  subs: make(
    18,
    <>
      <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
      <circle cx={5} cy={19} r={1} />
    </>,
  ),
  storage: make(
    18,
    <>
      <rect x={2} y={4} width={20} height={8} rx={2} />
      <rect x={2} y={12} width={20} height={8} rx={2} />
      <path d="M6 8h.01M6 16h.01" />
    </>,
  ),
  settings: make(
    18,
    <>
      <circle cx={12} cy={12} r={3} />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>,
  ),
  sun: make(
    16,
    <>
      <circle cx={12} cy={12} r={4} />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
    </>,
    { strokeWidth: 2 },
  ),
  moon: make(16, <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />),
  film: make(
    16,
    <path d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM7 3v18M17 3v18M3 8h18M3 16h18" />,
  ),
  music: make(
    16,
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx={6} cy={18} r={3} />
      <circle cx={18} cy={16} r={3} />
    </>,
  ),
  archive: make(
    16,
    <>
      <rect x={2} y={4} width={20} height={5} rx={1} />
      <path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M10 13h4" />
    </>,
  ),
  phone: make(
    16,
    <>
      <rect x={6} y={2} width={12} height={20} rx={2} />
      <path d="M11 18h2" />
    </>,
  ),
  server: make(
    16,
    <>
      <rect x={3} y={4} width={18} height={7} rx={1} />
      <rect x={3} y={13} width={18} height={7} rx={1} />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </>,
  ),
  sliders: make(
    16,
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx={16} cy={6} r={2} />
      <circle cx={10} cy={12} r={2} />
      <circle cx={18} cy={18} r={2} />
    </>,
  ),
  hq: make(16, <path d="M12 2 4 6v6c0 5 8 8 8 8s8-3 8-8V6zm-3 10 2 2 4-4" />),
  check: make(15, <path d="M20 6 9 17l-5-5" />),
  warn: make(
    15,
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>,
    { strokeWidth: 2 },
  ),
  retry: make(15, <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />),
  cancel: make(15, <path d="M18 6 6 18M6 6l12 12" />),
  pause: make(15, <path d="M6 4h4v16H6zM14 4h4v16h-4z" />),
  play: make(15, <path d="M8 5v14l11-7z" />, { fill: 'currentColor', stroke: 'none' }),
  folder: make(
    15,
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />,
  ),
  copy: make(
    15,
    <>
      <rect x={9} y={9} width={11} height={11} rx={2} />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>,
  ),
  trash: make(
    15,
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />,
  ),
  down: make(15, <path d="M12 3v12m-4-4 4 4 4-4M5 21h14" />),
  activity: make(16, <path d="M22 12h-4l-3 9L9 3l-3 9H2" />),
  alert: make(
    16,
    <>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 8v4M12 16h.01" />
    </>,
  ),
  disk: make(
    16,
    <>
      <rect x={2} y={4} width={20} height={16} rx={2} />
      <path d="M2 10h20" />
    </>,
  ),
  search: make(
    15,
    <>
      <circle cx={11} cy={11} r={7} />
      <path d="m21 21-4.3-4.3" />
    </>,
    { strokeWidth: 2 },
  ),
  plus: make(16, <path d="M12 5v14M5 12h14" />, { strokeWidth: 2.2 }),
  chevron: make(16, <path d="m9 18 6-6-6-6" />, { strokeWidth: 2.2 }),
  info: make(
    18,
    <>
      <circle cx={12} cy={12} r={10} />
      <path d="M12 16v-4M12 8h.01" />
    </>,
    { strokeWidth: 2 },
  ),
}

export type IconName = keyof typeof Ic
