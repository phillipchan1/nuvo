/**
 * The domain chapel — a domain isn't a folder, it's a place you're called to be
 * faithful, measured over a long arc. Faithful nod to DomainFloor: a standing vow
 * as a Fraunces inscription, a flourish, the 13-week faithfulness pulse (an EKG
 * against your weekly intent), and the faithfulness voice — including a quiet
 * domain gone cold, because surfacing neglect is the point.
 */

// 13 weeks of hours kept; the dashed line is the weekly intent.
type Dom = { name: string; color: string; weeks: number[]; target: number; state: string; lit: boolean }

const FEATURED: Dom = {
  name: 'Church',
  color: '#7C3AED',
  target: 5,
  weeks: [4, 6, 5, 3, 6, 7, 5, 4, 6, 8, 5, 6, 7],
  state: 'Groomed today · 7h kept this week',
  lit: true,
}
const VOW = 'Show up with presence — not just attendance.'

const RAIL: Dom[] = [
  { name: 'Work', color: '#2563EB', target: 16, weeks: [14, 18, 15, 17, 12, 16, 19, 15, 14, 18, 16, 15, 17], state: '17h this week', lit: true },
  { name: 'Family', color: '#DB2777', target: 6, weeks: [5, 4, 6, 3, 5, 6, 4, 5, 3, 6, 5, 4, 6], state: '6h this week', lit: true },
  { name: 'Craft', color: '#0D9488', target: 3, weeks: [3, 2, 4, 2, 3, 1, 2, 0, 0, 1, 0, 0, 0], state: 'Quiet · 18 days', lit: false },
]

function Pulse({ weeks, color, target, h = 54 }: { weeks: number[]; color: string; target: number; h?: number }) {
  const W = 320
  const n = weeks.length
  const gap = 5
  const bw = (W - (n - 1) * gap) / n
  const norm = target > 0 ? target : Math.max(...weeks, 1)
  const base = h - 6
  const ty = base - (base - 6) // target line position from the top
  const targetY = base - Math.min(1, target / norm) * (base - 6)
  return (
    <svg viewBox={`0 0 ${W} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden style={{ maxWidth: W }}>
      {target > 0 && (
        <line x1={0} y1={targetY} x2={W} y2={targetY} stroke={color} strokeWidth={1} strokeDasharray="3 4" opacity={0.35} />
      )}
      {weeks.map((hours, i) => {
        const v = Math.max(0, Math.min(1.25, hours / norm))
        const bh = 4 + v * (base - 6)
        const x = i * (bw + gap)
        const lit = v > 0.06
        return (
          <rect
            key={i}
            x={x}
            y={base - bh}
            width={bw}
            height={bh}
            rx={bw / 2}
            fill={lit ? color : 'var(--muted)'}
            opacity={lit ? 0.3 + v * 0.6 : 0.22}
          />
        )
      })}
      {/* silence needs to read even at zero */}
      {ty < 0 && null}
    </svg>
  )
}

function Flourish({ color }: { color: string }) {
  return (
    <svg width={124} height={12} viewBox="0 0 124 12" aria-hidden style={{ color }}>
      <g stroke="currentColor" fill="none" strokeWidth={1} opacity={0.5}>
        <line x1="6" y1="6" x2="50" y2="6" />
        <line x1="74" y1="6" x2="118" y2="6" />
      </g>
      <rect x="58" y="2" width="8" height="8" transform="rotate(45 62 6)" fill="currentColor" opacity={0.75} />
    </svg>
  )
}

export default function DomainChapelVisual() {
  return (
    <div
      className="glass-card overflow-hidden rounded-2xl border border-[var(--line)] shadow-[var(--shadow-3)]"
      aria-hidden="true"
    >
      <div className="grid gap-0 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* Featured chapel */}
        <div className="border-b border-[var(--line)] px-6 py-7 text-center md:border-b-0 md:border-r sm:px-8">
          <div className="flex items-center justify-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: FEATURED.color }} />
            <span className="section-label" style={{ color: FEATURED.color }}>
              {FEATURED.name}
            </span>
          </div>
          <p className="serif mx-auto mt-4 max-w-xs text-[1.25rem] italic leading-snug text-[var(--text)]">
            “{VOW}”
          </p>
          <div className="mt-5 flex justify-center">
            <Flourish color={FEATURED.color} />
          </div>
          <p className="section-label mt-6 text-[var(--muted)]">The last quarter</p>
          <div className="mt-2">
            <Pulse weeks={FEATURED.weeks} color={FEATURED.color} target={FEATURED.target} />
          </div>
          <p className="mt-3 text-[12px] text-[var(--muted)]">{FEATURED.state}</p>
        </div>

        {/* The other worlds — mini pulses, incl. one gone quiet */}
        <div className="flex flex-col divide-y divide-[var(--line)]">
          {RAIL.map((d) => (
            <div key={d.name} className="flex-1 px-5 py-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--text)]">
                  <span className="h-2 w-2 rounded-full" style={{ background: d.lit ? d.color : 'var(--muted)' }} />
                  {d.name}
                </span>
                <span
                  className="text-[11px]"
                  style={{ color: d.lit ? 'var(--muted)' : 'var(--signal)' }}
                >
                  {d.state}
                </span>
              </div>
              <div className="mt-2 opacity-90">
                <Pulse weeks={d.weeks} color={d.color} target={d.target} h={30} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
