/**
 * The flagship answer, shown rather than claimed: demand ÷ capacity, with the
 * verdict stated in words. Deliberately unglamorous — the point is that it's
 * arithmetic, so it should read like arithmetic, not like a dashboard.
 *
 * Static by design for now; the honest version of this is a live bar that
 * crosses the capacity line and flips the verdict.
 */

const ROWS = [
  { label: 'Meetings you can’t move', hours: 14, color: 'var(--line-strong)' },
  { label: 'What you committed to', hours: 19, color: 'var(--accent)' },
] as const

const CAPACITY = 30
const DEMAND = ROWS.reduce((n, r) => n + r.hours, 0)

export default function CapacityVisual() {
  // The bar is scaled to the larger of the two so an over-commit visibly
  // overshoots the capacity line instead of being clipped to it.
  const scale = Math.max(DEMAND, CAPACITY)

  return (
    <div className="glass-card reveal rounded-2xl border border-[var(--line)] px-5 py-6 sm:px-7" aria-hidden="true">
      <div className="flex items-baseline justify-between gap-4">
        <p className="section-label text-[var(--muted)]">This week</p>
        <p className="section-label text-[var(--muted)]">
          <span className="mono text-[var(--text)]">{DEMAND}h</span> asked ·{' '}
          <span className="mono text-[var(--text)]">{CAPACITY}h</span> real
        </p>
      </div>

      <div className="relative mt-6">
        {/* The capacity line — the thing demand is measured against. */}
        <div
          className="absolute -top-1 bottom-6 z-[1] w-px bg-[var(--text)]"
          style={{ left: `${(CAPACITY / scale) * 100}%` }}
        >
          <span className="section-label absolute -top-5 left-1.5 whitespace-nowrap text-[var(--text)]">
            Capacity
          </span>
        </div>

        <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
          {ROWS.map((r) => (
            <span
              key={r.label}
              className="h-full first:rounded-l-full"
              style={{ width: `${(r.hours / scale) * 100}%`, background: r.color }}
            />
          ))}
        </div>

        <ul className="mt-5 space-y-2.5">
          {ROWS.map((r) => (
            <li key={r.label} className="flex items-center gap-2.5 text-[13px]">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: r.color }}
              />
              <span className="text-[var(--muted)]">{r.label}</span>
              <span className="mono ml-auto text-[var(--text)]">{r.hours}h</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-6 border-t border-[var(--line)] pt-4 text-[13px] leading-snug text-[var(--muted)]">
        <span className="text-[var(--text)]">You’re 3 hours over.</span> Cut something now, or
        find out on Thursday.
      </p>
    </div>
  )
}
