/**
 * "Do I have space for the important things — the projects?"
 *
 * The Projects step of Plan the week, at the moment it says no. Real behavior,
 * observed 2026-07-27 (see D-039 in docs/product/decisions.md): a project the
 * week has no room for doesn't get filed in a list under the grid — it gets two
 * acts on its own row, while you're still choosing:
 *
 *   · Give it another week — this week takes what fits, the rest continues
 *   · Move it to next week — the whole span shifts, keeping how long it runs
 *
 * Both are the same kernel patch as dragging the card on On Deck, so the two
 * surfaces can't disagree about where a project lives.
 */

const WORK = '#2563EB'
const CHURCH = '#7C3AED'
const HEALTH = '#0D9488'
const FAMILY = '#DB2777'

const ROWS = [
  { name: 'Onboarding rewrite', meta: '5/5 · 4h', color: WORK, tight: false },
  { name: 'Build the base', meta: '2/4 · 2h', color: HEALTH, tight: false },
  { name: 'Trip logistics', meta: '3/3 · 1.5h', color: FAMILY, tight: false },
  { name: 'Fall retreat', meta: '0/4 · 3h', color: CHURCH, tight: true },
] as const

export default function ProjectRoomVisual() {
  return (
    <div
      className="glass-card overflow-hidden rounded-2xl border border-[var(--line)] shadow-[var(--shadow-3)]"
      aria-hidden="true"
    >
      <div className="border-b border-[var(--line)] px-4 py-3 sm:px-5">
        <p className="section-label text-[var(--accent)]">Step 2 of 3</p>
        <p className="masthead mt-1 text-[1.0625rem] leading-snug text-[var(--text)]">
          What are you moving this week?
        </p>
      </div>

      <ul className="px-4 sm:px-5">
        {ROWS.map((r) => (
          <li key={r.name} className="border-b border-[var(--line)] py-2.5">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.color }} />
              <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-[var(--text)]">
                {r.name}
              </span>
              {r.tight && (
                <span className="mono shrink-0 text-[11px] text-[var(--signal)]">no room</span>
              )}
              <span className="mono shrink-0 text-[12px] text-[var(--muted)]">{r.meta}</span>
            </div>

            {/* The remedy, on the project's own row, while you're still deciding. */}
            {r.tight && (
              <div className="mt-2 flex flex-wrap gap-2 pl-3.5">
                <span className="rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-1 text-[12px] text-[var(--accent)]">
                  Give it another week
                </span>
                <span className="rounded-full border border-[var(--line-strong)] px-2.5 py-1 text-[12px] text-[var(--muted)]">
                  Move it to next week
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* The arithmetic, sitting with the thing it measures */}
      <div className="px-4 pb-4 pt-3 sm:px-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="section-label text-[var(--muted)]">The week</p>
          <p className="mono text-[13px] text-[var(--text)]">
            25.9h <span className="text-[var(--signal)]">· 5.6h past your usual 20.3h</span>
          </p>
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-[var(--line)]">
          <div className="h-full" style={{ width: '43%', background: 'var(--line-strong)' }} />
          <div className="h-full" style={{ width: '32%', background: 'var(--accent)' }} />
          <div className="h-full" style={{ width: '11%', background: 'var(--accent-2)' }} />
          <div
            className="h-full"
            style={{
              width: '14%',
              background: 'color-mix(in srgb, var(--accent-2) 55%, var(--surface))',
            }}
          />
        </div>
      </div>
    </div>
  )
}
