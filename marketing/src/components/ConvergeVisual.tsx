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
 * The gather is SCRUBBED, not played. A still frame of this is two columns of
 * text; the *travel* is the whole point, because "nothing stays loose" is a
 * motion rather than a state — and the reader's own scroll is what performs it,
 * which is the section's argument acted out rather than asserted. It used to
 * fire once on entry off a 420ms timer, which meant a reader who arrived a
 * beat late met a finished, motionless column and never saw a thing move.
 *
 * 'through', not 'sticky': the beats can play while the diagram is still
 * travelling up the screen, so it costs no page height and no layout. Scatter
 * two sections above already spends the page's one sticky budget — see
 * useScrollProgress.
 */

import { useRef } from 'react'
import { steps, useScrollProgress } from '../useScrollProgress'

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
  const ref = useRef<HTMLDivElement>(null)

  /** The window is tight and late (0.28 → 0.68) so the gather happens while the
   *  diagram sits mid-viewport, where the reader is actually looking — not as
   *  it enters from the bottom edge, which is where an untuned scrub finishes
   *  its whole story off screen. */
  const p = useScrollProgress(ref, { mode: 'through', from: 0.28, to: 0.68 })

  /** One chip lands per beat, so the column assembles in front of you instead
   *  of snapping into place all at once. */
  const gathered = steps(p, CARRIED.length)
  const held = gathered >= CARRIED.length

  return (
    <div ref={ref} className="converge" aria-hidden="true">
      {/* The line they find. Dashed where things are still loose, solid the
          moment they're held — the funnel, drawn as one stroke. */}
      <div className="converge-rule" style={{ opacity: 0.25 + 0.75 * (gathered / CARRIED.length) }} />

      {CARRIED.map((c, i) => {
        /* Each chip owns one beat. No transitionDelay any more — the stagger
           used to come from CSS because one boolean flipped everything at once;
           now the scrub IS the stagger, and a delay on top of it would make a
           chip lag the scroll that moved it. */
        const on = i < gathered
        return (
          <span
            key={c.text}
            className="converge-chip"
            style={{
              left: on ? HELD_X : `${c.loose.x}%`,
              top: `${on ? heldY(i) : c.loose.y}%`,
              opacity: on ? 1 : 0.5,
              borderColor: on ? 'var(--line)' : 'transparent',
              background: on ? 'var(--surface)' : 'transparent',
              color: on ? 'var(--text)' : 'var(--muted)',
            }}
          >
            <span
              className="converge-dot"
              style={{ background: on ? 'var(--accent)' : 'var(--line-strong)' }}
            />
            {c.text}
          </span>
        )
      })}

      <span className="converge-caption" style={{ opacity: held ? 1 : 0 }}>
        One inbox
      </span>
    </div>
  )
}
