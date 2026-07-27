/**
 * Plan the week — the flagship visual.
 *
 * A faithful recreation of the real flow (`src/components/rituals/SundayRitual.tsx`
 * over `useWeekDraft`): the pool on the left walks three questions, the week on the
 * right fills as you answer, and the meter under the grid measures the whole thing
 * the entire time. Driven against the running app on 2026-07-27 — the step
 * questions, the button labels, the block eyebrows (PROJECT · PART 1 OF 2), the
 * "no open time left" report and the "past your usual" phrasing are the product's
 * own words, not marketing paraphrase.
 *
 * Kept in step with `src/lib/intake.ts` — PLAN_STEPS / STEP_LABEL / STEP_QUESTION.
 * When the walk changes shape there (Leftovers + Inbox became one step, "The
 * rest", in 6968d50), this file changes with it or the site sells a screen that
 * no longer exists.
 *
 * The steps are clickable, and advance on their own once while the visual is in
 * view — the argument of the section is that the week *fills as you decide*, and a
 * still frame can't make it. `prefers-reduced-motion` lands on the finished week
 * instead of walking there.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const DATES = [27, 28, 29, 30, 31]

/** Working window drawn by the grid — the product's default is 8:00–16:30. */
const DAY_START = 8
const DAY_END = 17
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16]

/** Domain identity, the one place a raw hue is right — same set the Schedule
 *  visual uses so the two screens read as one product. */
const WORK = '#2563EB'
const FAITH = '#7C3AED'
const HOME = '#0D9488'

type Step = 0 | 1 | 2

type Event = { day: number; start: number; end: number; title: string }

type Block = {
  /** The step that puts this on the week. */
  step: Step
  day: number
  start: number
  end: number
  title: string
  /** The block's designation — every block says what kind of thing it is. */
  eyebrow: string
  color: string
}

/** Already on the week before you plan anything — the constraint, not a backdrop. */
const EVENTS: Event[] = [
  { day: 0, start: 9, end: 9.5, title: 'Standup' },
  { day: 0, start: 12, end: 12.5, title: 'Lunch' },
  { day: 0, start: 13, end: 14, title: 'Staff meeting' },
  { day: 1, start: 9, end: 9.5, title: 'Standup' },
  { day: 1, start: 12, end: 12.5, title: 'Lunch' },
  { day: 1, start: 14, end: 15, title: 'Client review' },
  { day: 2, start: 9, end: 9.5, title: 'Standup' },
  { day: 2, start: 12, end: 12.5, title: 'Lunch' },
  { day: 2, start: 15, end: 16, title: 'Dentist' },
  { day: 3, start: 9, end: 9.5, title: 'Standup' },
  { day: 3, start: 11, end: 12, title: '1:1 — Dana' },
  { day: 3, start: 12, end: 12.5, title: 'Lunch' },
  { day: 4, start: 10, end: 11, title: 'Retro' },
  { day: 4, start: 12, end: 12.5, title: 'Lunch' },
  { day: 4, start: 13, end: 13.5, title: '1:1 — Sam' },
]

const BLOCKS: Block[] = [
  // Step 2 — the projects you're moving. A project that needs two sittings says so.
  { step: 1, day: 1, start: 8, end: 9, title: 'Meridian launch', eyebrow: 'PROJECT · PART 1 OF 2', color: WORK },
  { step: 1, day: 2, start: 8, end: 9, title: 'Coaching curriculum', eyebrow: 'PROJECT · PART 1 OF 2', color: FAITH },
  { step: 1, day: 0, start: 10, end: 11.5, title: 'Recommendation plan', eyebrow: 'PROJECT · 3 TASKS', color: WORK },
  { step: 1, day: 3, start: 13.5, end: 15, title: 'Coaching curriculum', eyebrow: 'PROJECT · PART 2 OF 2', color: FAITH },
  { step: 1, day: 4, start: 14, end: 15.5, title: 'Meridian launch', eyebrow: 'PROJECT · PART 2 OF 2', color: WORK },
  // Step 3 — everything the week is carrying that isn't a project: what slipped,
  // what's due, and this morning's captures, slotted together in one pass.
  { step: 2, day: 0, start: 15, end: 16, title: 'Record the demo', eyebrow: 'TASK · ↻11', color: WORK },
  { step: 2, day: 2, start: 13, end: 14, title: 'Order the refill', eyebrow: 'TASK', color: HOME },
  { step: 2, day: 3, start: 9.5, end: 10.5, title: 'Church — media handoff', eyebrow: 'SLOT · 3 CAPTURES', color: FAITH },
  { step: 2, day: 4, start: 8, end: 9, title: 'Admin — bills & forms', eyebrow: 'SLOT · 2 CAPTURES', color: HOME },
  { step: 2, day: 1, start: 10, end: 11, title: 'Reply — Dana', eyebrow: 'SLOT · 1 CAPTURE', color: WORK },
]

/** The three questions and the act on each button, verbatim from the product
 *  (`STEP_LABEL` / `STEP_QUESTION` in src/lib/intake.ts, `NEXT_ACT` in the ritual). */
const STEPS = [
  { tab: 'Open time', question: 'What room does this week actually have?', action: 'Add your projects' },
  { tab: 'Projects', question: 'What are you moving this week?', action: 'Add the rest' },
  { tab: 'The rest', question: 'What else is the week carrying?', action: 'Commit the week' },
] as const

/** The meter's segments. Everything is measured from the first step — work you
 *  haven't reached yet is ghosted at its real width, so the total never lies. */
const SEGMENTS = [
  { step: 0, label: 'Already on the calendar', pct: 43, fill: 'var(--line-strong)' },
  { step: 1, label: 'Projects', pct: 32, fill: 'var(--accent)' },
  { step: 2, label: 'Carried', pct: 11, fill: 'var(--accent-2)' },
  { step: 2, label: 'New', pct: 14, fill: 'color-mix(in srgb, var(--accent-2) 55%, var(--surface))' },
] as const

const PROJECT_ROWS = [
  { name: 'Meridian launch', meta: '4/4 · 3.5h', color: WORK },
  { name: 'Coaching curriculum', meta: '4/4 · 3.3h', color: FAITH },
  { name: 'Recommendation plan', meta: '3/3 · 2.3h', color: WORK },
  { name: 'Get Dayspring on the App Store', meta: '4/4 · 3.5h', color: HOME },
]

/** One pool: a task that slipped and a capture that arrived this morning are the
 *  same kind of thing at slotting time, so the walk asks about them once. */
const REST_ROWS = [
  { name: 'Record the demo', badge: '↻11', meta: '1h30', color: WORK },
  { name: 'Research — leadership test', badge: '↻5', meta: '1h', color: WORK },
  { name: 'Order the refill', badge: 'quiet', meta: '30m', color: HOME },
  { name: 'Church — media handoff', badge: null, meta: '3 captures', color: FAITH },
  { name: 'Admin — bills & forms', badge: null, meta: '2 captures', color: HOME },
]

function fmtHour(h: number) {
  const suffix = h >= 12 ? 'p' : 'a'
  const n = h > 12 ? h - 12 : h
  return `${n}${suffix}`
}

const top = (h: number) => `${((h - DAY_START) / (DAY_END - DAY_START)) * 100}%`
const height = (a: number, b: number) => `${((b - a) / (DAY_END - DAY_START)) * 100}%`

export default function PlanWeekVisual() {
  const [step, setStep] = useState<Step>(0)
  const [walking, setWalking] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const walked = useRef(false)

  /** Walk the week once, when it comes into view — and stop the moment the
   *  reader takes over, because a stepper that keeps moving under a click is
   *  the visual arguing with the person reading it. */
  useEffect(() => {
    const el = ref.current
    if (!el || walked.current) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setStep(2)
      walked.current = true
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !walked.current) {
          walked.current = true
          setWalking(true)
          io.disconnect()
        }
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!walking) return
    if (step >= STEPS.length - 1) {
      setWalking(false)
      return
    }
    const t = window.setTimeout(() => setStep((s) => (s + 1) as Step), 1200)
    return () => window.clearTimeout(t)
  }, [walking, step])

  const choose = useCallback((s: Step) => {
    setWalking(false)
    walked.current = true
    setStep(s)
  }, [])

  const shown = BLOCKS.filter((b) => b.step <= step)
  const current = STEPS[step]

  return (
    <div
      ref={ref}
      className="planweek glass-card overflow-hidden rounded-2xl border border-[var(--line)] shadow-[var(--shadow-3)]"
    >
      {/* ── the pool: where the week's work is coming from ─────────────────── */}
      <aside className="planweek-rail flex flex-col border-b border-[var(--line)] md:border-b-0 md:border-r">
        <div className="px-4 pt-4">
          <p className="section-label text-[var(--accent)]">Sprint 31 · Jul 27–Aug 2</p>
          <p className="masthead mt-1 text-[1.0625rem] text-[var(--text)]">Week of July 27</p>

          {/* the stepper — positional only; the step number is said once, below */}
          <div className="mt-4 flex items-center justify-between" role="tablist" aria-label="Plan the week">
            {STEPS.map((s, i) => (
              <div key={s.tab} className="flex min-w-0 flex-1 items-center">
                <button
                  type="button"
                  role="tab"
                  aria-selected={i === step}
                  onClick={() => choose(i as Step)}
                  className="group flex min-w-0 flex-col items-center gap-1 px-0.5"
                >
                  <span
                    className={`mono flex h-6 w-6 items-center justify-center rounded-full border text-[11px] transition-colors ${
                      i === step
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                        : i < step
                          ? 'border-[var(--accent-2)] text-[var(--accent)]'
                          : 'border-[var(--line-strong)] text-[var(--muted)]'
                    }`}
                  >
                    {i < step ? '✓' : i + 1}
                  </span>
                  <span
                    className={`truncate text-[10px] leading-none ${
                      i === step ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
                    }`}
                  >
                    {s.tab}
                  </span>
                </button>
                {i < STEPS.length - 1 && <span className="mx-1 h-px flex-1 bg-[var(--line)]" />}
              </div>
            ))}
          </div>

          <p className="section-label mt-5 text-[var(--accent)]">
            Step {step + 1} of {STEPS.length}
          </p>
          <p className="masthead mt-1 text-[1.0625rem] leading-snug text-[var(--text)]">
            {current.question}
          </p>
        </div>

        <div className="planweek-pool flex-1 px-4 pb-3 pt-3">
          {step === 0 && (
            <>
              <p className="text-[13px] leading-relaxed text-[var(--muted)]">
                <span className="mono text-[var(--text)]">12.4h</span> open inside your working
                hours.
              </p>
              <p className="mt-3 text-[12px] leading-relaxed text-[var(--muted)]">
                Not going to something? Click it on the week — its time counts as open, here and
                everywhere else in Nuvo.
              </p>
            </>
          )}

          {step === 1 && (
            <ul>
              {PROJECT_ROWS.map((r) => (
                <li
                  key={r.name}
                  className="flex items-center gap-2 border-b border-[var(--line)] py-2 text-[13px]"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.color }} />
                  <span className="min-w-0 flex-1 truncate text-[var(--text)]">{r.name}</span>
                  <span className="mono shrink-0 text-[11px] text-[var(--muted)]">{r.meta}</span>
                </li>
              ))}
              <li className="pt-2.5 text-[12px] text-[var(--muted)]">＋ bring one in (5)</li>
            </ul>
          )}

          {step === 2 && (
            <ul>
              {REST_ROWS.map((r) => (
                <li
                  key={r.name}
                  className="flex items-center gap-2 border-b border-[var(--line)] py-2 text-[13px]"
                >
                  <span
                    className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] text-[9px] text-white"
                    style={{ background: 'var(--accent)' }}
                  >
                    ✓
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[var(--text)]">{r.name}</span>
                  {r.badge && (
                    <span className="mono shrink-0 text-[10px] text-[var(--signal)]">{r.badge}</span>
                  )}
                  <span className="mono shrink-0 text-[11px] text-[var(--muted)]">{r.meta}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-[var(--line)] p-3">
          <button
            type="button"
            onClick={() => choose(Math.min(step + 1, STEPS.length - 1) as Step)}
            className="btn-primary w-full !py-2.5 !text-[13px]"
          >
            {current.action} →
          </button>
        </div>
      </aside>

      {/* ── the week: never a step. It fills as you keep things in the rail ─── */}
      <div className="planweek-week min-w-0">
        <div className="planweek-scroll">
          <div className="planweek-grid">
            <div className="grid grid-cols-[26px_repeat(5,minmax(0,1fr))] border-b border-[var(--line)]">
              <div />
              {DAYS.map((d, i) => (
                <div key={d} className="border-l border-[var(--line)] py-2 text-center">
                  <p className="section-label text-[9px] text-[var(--muted)]">{d}</p>
                  <p className="mono mt-0.5 text-[12px] text-[var(--text)]">{DATES[i]}</p>
                </div>
              ))}
            </div>

            <div className="relative grid grid-cols-[26px_repeat(5,minmax(0,1fr))]" style={{ height: 300 }}>
              <div className="relative">
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="mono absolute right-1 -translate-y-1/2 text-[9px] text-[var(--muted)]"
                    style={{ top: top(h) }}
                  >
                    {fmtHour(h)}
                  </div>
                ))}
              </div>

              {DAYS.map((_, day) => (
                <div key={day} className="relative border-l border-[var(--line)]">
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="absolute inset-x-0 border-t border-[var(--line)]"
                      style={{ top: top(h) }}
                    />
                  ))}

                  {/* immovable — quiet while you decide, full strength when you commit */}
                  {EVENTS.filter((e) => e.day === day).map((e) => (
                    <div
                      key={`${e.day}-${e.title}-${e.start}`}
                      className="absolute inset-x-0.5 overflow-hidden rounded-[4px] border-l-2 border-[var(--line-strong)] px-1 transition-opacity duration-500"
                      style={{
                        top: top(e.start),
                        height: height(e.start, e.end),
                        background: 'color-mix(in srgb, var(--text) 5%, transparent)',
                        opacity: step === STEPS.length - 1 ? 1 : 0.65,
                      }}
                    >
                      <p className="truncate text-[9px] leading-[1.35] text-[var(--muted)]">{e.title}</p>
                    </div>
                  ))}

                  {/* what you just decided, landing on the hour */}
                  {shown
                    .filter((b) => b.day === day)
                    .map((b) => (
                      <div
                        key={`${b.day}-${b.title}-${b.start}`}
                        className="planweek-block absolute inset-x-0.5 overflow-hidden rounded-[4px] px-1 py-0.5"
                        style={{
                          top: top(b.start),
                          height: height(b.start, b.end),
                          background: `color-mix(in srgb, ${b.color} 22%, transparent)`,
                          borderLeft: `3px solid ${b.color}`,
                        }}
                      >
                        <p
                          className="section-label truncate text-[7.5px] leading-[1.5]"
                          style={{ color: b.color }}
                        >
                          {b.eyebrow}
                        </p>
                        <p className="truncate text-[9.5px] font-medium leading-[1.3] text-[var(--text)]">
                          ✦ {b.title}
                        </p>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 px-3 pt-2 text-[10px] text-[var(--muted)]">
          <span>✦ placed for you</span>
          <span>15 immovable</span>
          <span className="mono ml-auto hidden sm:inline">drag to move · hover to drop</span>
        </div>

        {/* Can I carry this? A reference you glance at, sitting with the thing it
            measures — and measuring the whole week from step one. */}
        <div className="mt-2 border-t border-[var(--line)] px-3 pt-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="section-label text-[var(--muted)]">The week</p>
            <p className="mono text-[12px] text-[var(--text)]">
              25.9h{' '}
              <span className="text-[var(--signal)]">· 5.6h past your usual 20.3h</span>
            </p>
          </div>
          <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-[var(--line)]">
            {SEGMENTS.map((s) => (
              <div
                key={s.label}
                title={s.label}
                className="h-full transition-opacity duration-500"
                style={{ width: `${s.pct}%`, background: s.fill, opacity: step >= s.step ? 1 : 0.22 }}
              />
            ))}
          </div>
        </div>

        {/* Work you kept that the week had no room for — on screen while you can
            still do something about it, not after the fact. */}
        <div className="px-3 pb-3 pt-2.5" style={{ opacity: step >= 2 ? 1 : 0 }}>
          <p className="section-label text-[var(--signal)]">
            No open time left <span className="mono normal-case tracking-normal text-[var(--muted)]">1</span>
          </p>
          <div className="mt-1 flex items-center gap-3 border-b border-[var(--line)] pb-1.5 text-[11px]">
            <span className="min-w-0 flex-1 truncate text-[var(--text)]">Onboarding guide</span>
            <span className="mono shrink-0 text-[10px] text-[var(--muted)]">the week is full</span>
          </div>
        </div>
      </div>
    </div>
  )
}
