import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { NuvoMark } from '@nuvo/mark'
import { WORK } from '../components/hues'
import '../home.css'
import './method.css'
import { ACCESS_MAILTO } from '../config'
import { CtaGroup, NavOpenAppCtas } from '../components/CtaButtons'
import { place } from '../home/data'
import {
  CAPACITY,
  CAPTURE_CHIPS,
  CAPTURE_LINE,
  COMMITMENT,
  DAY,
  DEMAND,
  FRIDAY,
  HABITS,
  MEETINGS,
  PACE,
  PARTNER,
  PLACED,
  SCATTER,
  THREAD,
} from './data'

/* ═══════════════════════════════════════════════════════════════════════════
   /method — THE FIVE HABITS OF PEOPLE WHO GET IT ALL DONE.  (D-246)

   The operator's frame: ambitious people who finish things keep five habits —
   one place for everything, the long view, a time and place for everything, a
   measured day, and all of it tied together. The page names each habit as a
   practice anyone could keep, then shows how Nuvo makes it the default.

   Then the story: the habits are simple, but most people keep them across five
   tools, and the handoffs between those tools are where work gets lost (Drift,
   brandscript §2). In Nuvo they're one thing seen five ways — shown by
   following a single task through all five. Last, the partner: what Nuvo
   drafts and prepares inside each habit, and the rule that it never lands
   anything without you (P3; there is no chat, D-201).

   "Habit" here is the reader's practice, never something Nuvo tracks: Nuvo is
   not a habit or streak tracker (overview §2). No streaks, no scores of you.

   Every scene's FINAL state is the markup (prerendered, readable without JS,
   what reduced motion gets); method/motion.ts animates toward it.
   ═══════════════════════════════════════════════════════════════════════════ */

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

const fmtH = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`

/* ── the five scenes, one per habit ──────────────────────────────────────── */

function CaptureScene() {
  return (
    <div className="mth-card mth-cap" aria-label={`Typing “${CAPTURE_LINE}” becomes a task with a time, a length and a domain`}>
      <div className="mth-cap-field">
        <span className="mth-cap-k mono" aria-hidden>
          ⌥Space
        </span>
        <span className="mth-cap-text" data-cap-text>
          {CAPTURE_LINE}
        </span>
      </div>
      <div className="mth-cap-arrow" aria-hidden>
        ↓
      </div>
      <ul className="mth-cap-chips">
        {CAPTURE_CHIPS.map((c) => (
          <li key={c.k} data-chip style={'hue' in c ? ({ '--hue': c.hue } as CSSProperties) : undefined}>
            <span className="k-label">{c.k}</span>
            <b>
              {'hue' in c && <i className="mth-dot" />}
              {c.v}
            </b>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChainScene() {
  return (
    <div className="mth-card mth-chain">
      {[
        ['Initiative', 'Launch v2', 'Q4 · due Dec 12'],
        ['Project', 'Pricing page', '12h left · on pace'],
        ['Task', 'Draft tier copy', '45m'],
      ].map(([k, name, meta], i) => (
        <div key={k} className="mth-chain-row" style={{ '--i': i } as CSSProperties} data-chain>
          <span className="k-label">{k}</span>
          <b>{name}</b>
          <span className="mono">{meta}</span>
        </div>
      ))}
    </div>
  )
}

function WeekScene() {
  return (
    <div className="mth-card mth-week" aria-label="A week of meetings with five pieces of project work placed in the open hours between them">
      <div className="mth-wk-head">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mth-wk-body">
        {MEETINGS.map((m, i) => (
          <span key={i} className="mth-mtg" style={place(m)}>
            {m.title}
          </span>
        ))}
        {PLACED.map((b, i) => (
          <span key={i} className="mth-blk" style={{ ...place(b), '--hue': b.hue } as CSSProperties} data-blk>
            <b>{b.title}</b>
            <span>{b.sub}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function DayScene() {
  return (
    <div className="mth-card mth-day">
      <ol>
        {DAY.map((d) => (
          <li key={d.at} data-moment>
            <span className="mono mth-day-at">{d.at}</span>
            <div>
              <span className="k-label">{d.label}</span>
              <p>
                {d.line}
                {'prepared' in d && <span className="mth-prep">✦ Prepared</span>}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function TrackScene() {
  return (
    <div className="mth-card mth-track">
      <div className="mth-commit-row">
        <span className="mono mth-commit-num">
          <span data-count={COMMITMENT}>{COMMITMENT}</span>%
        </span>
        <div>
          <p className="mth-commit-l">Commitment, this week</p>
          <p className="mono mth-commit-m">
            {DEMAND}h of pace ÷ {CAPACITY}h open
          </p>
        </div>
      </div>
      <ul className="mth-pace">
        {PACE.map((p) => (
          <li key={p.name} style={{ '--hue': p.hue } as CSSProperties} data-pace>
            <i className="mth-dot" />
            <span>{p.name}</span>
            <span className="mono mth-pace-math">{fmtH(p.pace)}/wk</span>
            <b className={'behind' in p ? 'is-behind' : ''}>{p.status}</b>
          </li>
        ))}
      </ul>
      <div className="mth-fri">
        <p className="k-label">Friday</p>
        <ul>
          {FRIDAY.map((m) => (
            <li key={m} data-moved>
              <span aria-hidden>✓</span>
              {m}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const SCENES: Record<(typeof HABITS)[number]['id'], ReactNode> = {
  'one-place': <CaptureScene />,
  'long-term': <ChainScene />,
  'time-place': <WeekScene />,
  'the-day': <DayScene />,
  'tied-together': <TrackScene />,
}

export default function Method() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cleanup: (() => void) | undefined
    let cancelled = false
    import('./motion').then(({ initMethodMotion }) => {
      if (cancelled || !root.current) return
      cleanup = initMethodMotion(root.current)
    })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])

  return (
    <div ref={root} className="hm mth" style={{ '--work': WORK } as CSSProperties}>
      <div className="hm-progress" data-progress aria-hidden />

      <header className="hm-nav">
        <a href="/" className="wordmark hm-mark tap" aria-label="Nuvo home">
          <NuvoMark size={24} />
          Nuvo
        </a>
        <nav className="hm-links">
          <a href="#habits">The habits</a>
          <a href="#drift">Why it’s hard</a>
          <a href="#thread">One system</a>
          <a href="#partner">The partner</a>
          <a href="/#pricing">Pricing</a>
        </nav>
        <NavOpenAppCtas />
      </header>

      <main>
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section className="hero mth-hero">
          <h1 className="hero-h1">
            <span className="hero-kick">The Nuvo method · Five habits</span>
            <span className="hero-line">
              <span>How the</span>
            </span>
            <span className="hero-line">
              <span>ambitious get</span>
            </span>
            <span className="hero-line">
              <span>
                <em>
                  it all done<span className="stop">.</span>
                </em>
              </span>
            </span>
          </h1>
          <div className="hero-foot">
            <p className="hero-sub">
              They aren’t more disciplined than you. They keep five habits, and they keep them in one
              place. Here are the five, and how Nuvo makes each one the default instead of one more
              thing to remember.
            </p>
            <a href="#habits" className="mth-cue tap">
              See the five
              <span aria-hidden>↓</span>
            </a>
          </div>
        </section>

        {/* ── THE PREMISE ──────────────────────────────────────────────────── */}
        <section className="mf" data-manifesto>
          <div className="mf-inner">
            <p className="k-label mf-label">What they do differently</p>
            <p className="mf-text">
              <Words text="The people who finish big things aren’t working harder than you." />
              <Words
                text="Nothing lives in their head. Every goal has a pace. Every task has a time. Every day gets measured."
                className="strong"
              />
            </p>
            <p className="mf-coda">That isn’t a personality. It’s five habits, and you can borrow them.</p>
          </div>
        </section>

        {/* ── THE FIVE HABITS ──────────────────────────────────────────────── */}
        <section id="habits" className="mth-habits" data-habits>
          <aside className="mth-index" aria-hidden>
            <div className="mth-index-sticky">
              <p className="k-label accent">The five habits</p>
              <ol data-index data-on="0">
                {HABITS.map((h, i) => (
                  <li key={h.id} data-index-item={i}>
                    <span className="mono">{h.n}</span>
                    {h.short}
                  </li>
                ))}
              </ol>
            </div>
          </aside>

          <ol className="mth-list">
            {HABITS.map((h, i) => (
              <li key={h.id} id={h.id} className="mth-habit" data-habit={i}>
                <span className="mth-habit-n mono">Habit {h.n}</span>
                <h2 className="mth-habit-t">{h.title}</h2>
                <p className="mth-habit-p">{h.habit}</p>
                <div className="mth-in-nuvo">
                  <p className="k-label accent">In Nuvo</p>
                  <p>{h.nuvo}</p>
                </div>
                <div className="mth-scene" data-rise>
                  {SCENES[h.id]}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── WHY IT'S HARD (the ink chapter) ──────────────────────────────── */}
        <section id="drift" className="mth-villain" data-theme="dark" data-villain>
          <div className="mth-villain-inner">
            <p className="k-label">Why it’s hard</p>
            <h2 className="h2 mth-villain-h2">
              Five habits. <em>Usually five apps.</em>
            </h2>
            <ol className="mth-scatter">
              {SCATTER.map((s, i) => (
                <li key={s.habit} data-scatter>
                  <span className="mono">{String(i + 1).padStart(2, '0')}</span>
                  <b>{s.tool}</b>
                  <span className="mth-scatter-lost">{s.lost}</span>
                </li>
              ))}
            </ol>
            <p className="mth-villain-h">
              The gaps between them have a name<span className="mth-colon">:</span>
              <span className="mth-villain-word" data-villain-word>
                Drift<span className="stop">.</span>
              </span>
            </p>
            <p className="mth-villain-def">
              <Words text="The slow, blameless distance between what you say matters and what your calendar actually spends you on." />
            </p>
            <div className="mth-villain-foot">
              <p>
                No single day causes it. Each tool does its one job well. The work just gets lost in the
                handoffs, and working harder only makes you busier inside it.
              </p>
              <p>
                <b>The habits only hold when they’re one system,</b> where the thing you captured is the
                step in the project, the block on Tuesday and the tick on Friday.
              </p>
            </div>
          </div>
        </section>

        {/* ── ONE SYSTEM: a single task through all five ───────────────────── */}
        <section id="thread" className="mth-thread-s">
          <div className="mth-thread-head">
            <p className="k-label accent">One system</p>
            <h2 className="h2">
              One task. <em>All five habits.</em>
            </h2>
            <p className="body">
              In Nuvo the habits aren’t five features. They’re one thing, seen five ways. Follow a
              single task from the moment it crossed your mind to the quarter it moved.
            </p>
          </div>
          <ol className="mth-thread" data-thread>
            {THREAD.map((t, i) => (
              <li key={t.habit} data-thread-step>
                <span className="mth-thread-dot mono" aria-hidden>
                  {i + 1}
                </span>
                <span className="k-label">{t.habit}</span>
                <b>{t.what}</b>
                <span className="mono mth-thread-when">{t.when}</span>
                <p>{t.note}</p>
              </li>
            ))}
          </ol>
          <p className="mth-thread-foot">The same task the whole way. Nothing to copy, nothing to keep in sync.</p>
        </section>

        {/* ── THE PARTNER ──────────────────────────────────────────────────── */}
        <section id="partner" className="mth-partner">
          <div className="mth-partner-head">
            <p className="k-label accent">Along the way</p>
            <h2 className="h2">
              A planning partner <em>inside every habit.</em>
            </h2>
            <p className="body">
              Nuvo doesn’t run your life. It does the tedious part of each habit, then hands it back to
              you.
            </p>
            <div className="mth-rule" data-rise>
              <span className="mth-rule-star" aria-hidden>
                ✦
              </span>
              <div>
                <b>It drafts. You keep.</b>
                <span>Nothing it suggests reaches your calendar until you say so.</span>
              </div>
            </div>
            {/* The one way to talk to Nuvo since the chat went (D-201): your own
                assistant, over Nuvo's MCP server. The app's own words (NuvoConnect). */}
            <p className="mth-connect" data-rise>
              <b>Rather talk it through?</b> Connect your own assistant. Claude, ChatGPT, or anything
              else that connects to apps can read and plan your Nuvo.
            </p>
          </div>
          <ul className="mth-partner-list">
            {PARTNER.map(([habit, does], i) => (
              <li key={habit} data-rise>
                <span className="mono">{String(i + 1).padStart(2, '0')}</span>
                <span className="mth-partner-h">{habit}</span>
                <p>{does}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── CLOSE ────────────────────────────────────────────────────────── */}
        <section className="cl" data-close>
          <p className="cl-big">
            <span>Start them</span>
            <span>
              <em>
                this week<span className="stop">.</span>
              </em>
            </span>
          </p>
          <p className="cl-sub">Fourteen days free. No card.</p>
          <CtaGroup className="cl-cta" />
          <p className="hero-note">
            Or <a href="/#system">see the app</a> first.
          </p>
        </section>
      </main>

      <footer className="hm-foot">
        <span className="wordmark hm-foot-mark">
          <NuvoMark size={20} />
          Nuvo
        </span>
        <div>
          <a href="/">Home</a>
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
