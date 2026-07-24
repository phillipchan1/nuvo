/**
 * On Deck — the project planning modality. Faithful recreation of the product's
 * OnDeckPlanner: an inbox of projects "needing a week", a runway of sprint columns
 * with a per-week load gauge, and project bars time-boxed across weeks, each
 * carrying a Defined · Planned · Fits readiness meter (teal ready · amber grooming
 * · faint raw). Static, on-brand, no drag — just the shape of the surface.
 */

const READY = '#2f8d86'
const GROOM = '#c2892e'
const RAW = 'var(--line-strong)'

const DOMAIN = { work: '#2563EB', church: '#7C3AED', family: '#DB2777' }

const INBOX = [
  { name: 'Rebrand the site', dot: DOMAIN.work, sub: 'due Aug 20' },
  { name: 'Youth summer retreat', dot: DOMAIN.church, sub: 'no finish line' },
  { name: 'Kitchen reno quotes', dot: DOMAIN.family, sub: 'due Aug 8' },
]

const WEEKS = [
  { sprint: 30, tag: 'This week', date: 'Jul 21', load: 2, now: true },
  { sprint: 31, tag: 'Next week', date: 'Jul 28', load: 1, now: false },
  { sprint: 32, tag: 'Week of', date: 'Aug 4', load: 2, now: false },
  { sprint: 33, tag: 'Week of', date: 'Aug 11', load: 2, now: false },
]
const MAX = 3

type Tier = 'ready' | 'grooming' | 'raw'
const TIER = {
  ready: { c: READY, segs: 3, hint: 'ready' },
  grooming: { c: GROOM, segs: 2, hint: 'add steps' },
  raw: { c: RAW, segs: 1, hint: 'raw idea' },
} as const

type Bar = { name: string; dot: string; tier: Tier; start: number; end: number; hint?: string }
const ROWS: Bar[][] = [
  [
    { name: 'Ship Meridian v3', dot: DOMAIN.work, tier: 'ready', start: 1, end: 1 },
    { name: 'Youth retreat plan', dot: DOMAIN.church, tier: 'grooming', start: 2, end: 3 },
    { name: 'Q3 planning offsite', dot: DOMAIN.work, tier: 'raw', start: 4, end: 4 },
  ],
  [
    { name: 'Worship set overhaul', dot: DOMAIN.church, tier: 'ready', start: 1, end: 1 },
    { name: 'Kitchen reno', dot: DOMAIN.family, tier: 'grooming', start: 3, end: 4, hint: 'won’t fit' },
  ],
]

function Meter({ tier, hint }: { tier: Tier; hint?: string }) {
  const t = TIER[tier]
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <span className="flex flex-1 items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-[5px] flex-1 rounded-full"
            style={{ background: i < t.segs ? t.c : 'var(--line)' }}
          />
        ))}
      </span>
      <span className="mono shrink-0 text-[10px]" style={{ color: t.c }}>
        {hint ?? t.hint}
      </span>
    </div>
  )
}

function BarCard({ b }: { b: Bar }) {
  return (
    <div
      className="relative mx-1 flex min-h-[58px] flex-col justify-center rounded-xl border border-[var(--line)] bg-[var(--surface)] py-2.5 pl-4 pr-3 shadow-[var(--shadow-1)]"
      style={{ gridColumn: `${b.start} / ${b.end + 1}` }}
    >
      <span
        className="pointer-events-none absolute inset-y-2.5 left-1.5 w-[3px] rounded-full"
        style={{ background: b.dot }}
      />
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: b.dot }} />
        <span className="truncate text-[12px] font-semibold text-[var(--text)]">{b.name}</span>
      </div>
      <Meter tier={b.tier} hint={b.hint} />
    </div>
  )
}

export default function DeckVisual() {
  return (
    <div
      className="glass-card overflow-hidden rounded-2xl border border-[var(--line)] shadow-[var(--shadow-3)]"
      aria-hidden="true"
    >
      <div className="flex flex-col md:flex-row">
        {/* Inbox — projects needing a week */}
        <aside className="shrink-0 border-b border-[var(--line)] bg-[var(--surface-2)] p-3 md:w-56 md:border-b-0 md:border-r">
          <p className="section-label px-1 pb-2 text-[var(--muted)]">Needs a week · {INBOX.length}</p>
          <div className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
            {INBOX.map((p) => (
              <div
                key={p.name}
                className="min-w-[9.5rem] shrink-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 shadow-[var(--shadow-1)] md:min-w-0"
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.dot }} />
                  <span className="truncate text-[12px] text-[var(--text)]">{p.name}</span>
                </div>
                <p className="mono mt-0.5 pl-4 text-[10px] text-[var(--muted)]">{p.sub}</p>
              </div>
            ))}
            <div className="hidden rounded-lg border border-dashed border-[var(--line)] px-3 py-2 text-center text-[11px] font-medium text-[var(--muted)] md:block">
              + project
            </div>
          </div>
        </aside>

        {/* Timeline — sprint columns + time-boxed bars */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3 px-4 pb-1 pt-3">
            <p className="masthead text-[15px] text-[var(--text)]">On deck · next 4 weeks</p>
            <div className="hidden shrink-0 items-center gap-3 text-[10px] sm:flex">
              <span className="flex items-center gap-1 text-[var(--muted)]">
                <span className="h-2 w-2 rounded-full" style={{ background: READY }} /> ready
              </span>
              <span className="flex items-center gap-1 text-[var(--muted)]">
                <span className="h-2 w-2 rounded-full" style={{ background: GROOM }} /> grooming
              </span>
              <span className="flex items-center gap-1 text-[var(--muted)]">
                <span className="h-2 w-2 rounded-full border border-[var(--line-strong)]" /> raw
              </span>
            </div>
          </div>

          {/* horizontal scroll on small screens, like the product's runway */}
          <div className="overflow-x-auto px-1.5 pb-3">
            <div className="min-w-[560px]">
              {/* week headers */}
              <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                {WEEKS.map((w, i) => {
                  const over = w.load > MAX
                  return (
                    <div
                      key={i}
                      className="border-l border-[var(--line)] px-3 pb-2 pt-1 first:border-l-0"
                      style={{
                        background: w.now ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : undefined,
                        borderTop: w.now ? '2px solid var(--accent)' : undefined,
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-1">
                        <span
                          className="flex items-center gap-1 text-[11px] font-semibold"
                          style={{ color: w.now ? 'var(--accent)' : 'var(--text)' }}
                        >
                          {w.now && <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />}
                          Sprint {w.sprint}
                        </span>
                        <span
                          className="mono text-[10px]"
                          style={{ color: over ? GROOM : w.load ? 'var(--muted)' : 'var(--line-strong)' }}
                        >
                          {w.load}/{MAX}
                          {over ? ' ⚠' : ''}
                        </span>
                      </div>
                      <p className="mono mt-0.5 text-[10px] text-[var(--muted)]">
                        {w.tag} · {w.date}
                      </p>
                    </div>
                  )
                })}
              </div>
              <div className="h-px w-full bg-[var(--line)]" />

              {/* time-boxed bars, lane-packed into rows */}
              <div className="space-y-1 py-1.5">
                {ROWS.map((row, ri) => (
                  <div
                    key={ri}
                    className="grid items-stretch"
                    style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
                  >
                    {row.map((b) => (
                      <BarCard key={b.name} b={b} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="border-t border-[var(--line)] px-4 py-2.5 text-[11px] text-[var(--muted)]">
            Drag onto a week to time-box · drag an edge to resize · click to edit
          </p>
        </div>
      </div>
    </div>
  )
}
