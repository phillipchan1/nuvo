import { useEffect, useRef, type CSSProperties } from 'react'
import { NuvoMark } from '@nuvo/mark'
import { WORK } from './components/hues'
import './home.css'
import { ACCESS_MAILTO, APP_URL } from './config'
import { appUrlWithCode } from './referral'
import { CtaGroup, NavOpenAppCtas } from './components/CtaButtons'
import { AMBITIONS, CASCADE_STEPS, MEMORY_RULES, WEEK_STEPS } from './home/data'
import {
  CaptureScene,
  CascadeCanvas,
  DayMoments,
  FridayScene,
  HeroSchedule,
  MemoryScene,
  WeekScene,
} from './home/Scenes'

/* ═══════════════════════════════════════════════════════════════════════════
   THE PAGE SAYS ONE THING: AMBITION, DOWN TO THE HOUR.  (D-186)

   The previous page sold *certainty* to someone overwhelmed — "your life won't
   get simpler, your week can." It was honest and it was aimed at the wrong
   emotion. The person this is for isn't looking for calm. They're running big
   things and want them finished, and they're tired of tools that are embarrassed
   by the word "project."

   So the page is unashamed about the hierarchy — Initiatives, Projects, Tasks —
   and spends its motion on the one move nobody else makes: carrying an
   outcome all the way down to a block on Tuesday. Then the two newest things
   the product does for that person: it commits the week WITH them, and it
   walks every day beside them.

   What did NOT change: the honesty. "Ambition without arithmetic is a wish list"
   is the old "it tells you when the week doesn't fit," pointed at the new
   reader. And the brandscript's banned words stay banned — ambitious is not
   hustle; nothing here says crush, 10x, grind or AI-powered.

   Every scene renders its final state as markup (prerendered, readable without
   JS, and what reduced-motion users get). home/motion.ts animates toward it.
   ═══════════════════════════════════════════════════════════════════════════ */

const PLANS = [
  {
    name: 'Annual',
    perMonth: '19',
    billed: '$228 billed yearly',
    badge: 'Save $120',
    note: 'Two months free. For people who plan in years.',
    featured: true,
  },
  {
    name: 'Monthly',
    perMonth: '29',
    billed: 'Billed monthly',
    badge: null,
    note: 'Month to month. Leave whenever, and take your calendars with you.',
    featured: false,
  },
] as const

const TERMS = [
  'Fourteen days free, no card',
  'Every feature, no tiers',
  'Mac, iPhone, and any browser',
  'Cancel in two clicks',
] as const

const STANCE = [
  ['You stay in charge.', 'It proposes. You commit. Every block drags, and nothing lands on your calendar without you.'],
  ['It tells you the truth.', 'Including “this week doesn’t fit.” Then it lets you carry it anyway.'],
  ['No streaks. No shame.', 'It reports what moved. It never nags you about what didn’t.'],
  ['Yours alone.', 'No team board, no manager’s dashboard. Nobody else is ever in your account.'],
] as const

/** Words that light up as they're read. Split at render so the prerendered
 *  HTML already holds the spans — no client-side text surgery. */
function Words({ text, className = '' }: { text: string; className?: string }) {
  return (
    <>
      {text.split(' ').map((w, i) => (
        <span key={i} className={`w ${className}`}>
          {w}{' '}
        </span>
      ))}
    </>
  )
}

export default function Home() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cleanup: (() => void) | undefined
    let cancelled = false
    // Motion is loaded after first paint: the page is fully readable before a
    // single byte of GSAP arrives.
    import('./home/motion').then(({ initMotion }) => {
      if (cancelled || !root.current) return
      cleanup = initMotion(root.current)
    })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])

  return (
    <div ref={root} className="hm" style={{ '--work': WORK } as CSSProperties}>
      <div className="hm-progress" data-progress aria-hidden />

      <header className="hm-nav">
        <a href="/" className="wordmark hm-mark tap" aria-label="Nuvo">
          <NuvoMark size={24} />
          Nuvo
        </a>
        <nav className="hm-links">
          <a href="#system">The system</a>
          <a href="#week">The week</a>
          <a href="#day">The day</a>
          <a href="#memory">Memory</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <NavOpenAppCtas />
      </header>

      <main>
        {/* ── HERO ──────────────────────────────────────────────────────────
            H1 starts with "Nuvo" so Google's OAuth branding review can match
            the app name in the prerendered HTML. The kicker carries it; the
            three lines carry the claim. */}
        <section className="hero" data-hero>
          <h1 className="hero-h1">
            <span className="hero-kick">Nuvo · Task management for the ambitious</span>
            <span className="hero-line">
              <span>Ambition,</span>
            </span>
            <span className="hero-line">
              <span>down to</span>
            </span>
            <span className="hero-line">
              <span>
                <em>
                  the hour<span className="stop">.</span>
                </em>
              </span>
            </span>
          </h1>

          <div className="hero-foot">
            <p className="hero-sub">
              Initiatives, projects, and every task beneath them — each with a time on your
              calendar. Plus a planning partner that commits the week with you, keeps every day on
              course, and learns how you actually work.
            </p>
            <div>
              <CtaGroup />
              <p className="hero-note">Fourteen days free. No card.</p>
            </div>
          </div>

          <div className="hero-stage" data-hero-stage>
            <div className="hero-float f1" data-float="0.6" aria-hidden>
              <span className="k-label">Initiative</span>
              <b>Launch v2</b>
            </div>
            <div className="hero-float f2" data-float="1.1" aria-hidden>
              <span className="k-label">Project</span>
              <b>Pricing page</b>
              <span className="mono">5 of 7 · on pace</span>
            </div>
            <div className="hero-float f3" data-float="0.85" aria-hidden>
              <span className="k-label">Task</span>
              <b>Draft tier copy</b>
              <span className="mono">Tue 9–9:45am</span>
            </div>
            <div className="hero-device" data-hero-device>
              <HeroSchedule mark={<NuvoMark size={18} />} />
            </div>
          </div>
        </section>

        {/* ── MARQUEE ─────────────────────────────────────────────────────── */}
        <section className="mq" aria-label="What people build with Nuvo">
          <div className="mq-row" data-marquee="1">
            {[0, 1].map((k) => (
              <div className="mq-track" key={k} aria-hidden={k === 1}>
                {AMBITIONS.map((a) => (
                  <span key={a}>
                    {a}
                    <i>✦</i>
                  </span>
                ))}
              </div>
            ))}
          </div>
          <div className="mq-row mq-row-2" data-marquee="-1" aria-hidden>
            {[0, 1].map((k) => (
              <div className="mq-track" key={k}>
                {['Initiatives', 'Projects', 'Tasks', 'Time blocks', 'Initiatives', 'Projects', 'Tasks', 'Time blocks'].map(
                  (a, i) => (
                    <span key={i}>{a}</span>
                  ),
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── MANIFESTO ───────────────────────────────────────────────────── */}
        <section className="mf" data-manifesto>
          <div className="mf-inner">
            <p className="k-label mf-label">Who this is for</p>
            <p className="mf-text">
              <Words text="Most planners promise you calm." />
              <Words text="You don’t want calm. You want the thing finished" className="strong" />
              <Words text="— the launch, the book, the second company — and the forty-minute block on Tuesday that actually moves it." />
            </p>
            <p className="mf-coda">
              Nuvo is for people with more ambition than hours.
            </p>
          </div>
        </section>

        {/* ── THE SYSTEM — one initiative, all the way down ─────────────────── */}
        <section id="system" className="sys" data-cascade>
          <div className="sys-pin">
            <div className="sys-copy">
              <p className="k-label accent">The system</p>
              <h2 className="sys-h2">
                Every task has a reason. <em>Every reason has a time.</em>
              </h2>
              <ol className="sys-steps">
                {CASCADE_STEPS.map((s, i) => (
                  <li key={s.n} data-step={i}>
                    <span className="sys-n mono">{s.n}</span>
                    <div>
                      <p className="sys-label">{s.label}</p>
                      <p className="sys-title">{s.title}</p>
                      <p className="sys-body">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="sys-stage">
              <CascadeCanvas />
            </div>
          </div>
        </section>

        {/* ── UNASHAMED ───────────────────────────────────────────────────── */}
        <section className="un" data-unashamed>
          <p className="un-line" data-dir="-1">
            Initiatives<span>.</span>
          </p>
          <p className="un-line outline" data-dir="1">
            Projects<span>.</span>
          </p>
          <p className="un-line" data-dir="-1">
            Tasks<span>.</span>
          </p>
          <div className="un-copy">
            <p className="k-label accent">Unashamedly</p>
            <p className="un-text">
              Most apps pick one altitude and pretend the others don’t exist. A list that can’t see
              the quarter. A board that never reaches Tuesday. Ambition lives at all three — and
              dies in the gaps between them.
            </p>
          </div>
        </section>

        {/* ── CAPTURE ─────────────────────────────────────────────────────── */}
        <section className="cp" data-capture>
          <div className="cp-copy">
            <p className="k-label accent">Capture</p>
            <h2 className="h2">At the speed of the idea.</h2>
            <p className="body">
              ⌥Space from anywhere on your Mac. ⌘K in the app. Your voice on the phone. Type it the
              way you’d text it, and it lands as structure — day, time, length, where it belongs.
            </p>
          </div>
          <CaptureScene />
        </section>

        {/* ── THE WEEK ────────────────────────────────────────────────────── */}
        <section id="week" className="wkp" data-week>
          <div className="wkp-pin">
            <div className="wkp-head">
              <p className="k-label accent">Plan the week</p>
              <h2 className="h2">
                Sunday night, <em>commit the week.</em>
              </h2>
            </div>
            <div className="wkp-grid">
              <ol className="wkp-steps">
                {WEEK_STEPS.map((s, i) => (
                  <li key={s.n} data-wstep={i}>
                    <span className="mono">{s.n}</span>
                    <div>
                      <b>{s.label}</b>
                      <p>{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <WeekScene />
            </div>
          </div>
        </section>

        {/* ── THE DAY (the dark chapter) ──────────────────────────────────── */}
        <section id="day" className="dy" data-day data-theme="dark">
          <div className="dy-inner">
            <div className="dy-side">
              <div className="dy-sticky">
                <p className="k-label">Your planning partner</p>
                <h2 className="h2">
                  Then it walks <em>every day</em> with you.
                </h2>
                <p className="dy-clock mono" data-clock aria-hidden>
                  7:30<span>am</span>
                </p>
                <div className="dy-track" aria-hidden>
                  <span data-day-fill />
                </div>
              </div>
            </div>
            <DayMoments />
          </div>
        </section>

        {/* ── MEMORY + THE CHAT — the learning engine (docs/memory.md) ─────────
            What Nuvo learns from what you already do, how sure it is, and the
            chat planning from it. The spec's line: a memory is never a guess
            the app acts on — it's a fact you confirmed, evidence attached. */}
        <section id="memory" className="mem" data-memory>
          <div className="mem-copy">
            <p className="k-label accent">Memory</p>
            <h2 className="h2">
              It learns how you <em>actually</em> work.
            </h2>
            <p className="body">
              Your calendar, the blocks you finish, the drafts you correct. Nuvo notices the patterns
              in what you already do. Keep one, and everything that plans for you uses it: your
              hours, your week, the chat.
            </p>
            <ul className="mem-rules">
              {MEMORY_RULES.map(([t, b]) => (
                <li key={t} data-rise>
                  <b>{t}</b>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <MemoryScene />
        </section>

        {/* ── ARITHMETIC + FRIDAY ─────────────────────────────────────────── */}
        <section className="ar" data-arith>
          <div className="ar-copy">
            <p className="k-label accent">The honest part</p>
            <h2 className="ar-h2">
              Ambition without arithmetic is a <em>wish list.</em>
            </h2>
            <div className="ar-meter">
              <span className="mono ar-num">
                <span data-count="112">112</span>%
              </span>
              <div>
                <p className="ar-meter-l">Commitment, this week</p>
                <p className="body">
                  Everything you’ve committed to, against the hours you really have, at the pace
                  you’ve <em>proven</em>. Over a hundred? It’ll let you carry it. It just won’t
                  pretend.
                </p>
              </div>
            </div>
          </div>
          <div>
            <p className="k-label">Friday</p>
            <p className="ar-fri">See what moved. With evidence, not memory.</p>
            <FridayScene />
          </div>
        </section>

        {/* ── STANCE ──────────────────────────────────────────────────────── */}
        <section className="st">
          <p className="k-label">Ambitious, not reckless</p>
          <ul className="st-list">
            {STANCE.map(([t, b]) => (
              <li key={t} data-rise>
                <p className="st-t">{t}</p>
                <p className="st-b">{b}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── PRICING ─────────────────────────────────────────────────────── */}
        <section id="pricing" className="pr">
          <div className="pr-head">
            <p className="k-label accent">Pricing</p>
            <h2 className="h2">One price. All of it.</h2>
            <p className="body">No tiers. No add-ons. Nothing held back for a “pro” plan.</p>
          </div>
          <div className="pr-cards">
            {PLANS.map((p) => (
              <div key={p.name} className={`pr-card ${p.featured ? 'is-featured' : ''}`} data-rise>
                {p.badge && <span className="pr-badge">{p.badge}</span>}
                <p className="k-label">{p.name}</p>
                <p className="pr-price">
                  <span className="mono">${p.perMonth}</span>
                  <span>/month</span>
                </p>
                <p className="pr-billed">{p.billed}</p>
                <p className="pr-note">{p.note}</p>
              </div>
            ))}
          </div>
          <ul className="pr-terms">
            {TERMS.map((t) => (
              <li key={t}>
                <span aria-hidden>✓</span>
                {t}
              </li>
            ))}
          </ul>
        </section>

        {/* ── CLOSE ───────────────────────────────────────────────────────── */}
        <section className="cl" data-close>
          <p className="cl-big">
            <span>Go build</span>
            <span>
              <em>
                the thing<span className="stop">.</span>
              </em>
            </span>
          </p>
          <p className="cl-sub">We’ll find it a time.</p>
          <CtaGroup className="cl-cta" />
          <p className="hero-note">
            Or <a href={appUrlWithCode(APP_URL)} rel="noopener noreferrer">open it in your browser</a> and plan
            this week tonight.
          </p>
        </section>
      </main>

      <footer className="hm-foot">
        <span className="wordmark hm-foot-mark">
          <NuvoMark size={20} />
          Nuvo
        </span>
        <div>
          <a href="/share">Share</a>
          <a href="/support">Support</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href={ACCESS_MAILTO}>Contact</a>
          <span>© {new Date().getFullYear()} · For people with more ambition than hours</span>
        </div>
      </footer>
    </div>
  )
}
