/**
 * Scattered, then held.
 *
 * Ported from the app's own welcome hero (`src/components/orientation/
 * Visuals.tsx` → `WelcomeHero`), whose comment calls it "the one image the whole
 * product is: things you're carrying, arriving loose and out of register,
 * gathering into a single calm line."
 *
 * The app's version is deliberately label-free — a welcome screen can't ask a
 * cold reader to decode anything, so the feeling has to arrive before the
 * vocabulary. Marketing can afford labels, and here they're load-bearing: the
 * *breadth* of what gets captured is the argument, and a list of input methods
 * would say it far worse than six things a person recognizes carrying.
 *
 * Deliberately absent: forwarding an email. There is no inbound-email function
 * and no Resend anywhere on master (checked 2026-08-09), and the site does not
 * sell what doesn't ship — the same rule the INVENTORY list in Home.tsx keeps.
 * "From another app" is honest: `supabase/functions/capture` is live.
 *
 * The gather runs once on entry. A still frame of this is just two columns of
 * text; the *travel* is the whole point, because "nothing stays loose" is a
 * motion, not a state.
 */

import { useEffect, useRef, useState } from 'react'

/** Six things a person actually carries — not six input methods. The one
 *  mechanism named outright is ⌥Space, because a global hotkey is the single
 *  fact that makes capture cheap enough to be honest. */
const CARRIED = [
  { text: 'a promise made in a hallway', loose: { x: 1, y: 3 } },
  { text: '⌥Space, mid-meeting', loose: { x: 24, y: 19 } },
  { text: 'said out loud, hands full', loose: { x: 4, y: 39 } },
  { text: '11pm, half-shaped', loose: { x: 27, y: 57 } },
  { text: 'pushed in from another app', loose: { x: 0, y: 75 } },
  { text: 'the one you keep re-remembering', loose: { x: 20, y: 91 } },
]

/** Where each one ends up: a calm, evenly spaced column. The x comes from CSS
 *  (`--converge-held-x`) because the gather point moves on a phone, and the
 *  chips and the rule they land on must never disagree about where it is. */
const HELD_X = 'var(--converge-held-x)'
const heldY = (i: number) => 6 + i * 16

export default function ConvergeVisual() {
  const [held, setHeld] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setHeld(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          window.setTimeout(() => setHeld(true), 420)
          io.disconnect()
        }
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} className="converge" aria-hidden="true">
      {/* The line they find. Dashed where things are still loose, solid the
          moment they're held — the funnel, drawn as one stroke. */}
      <div className="converge-rule" style={{ opacity: held ? 1 : 0.25 }} />

      {CARRIED.map((c, i) => (
        <span
          key={c.text}
          className="converge-chip"
          style={{
            left: held ? HELD_X : `${c.loose.x}%`,
            top: `${held ? heldY(i) : c.loose.y}%`,
            opacity: held ? 1 : 0.5,
            borderColor: held ? 'var(--line)' : 'transparent',
            background: held ? 'var(--surface)' : 'transparent',
            color: held ? 'var(--text)' : 'var(--muted)',
            transitionDelay: `${i * 90}ms`,
          }}
        >
          <span
            className="converge-dot"
            style={{ background: held ? 'var(--accent)' : 'var(--line-strong)' }}
          />
          {c.text}
        </span>
      ))}

      <span className="converge-caption" style={{ opacity: held ? 1 : 0 }}>
        One inbox
      </span>
    </div>
  )
}
