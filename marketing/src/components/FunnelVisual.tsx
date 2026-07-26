/**
 * The differentiator, demonstrated rather than asserted: ONE thing descending
 * every altitude — the year you're planning down to the hour you're working —
 * and staying the same object the whole way. A static ladder is a taxonomy
 * (every tool has one); the motion between the rungs is the part nobody else
 * does, so the visual animates the descent and then holds the full chain.
 */

import { useEffect, useRef, useState } from 'react'

const STEPS = [
  { label: 'Domain', hint: 'a part of your life', value: 'Work', color: '#2563EB' },
  { label: 'Initiative', hint: 'what you’re betting on', value: 'Grow the product team', color: '#7C3AED' },
  { label: 'Project', hint: 'the body of work', value: 'Rebuild onboarding', color: '#0D9488' },
  { label: 'Task', hint: 'the next move', value: 'Draft the welcome email', color: '#92568a' },
  { label: 'Block', hint: 'a real hour, on your calendar', value: 'Tuesday · 9:00–10:30', color: '#e0620f' },
] as const

const STEP_MS = 900
const HOLD_MS = 3200

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
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
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
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => io.disconnect()
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
      className="glass-card reveal rounded-2xl border border-[var(--line)] px-5 py-6 sm:px-7"
      aria-hidden="true"
    >
      <p className="section-label text-[var(--muted)]">One object, all the way down</p>
      <p className="masthead mt-2 text-[1.35rem] text-[var(--text)]">
        From the year you’re planning to the hour you’re working.
      </p>

      <ol className="mt-6 space-y-0">
        {STEPS.map((s, i) => {
          const lit = i <= active
          return (
            <li key={s.label} className="relative flex gap-4 pb-5 last:pb-0">
              {i < STEPS.length - 1 && (
                <>
                  <span
                    className="absolute left-[11px] top-6 bottom-0 w-px bg-[var(--line-strong)]"
                    aria-hidden
                  />
                  {/* The descent itself: the segment fills as the object moves down. */}
                  <span
                    className="absolute left-[11px] top-6 bottom-0 w-px origin-top transition-transform duration-500 ease-out"
                    style={{
                      background: s.color,
                      transform: `scaleY(${i < active ? 1 : 0})`,
                    }}
                    aria-hidden
                  />
                </>
              )}
              <span
                className="relative z-[1] mt-1 h-[22px] w-[22px] shrink-0 rounded-full border-2 transition-all duration-500 ease-out"
                style={{
                  borderColor: lit ? s.color : 'var(--line-strong)',
                  background: lit ? s.color : 'var(--surface)',
                  transform: i === active ? 'scale(1.14)' : 'scale(1)',
                  boxShadow: i === active ? `0 0 0 5px ${s.color}22` : 'none',
                }}
              />
              <div className="min-w-0 pt-0.5">
                <p
                  className="text-[15px] font-medium transition-colors duration-500"
                  style={{ color: lit ? 'var(--text)' : 'var(--muted)' }}
                >
                  {s.label}
                </p>
                <p className="text-[13px] text-[var(--muted)]">{s.hint}</p>
                {/* The concrete value is what proves it's the SAME thing getting
                    more specific, not five separate records in five tools. */}
                <p
                  className="mt-1.5 inline-block rounded-md px-2 py-1 text-[13px] leading-snug transition-all duration-500 ease-out"
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

      <p className="mt-2 border-t border-[var(--line)] pt-4 text-[13px] leading-snug text-[var(--muted)]">
        No re-typing between apps. No project quietly dying in a board while your week fills
        up — and when Tuesday is done, the bet above it moved.
      </p>
    </div>
  )
}
