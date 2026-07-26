/**
 * The villain, drawn. Drift is defined in the copy as "the slow, blameless gap
 * between what you said mattered and what your calendar actually spends you
 * on" — which is literally two diverging lines, so draw them instead of
 * describing them. The widening shaded area IS the definition.
 *
 * The lines draw left→right on entry so the reader watches the gap open rather
 * than arriving at a finished chart.
 */

import { useEffect, useRef, useState } from 'react'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr'] as const

// One flat line (intent never changes) and one that sags (hours go elsewhere).
const INTENT = 'M 34 46 L 150 46 L 266 46 L 382 46'
const ACTUAL = 'M 34 46 C 110 58, 130 92, 200 104 S 320 132, 382 148'
const GAP_AREA = `${INTENT} L 382 148 C 320 132, 270 116, 200 104 S 110 58, 34 46 Z`

export default function DriftVisual() {
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
      { threshold: 0.4 },
    )
    io.observe(el)
    // Degenerate viewports never fire the observer; don't strand it blank.
    const fallback = window.setTimeout(() => setPlayed(true), 2500)
    return () => {
      io.disconnect()
      window.clearTimeout(fallback)
    }
  }, [])

  const draw = (delay: number) => ({
    strokeDasharray: 1,
    strokeDashoffset: played ? 0 : 1,
    transition: instant ? 'none' : `stroke-dashoffset 1.5s ${delay}s cubic-bezier(.4,0,.2,1)`,
  })

  return (
    <div
      ref={ref}
      className="glass-card reveal rounded-2xl border border-[var(--line)] px-5 py-6 sm:px-7"
      aria-hidden="true"
    >
      <svg viewBox="0 0 420 190" className="w-full" role="presentation">
        {/* Month gridlines — just enough to read this as elapsed time. */}
        {MONTHS.map((m, i) => (
          <g key={m}>
            <line
              x1={34 + i * 116}
              y1="24"
              x2={34 + i * 116}
              y2="158"
              stroke="var(--line)"
              strokeWidth="1"
            />
            <text
              x={34 + i * 116}
              y="176"
              textAnchor="middle"
              fill="var(--muted)"
              style={{ font: '500 11px ui-sans-serif, system-ui', letterSpacing: '.08em' }}
            >
              {m.toUpperCase()}
            </text>
          </g>
        ))}

        {/* The gap itself — the thing being named. */}
        <path
          d={GAP_AREA}
          fill="var(--accent)"
          style={{
            opacity: played ? 0.1 : 0,
            transition: instant ? 'none' : 'opacity 1.1s .9s ease-out',
          }}
        />

        <path
          d={INTENT}
          pathLength={1}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          style={draw(0)}
        />
        <path
          d={ACTUAL}
          pathLength={1}
          fill="none"
          stroke="var(--muted)"
          strokeWidth="2"
          strokeLinecap="round"
          style={draw(0.25)}
        />

        {/* Label the gap in place, so the chart still reads on its own if it's
            ever screenshotted away from the heading beside it. */}
        <text
          x="300"
          y="112"
          textAnchor="middle"
          fill="var(--accent)"
          style={{
            font: '600 11px ui-sans-serif, system-ui',
            letterSpacing: '.14em',
            opacity: played ? 0.85 : 0,
            transition: instant ? 'none' : 'opacity .8s 1.6s ease-out',
          }}
        >
          DRIFT
        </text>

        {/* Endpoint dots land as each line finishes. */}
        <circle
          cx="382"
          cy="46"
          r="4"
          fill="var(--accent)"
          style={{ opacity: played ? 1 : 0, transition: instant ? 'none' : 'opacity .4s 1.5s' }}
        />
        <circle
          cx="382"
          cy="148"
          r="4"
          fill="var(--muted)"
          style={{ opacity: played ? 1 : 0, transition: instant ? 'none' : 'opacity .4s 1.75s' }}
        />
      </svg>

      <div className="mt-4 space-y-2 border-t border-[var(--line)] pt-4">
        <p className="flex items-center gap-2.5 text-[13px] text-[var(--text)]">
          <span className="h-0.5 w-4 shrink-0 rounded-full bg-[var(--accent)]" />
          What you said mattered
        </p>
        <p className="flex items-center gap-2.5 text-[13px] text-[var(--muted)]">
          <span className="h-0.5 w-4 shrink-0 rounded-full bg-[var(--muted)]" />
          What actually got hours
        </p>
      </div>
    </div>
  )
}
