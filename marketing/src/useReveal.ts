/**
 * Sections rise as they arrive.
 *
 * The default state of an un-observed element is **visible**, and that is the
 * load-bearing detail. This page is prerendered (`scripts/prerender.mjs`) and
 * Google's OAuth branding reviewer fetches `/` without running JS — a CSS
 * default of `opacity: 0` would ship them a blank page and read as "the home
 * page does not explain the app's purpose," which is the exact failure the
 * prerenderer exists to prevent (see routes.ts). So the hook adds the `.rise`
 * class itself on mount, which is the only moment we know JS is running, and
 * removes the element from the flow of the argument only once it can put it
 * back.
 *
 * One observer for the whole page, not one per section, and each element is
 * unobserved the moment it has arrived — a reveal that re-plays on scroll-up is
 * a page that won't hold still while you read it.
 */

import { useEffect, useRef } from 'react'

export function useReveal<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    el.classList.add('rise')

    /** Already on screen at mount (the hero, and anything above the fold on a
     *  tall desktop): let it play immediately rather than waiting for a scroll
     *  that may never come. */
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
      requestAnimationFrame(() => el.classList.add('is-in'))
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in')
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.06 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return ref
}
