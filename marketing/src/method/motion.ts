/**
 * The method page's motion. Same rules as home/motion.ts: the markup already
 * holds every FINAL state, everything here is a `from` toward it, transforms
 * and opacity only, and reduced motion simply never runs this file.
 */
import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const q = <T extends Element = HTMLElement>(root: ParentNode, sel: string) =>
  Array.from(root.querySelectorAll<T>(sel))

export function initMethodMotion(root: HTMLElement): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {}

  document.documentElement.classList.add('hm-motion')

  const lenis = new Lenis({ lerp: 0.11, anchors: { offset: 0 } })
  lenis.on('scroll', ScrollTrigger.update)
  const tick = (t: number) => lenis.raf(t * 1000)
  gsap.ticker.add(tick)
  gsap.ticker.lagSmoothing(0)

  const ctx = gsap.context(() => {
    gsap.to('[data-progress]', {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { trigger: root, start: 'top top', end: 'bottom bottom', scrub: 0.3 },
    })

    /* the premise — words light as they're read */
    gsap.fromTo(
      '[data-manifesto] .w',
      { opacity: 0.12 },
      {
        opacity: 1,
        stagger: 0.05,
        ease: 'none',
        scrollTrigger: { trigger: '[data-manifesto]', start: 'top 70%', end: 'bottom 75%', scrub: 0.5 },
      },
    )

    /* the index follows the habit you're reading */
    const index = root.querySelector<HTMLElement>('[data-index]')
    q(root, '[data-habit]').forEach((el) => {
      ScrollTrigger.create({
        trigger: el,
        start: 'top 55%',
        end: 'bottom 55%',
        onToggle: (self) => {
          if (self.isActive && index) index.dataset.on = el.dataset.habit ?? '0'
        },
      })
    })

    /* habit 01 — the sentence types itself, then lands as structure */
    const cap = root.querySelector<HTMLElement>('[data-cap-text]')
    if (cap) {
      const full = cap.textContent ?? ''
      const o = { n: 0 }
      gsap
        .timeline({ scrollTrigger: { trigger: '.mth-cap', start: 'top 75%' } })
        .fromTo(
          o,
          { n: 0 },
          {
            n: full.length,
            duration: full.length * 0.045,
            ease: 'none',
            onUpdate: () => {
              cap.textContent = full.slice(0, Math.round(o.n))
            },
          },
        )
        .from('[data-chip]', { opacity: 0, y: 14, scale: 0.92, stagger: 0.1, duration: 0.45, ease: 'back.out(1.8)' }, '+=0.15')
    }

    /* habit 02 — the chain steps down */
    gsap.from('[data-chain]', {
      opacity: 0,
      x: -20,
      stagger: 0.14,
      duration: 0.6,
      ease: 'power3.out',
      scrollTrigger: { trigger: '.mth-chain', start: 'top 80%' },
    })

    /* habit 03 — the work lands in the open hours */
    gsap.from('[data-blk]', {
      opacity: 0,
      scale: 0.8,
      stagger: 0.12,
      duration: 0.5,
      ease: 'back.out(1.7)',
      scrollTrigger: { trigger: '.mth-week', start: 'top 70%' },
    })

    /* habit 04 — the day, from brief to close */
    gsap.from('[data-moment]', {
      opacity: 0,
      y: 16,
      stagger: 0.18,
      duration: 0.55,
      ease: 'power3.out',
      scrollTrigger: { trigger: '.mth-day', start: 'top 78%' },
    })

    /* habit 05 — the number counts, the rows and Friday arrive */
    q(root, '[data-count]').forEach((el) => {
      const to = Number(el.dataset.count)
      const o = { v: 0 }
      gsap.to(o, {
        v: to,
        duration: 1.8,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 85%' },
        onUpdate: () => {
          el.textContent = String(Math.round(o.v))
        },
      })
    })
    gsap.from('[data-pace]', {
      opacity: 0,
      y: 10,
      stagger: 0.08,
      duration: 0.5,
      ease: 'power3.out',
      scrollTrigger: { trigger: '.mth-pace', start: 'top 85%' },
    })
    gsap.from('[data-moved]', {
      opacity: 0,
      x: -16,
      stagger: 0.14,
      duration: 0.5,
      ease: 'power3.out',
      scrollTrigger: { trigger: '.mth-fri', start: 'top 90%' },
    })

    /* why it's hard — five tools arrive apart; then the word */
    gsap.from('[data-scatter]', {
      opacity: 0,
      y: 30,
      rotate: (i: number) => (i % 2 ? 2 : -2),
      stagger: 0.1,
      duration: 0.7,
      ease: 'power3.out',
      scrollTrigger: { trigger: '.mth-scatter', start: 'top 80%' },
    })
    gsap.fromTo(
      '[data-villain-word]',
      { scale: 0.6, opacity: 0.15, transformOrigin: '0% 100%' },
      {
        scale: 1,
        opacity: 1,
        ease: 'none',
        scrollTrigger: { trigger: '.mth-villain-h', start: 'top 90%', end: 'top 35%', scrub: 0.5 },
      },
    )
    gsap.fromTo(
      '[data-villain] .w',
      { opacity: 0.15 },
      {
        opacity: 1,
        stagger: 0.05,
        ease: 'none',
        scrollTrigger: { trigger: '.mth-villain-def', start: 'top 80%', end: 'bottom 55%', scrub: 0.5 },
      },
    )

    /* one system — the task walks the five habits */
    gsap.from('[data-thread-step]', {
      opacity: 0,
      y: 30,
      stagger: 0.15,
      duration: 0.6,
      ease: 'power3.out',
      scrollTrigger: { trigger: '[data-thread]', start: 'top 78%' },
    })

    /* generic rises + headings */
    q(root, '[data-rise]').forEach((el, i) => {
      gsap.from(el, {
        opacity: 0,
        y: 40,
        duration: 0.9,
        delay: (i % 4) * 0.06,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 88%' },
      })
    })
    q(root, '.h2, .mth-habit-t').forEach((el) => {
      if (el.closest('.hero')) return
      gsap.from(el, { opacity: 0, y: 24, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 90%' } })
    })

    gsap.fromTo(
      '.cl-big',
      { scale: 0.72, opacity: 0.2 },
      {
        scale: 1,
        opacity: 1,
        ease: 'none',
        scrollTrigger: { trigger: '[data-close]', start: 'top bottom', end: 'top 25%', scrub: 0.5 },
      },
    )
  }, root)

  document.fonts?.ready.then(() => ScrollTrigger.refresh())

  return () => {
    ctx.revert()
    gsap.ticker.remove(tick)
    lenis.destroy()
    document.documentElement.classList.remove('hm-motion')
  }
}
