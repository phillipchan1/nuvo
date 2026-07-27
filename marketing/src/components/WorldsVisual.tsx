/**
 * The offer, as one picture: **breadth × altitude, on a single canvas.**
 *
 * Rows are the worlds you run. Columns are altitude — the year, the quarter, the
 * week, today. Every other tool covers one cell or one row: a task app is
 * today-and-this-week for one world; a project tool is quarter-and-year and never
 * reaches an hour; a calendar is time with no intent behind it. Nuvo is the plane.
 *
 * **This is deliberately NOT a screenshot.** It's a diagram, and it's drawn to
 * look like one — hairline grid on the paper, no window chrome, no glass card, no
 * fake toolbar. The rule the site now follows: either a visual is a faithful
 * recreation of a screen that exists, or it plainly isn't a screen at all.
 * A concept dressed up as UI is a promise we haven't shipped.
 *
 * The empty cells are honest and load-bearing: a real life has worlds with
 * nothing in them this week, and seeing that is half of what the product is for.
 */

const COLS = ['This year', 'This quarter', 'This week', 'Today'] as const

type Row = {
  world: string
  color: string
  /** year · quarter · week · today — null is a genuinely empty cell. */
  cells: (string | null)[]
}

const ROWS: Row[] = [
  {
    world: 'Work',
    color: '#2563EB',
    cells: ['Ship the new onboarding', 'Onboarding rewrite', '3 sittings', '8:00'],
  },
  {
    world: 'Church',
    color: '#7C3AED',
    cells: ['Hand off the fall season', 'Fall retreat', '2 sittings', null],
  },
  {
    world: 'Health',
    color: '#0D9488',
    cells: ['Get strong again by spring', 'Build the base', '2 sittings', '6:00'],
  },
  {
    world: 'Family',
    color: '#DB2777',
    cells: ['Be there for the season', 'Summer trip', '1 sitting', null],
  },
  {
    world: 'Craft',
    color: '#B45309',
    cells: ['Learn to build it properly', null, null, null],
  },
]

export default function WorldsVisual() {
  return (
    <div className="worlds" aria-hidden="true">
      <div className="worlds-grid">
        {/* header */}
        <div />
        {COLS.map((c, i) => (
          <p
            key={c}
            className={`section-label worlds-head ${
              i === COLS.length - 1 ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
            }`}
          >
            {c}
          </p>
        ))}

        {ROWS.map((r) => (
          <div key={r.world} className="contents">
            <p className="worlds-world">
              <span className="worlds-dot" style={{ background: r.color }} />
              {r.world}
            </p>
            {r.cells.map((cell, i) => (
              <div key={i} className="worlds-cell">
                {cell && (
                  <span
                    className="worlds-chip"
                    style={{
                      color: 'var(--text)',
                      background: `color-mix(in srgb, ${r.color} 11%, transparent)`,
                      boxShadow: `inset 2px 0 0 ${r.color}`,
                    }}
                  >
                    {cell}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="mt-5 border-t border-[var(--line)] pt-4 text-[13px] leading-snug text-[var(--muted)]">
        One canvas. Every other tool you’ve tried covers one row of it, or one column.
      </p>
    </div>
  )
}
