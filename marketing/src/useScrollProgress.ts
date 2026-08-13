/**
 * Scroll progress, 0 → 1, for a visual whose *sequence* is the argument.
 *
 * The page has one motion doctrine and this hook is half of it (useReveal is
 * the other half):
 *
 *   SCRUB (this)   — the reader drives, because watching the steps happen IS
 *                    the point. Scatter's four tools failing one at a time.
 *                    Converge's loose things finding one line.
 *   REVEAL         — one beat on entry, because the END STATE is the point. A
 *                    number, a filled week, a bar. Scrubbing one of these makes
 *                    the reader work for a fact they could have just read.
 *
 * Getting that backwards is precisely what makes a site feel like scroll-
 * jacking: the reader is made to labour through an animation that had nothing
 * to say. So: if you can screenshot the end and lose nothing, use useReveal.
 *
 * Two geometries, because the two shapes of argument need different room:
 *
 *   'sticky'   — the element is a TRACK taller than the viewport with a sticky
 *                frame inside it. Progress is how far the frame has travelled
 *                through the track. Use when the visual must hold still while
 *                several beats play (Scatter). Costs the reader real scroll
 *                distance, so never two of these back to back.
 *   'through'  — the element is normal height and progress is how far it has
 *                crossed the viewport. Use when the beats can play while the
 *                thing is still moving up the screen (Converge). Costs no
 *                layout and no extra page height, which is why it's the default
 *                choice — reach for 'sticky' only when 'through' isn't enough
 *                room.
 *
 * Returns 1 (the finished state) and attaches no listeners when the reader has
 * reduced motion on, or on a phone. Both are deliberate: a sticky frame
 * fighting iOS's address-bar resize is worse than no motion, and a scrub is a
 * pointing-device idiom. The finished state is also what the prerenderer
 * serialises, so a crawler that runs no JS sees a complete picture.
 */

import { useEffect, useState, type RefObject } from 'react'

type Options = {
  mode?: 'sticky' | 'through'
  /** Dead zone before the first beat — lets the reader see the untouched
   *  starting state before anything happens to it. */
  from?: number
  /** Dead zone after the last beat, so the finished state holds on screen
   *  instead of flicking past at the moment it becomes true. */
  to?: number
}

export function useScrollProgress(
  ref: RefObject<HTMLElement | null>,
  { mode = 'through', from = 0.12, to = 0.82 }: Options = {},
) {
  const [p, setP] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const narrow = !!window.matchMedia?.('(max-width: 767px)').matches
    if (reduced || narrow) {
      setP(1)
      return
    }

    let frame = 0
    const measure = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight

      let raw: number
      if (mode === 'sticky') {
        const travel = r.height - vh
        if (travel <= 0) {
          setP(1)
          return
        }
        raw = -r.top / travel
      } else {
        /** 0 when the element's top edge is at the bottom of the viewport,
         *  1 when its bottom edge has left the top. */
        const travel = vh + r.height
        if (travel <= 0) {
          setP(1)
          return
        }
        raw = (vh - r.top) / travel
      }

      const windowed = (raw - from) / Math.max(0.0001, to - from)
      setP(Math.min(1, Math.max(0, windowed)))
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
  }, [ref, mode, from, to])

  return p
}

/** Progress → "how many of N beats have fired", for a stepped scrub.
 *
 *  Stepped, not continuous, on purpose: a class flip that CSS then transitions
 *  reads as deliberate, while a per-frame style write reads as the page being
 *  dragged around. It also means every beat is a state the static fallback can
 *  land on, which is what makes reduced-motion and the prerender honest rather
 *  than approximate. */
export function steps(p: number, count: number) {
  return Math.min(count, Math.floor(p * (count + 1)))
}
