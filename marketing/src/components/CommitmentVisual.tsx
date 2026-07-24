/**
 * "Do I even have time?" — answered before the week starts.
 * Domain-colored demand stacks across the week's real capacity. When it
 * overshoots, the tail turns to signal and Nuvo says cut, don't cram.
 */

const CAPACITY = 34 // focus hours you actually have this week
const DEMAND = [
  { name: 'Work', hours: 16, c: '#2563EB' },
  { name: 'Church', hours: 8, c: '#7C3AED' },
  { name: 'Family', hours: 7, c: '#DB2777' },
  { name: 'Craft', hours: 6, c: '#0D9488' },
]

const TOTAL = DEMAND.reduce((s, d) => s + d.hours, 0) // 37
const OVER = TOTAL - CAPACITY // 3
const SCALE = 100 / TOTAL // percent-per-hour across the full demand

export default function CommitmentVisual() {
  const capacityPct = CAPACITY * SCALE

  return (
    <div
      className="glass-card rounded-2xl border border-[var(--line)] px-5 py-6 shadow-[var(--shadow-3)] sm:px-7 sm:py-7"
      aria-hidden="true"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="section-label text-[var(--muted)]">This week · commitment</p>
        <p className="mono text-[12px] text-[var(--signal)]">{OVER}h over</p>
      </div>

      {/* The bar */}
      <div className="relative mt-4">
        <div className="relative flex h-11 w-full overflow-hidden rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_60%,transparent)]">
          {DEMAND.map((d, i) => {
            const over = TOTAL - d.hours < CAPACITY // segment crosses the line
            return (
              <div
                key={d.name}
                className="bar-grow relative flex items-center justify-center"
                style={{
                  width: `${d.hours * SCALE}%`,
                  animationDelay: `${0.12 * i}s`,
                  background: over
                    ? `repeating-linear-gradient(45deg, ${d.c}, ${d.c} 6px, color-mix(in srgb, ${d.c} 55%, var(--signal)) 6px, color-mix(in srgb, ${d.c} 55%, var(--signal)) 12px)`
                    : `color-mix(in srgb, ${d.c} 78%, transparent)`,
                }}
              >
                <span className="mono text-[10px] font-medium text-white/95">{d.hours}h</span>
              </div>
            )
          })}
        </div>

        {/* Capacity line */}
        <div
          className="pointer-events-none absolute -top-1.5 bottom-[-1.5rem] w-px bg-[var(--text)]"
          style={{ left: `${capacityPct}%` }}
        >
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--text)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--bg)]">
            your real week · {CAPACITY}h
          </span>
        </div>
      </div>

      {/* Legend + verdict */}
      <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {DEMAND.map((d) => (
          <span key={d.name} className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
            <span className="h-2 w-2 rounded-full" style={{ background: d.c }} />
            {d.name}
          </span>
        ))}
      </div>

      <p className="mt-5 border-t border-[var(--line)] pt-4 text-[13px] leading-snug text-[var(--text)]">
        <span className="text-[var(--signal)]">Over by 3 hours.</span>{' '}
        <span className="text-[var(--muted)]">
          Nuvo shows it Sunday — so you cut or move something on purpose, instead of finding out
          Thursday night.
        </span>
      </p>
    </div>
  )
}
