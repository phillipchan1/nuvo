/**
 * The rhythm, shown as a loop — enter, decide, leave. Short rituals with
 * clear end states, not a second job. Horizontal timeline; stacks on mobile.
 */

const BEATS = [
  { when: 'Sunday', act: 'Compose the week', sub: 'Sweep · bet · pull', c: '#7C3AED' },
  { when: 'Morning', act: 'Claim the day', sub: 'Pull from the week', c: '#e0620f' },
  { when: 'Shutdown', act: 'Close it out', sub: 'Record · roll leftovers', c: '#2f8d86' },
  { when: 'Summit', act: 'Turn the quarter', sub: 'Set the next bets', c: '#92568a' },
]

export default function CadenceVisual() {
  return (
    <div className="relative" aria-hidden="true">
      {/* connecting line (desktop) */}
      <div className="pointer-events-none absolute left-0 right-0 top-[26px] hidden h-px bg-[var(--line-strong)] sm:block" />
      <ol className="grid gap-4 sm:grid-cols-4 sm:gap-3">
        {BEATS.map((b) => (
          <li key={b.when} className="relative flex gap-3 sm:flex-col sm:gap-0">
            <span
              className="relative z-[1] mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 bg-[var(--bg)] sm:mx-auto"
              style={{ borderColor: b.c }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: b.c }} />
            </span>
            <div className="min-w-0 sm:mt-4 sm:text-center">
              <p className="section-label" style={{ color: b.c }}>
                {b.when}
              </p>
              <p className="mt-1.5 text-[15px] font-medium leading-snug text-[var(--text)]">{b.act}</p>
              <p className="mt-0.5 text-[12px] text-[var(--muted)]">{b.sub}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
