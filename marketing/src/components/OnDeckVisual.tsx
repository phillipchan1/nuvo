/**
 * On Deck — a faithful recreation of a screen that exists, not a reduction of it.
 *
 * Driven at 1440×900 on 2026-07-27. Everything here is on the real screen:
 * the face switch (On Deck · Groom · Table · Shipped), the rail's "NEXT 4 WEEKS /
 * 5 of 6 ready" with the projects that still need a sprint, the COVERAGE grid
 * (domains down the side, sprints across, and the header's "Domains n/n"), the
 * sprint columns with their n/m counts, project cards with a three-segment
 * readiness track that says "Ready" or names what's missing, and the footer
 * "Drag onto a sprint to time-box · drag an edge to resize · click to edit".
 *
 * It earns two sections at once, which is why the marketing site now shows it
 * whole instead of cropping it twice: **how a big thing gets provisioned across
 * weeks** and **which life you're starving** are the same picture. An empty
 * coverage row is the answer to the second, and it costs nothing to show.
 */

import { COMMUNITY as CHURCH, CRAFT, FAMILY, HEALTH, MONEY, WORK } from './hues'

const COVERAGE = [
  { name: 'Work', color: WORK, bars: [[2, 60], [2, 46], [2, 38]] },
  { name: 'Church', color: CHURCH, bars: [[2, 32], [42, 28], []] },
  { name: 'Health', color: HEALTH, bars: [[2, 26], [2, 20], []] },
  { name: 'Family', color: FAMILY, bars: [[52, 22], [], []] },
  { name: 'Craft', color: CRAFT, bars: [[], [], []] },
  { name: 'Money', color: MONEY, bars: [[], [], []] },
] as const

const SPRINTS = [
  { n: 31, when: 'This week · Jul 26', count: '5/2', warn: true, now: true },
  { n: 32, when: 'Next week · Aug 2', count: '1/2', warn: false, now: false },
  { n: 33, when: 'Week of Aug 9', count: null, warn: false, now: false },
] as const

const CARDS = [
  { sprint: 0, name: 'Onboarding rewrite', color: WORK, ready: true, note: 'Ready' },
  { sprint: 0, name: 'Build the base', color: HEALTH, ready: true, note: 'Ready' },
  { sprint: 0, name: 'Fall retreat', color: CHURCH, ready: true, note: 'Ready' },
  { sprint: 0, name: 'Summer trip logistics', color: FAMILY, ready: true, note: 'Ready' },
  { sprint: 1, name: 'Teach the kids to ride', color: FAMILY, ready: false, note: 'no outcome · no steps' },
] as const

const NEEDS_SPRINT = [
  'Rebuild the trading journal',
  'Marketing and social plan',
  'Feedback and product loop',
  'Support infrastructure',
]

function Track({ ready, note, color }: { ready: boolean; note: string; color: string }) {
  return (
    <div className="mt-1.5 flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-[3px] flex-1 rounded-full"
          style={{
            background: ready ? color : i === 0 ? 'var(--signal)' : 'var(--line-strong)',
            opacity: ready ? 0.85 : 1,
          }}
        />
      ))}
      <span
        className="mono ml-1 shrink-0 text-[8.5px]"
        style={{ color: ready ? color : 'var(--signal)' }}
      >
        {note}
      </span>
    </div>
  )
}

export default function OnDeckVisual() {
  return (
    <div
      className="ondeck glass-card overflow-hidden rounded-2xl border border-[var(--line)] shadow-[var(--shadow-3)]"
      aria-hidden="true"
    >
      {/* face switch */}
      <div className="flex items-center justify-end gap-1 border-b border-[var(--line)] px-3 py-2 text-[11px]">
        <span className="rounded-md bg-[var(--accent-soft)] px-2 py-1 text-[var(--accent)]">
          On Deck
        </span>
        {['Groom', 'Table', 'Shipped'].map((f) => (
          <span key={f} className="px-2 py-1 text-[var(--muted)]">
            {f}
          </span>
        ))}
      </div>

      <div className="ondeck-body">
        {/* rail — what isn't scheduled yet */}
        <aside className="ondeck-rail hidden flex-col border-r border-[var(--line)] md:flex">
          <div className="border-b border-[var(--line)] px-3 py-2.5">
            <div className="flex items-baseline justify-between">
              <p className="section-label text-[var(--muted)]">Next 4 weeks</p>
              <span className="text-[10px] text-[var(--muted)]">open</span>
            </div>
            <p className="mt-1.5 text-[12px] text-[var(--text)]">
              <span className="mono">5</span> of <span className="mono">6</span> ready
            </p>
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-[var(--line)]">
              <div className="h-full w-[83%] rounded-full bg-[var(--accent)]" />
            </div>
          </div>
          <div className="border-b border-[var(--line)] px-3 py-2 text-[11px] text-[var(--muted)]">
            1 need shaping <span className="text-[var(--signal)]">— mid-groom</span>
          </div>
          <div className="px-3 py-2.5">
            <p className="section-label text-[var(--muted)]">
              Needs a sprint · <span className="mono normal-case">4</span>
            </p>
            <ul className="mt-2 space-y-1.5">
              {NEEDS_SPRINT.map((n) => (
                <li
                  key={n}
                  className="rounded-md border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_60%,transparent)] px-2 py-1.5"
                >
                  <p className="truncate text-[11px] leading-snug text-[var(--text)]">{n}</p>
                  <p className="text-[9px] text-[var(--muted)]">no finish line</p>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* coverage + sprints */}
        <div className="min-w-0">
          <div className="ondeck-scroll">
            <div className="ondeck-plane">
              <div className="flex items-baseline justify-between px-3 py-2">
                <p className="section-label text-[var(--muted)]">· Coverage</p>
                <p className="text-[10px] text-[var(--muted)]">Domains 4/6 ▾</p>
              </div>

              {/* every life you are living, three weeks across */}
              <ul className="border-b border-[var(--line)]">
                {COVERAGE.map((r) => {
                  const empty = r.bars.every((b) => b.length === 0)
                  return (
                    <li
                      key={r.name}
                      className="grid grid-cols-[6.5rem_repeat(3,minmax(0,1fr))] items-center"
                    >
                      <div className="flex items-center gap-1.5 py-[3px] pl-3">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: empty ? 'var(--line-strong)' : r.color }}
                        />
                        <span
                          className={`truncate text-[11px] ${
                            empty ? 'text-[var(--muted)]' : 'text-[var(--text)]'
                          }`}
                        >
                          {r.name}
                        </span>
                      </div>
                      {r.bars.map((bar, i) => (
                        <div
                          key={i}
                          className="relative mx-1 my-[3px] h-[13px] rounded-[3px]"
                          style={{ background: 'color-mix(in srgb, #1f1a16 4%, transparent)' }}
                        >
                          {bar.length === 2 && (
                            <span
                              className="absolute top-1/2 h-[9px] -translate-y-1/2 rounded-[3px]"
                              style={{ left: `${bar[0]}%`, width: `${bar[1]}%`, background: r.color }}
                            />
                          )}
                        </div>
                      ))}
                    </li>
                  )
                })}
              </ul>

              {/* the sprints themselves */}
              <div className="grid grid-cols-[6.5rem_repeat(3,minmax(0,1fr))]">
                <div />
                {SPRINTS.map((s) => (
                  <div
                    key={s.n}
                    className={`border-l border-[var(--line)] px-2 py-2 ${
                      s.now ? 'bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]' : ''
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-1">
                      <p
                        className={`text-[12px] font-medium ${
                          s.now ? 'text-[var(--signal)]' : 'text-[var(--text)]'
                        }`}
                      >
                        {s.now && '● '}Sprint {s.n}
                      </p>
                      {s.count && (
                        <span className="mono text-[9px] text-[var(--muted)]">
                          {s.count} {s.warn && '⚠'}
                        </span>
                      )}
                    </div>
                    <p className="text-[9px] text-[var(--muted)]">{s.when}</p>
                  </div>
                ))}

                <div />
                {SPRINTS.map((s, si) => (
                  <div
                    key={s.n}
                    className={`space-y-1.5 border-l border-[var(--line)] p-1.5 ${
                      s.now ? 'bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]' : ''
                    }`}
                  >
                    {CARDS.filter((c) => c.sprint === si).map((c) => (
                      <div
                        key={c.name}
                        className="rounded-md border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] px-2 py-1.5"
                        style={{ borderLeft: `3px solid ${c.color}` }}
                      >
                        <p className="truncate text-[11px] leading-snug text-[var(--text)]">
                          {c.name}
                        </p>
                        <Track ready={c.ready} note={c.note} color={c.color} />
                      </div>
                    ))}
                    <p className="pt-0.5 text-center text-[10px] text-[var(--muted)]">+ project</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="border-t border-[var(--line)] px-3 py-2 text-[10px] text-[var(--muted)]">
            Drag onto a sprint to time-box · drag an edge to resize · click to edit
          </p>
        </div>
      </div>
    </div>
  )
}
