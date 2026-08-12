/**
 * The hero — the same move at every altitude.
 *
 * Not a tour of three screens. One screen, three times: the product's own law is
 * that the Schedule, the project deck and the initiative deck are *the same act
 * at three clock speeds* (pool left → grid of time right, CLAUDE.md). So the
 * layout never changes here. Only two things do — what's in the pool
 * (task → project → initiative) and what the grid's columns are
 * (hours → weeks → quarters). The reader gets "oh, it's the same move all the
 * way up" without reading a word, which is the elevator claim shown instead of
 * argued.
 *
 * A visible cursor performs every drag, and that is not decoration. Blocks that
 * place themselves read as Motion-style autopilot — N-01, and the exact thing
 * Principles 3 and 4 exist to refuse (*Nuvo proposes; you promote*). The cursor
 * is the human. Nothing on this visual moves without it.
 *
 * Recreates, faithfully: the Schedule day grid (`CalendarPane` + `PlannerRail`),
 * the project deck's week columns (`OnDeck`), and the initiative deck's quarter
 * columns. Driven against the running app at 1440×900 on 2026-08-09. The week
 * columns name themselves by distance and never by an ISO number — a "sprint 31"
 * is a retired word (glossary, retired-names table).
 *
 * The walk plays once and rests at the top of the ladder; it stops permanently
 * the moment the reader takes a pill, because a demo that keeps moving under a
 * click is the visual arguing with the person reading it.
 * `prefers-reduced-motion` lands on the finished state instead of travelling.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { COMMUNITY, CRAFT, FAMILY, HEALTH, MONEY, WORK } from './hues'

/* ── the walk ───────────────────────────────────────────────────────────── */

const START_DELAY = 620
const LIFT = 260
const TRAVEL = 720
const DROP = 300
const REST = 1150

type Phase = 'idle' | 'lift' | 'travel' | 'drop' | 'rest'

/* ── the day grid (altitude 0) ──────────────────────────────────────────── */

const DAY_START = 8
const DAY_END = 17
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16]

/** Three days, not one: a lone column stretched across the pane reads as a
 *  timeline of thin bars rather than a calendar. Three fills the width the way
 *  the real day view does — and it isn't the five of the Plan-the-week visual
 *  further down the page, so the two never echo each other. */
const DAYS = [
  { day: 'Mon', date: 'July 28' },
  { day: 'Tue', date: 'July 29' },
  { day: 'Wed', date: 'July 30' },
]

/** Already on the days before you plan anything — the constraint, not a backdrop. */
const IMMOVABLE = [
  { col: 0, start: 9, end: 9.5, title: 'Standup' },
  { col: 0, start: 12, end: 12.5, title: 'Lunch' },
  { col: 0, start: 13, end: 14, title: 'Staff meeting' },
  { col: 1, start: 9, end: 9.5, title: 'Standup' },
  { col: 1, start: 12, end: 12.5, title: 'Lunch' },
  { col: 1, start: 14, end: 15, title: 'Client review' },
  { col: 2, start: 9, end: 9.5, title: 'Standup' },
  { col: 2, start: 11, end: 12, title: '1:1 — Dana' },
  { col: 2, start: 12, end: 12.5, title: 'Lunch' },
  { col: 2, start: 15.5, end: 16, title: 'Pickup — Ivy' },
]

/** Where the task is going. Rendered as an open window until it's claimed. */
const TASK_SLOT = { col: 0, start: 10, end: 11.5 }

const top = (h: number) => `${((h - DAY_START) / (DAY_END - DAY_START)) * 100}%`
const height = (a: number, b: number) => `${((b - a) / (DAY_END - DAY_START)) * 100}%`

function fmtHour(h: number) {
  const suffix = h >= 12 ? 'p' : 'a'
  const n = h > 12 ? h - 12 : h
  return `${n}${suffix}`
}

/* ── the three altitudes ────────────────────────────────────────────────── */

type PoolRow = { name: string; meta: string; badge?: string; color: string }
type ColCard = { name: string; color: string }

type Altitude = {
  pill: string
  /** The teaching. Same skeleton, two words swap — the pattern is the point. */
  lead: string
  swap: string
  tail: string
  /** The rail's own crown, in the product's voice. */
  crown: string
  count: string
  pool: PoolRow[]
  /** Columns for the stacked grids (altitudes 1 and 2). */
  columns?: { label: string; sub: string; cards: ColCard[]; load: number }[]
  /** Which column index receives the drop. */
  targetCol?: number
  landed: { eyebrow: string; title: string; color: string }
}

const ALTITUDES: Altitude[] = [
  {
    pill: 'Tasks',
    lead: 'A ',
    swap: 'task',
    tail: ' lands on an hour.',
    crown: 'Loose work',
    count: '4 unplaced',
    pool: [
      { name: 'Record the demo', meta: '1h30', badge: '↻11', color: WORK },
      { name: 'Reply — Dana', meta: '30m', color: WORK },
      { name: 'Order the refill', meta: '30m', color: HEALTH },
      { name: 'Church — media handoff', meta: '3 captures', color: COMMUNITY },
    ],
    landed: { eyebrow: 'TASK · 1H30', title: 'Record the demo', color: WORK },
  },
  {
    pill: 'Projects',
    lead: 'A ',
    swap: 'project',
    tail: ' lands on a week.',
    crown: 'Not yet on a week',
    count: '4 waiting',
    pool: [
      { name: 'Meridian launch', meta: '3 tasks · 3.5h', color: WORK },
      { name: 'Coaching curriculum', meta: '4 tasks · 3.3h', color: COMMUNITY },
      { name: 'Dayspring on the App Store', meta: '4 tasks · 3.5h', color: CRAFT },
      { name: 'Move the 401k', meta: '2 tasks · 1.5h', color: MONEY },
    ],
    columns: [
      {
        label: 'This week',
        sub: 'Jul 28',
        cards: [
          { name: 'Recommendation plan', color: WORK },
          { name: 'Fall series outline', color: COMMUNITY },
        ],
        load: 82,
      },
      { label: 'Next week', sub: 'Aug 4', cards: [{ name: 'Onboarding guide', color: WORK }], load: 38 },
      { label: 'In 3 weeks', sub: 'Aug 11', cards: [{ name: 'Half-marathon block', color: HEALTH }], load: 30 },
      { label: 'In 4 weeks', sub: 'Aug 18', cards: [], load: 0 },
      { label: 'In 5 weeks', sub: 'Aug 25', cards: [{ name: 'Quarter close', color: MONEY }], load: 26 },
    ],
    targetCol: 1,
    landed: { eyebrow: 'PROJECT · 3 TASKS', title: 'Meridian launch', color: WORK },
  },
  {
    pill: 'Initiatives',
    lead: 'An ',
    swap: 'initiative',
    tail: ' lands on a quarter.',
    crown: 'Not yet claimed',
    count: '3 waiting',
    pool: [
      { name: 'Double trial conversion', meta: '2 key results · 4 projects', color: WORK },
      { name: 'Launch the fall series', meta: '1 key result · 3 projects', color: COMMUNITY },
      { name: 'Run a sub-2:00 half', meta: '1 key result · 2 projects', color: HEALTH },
    ],
    columns: [
      {
        label: 'This quarter',
        sub: 'Jul — Sep',
        cards: [{ name: 'Get Dayspring shipped', color: CRAFT }],
        load: 64,
      },
      { label: 'Q4', sub: 'Oct — Dec', cards: [{ name: 'Rebuild the rhythm', color: FAMILY }], load: 41 },
      { label: 'Q1', sub: 'Jan — Mar', cards: [], load: 0 },
      { label: 'Q2', sub: 'Apr — Jun', cards: [], load: 0 },
    ],
    targetCol: 0,
    /* Just the kind. A quarter column is narrow by nature, and the pool row
       already carries the key-result count. */
    landed: { eyebrow: 'INITIATIVE', title: 'Double trial conversion', color: WORK },
  },
]

export default function AltitudeVisual() {
  const [alt, setAlt] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [run, setRun] = useState(0)
  const [path, setPath] = useState<{ x: number; y: number; w: number; h: number; dx: number; dy: number } | null>(
    null,
  )

  const [armed, setArmed] = useState(false)
  const auto = useRef(true)
  const wrapRef = useRef<HTMLDivElement>(null)
  const srcRef = useRef<HTMLLIElement>(null)
  const tgtRef = useRef<HTMLDivElement>(null)

  const reduced =
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  /** Measure the real geometry, so the drag lands correctly at any width —
   *  including after the phone reflow puts the pool above the grid.
   *
   *  Deliberately useEffect, not useLayoutEffect: this page is prerendered
   *  (scripts/prerender.mjs), and a layout effect warns on the server and
   *  risks a hydration mismatch. Nothing needs the measurement before paint —
   *  the ghost doesn't exist until the `lift` beat, 260ms later. */
  useEffect(() => {
    if (reduced) return
    const wrap = wrapRef.current
    const src = srcRef.current
    const tgt = tgtRef.current
    if (!wrap || !src || !tgt) return
    const W = wrap.getBoundingClientRect()
    const S = src.getBoundingClientRect()
    const T = tgt.getBoundingClientRect()
    setPath({
      x: S.left - W.left,
      y: S.top - W.top,
      w: S.width,
      h: S.height,
      dx: T.left - S.left,
      dy: T.top - S.top,
    })
  }, [alt, run, reduced])

  /** Wait until the card is actually on screen before walking it.
   *
   *  On a desktop the hero is above the fold and this fires at mount, so it
   *  costs nothing there. On a phone the headline pushes the card ~1200px down
   *  the page — a mount timer would run the whole walk while the reader is
   *  still looking at the h1, and they'd arrive at a finished, motionless
   *  screen having never seen the one thing the section is for. */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setArmed(true)
          io.disconnect()
        }
      },
      { threshold: 0.3 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  /** One chain of beats per altitude, torn down whenever the reader interrupts. */
  useEffect(() => {
    if (reduced) {
      setPhase('rest')
      return
    }
    if (!armed) return
    const timers: number[] = []
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))

    const opening = alt === 0 && run === 0 ? START_DELAY : 0
    setPhase('idle')

    at(opening, () => setPhase('lift'))
    at(opening + LIFT, () => setPhase('travel'))
    at(opening + LIFT + TRAVEL, () => setPhase('drop'))
    at(opening + LIFT + TRAVEL + DROP, () => setPhase('rest'))
    at(opening + LIFT + TRAVEL + DROP + REST, () => {
      if (auto.current && alt < ALTITUDES.length - 1) setAlt((a) => a + 1)
    })

    return () => timers.forEach(window.clearTimeout)
  }, [alt, run, reduced, armed])

  /** Taking a pill ends the walk for good, then replays that altitude once. */
  const choose = useCallback((i: number) => {
    auto.current = false
    setArmed(true)
    setAlt(i)
    setRun((r) => r + 1)
  }, [])

  const a = ALTITUDES[alt]
  const landed = phase === 'drop' || phase === 'rest'
  const moving = phase === 'lift' || phase === 'travel'
  const travelling = phase === 'travel'
  const hero = a.pool[0]

  return (
    <div>
      {/* The pills — three altitudes, one act. Sized as tabs, not as buttons
          competing with the page's CTAs. */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Altitude">
        {ALTITUDES.map((x, i) => (
          <button
            key={x.pill}
            type="button"
            role="tab"
            aria-selected={i === alt}
            onClick={() => choose(i)}
            className={`tap inline-flex items-center rounded-full px-4 text-[0.9375rem] font-medium transition-all duration-300 ${
              i === alt
                ? 'bg-[var(--accent)] text-white shadow-[var(--shadow-2)]'
                : 'border border-[var(--line-strong)] bg-[color-mix(in_srgb,var(--surface)_55%,transparent)] text-[var(--muted)] hover:border-[var(--accent-2)] hover:text-[var(--text)]'
            }`}
          >
            {x.pill}
          </button>
        ))}
      </div>

      {/* The teaching. Keyed so the sentence re-enters when the altitude does —
          same skeleton, two words swapping, is the whole lesson. */}
      <p key={alt} className="altitude-line mt-4 text-body text-[var(--muted)]">
        {a.lead}
        <span className="font-medium text-[var(--text)]">{a.swap}</span>
        {a.tail}
      </p>

      <div
        ref={wrapRef}
        className="altitude glass-card relative mt-5 overflow-hidden rounded-2xl border border-[var(--line)] shadow-[var(--shadow-3)]"
      >
        {/* ── the pool ──────────────────────────────────────────────────── */}
        <aside className="altitude-rail flex flex-col border-b border-[var(--line)] md:border-b-0 md:border-r">
          <div className="px-4 pt-4">
            <p className="section-label text-[var(--accent)]">{a.crown}</p>
            <p className="mono mt-1 text-[12px] text-[var(--muted)]">{a.count}</p>
          </div>

          <ul className="altitude-pool flex-1 px-4 pb-3 pt-3">
            {a.pool.map((r, i) => (
              <li
                key={r.name}
                ref={i === 0 ? srcRef : undefined}
                className="flex items-center gap-2 border-b border-[var(--line)] py-2.5 text-[13px] transition-opacity duration-300"
                style={{ opacity: i === 0 && (moving || landed) ? 0.28 : 1 }}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.color }} />
                <span className="min-w-0 flex-1 truncate text-[var(--text)]">{r.name}</span>
                {r.badge && (
                  <span className="mono shrink-0 text-[10px] text-[var(--signal)]">{r.badge}</span>
                )}
                <span className="mono shrink-0 text-[11px] text-[var(--muted)]">{r.meta}</span>
              </li>
            ))}
          </ul>
        </aside>

        {/* ── the grid of time ──────────────────────────────────────────── */}
        <div className="altitude-body min-w-0">
          <div className="altitude-scroll">
            <div className="altitude-grid">
              {alt === 0 ? (
                /* Hours of one day. The block that lands is big enough to read,
                   which is the most literal possible statement of "on an hour". */
                <>
                  <div className="grid grid-cols-[30px_repeat(3,minmax(0,1fr))] border-b border-[var(--line)]">
                    <div />
                    {DAYS.map((d) => (
                      <div key={d.day} className="border-l border-[var(--line)] py-2 text-center">
                        <p className="section-label text-[9px] text-[var(--muted)]">{d.day}</p>
                        <p className="mono mt-0.5 text-[11px] text-[var(--text)]">{d.date}</p>
                      </div>
                    ))}
                  </div>

                  <div
                    className="relative grid grid-cols-[30px_repeat(3,minmax(0,1fr))]"
                    style={{ height: 250 }}
                  >
                    <div className="relative">
                      {HOURS.map((h) => (
                        <div
                          key={h}
                          className="mono absolute right-1.5 -translate-y-1/2 text-[9px] text-[var(--muted)]"
                          style={{ top: top(h) }}
                        >
                          {fmtHour(h)}
                        </div>
                      ))}
                    </div>

                    {DAYS.map((d, col) => (
                      <div key={d.day} className="relative border-l border-[var(--line)]">
                        {HOURS.map((h) => (
                          <div
                            key={h}
                            className="absolute inset-x-0 border-t border-[var(--line)]"
                            style={{ top: top(h) }}
                          />
                        ))}

                        {IMMOVABLE.filter((e) => e.col === col).map((e) => (
                          <div
                            key={`${e.col}-${e.title}-${e.start}`}
                            className="absolute inset-x-0.5 overflow-hidden rounded-[4px] border-l-2 border-[var(--line-strong)] px-1"
                            style={{
                              top: top(e.start),
                              height: height(e.start, e.end),
                              background: 'color-mix(in srgb, var(--text) 5%, transparent)',
                            }}
                          >
                            <p className="truncate text-[9px] leading-[1.4] text-[var(--muted)]">{e.title}</p>
                          </div>
                        ))}

                        {/* An open window, waiting — then what you put in it. */}
                        {col === TASK_SLOT.col && (
                          <div
                            ref={tgtRef}
                            className="absolute inset-x-0.5"
                            style={{
                              top: top(TASK_SLOT.start),
                              height: height(TASK_SLOT.start, TASK_SLOT.end),
                            }}
                          >
                            {landed ? (
                              <LandedBlock {...a.landed} />
                            ) : (
                              <OpenWindow armed={travelling} label="1h30 open" />
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                /* Weeks, then quarters. Same shape, coarser unit — the grid
                   getting coarser as you climb is itself the lesson. */
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `repeat(${a.columns!.length}, minmax(0,1fr))`, height: 284 }}
                >
                  {a.columns!.map((c, i) => (
                    <div
                      key={c.label}
                      className="flex min-w-0 flex-col border-l border-[var(--line)] first:border-l-0"
                    >
                      <div className="border-b border-[var(--line)] px-2 py-2 text-center">
                        <p className="section-label truncate text-[9px] text-[var(--text)]">{c.label}</p>
                        <p className="mono mt-0.5 truncate text-[10px] text-[var(--muted)]">{c.sub}</p>
                      </div>

                      <div className="flex flex-1 flex-col gap-1.5 p-1.5">
                        {c.cards.map((card) => (
                          <div
                            key={card.name}
                            className="overflow-hidden rounded-[4px] px-1.5 py-1"
                            style={{
                              background: `color-mix(in srgb, ${card.color} 14%, transparent)`,
                              borderLeft: `3px solid ${card.color}`,
                            }}
                          >
                            <p className="line-clamp-2 text-[10px] leading-[1.3] text-[var(--text)]">
                              {card.name}
                            </p>
                          </div>
                        ))}

                        {i === a.targetCol && (
                          <div ref={tgtRef} className="min-h-[38px]">
                            {landed ? (
                              <LandedBlock {...a.landed} />
                            ) : (
                              <OpenWindow armed={travelling} label="room" />
                            )}
                          </div>
                        )}
                      </div>

                      {/* How full it already is — the reason a week can refuse. */}
                      <div className="px-1.5 pb-2">
                        <div className="h-1 overflow-hidden rounded-full bg-[var(--line)]">
                          <div
                            className="h-full transition-[width] duration-700"
                            style={{
                              width: `${Math.min(100, c.load + (landed && i === a.targetCol ? 34 : 0))}%`,
                              background:
                                c.load + (landed && i === a.targetCol ? 34 : 0) > 95
                                  ? 'var(--signal)'
                                  : 'var(--accent)',
                              transitionTimingFunction: 'var(--ease-out)',
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── the hand ───────────────────────────────────────────────────
            The card travels because a person moved it. Without this the visual
            says "Nuvo schedules your life for you", which is the one promise
            the product refuses (N-01, Principles 3 & 4). */}
        {!reduced && path && (moving || phase === 'drop') && (
          <>
            <div
              className="altitude-ghost"
              style={{
                left: path.x,
                top: path.y,
                width: path.w,
                height: path.h,
                transform: travelling || phase === 'drop' ? `translate(${path.dx}px, ${path.dy}px)` : 'none',
                opacity: phase === 'drop' ? 0 : 1,
              }}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: hero.color }} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">{hero.name}</span>
              <span className="mono shrink-0 text-[11px] text-[var(--muted)]">{hero.meta}</span>
            </div>

            <div
              className="altitude-cursor"
              style={{
                left: path.x + Math.min(path.w * 0.42, 92),
                top: path.y + path.h * 0.62,
                transform: travelling || phase === 'drop' ? `translate(${path.dx}px, ${path.dy}px)` : 'none',
                opacity: phase === 'drop' ? 0 : 1,
              }}
            >
              <svg viewBox="0 0 12 18" width="15" height="22" aria-hidden="true">
                <path
                  d="M1 1.2 L1 14.4 L4.3 11.4 L6.5 16.6 L8.7 15.6 L6.5 10.6 L10.8 10.4 Z"
                  fill="var(--text)"
                  stroke="var(--surface)"
                  strokeWidth="1.1"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </>
        )}
      </div>

      <p className="mt-4 text-[0.9375rem] text-[var(--muted)]">
        The same move at every altitude. That’s the whole product.
      </p>
    </div>
  )
}

/** The open window it's headed for — a genuine gap, drawn as unclaimed. */
function OpenWindow({ armed, label }: { armed: boolean; label: string }) {
  return (
    <div
      className="flex h-full min-h-[38px] items-center justify-center rounded-[4px] border border-dashed transition-all duration-300"
      style={{
        borderColor: armed ? 'var(--slot)' : 'var(--line-strong)',
        background: armed ? 'color-mix(in srgb, var(--slot) 12%, transparent)' : 'transparent',
      }}
    >
      <span
        className="mono text-[9.5px] transition-colors duration-300"
        style={{ color: armed ? 'var(--slot)' : 'var(--muted)' }}
      >
        {label}
      </span>
    </div>
  )
}

/** What you just placed, wearing what kind of thing it is. */
function LandedBlock({ eyebrow, title, color }: { eyebrow: string; title: string; color: string }) {
  return (
    <div
      className="altitude-landed flex h-full min-h-[38px] flex-col justify-center overflow-hidden rounded-[4px] px-1.5 py-1"
      style={{
        background: `color-mix(in srgb, ${color} 22%, transparent)`,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <p className="section-label truncate text-[7.5px] leading-[1.5]" style={{ color }}>
        {eyebrow}
      </p>
      <p className="truncate text-[10.5px] font-medium leading-[1.3] text-[var(--text)]">{title}</p>
    </div>
  )
}
