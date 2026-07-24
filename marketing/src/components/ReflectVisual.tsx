/**
 * Reflect — the weekly review. A faithful nod to the product's WeekStory: a
 * generative emblem drawn from real numbers (rings = domains by hours,
 * satellites = priorities landed/open, ambient dots = done-work) narrated by
 * three plain reads — priorities landed (the gain), where the hours went, and
 * what you shipped. Static recreation; the app animates it scene by scene.
 */

const DOMAINS = [
  { name: 'Work', color: '#2563EB', hours: 16, frac: 0.72 },
  { name: 'Church', color: '#7C3AED', hours: 8, frac: 0.52 },
  { name: 'Family', color: '#DB2777', hours: 6, frac: 0.42 },
  { name: 'Craft', color: '#0D9488', hours: 4, frac: 0.3 },
]
const TOTAL_H = DOMAINS.reduce((s, d) => s + d.hours, 0)

const SHIPPED = [
  { project: 'Meridian', color: '#2563EB', items: ['Shipped deck v3', 'Fixed the auth loop'] },
  { project: 'Worship', color: '#7C3AED', items: ['New Sunday set'] },
  { project: 'Home', color: '#DB2777', items: ['Booked the reno quotes'] },
]

// Emblem geometry — center, domain rings, priority satellites, ambient done-dots.
const CX = 110
const CY = 110
const RINGS = [
  { r: 82, color: DOMAINS[0].color, frac: DOMAINS[0].frac },
  { r: 66, color: DOMAINS[1].color, frac: DOMAINS[1].frac },
  { r: 50, color: DOMAINS[2].color, frac: DOMAINS[2].frac },
  { r: 34, color: DOMAINS[3].color, frac: DOMAINS[3].frac },
]
const PRIORITIES = [true, true, true, true, true, false] // 5 landed, 1 open
const SATS = PRIORITIES.map((landed, i) => {
  const a = (i / PRIORITIES.length) * Math.PI * 2 - Math.PI / 2
  return { x: CX + Math.cos(a) * 98, y: CY + Math.sin(a) * 98, landed }
})
// Ambient done-work — fixed scatter (no RNG), inside the rings.
const AMBIENT = [
  [70, 60], [150, 72], [88, 150], [138, 140], [60, 108], [160, 116],
  [110, 46], [96, 96], [128, 90], [82, 128], [120, 160], [150, 150],
].map(([x, y]) => ({ x, y }))

function Emblem() {
  return (
    <svg viewBox="0 0 220 220" className="h-full w-full" role="img" aria-label="Your week as one mark">
      <defs>
        <radialGradient id="sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={CX} cy={CY} r="70" fill="url(#sun)" />
      {/* domain rings — arc length ∝ hours */}
      {RINGS.map((ring) => {
        const c = 2 * Math.PI * ring.r
        return (
          <g key={ring.r}>
            <circle cx={CX} cy={CY} r={ring.r} fill="none" stroke="var(--line)" strokeWidth="4" />
            <circle
              cx={CX}
              cy={CY}
              r={ring.r}
              fill="none"
              stroke={ring.color}
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeDasharray={`${ring.frac * c} ${c}`}
              transform={`rotate(-90 ${CX} ${CY})`}
            />
          </g>
        )
      })}
      {/* ambient done-work */}
      {AMBIENT.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="1.6" fill="var(--muted)" opacity="0.55" />
      ))}
      {/* priority satellites */}
      {SATS.map((s, i) =>
        s.landed ? (
          <circle key={i} cx={s.x} cy={s.y} r="5" fill="var(--accent)" />
        ) : (
          <circle key={i} cx={s.x} cy={s.y} r="4.5" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2" />
        ),
      )}
      {/* the sun */}
      <circle cx={CX} cy={CY} r="12" fill="var(--accent)" />
    </svg>
  )
}

export default function ReflectVisual() {
  return (
    <div
      className="glass-card overflow-hidden rounded-2xl border border-[var(--line)] shadow-[var(--shadow-3)]"
      aria-hidden="true"
    >
      <div className="grid gap-0 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* The emblem */}
        <div className="flex flex-col items-center justify-center gap-4 border-b border-[var(--line)] px-6 py-8 md:border-b-0 md:border-r">
          <p className="section-label self-start text-[var(--muted)]">The Review · Jul 14–20</p>
          <div className="aspect-square w-full max-w-[260px]">
            <Emblem />
          </div>
          <p className="text-center text-[12px] text-[var(--muted)]">
            Your week, drawn as one mark — different every week.
          </p>
        </div>

        {/* The reads */}
        <div className="flex flex-col divide-y divide-[var(--line)]">
          {/* Gain — priorities landed */}
          <div className="px-6 py-5">
            <p className="section-label text-[var(--muted)]">Priorities landed</p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="masthead text-[2.75rem] leading-none text-[var(--text)]">5</span>
              <span className="text-[1.05rem] text-[var(--muted)]">of 6 landed</span>
            </p>
          </div>

          {/* Where your hours went */}
          <div className="px-6 py-5">
            <p className="section-label text-[var(--muted)]">Where your hours went</p>
            <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full">
              {DOMAINS.map((d) => (
                <div key={d.name} style={{ width: `${(d.hours / TOTAL_H) * 100}%`, background: d.color }} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {DOMAINS.map((d) => (
                <span key={d.name} className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
                  <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                  {d.name} <span className="mono text-[var(--text)]">{d.hours}h</span>
                </span>
              ))}
            </div>
          </div>

          {/* What you shipped */}
          <div className="px-6 py-5">
            <p className="section-label text-[var(--muted)]">What you shipped</p>
            <div className="mt-3 space-y-3">
              {SHIPPED.map((g) => (
                <div key={g.project}>
                  <p className="flex items-center gap-2 text-[13px] font-medium text-[var(--text)]">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: g.color }} />
                    {g.project}
                  </p>
                  <ul className="mt-1 space-y-0.5 pl-4">
                    {g.items.map((it) => (
                      <li key={it} className="flex items-baseline gap-2 text-[12px] text-[var(--muted)]">
                        <span className="mono shrink-0 text-[var(--muted)]">↳</span>
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
