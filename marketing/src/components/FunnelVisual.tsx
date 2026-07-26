/**
 * The differentiator, demonstrated rather than asserted: ONE thing descending
 * every altitude — the year you're planning down to the hour you're working —
 * and staying the same object the whole way. A static ladder is a taxonomy
 * (every tool has one); the motion between the rungs is the part nobody else
 * does, so this animates the descent and then holds the full chain.
 *
 * Reads left→right on desktop so the whole argument is one glance, and stacks
 * top→bottom on a phone. Two connector spans (not one) because the fill
 * transform differs per axis and Tailwind can't switch scaleX/scaleY inline.
 */

import { useEffect, useRef, useState } from 'react'

// Plain language only — the app's vocabulary ("domain", "block") stays in the
// app. A first-time reader shouldn't have to learn two words to read a diagram.
const STEPS = [
  { label: 'A world you run', hint: 'work, family, the side thing', value: 'Work', color: '#2563EB' },
  { label: 'A bet you make', hint: 'what moves it this year', value: 'Grow the product team', color: '#7C3AED' },
  { label: 'The body of work', hint: 'the actual project', value: 'Rebuild onboarding', color: '#0D9488' },
  { label: 'The next move', hint: 'one task', value: 'Draft the welcome email', color: '#92568a' },
  { label: 'The hour', hint: 'on your real calendar', value: 'Tue · 9:00–10:30', color: '#e0620f' },
] as const

const STEP_MS = 850
const HOLD_MS = 3400

export default function FunnelVisual() {
  // -1 = nothing lit yet (pre-roll); STEPS.length - 1 = fully descended.
  const [active, setActive] = useState(-1)
  const [started, setStarted] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Don't run the descent off-screen — it's the one moment that explains the
  // product, so it should play when the reader is actually looking at it.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setActive(STEPS.length - 1)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true)
          io.disconnect()
        }
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    // Safety net: in a zero-height or otherwise degenerate viewport the observer
    // never fires, which would strand the ladder in its empty pre-roll state.
    // Start anyway — a loop the reader joins mid-cycle beats a blank diagram.
    const fallback = window.setTimeout(() => setStarted(true), 3000)
    return () => {
      io.disconnect()
      window.clearTimeout(fallback)
    }
  }, [])

  useEffect(() => {
    if (!started) return
    const last = STEPS.length - 1
    const t = window.setTimeout(
      () => setActive((a) => (a >= last ? -1 : a + 1)),
      active >= last ? HOLD_MS : STEP_MS,
    )
    return () => window.clearTimeout(t)
  }, [started, active])

  return (
    <div
      ref={ref}
      className="glass-card reveal rounded-2xl border border-[var(--line)] px-5 py-7 sm:px-8"
      aria-hidden="true"
    >
      <div className="flex items-baseline justify-between gap-4">
        <p className="section-label text-[var(--muted)]">One object, all the way down</p>
        <p className="section-label hidden text-[var(--muted)] sm:block">The year → the hour</p>
      </div>

      <ol className="mt-7 flex flex-col md:flex-row">
        {STEPS.map((s, i) => {
          const lit = i <= active
          const filled = i < active
          const isLast = i === STEPS.length - 1
          return (
            <li
              key={s.label}
              className="relative flex gap-4 pb-6 last:pb-0 md:min-w-0 md:flex-1 md:flex-col md:gap-2.5 md:pb-0"
            >
              {!isLast && (
                <>
                  {/* Vertical spine (phone) */}
                  <span
                    className="absolute left-[11px] top-6 bottom-0 w-px bg-[var(--line-strong)] md:hidden"
                    aria-hidden
                  />
                  <span
                    className="absolute left-[11px] top-6 bottom-0 w-px origin-top transition-transform duration-500 ease-out md:hidden"
                    style={{ background: s.color, transform: `scaleY(${filled ? 1 : 0})` }}
                    aria-hidden
                  />
                  {/* Horizontal rail (desktop) */}
                  <span
                    className="absolute left-7 right-3 top-[11px] hidden h-px bg-[var(--line-strong)] md:block"
                    aria-hidden
                  />
                  <span
                    className="absolute left-7 right-3 top-[11px] hidden h-px origin-left transition-transform duration-500 ease-out md:block"
                    style={{ background: s.color, transform: `scaleX(${filled ? 1 : 0})` }}
                    aria-hidden
                  />
                </>
              )}

              <span
                className="relative z-[1] mt-1 h-[22px] w-[22px] shrink-0 rounded-full border-2 transition-all duration-500 ease-out md:mt-0"
                style={{
                  borderColor: lit ? s.color : 'var(--line-strong)',
                  background: lit ? s.color : 'var(--surface)',
                  transform: i === active ? 'scale(1.16)' : 'scale(1)',
                  boxShadow: i === active ? `0 0 0 5px ${s.color}22` : 'none',
                }}
              />

              <div className="min-w-0 pt-0.5 md:pr-4 md:pt-0">
                <p
                  className="text-[15px] font-medium transition-colors duration-500"
                  style={{ color: lit ? 'var(--text)' : 'var(--muted)' }}
                >
                  {s.label}
                </p>
                <p className="text-[13px] text-[var(--muted)]">{s.hint}</p>
                {/* The concrete value is what proves it's the SAME thing getting
                    more specific — not five records in five different tools. */}
                <p
                  className="mt-2 inline-block rounded-md px-2 py-1 text-[13px] leading-snug transition-all duration-500 ease-out"
                  style={{
                    background: lit ? `${s.color}14` : 'transparent',
                    color: lit ? 'var(--text)' : 'transparent',
                    opacity: lit ? 1 : 0,
                    transform: lit ? 'translateY(0)' : 'translateY(-6px)',
                  }}
                >
                  {s.value}
                </p>
              </div>
            </li>
          )
        })}
      </ol>

      <p className="mt-7 border-t border-[var(--line)] pt-4 text-[13px] leading-snug text-[var(--muted)]">
        Finish Tuesday and the bet above it moved. No re-typing between apps.
      </p>
    </div>
  )
}
