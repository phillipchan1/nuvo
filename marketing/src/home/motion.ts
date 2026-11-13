/**
 * The home page's motion, in one place and in page order.
 *
 * Rules this file keeps:
 *  - The markup already holds every FINAL state. Everything here is a
 *    `from`/`fromTo` toward it, so reduced motion (and no JS) is simply "don't
 *    run this file" — never a second layout.
 *  - Transforms and opacity only, except four absolutely-positioned task cards
 *    in the cascade whose box moves (four elements; measured, cheap).
 *  - No backdrop-filter anywhere in a scrubbed scene (docs/performance.md).
 *  - Pins are created top-to-bottom, the order ScrollTrigger needs.
 */
import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { CASCADE_TASKS, DAY_MOMENTS, WEEK_DRAFT, place } from './data'
import { CAPTURE_TEXT } from './Scenes'

gsap.registerPlugin(ScrollTrigger)

const q = <T extends Element = HTMLElement>(root: ParentNode, sel: string) =>
  Array.from(root.querySelectorAll<T>(sel))

function fmtClock(h: number) {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60 / 5) * 5
  const m = mm === 60 ? 0 : mm
  const H = mm === 60 ? hh + 1 : hh
  const h12 = H > 12 ? H - 12 : H
  return { t: `${h12}:${String(m).padStart(2, '0')}`, ap: H >= 12 ? 'pm' : 'am' }
}

export function initMotion(root: HTMLElement): () => void {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce) return () => {}

  document.documentElement.classList.add('hm-motion')

  /* ── smooth scroll, driven by GSAP's ticker so pins and scroll agree ── */
  const lenis = new Lenis({ lerp: 0.11, anchors: { offset: 0 } })
  lenis.on('scroll', ScrollTrigger.update)
  const tick = (t: number) => lenis.raf(t * 1000)
  gsap.ticker.add(tick)
  gsap.ticker.lagSmoothing(0)

  const mm = gsap.matchMedia()
  const disposers: (() => void)[] = []

  const ctx = gsap.context(() => {
    /* progress hairline */
    gsap.to('[data-progress]', {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { trigger: root, start: 'top top', end: 'bottom bottom', scrub: 0.3 },
    })

    /* ── HERO ── the entrance is CSS (home.css, .js-motion) so it runs before
       this bundle lands. Here: the device arrives tilted back and lies flat
       as you scroll into it. */
    gsap.fromTo(
      '[data-hero-device]',
      { rotateX: 24, scale: 0.88, transformOrigin: '50% 0%' },
      {
        rotateX: 0,
        scale: 1,
        ease: 'none',
        scrollTrigger: { trigger: '[data-hero-stage]', start: 'top 85%', end: 'top 15%', scrub: 0.6 },
      },
    )
    q(root, '[data-float]').forEach((el) => {
      const f = Number(el.dataset.float)
      gsap.to(el, {
        y: -180 * f,
        ease: 'none',
        scrollTrigger: { trigger: '[data-hero-stage]', start: 'top bottom', end: 'bottom top', scrub: true },
      })
    })

    /* pointer parallax on the floating cards — hover devices only */
    if (window.matchMedia('(hover: hover)').matches) {
      const floats = q(root, '[data-float]')
      const xs = floats.map((el) => gsap.quickTo(el, 'x', { duration: 0.8, ease: 'power3' }))
      const onMove = (e: PointerEvent) => {
        const nx = e.clientX / window.innerWidth - 0.5
        floats.forEach((el, i) => xs[i](nx * 40 * Number(el.dataset.float)))
      }
      window.addEventListener('pointermove', onMove)
      disposers.push(() => window.removeEventListener('pointermove', onMove))
      // magnetic buttons
      q(root, '.btn-primary, .btn-ghost').forEach((btn) => {
        const bx = gsap.quickTo(btn, 'x', { duration: 0.5, ease: 'power3' })
        const by = gsap.quickTo(btn, 'y', { duration: 0.5, ease: 'power3' })
        btn.addEventListener('pointermove', (e) => {
          const r = btn.getBoundingClientRect()
          bx((e.clientX - r.left - r.width / 2) * 0.25)
          by((e.clientY - r.top - r.height / 2) * 0.35)
        })
        btn.addEventListener('pointerleave', () => {
          bx(0)
          by(0)
        })
      })
    }

    /* ── MARQUEE ── endless, and it leans into how fast you scroll */
    q(root, '[data-marquee]').forEach((row) => {
      const dir = Number(row.dataset.marquee)
      const tracks = q(row, '.mq-track')
      const tween = gsap.fromTo(
        tracks,
        { xPercent: dir > 0 ? 0 : -100 },
        { xPercent: dir > 0 ? -100 : 0, duration: 38, ease: 'none', repeat: -1 },
      )
      ScrollTrigger.create({
        trigger: row,
        start: 'top bottom',
        end: 'bottom top',
        onUpdate: (self) => {
          const v = Math.min(Math.abs(self.getVelocity()) / 250, 7)
          gsap.to(tween, {
            timeScale: 1 + v,
            duration: 0.25,
            overwrite: true,
            onComplete: () => void gsap.to(tween, { timeScale: 1, duration: 1.4, ease: 'power2.out' }),
          })
        },
      })
    })

    /* ── MANIFESTO ── words light as they're read */
    gsap.fromTo(
      '[data-manifesto] .w',
      { opacity: 0.12 },
      {
        opacity: 1,
        stagger: 0.1,
        ease: 'none',
        scrollTrigger: { trigger: '[data-manifesto]', start: 'top 70%', end: 'bottom 75%', scrub: 0.5 },
      },
    )
    gsap.from('.mf-coda', {
      opacity: 0,
      y: 30,
      duration: 1,
      ease: 'power3.out',
      scrollTrigger: { trigger: '.mf-coda', start: 'top 85%' },
    })

    /* ── THE SYSTEM ── pinned, four stages, one initiative down to the hour */
    mm.add(
      { desktop: '(min-width: 900px)', mobile: '(max-width: 899px)' },
      (c) => {
        const desktop = c.conditions?.desktop
        const steps = q(root, '[data-step]')
        steps[0]?.classList.add('is-on')
        const tl = gsap.timeline({
          defaults: { ease: 'power2.inOut' },
          scrollTrigger: {
            trigger: '[data-cascade]',
            pin: '.sys-pin',
            start: 'top top',
            end: desktop ? '+=320%' : '+=260%',
            scrub: 0.8,
            onUpdate: (self) => {
              const i = Math.min(3, Math.floor(self.progress * 4.2))
              steps.forEach((s, k) => s.classList.toggle('is-on', k === i))
              steps.forEach((s, k) => s.classList.toggle('is-past', k < i))
            },
          },
        })

        // 1 · initiative
        tl.fromTo('.cas-init', { opacity: 0, y: 40, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 1 })
        tl.fromTo('[data-ring]', { strokeDashoffset: 100 }, { strokeDashoffset: 38, duration: 1 }, '<0.3')
        // 2 · projects
        tl.fromTo('.cas-lines', { opacity: 0, scaleY: 0.2, transformOrigin: '50% 14%' }, { opacity: 1, scaleY: 1, duration: 0.6 }, '+=0.2')
        tl.fromTo('.cas-proj', { opacity: 0, y: -30 }, { opacity: 1, y: 0, duration: 0.8, stagger: 0.15 }, '<0.3')
        // 3 · tasks hang under their projects
        const tasks = q(root, '.cas-task')
        tasks.forEach((el, i) => {
          const t = CASCADE_TASKS[i]
          gsap.set(el, { left: `${t.list.left}%`, top: `${t.list.top}%`, width: `${t.list.width}%`, height: `${t.list.height}%` })
        })
        tl.fromTo(tasks, { opacity: 0, y: -16 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.12 }, '+=0.3')
        tl.to({}, { duration: 0.4 })
        // 4 · the week appears, and every task drops onto its hour
        tl.fromTo('.cas-grid', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.7 })
        tl.fromTo('.cas-meet', { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.08 }, '<0.3')
        tl.to('.cas-proj, .cas-init, .cas-lines', { opacity: 0.35, duration: 0.5 }, '<')
        tasks.forEach((el, i) => {
          const t = CASCADE_TASKS[i]
          tl.to(
            el,
            {
              left: `${t.cal.left}%`,
              top: `${t.cal.top}%`,
              width: `${t.cal.width}%`,
              height: `${t.cal.height}%`,
              duration: 1,
              ease: 'power3.inOut',
            },
            i === 0 ? '+=0.1' : '<0.18',
          )
        })
        tl.fromTo('.cas', { '--landed': 0 } as gsap.TweenVars, { '--landed': 1, duration: 0.4 } as gsap.TweenVars, '-=0.3')
        tl.to({}, { duration: 0.6 })
      },
    )

    /* ── UNASHAMED ── three words that slide against each other */
    q(root, '.un-line').forEach((el) => {
      const dir = Number(el.dataset.dir)
      gsap.fromTo(
        el,
        { xPercent: dir * -18 },
        {
          xPercent: dir * 18,
          ease: 'none',
          scrollTrigger: { trigger: '[data-unashamed]', start: 'top bottom', end: 'bottom top', scrub: 0.4 },
        },
      )
    })

    /* ── CAPTURE ── types itself, parses itself, lands on Friday — on a loop */
    const typed = root.querySelector<HTMLElement>('[data-cap-typed]')
    if (typed) {
      const state = { n: 0 }
      const cap = gsap.timeline({ repeat: -1, repeatDelay: 1.6, paused: true })
      cap.set('[data-chip]', { opacity: 0, y: 10, scale: 0.9 })
      cap.set('[data-cap-block]', { opacity: 0, y: -40, scale: 0.9 })
      cap.set(state, { n: 0 })
      cap.to(state, {
        n: CAPTURE_TEXT.length,
        duration: 2.2,
        ease: 'none',
        onUpdate: () => {
          typed.textContent = CAPTURE_TEXT.slice(0, Math.round(state.n))
        },
      })
      cap.to('[data-chip]', { opacity: 1, y: 0, scale: 1, duration: 0.45, stagger: 0.12, ease: 'back.out(2)' }, '+=0.25')
      cap.to('[data-cap-block]', { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'back.out(1.6)' }, '+=0.2')
      cap.to({}, { duration: 2.4 })
      cap.to('[data-chip], [data-cap-block]', { opacity: 0, duration: 0.35 })
      ScrollTrigger.create({
        trigger: '[data-capture]',
        start: 'top 75%',
        end: 'bottom top',
        onToggle: (self) => (self.isActive ? cap.play() : cap.pause()),
      })
      disposers.push(() => cap.kill())
    }
    gsap.from('.cp-copy > *', {
      opacity: 0,
      y: 30,
      stagger: 0.1,
      duration: 0.9,
      ease: 'power3.out',
      scrollTrigger: { trigger: '[data-capture]', start: 'top 75%' },
    })

    /* ── PLAN THE WEEK ── pinned: pull → place → walk → commit */
    mm.add('(min-width: 900px)', () => weekTimeline(root, true))
    mm.add('(max-width: 899px)', () => weekTimeline(root, false))

    /* ── THE DAY ── a clock that runs as you scroll */
    const clock = root.querySelector<HTMLElement>('[data-clock]')
    const first = DAY_MOMENTS[0].h
    const last = DAY_MOMENTS[DAY_MOMENTS.length - 1].h
    ScrollTrigger.create({
      trigger: '.day-list',
      start: 'top 60%',
      end: 'bottom 60%',
      scrub: true,
      onUpdate: (self) => {
        if (!clock) return
        const { t, ap } = fmtClock(first + (last - first) * self.progress)
        clock.innerHTML = `${t}<span>${ap}</span>`
        gsap.set('[data-day-fill]', { scaleX: self.progress })
      },
    })
    q(root, '[data-moment]').forEach((m) => {
      gsap.from(m, {
        opacity: 0,
        y: 60,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: m, start: 'top 80%', toggleClass: { targets: m, className: 'is-lit' } },
      })
      ScrollTrigger.create({ trigger: m, start: 'top 60%', end: 'bottom 40%', toggleClass: { targets: m, className: 'is-lit' } })
      const chat = m.querySelector('.chat')
      if (chat) {
        const ctl = gsap.timeline({ scrollTrigger: { trigger: chat, start: 'top 75%' } })
        ctl.from(chat.querySelector('.chat-me'), { opacity: 0, x: 40, duration: 0.6, ease: 'power3.out' })
        ctl.from(chat.querySelector('.chat-nuvo'), { opacity: 0, y: 20, duration: 0.6, ease: 'power3.out' }, '+=0.5')
        ctl.from(q(chat, '.chat-nuvo li'), { opacity: 0, x: -14, stagger: 0.15, duration: 0.4 }, '-=0.2')
        ctl.from(chat.querySelector('.undo'), { opacity: 0, scale: 0.7, duration: 0.4, ease: 'back.out(2)' })
      }
    })

    /* ── ARITHMETIC ── the number counts, the bars fill */
    q(root, '[data-count]').forEach((el) => {
      const to = Number(el.dataset.count)
      const isInt = Number.isInteger(to)
      const o = { v: 0 }
      gsap.to(o, {
        v: to,
        duration: 1.8,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 85%' },
        onUpdate: () => {
          el.textContent = isInt ? String(Math.round(o.v)) : o.v.toFixed(1).replace(/\.0$/, '')
        },
      })
    })
    gsap.from('[data-bar]', {
      scaleX: 0,
      transformOrigin: '0 50%',
      duration: 1.4,
      ease: 'expo.out',
      stagger: 0.12,
      scrollTrigger: { trigger: '.fri', start: 'top 80%' },
    })
    gsap.from('[data-moved]', {
      opacity: 0,
      x: -20,
      duration: 0.6,
      stagger: 0.15,
      ease: 'power3.out',
      scrollTrigger: { trigger: '.fri-moved', start: 'top 90%' },
    })
    gsap.from('.ar-h2', {
      opacity: 0,
      y: 50,
      duration: 1.1,
      ease: 'expo.out',
      scrollTrigger: { trigger: '[data-arith]', start: 'top 75%' },
    })

    /* generic rises */
    q(root, '[data-rise]').forEach((el, i) => {
      gsap.from(el, {
        opacity: 0,
        y: 40,
        duration: 0.9,
        delay: (i % 4) * 0.08,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 88%' },
      })
    })
    q(root, '.h2, .k-label').forEach((el) => {
      if (el.closest('.hero, .sys-pin, .wkp-pin, .dy-sticky')) return
      gsap.from(el, { opacity: 0, y: 24, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 90%' } })
    })

    /* ── CLOSE ── the last line grows into the screen */
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

  // Fraunces landing late moves every trigger; re-measure once it has.
  document.fonts?.ready.then(() => ScrollTrigger.refresh())

  return () => {
    disposers.forEach((d) => d())
    mm.revert()
    ctx.revert()
    gsap.ticker.remove(tick)
    lenis.destroy()
    document.documentElement.classList.remove('hm-motion')
  }
}

/** Plan the week, as one scrubbed timeline. Desktop pins; the phone pins a
 *  shorter run with the rail folded under the grid. */
function weekTimeline(root: HTMLElement, desktop: boolean) {
  const steps = q(root, '[data-wstep]')
  steps[0]?.classList.add('is-on')
  const blocks = q(root, '[data-pw-block]')
  const items = q(root, '[data-pw-item]')
  const oks = q(root, '[data-pw-ok]')
  const alts = q(root, '[data-pw-alt]')
  const cursor = root.querySelector<HTMLElement>('[data-pw-cursor]')
  const pctEl = root.querySelector<HTMLElement>('[data-pw-pct]')
  const fill = root.querySelector<HTMLElement>('[data-pw-fill]')

  const tl = gsap.timeline({
    defaults: { ease: 'power2.inOut' },
    scrollTrigger: {
      trigger: '[data-week]',
      pin: '.wkp-pin',
      start: 'top top',
      end: desktop ? '+=300%' : '+=240%',
      scrub: 0.8,
      onUpdate: (self) => {
        const p = self.progress
        const i = p < 0.18 ? 0 : p < 0.38 ? 1 : p < 0.86 ? 2 : 3
        steps.forEach((s, k) => {
          s.classList.toggle('is-on', k === i)
          s.classList.toggle('is-past', k < i)
        })
      },
    },
  })

  const meter = { v: 0 }
  const setMeter = () => {
    if (pctEl) pctEl.textContent = `${Math.round(meter.v)}%`
    if (fill) fill.style.width = `${meter.v}%`
  }

  // 1 · pull: the rail fills
  tl.fromTo(items, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5, stagger: 0.12 })
  tl.fromTo(oks, { opacity: 0, scale: 0.4 }, { opacity: 0, scale: 0.4, duration: 0.01 }, '<')

  // 2 · place: drafts appear, dashed, in the open gaps
  gsap.set(blocks, { '--held': 0 } as gsap.TweenVars)
  blocks.forEach((el, i) => {
    const d = WEEK_DRAFT[i]
    if (d.from) {
      const p = place(d.from)
      gsap.set(el, { left: p.left, top: p.top })
    }
  })
  tl.fromTo(
    blocks,
    { opacity: 0, scale: 0.85 },
    { opacity: 1, scale: 1, duration: 0.5, stagger: 0.1, ease: 'back.out(1.6)' },
    '+=0.2',
  )
  tl.fromTo(meter, { v: 0 }, { v: 74, duration: 1.1, onUpdate: setMeter, ease: 'power1.out' }, '<')

  // 3 · walk: the cursor visits each block; ↵ keeps it
  tl.set(cursor, { opacity: 1 })
  blocks.forEach((el, i) => {
    const d = WEEK_DRAFT[i]
    const at = place(d.from ?? d)
    tl.to(cursor, { left: at.left, top: at.top, width: at.width, height: at.height, duration: 0.45 })
    if (d.alts && d.from) {
      // show the other places it fits, then take number 2
      tl.fromTo(alts, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.35, stagger: 0.08 })
      const fin = place(d)
      tl.to([el, cursor], { left: fin.left, top: fin.top, duration: 0.6, ease: 'power3.inOut' }, '+=0.15')
      tl.to(alts, { opacity: 0, duration: 0.3 })
    }
    tl.fromTo(el, { '--held': 0 } as gsap.TweenVars, { '--held': 1, duration: 0.25 } as gsap.TweenVars)
    tl.fromTo(oks[i], { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.25, ease: 'back.out(3)' }, '<')
  })
  tl.to(cursor, { opacity: 0, duration: 0.2 })

  // 4 · commit: the meter settles and the verdict lands
  tl.fromTo('.pw-meter', { '--glow': 0 } as gsap.TweenVars, { '--glow': 1, duration: 0.4 } as gsap.TweenVars)
  tl.to({}, { duration: 0.6 })

}
