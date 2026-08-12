/**
 * Where the hours actually went.
 *
 * The one answer on this page that nothing on the field table can give. Akiflow
 * and Sunsama plan the week and stop; Motion and Reclaim place the work and
 * stop; a board never touches the calendar at all. None of them can tell you
 * that the part of your life you *said* mattered got 1.5 hours.
 *
 * Recreates the domain time ledger — the week's shape on the domain wall, fed
 * by `src/lib/eventActuals.ts` and `src/hooks/useWeekReport.ts`, with the
 * attribution itself coming from the `route-events` edge function and
 * `useEventRouter`. Two feeds land here: attended calendar events (RSVP-derived)
 * and completed blocks.
 *
 * The bottom two rows are the honest half and the reason this belongs on the
 * page at all. Nuvo routes what it's confident about and *says so* when it
 * isn't — Principle 6 ("when there's no history, say so — never guess") and
 * Principle 4 (it reports, it doesn't act). A tracker that silently guessed
 * would be a tracker you couldn't trust with the one number that matters.
 */

import { COMMUNITY, CRAFT, FAMILY, HEALTH, WORK } from './hues'

type Row = { name: string; hours: string; pct: number; note: string; color: string }

/** Deliberately uneven — a flat ledger is a fantasy, and the *gap* is the read.
 *  Craft at 1.5h against Work at 21.5h is the picture doing the arguing. */
const ROWS: Row[] = [
  { name: 'Work', hours: '21.5h', pct: 100, note: '18 events · 6 blocks', color: WORK },
  { name: 'Church', hours: '6.0h', pct: 28, note: '4 events · 2 blocks', color: COMMUNITY },
  { name: 'Family', hours: '4.5h', pct: 21, note: '3 events', color: FAMILY },
  { name: 'Health', hours: '3.0h', pct: 14, note: '4 blocks', color: HEALTH },
  { name: 'Craft', hours: '1.5h', pct: 7, note: '1 block', color: CRAFT },
]

/** What routing looks like when it's sure, and when it isn't. */
const ROUTED = [
  { event: 'Q3 board call', domain: 'Work', color: WORK, state: 'assigned' as const },
  { event: 'Small group — Tuesdays', domain: 'Church', color: COMMUNITY, state: 'assigned' as const },
  { event: 'Coffee — Marcus', domain: null, color: null, state: 'asking' as const },
]

export default function LedgerVisual() {
  return (
    <div className="glass-card overflow-hidden rounded-2xl border border-[var(--line)] shadow-[var(--shadow-3)]">
      <div className="border-b border-[var(--line)] px-5 pb-3 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="section-label text-[var(--accent)]">This week · where it went</p>
          <p className="mono text-[12px] text-[var(--text)]">36.5h</p>
        </div>
      </div>

      <ul className="px-5 pb-1 pt-1">
        {ROWS.map((r) => (
          <li key={r.name} className="border-b border-[var(--line)] py-2.5 last:border-b-0">
            <div className="flex items-baseline gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.color }} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">{r.name}</span>
              <span className="mono shrink-0 text-[11px] text-[var(--muted)]">{r.note}</span>
              <span className="mono w-12 shrink-0 text-right text-[12px] text-[var(--text)]">
                {r.hours}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--line)]">
              <div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: r.color }} />
            </div>
          </li>
        ))}
      </ul>

      {/* Nobody typed any of this — and where it wasn't sure, it asks. */}
      <div className="border-t border-[var(--line)] px-5 pb-4 pt-3">
        <p className="section-label text-[var(--muted)]">Assigned for you</p>
        <ul className="mt-2">
          {ROUTED.map((r) => (
            <li
              key={r.event}
              className="flex items-center gap-2 border-b border-[var(--line)] py-1.5 text-[12px] last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-[var(--text)]">{r.event}</span>
              {r.state === 'assigned' ? (
                <span
                  className="mono shrink-0 rounded-[3px] px-1.5 py-0.5 text-[10px]"
                  style={{
                    color: r.color!,
                    background: `color-mix(in srgb, ${r.color} 14%, transparent)`,
                  }}
                >
                  {r.domain}
                </span>
              ) : (
                <span className="mono shrink-0 text-[10px] text-[var(--signal)]">
                  which life? ·{' '}
                  <span className="text-[var(--muted)]">not sure — it asks</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
