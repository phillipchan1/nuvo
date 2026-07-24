/**
 * Chaos → order. The emotional core of the pitch: everything you carry —
 * scattered across apps, calls, and your own head — pulled into one calm week.
 * Left drifts (muted, tilted, from everywhere). Right lands (lit, ordered, dated).
 */

type Frag = { t: string; from: string; r: number; mt: string }

// The loose ends of a multi-domain life — from everywhere, tilted, unowned.
// A wrapped "pile" (not absolute coords) so it reflows cleanly to any width.
const FRAGS: Frag[] = [
  { t: 'Call David — SCE deck', from: 'Slack', r: -4, mt: '0' },
  { t: 'Youth retreat headcount', from: 'text', r: 3, mt: '1.25rem' },
  { t: 'Mom’s birthday — Sat', from: 'note', r: 4, mt: '0.25rem' },
  { t: 'Review Meridian PR', from: 'email', r: -3, mt: '1rem' },
  { t: 'Q3 board prep', from: 'head', r: 5, mt: '0' },
  { t: 'Fix the kitchen leak', from: 'note', r: -2, mt: '0.75rem' },
  { t: 'Renew the domain', from: 'head', r: 3, mt: '0.25rem' },
]

// The same life, one week later — owned, dated, tinted by domain.
const LANDED = [
  { day: 'Mon', t: 'Ship deck v3', c: '#2563EB' },
  { day: 'Tue', t: 'Youth retreat plan', c: '#7C3AED' },
  { day: 'Thu', t: 'Board prep', c: '#2563EB' },
  { day: 'Sat', t: 'Mom’s birthday', c: '#DB2777' },
]

export default function CarryVisual() {
  return (
    <div
      className="glass-card relative overflow-hidden rounded-2xl border border-[var(--line)] shadow-[var(--shadow-3)]"
      aria-hidden="true"
    >
      <div className="grid gap-0 md:grid-cols-[minmax(0,1.1fr)_auto_minmax(0,0.95fr)]">
        {/* Scattered — what you carry */}
        <div className="relative px-4 py-4">
          <p className="section-label text-[var(--muted)]">In your head, everywhere</p>
          <div className="mt-4 flex flex-wrap items-start gap-x-3 gap-y-1">
            {FRAGS.map((f) => (
              <div
                key={f.t}
                className="rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] px-2.5 py-2 shadow-[var(--shadow-1)]"
                style={{ transform: `rotate(${f.r}deg)`, marginTop: f.mt }}
              >
                <p className="text-[12px] leading-snug text-[color-mix(in_srgb,var(--text)_72%,transparent)]">
                  {f.t}
                </p>
                <p className="mt-0.5 text-[9px] uppercase tracking-wider text-[var(--muted)]">{f.from}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Funnel seam */}
        <div className="relative flex items-center justify-center border-[var(--line)] py-2 md:border-x">
          <div className="flex items-center gap-1 text-[var(--accent)]">
            <span className="hidden h-px w-6 bg-gradient-to-r from-transparent to-[var(--accent)] md:block" />
            <span className="text-[15px]">→</span>
            <span className="hidden h-px w-6 bg-gradient-to-r from-[var(--accent)] to-transparent md:block" />
          </div>
        </div>

        {/* Landed — one calm week */}
        <div className="relative px-4 py-4">
          <p className="section-label text-[var(--accent)]">One week. Placed.</p>
          <div className="mt-3 space-y-2">
            {LANDED.map((l) => (
              <div
                key={l.t}
                className="flex items-center gap-2.5 rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] px-3 py-2.5"
                style={{ borderLeft: `3px solid ${l.c}` }}
              >
                <span className="mono w-8 shrink-0 text-[11px] text-[var(--muted)]">{l.day}</span>
                <span className="truncate text-[13px] font-medium text-[var(--text)]">{l.t}</span>
              </div>
            ))}
            <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-2 text-[12px] text-[var(--muted)]">
              <span className="mono w-8 shrink-0 text-[11px]">···</span>
              <span>and the rest, held for next week</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
