/**
 * The offer, as one picture: **breadth × altitude, on a single canvas.**
 *
 * Rows are the lives you're living. Columns are altitude — the year, the quarter,
 * the week, today. Every other tool covers one cell or one row: a task app is
 * today-and-this-week for one life; a project tool is quarter-and-year and never
 * reaches an hour; a calendar is time with no intent behind it. Nuvo is the plane.
 *
 * "Lives" is the outward-facing word for what the app calls a **domain** (D-057).
 * Don't reintroduce "worlds" here — that was the third name for one concept.
 *
 * **This is deliberately NOT a screenshot.** It's a diagram, and it's drawn to
 * look like one — hairline grid on the paper, no window chrome, no glass card, no
 * fake toolbar. The rule the site now follows: either a visual is a faithful
 * recreation of a screen that exists, or it plainly isn't a screen at all.
 * A concept dressed up as UI is a promise we haven't shipped.
 *
 * The empty cells are honest and load-bearing: in a real week at least one life
 * has nothing in it, and seeing that is half of what the product is for.
 */

const COLS = ['This year', 'This quarter', 'This week', 'Today'] as const

type Row = {
  life: string
  color: string
  /** year · quarter · week · today — null is a genuinely empty cell. */
  cells: (string | null)[]
}

const ROWS: Row[] = [
  {
    life: 'Work',
    color: '#2563EB',
    cells: ['Ship the new onboarding', 'Onboarding rewrite', '3 sittings', '8:00'],
  },
  {
    life: 'Church',
    color: '#7C3AED',
    cells: ['Hand off the fall season', 'Fall retreat', '2 sittings', null],
  },
  {
    life: 'Health',
    color: '#0D9488',
    cells: ['Get strong again by spring', 'Build the base', '2 sittings', '6:00'],
  },
  {
    life: 'Family',
    color: '#DB2777',
    cells: ['Be there for the season', 'Summer trip', '1 sitting', null],
  },
  {
    life: 'Craft',
    color: '#B45309',
    cells: ['Learn to build it properly', null, null, null],
  },
]

export default function LivesVisual() {
  return (
    <div className="lives" aria-hidden="true">
      <div className="lives-grid">
        {/* header */}
        <div />
        {COLS.map((c, i) => (
          <p
            key={c}
            className={`section-label lives-head ${
              i === COLS.length - 1 ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
            }`}
          >
            {c}
          </p>
        ))}

        {ROWS.map((r) => (
          <div key={r.life} className="contents">
            <p className="lives-life">
              <span className="lives-dot" style={{ background: r.color }} />
              {r.life}
            </p>
            {r.cells.map((cell, i) => (
              <div key={i} className="lives-cell">
                {cell && (
                  <span
                    className="lives-chip"
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
