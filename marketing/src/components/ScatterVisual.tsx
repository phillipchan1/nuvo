/**
 * The stack that can't answer the question.
 *
 * This is the recognition beat, and it is the one section on the page whose job
 * is to end *unresolved*. Four good tools sit on the paper — a list, a board, a
 * calendar, a note — and one question walks across them asking each in turn.
 * Every one of them answers with what it knows, and none of them answers what
 * was asked. Then the question is left standing alone.
 *
 * Why it has to move: "no amount of syncing makes a stack into a system" is an
 * abstraction, and the reader has heard some version of it from every tool that
 * wanted to replace their other tools. Watching a single question fail four
 * times in a row is not an abstraction — it's the reader's own Monday morning,
 * and they supply the frustration themselves. A still frame of this is four
 * boxes of sample data, which argues nothing.
 *
 * Deliberately NOT resolved here. ConvergeVisual one section below is the
 * gather, and the rest of the page is the answer; resolving it inside this
 * component would spend the tension two screens early and make the sections
 * that follow feel like a recap.
 *
 * A DIAGRAM, so it wears no card and no glass (design-language.md, "dissolve,
 * don't frame") — hairlines on the paper. The four sources are drawn as
 * *fragments* of interfaces, never as logos: naming Todoist and Asana would
 * invite a feature comparison, and landscape.md §4 is clear that a comparison
 * is a fight we currently lose on integrations, mobile depth and onboarding.
 * The reader recognizes the shapes without being told whose they are.
 *
 * Scroll-scrubbed on a desktop: the reader drives the interrogation, so the
 * pacing belongs to them rather than to a timer they can fall behind. On a
 * phone, and under `prefers-reduced-motion`, it lands on the finished state —
 * all four answered, the question still open — which is also exactly what the
 * prerendered HTML contains for a crawler that runs no JS.
 */

import { useEffect, useRef, useState } from 'react'
import { COMMUNITY, CRAFT, FAMILY, WORK } from './hues'

/** The question every one of these tools is about to fail. Deliberately one
 *  sentence and deliberately compound — the *conjunction* is the whole point.
 *  "Is it moving" is answerable by a board. "What's on Thursday" is answerable
 *  by a calendar. Nothing on the desk can hold both halves at once. */
const QUESTION = 'Is the thing I committed to in January still moving, given what’s on Thursday?'

type Source = {
  /** What the reader recognizes it as, without a brand name. */
  kind: string
  /** The interface fragment, drawn from the shape not the product. */
  rows: { text: string; meta?: string; color?: string; done?: boolean }[]
  /** What it says back. Generous about what it genuinely knows — a strawman
   *  would let the reader dismiss the whole section. */
  knows: string
  /** Where it stops. This is the sentence doing the work. */
  stops: string
}

const SOURCES: Source[] = [
  {
    kind: 'The list',
    rows: [
      { text: 'Ship the pricing page', done: false },
      { text: 'Call David back', done: false },
      { text: 'Book the flights', done: true },
      { text: 'Look at the Q3 thing', done: false },
    ],
    knows: 'Knows everything you wrote down.',
    stops: 'Has no idea which of them is the one that matters, or when any of it happens.',
  },
  {
    kind: 'The board',
    rows: [
      { text: 'Meridian launch', meta: 'In progress', color: WORK },
      { text: 'Fall series', meta: 'In progress', color: COMMUNITY },
      { text: 'Dayspring v2', meta: 'Backlog', color: CRAFT },
    ],
    knows: 'Knows the project exists, and that you moved it to “In progress”.',
    stops: 'Last touched three weeks ago. It has never once seen your Thursday.',
  },
  {
    kind: 'The calendar',
    rows: [
      { text: 'Standup', meta: '9:00', color: WORK },
      { text: 'Vendor call', meta: '11:00', color: WORK },
      { text: '—', meta: '1:30' },
      { text: 'Pickup', meta: '3:15', color: FAMILY },
    ],
    knows: 'Knows Thursday exactly, down to the minute.',
    stops: 'Doesn’t know what a single hour of it was for, or what it cost you.',
  },
  {
    kind: 'The note',
    rows: [
      { text: 'the Q3 thing — don’t forget' },
      { text: 'ask about the contract?' },
      { text: 'idea: split the onboarding' },
    ],
    knows: 'Knows you were worried about it at 11pm.',
    stops: 'That is the entire extent of what it knows.',
  },
]

/** Scrub geometry. The wrapper is taller than the viewport; progress is how far
 *  the sticky frame has travelled through it, so one source is interrogated per
 *  quarter-turn of scroll and the last beat holds while the question stands.
 *
 *  340vh, not 260: at 260 the whole interrogation resolved inside a single
 *  trackpad flick (~250px of scroll per source), which reads as a flicker rather
 *  than as four tools failing one at a time. This gives each source ~430px —
 *  slow enough to read the reply before the next one starts, short enough that
 *  nobody feels held hostage by the section. */
const TRACK_VH = 340

export default function ScatterVisual() {
  /** -1 = nothing asked yet; 0..3 = this source is answering; 4 = all done. */
  const [asked, setAsked] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return

    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    /** The scrub needs vertical room the phone doesn't have, and a sticky frame
     *  fighting iOS's address-bar resize is worse than no motion at all. Below
     *  the app's own mobile breakpoint the section is simply true on arrival. */
    const narrow = window.matchMedia?.('(max-width: 767px)').matches

    if (reduced || narrow) {
      setAsked(SOURCES.length)
      return
    }

    let frame = 0
    const measure = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      const travel = r.height - window.innerHeight
      if (travel <= 0) {
        setAsked(SOURCES.length)
        return
      }
      /** 0 at the moment the frame sticks, 1 when it releases. */
      const p = Math.min(1, Math.max(0, -r.top / travel))
      /** A lead-in so the reader sees the untouched desk before anything is
       *  asked, and a tail so the unanswered question holds on screen. */
      const t = (p - 0.12) / 0.7
      setAsked(t <= 0 ? -1 : Math.min(SOURCES.length, Math.floor(t * (SOURCES.length + 1))))
    }

    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const done = asked >= SOURCES.length

  return (
    <div ref={wrapRef} className="scatter-track" style={{ ['--scatter-vh' as string]: `${TRACK_VH}vh` }}>
      <div className="scatter-frame">
        {/* The question rides above the desk the whole time — it's the subject
            of the section, not a caption on it. */}
        <p
          className={`scatter-q serif ${asked >= 0 ? 'is-asked' : ''} ${done ? 'is-open' : ''}`}
          aria-hidden={false}
        >
          {QUESTION}
        </p>

        <ul className="scatter-desk">
          {SOURCES.map((s, i) => {
            const answering = asked === i
            const answered = asked > i
            return (
              <li
                key={s.kind}
                className={`scatter-src ${answering ? 'is-answering' : ''} ${answered ? 'is-answered' : ''}`}
              >
                <p className="section-label scatter-kind">{s.kind}</p>

                {/* The interface fragment. Shapes, not logos. */}
                <ul className="scatter-rows" aria-hidden="true">
                  {s.rows.map((r, j) => (
                    <li key={j} className="scatter-row">
                      {r.color ? (
                        <span className="scatter-dot" style={{ background: r.color }} />
                      ) : (
                        <span className={`scatter-box ${r.done ? 'is-done' : ''}`} />
                      )}
                      <span className={`scatter-text ${r.done ? 'is-done' : ''}`}>{r.text}</span>
                      {r.meta && <span className="scatter-meta">{r.meta}</span>}
                    </li>
                  ))}
                </ul>

                {/* The reply. Two lines: what it genuinely knows, then the wall. */}
                <div className="scatter-reply">
                  <p className="scatter-knows">{s.knows}</p>
                  <p className="scatter-stops">{s.stops}</p>
                </div>
              </li>
            )
          })}
        </ul>

        <p className={`scatter-verdict ${done ? 'is-open' : ''}`}>
          Four good tools. Not one of them can answer it — because the answer isn’t inside any of
          them.
        </p>
      </div>
    </div>
  )
}
