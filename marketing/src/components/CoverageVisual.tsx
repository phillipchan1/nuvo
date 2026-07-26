/**
 * The three-tool deficiency, shown as coverage instead of stated as prose.
 * Each tool spans only part of the range you actually live across, and the
 * hole between "this week" and "this quarter" is exactly where the important
 * thing dies — task apps ceiling out at the week, project tools never reach a
 * Tuesday, and calendars only ever held meetings.
 *
 * Canon-accurate: the ceilings come from personas.md §1 ("the week is all
 * there is" / "work goes in and never comes out onto a Tuesday").
 */

import { useEffect, useRef, useState } from 'react'

// Short, because the axis sits under a right-aligned last tick and "The year"
// wraps at desktop widths.
const TICKS = ['Hour', 'Day', 'Week', 'Quarter', 'Year'] as const

// start/end as percentages of the altitude axis.
const TOOLS = [
  { name: 'Task apps', start: 0, end: 42, blind: 'Blind to the quarter.', faded: false },
  { name: 'Calendars', start: 0, end: 42, blind: 'Only ever held meetings.', faded: true },
  { name: 'Project tools', start: 58, end: 100, blind: 'Never reach a Tuesday.', faded: false },
] as const

const GAP_START = 42
const GAP_END = 58

export default function CoverageVisual() {
  const [played, setPlayed] = useState(false)
  const [instant, setInstant] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setInstant(true)
      setPlayed(true)
      return
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setPlayed(true)
          io.disconnect()
        }
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    const fallback = window.setTimeout(() => setPlayed(true), 2500)
    return () => {
      io.disconnect()
      window.clearTimeout(fallback)
    }
  }, [])

  return (
    <div ref={ref} aria-hidden="true">
      {/* The altitude axis every tool is measured against. */}
      <div className="relative hidden h-5 sm:block">
        {TICKS.map((t, i) => (
          <span
            key={t}
            className="section-label absolute top-0 text-[var(--muted)]"
            style={{
              left: `${(i / (TICKS.length - 1)) * 100}%`,
              transform:
                i === 0 ? 'none' : i === TICKS.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
          >
            {t}
          </span>
        ))}
      </div>

      <div className="mt-3 space-y-5 sm:space-y-4">
        {TOOLS.map((t, i) => (
          <div key={t.name} className="sm:flex sm:items-center sm:gap-5">
            <div className="flex items-baseline gap-2 sm:w-[16.5rem] sm:shrink-0">
              <span className="text-[0.9375rem] font-medium text-[var(--text)]">{t.name}</span>
              <span className="text-[0.875rem] text-[var(--muted)]">{t.blind}</span>
            </div>

            <div className="relative mt-2 h-2.5 w-full rounded-full bg-[var(--line)] sm:mt-0">
              <span
                className="absolute inset-y-0 rounded-full"
                style={{
                  left: `${t.start}%`,
                  width: played ? `${t.end - t.start}%` : 0,
                  background: t.faded ? 'var(--line-strong)' : 'var(--muted)',
                  opacity: t.faded ? 0.65 : 1,
                  transition: instant
                    ? 'none'
                    : `width .8s ${0.12 * i}s cubic-bezier(.4,0,.2,1)`,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* The hole. Nothing above spans it, which is the entire argument. */}
      <div className="relative mt-4 hidden h-9 sm:block">
        <div
          className="absolute top-0 flex flex-col items-center"
          style={{
            left: `calc(16.5rem + 1.25rem + (100% - 16.5rem - 1.25rem) * ${(GAP_START + GAP_END) / 200})`,
            transform: 'translateX(-50%)',
            opacity: played ? 1 : 0,
            transition: instant ? 'none' : 'opacity .7s 1s ease-out',
          }}
        >
          <span className="h-3 w-px bg-[var(--accent)]" />
          <span className="section-label mt-1.5 whitespace-nowrap text-[var(--accent)]">
            Nothing covers this
          </span>
        </div>
      </div>

      <p className="mt-4 text-[0.875rem] text-[var(--muted)] sm:hidden">
        Nothing covers the space between this week and this quarter.
      </p>
    </div>
  )
}
