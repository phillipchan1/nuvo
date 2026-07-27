/**
 * "I need fast day-to-day execution AND long-term planning. One tool."
 *
 * The proof is the app's own left spine, which is genuinely built this way:
 * **EXECUTE** (Schedule) above **BUILD** (Projects · Initiatives · Domains),
 * numbered 1–4, each floor carrying its own readiness. Observed in the running
 * app on 2026-07-27.
 *
 * Flanking it, the two speeds: a capture bar and today's one call on the left,
 * a quarter of initiatives on the right. Same sidebar, same account, no export
 * between them.
 */

export default function SpineVisual() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_13rem_minmax(0,1fr)]" aria-hidden="true">
      {/* Fast — the day. Deliberately NOT drawn as a screen: the only real UI in
          this figure is the spine in the middle. Annotation looks like
          annotation; anything with a card around it reads as a promise. */}
      <div className="order-2 lg:order-1 lg:pt-2">
        <p className="section-label text-[var(--muted)]">Seconds</p>
        <ul className="mt-3 space-y-2.5">
          {[
            { t: 'Capture it while you’re walking', m: '⌥Space' },
            { t: 'Name today’s one thing', m: '2 min' },
            { t: 'Drag it to 3pm', m: 'one gesture' },
          ].map((r) => (
            <li key={r.t} className="border-t border-[var(--line)] pt-2">
              <p className="text-[0.9375rem] leading-snug text-[var(--text)]">{r.t}</p>
              <p className="mono text-[11px] text-[var(--muted)]">{r.m}</p>
            </li>
          ))}
        </ul>
      </div>

      {/* The spine itself */}
      <div className="glass-card order-1 rounded-2xl border border-[var(--line)] px-3 py-4 shadow-[var(--shadow-3)] lg:order-2">
        <span className="wordmark px-1 text-[15px] text-[var(--muted)]">Nuvo</span>

        <p className="section-label mt-5 px-1 text-[var(--accent)]">Execute</p>
        <div className="mt-2 rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_75%,transparent)] px-2.5 py-2">
          <p className="flex items-baseline gap-2 text-[13px] text-[var(--text)]">
            <span className="mono text-[11px] text-[var(--muted)]">1</span> Schedule
          </p>
          <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-[var(--line)]">
            <div className="h-full w-[18%] rounded-full bg-[var(--accent)]" />
          </div>
          <p className="mt-1 text-right text-[10px] text-[var(--muted)]">plan the week</p>
        </div>

        <p className="section-label mt-5 px-1 text-[var(--accent)]">Build</p>
        <ul className="mt-2 space-y-3 px-2.5">
          {[
            { n: 2, name: 'Projects', note: '4 to ready', pct: 55 },
            { n: 3, name: 'Initiatives', note: '2 to ready', pct: 40 },
            { n: 4, name: 'Domains', note: null, pct: 100 },
          ].map((s) => (
            <li key={s.name}>
              <p className="flex items-baseline gap-2 text-[13px] text-[var(--muted)]">
                <span className="mono text-[11px]">{s.n}</span> {s.name}
              </p>
              <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-[var(--line)]">
                <div className="h-full rounded-full bg-[var(--slot)]" style={{ width: `${s.pct}%` }} />
              </div>
              {s.note && (
                <p className="mt-0.5 text-right text-[10px] text-[var(--signal)]">{s.note}</p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Slow — the quarter. Same rule: type on paper, not a fake panel. */}
      <div className="order-3 lg:pt-2">
        <p className="section-label text-[var(--muted)]">Quarters</p>
        <ul className="mt-3 space-y-2.5">
          {[
            { t: 'Decide the few bets that get real hours', m: 'once a quarter' },
            { t: 'Watch a project fall off pace', m: 'before it’s late' },
            { t: 'See three weeks of collisions', m: 'while they’re fixable' },
          ].map((r) => (
            <li key={r.t} className="border-t border-[var(--line)] pt-2">
              <p className="text-[0.9375rem] leading-snug text-[var(--text)]">{r.t}</p>
              <p className="mono text-[11px] text-[var(--muted)]">{r.m}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
