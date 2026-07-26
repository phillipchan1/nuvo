import CalendarsVisual from './components/CalendarsVisual'
import CapacityVisual from './components/CapacityVisual'
import CaptureVisual from './components/CaptureVisual'
import CoverageVisual from './components/CoverageVisual'
import DomainVisual from './components/DomainVisual'
import DriftVisual from './components/DriftVisual'
import FunnelVisual from './components/FunnelVisual'
import OperatorVisual from './components/OperatorVisual'
import ScheduleVisual from './components/ScheduleVisual'
import { useCallback, useState } from 'react'
import { ACCESS_MAILTO, APP_URL, DOWNLOAD_MAC_URL, RELEASES_REPO } from './config'

// Everything you get, grouped so it reads as a system rather than a wall.
// Written as outcomes, not features — a capability list is app-impressive by
// default, and only earns its place if every line is what *you* can do.
//
// AUDITED against master (2026-07-25). Deliberately absent because they don't
// ship on master yet: forward-email-to-inbox and the inbound capture API (no
// edge function, no migration — they live on other branches). Don't list them
// until they deploy; a depth signal that doesn't survive contact is worse than
// a shorter list.
const INVENTORY = [
  {
    group: 'Capture',
    items: [
      '⌥Space from anywhere on Mac',
      '⌘K inside the app',
      'Type it like a text message',
      'Voice dictation',
      'An inbox that holds everything',
    ],
  },
  {
    group: 'Your calendars',
    items: [
      'Google, Microsoft 365, iCloud, ICS',
      'Two-way sync with Google',
      'Meetings and your work, one grid',
      'Hide what you don’t plan around',
      'Recurring events, guests, locations',
    ],
  },
  {
    group: 'Planning the week',
    items: [
      'Sunday composes your week',
      'Demand against your real hours',
      'Calibrated to your proven pace',
      'Priorities tied to real projects',
      'Standing time for recurring work',
      'Drag work onto the hour',
    ],
  },
  {
    group: 'The bigger picture',
    items: [
      'Every level in one system',
      'See three weeks out',
      'Know when a project is behind',
      'Shape work before it’s scheduled',
      'See what’s ready to work',
    ],
  },
  {
    group: 'Your day',
    items: [
      'One honest call on today',
      'A morning brief',
      'An evening close',
      'Unfinished work rolls forward',
      'Weather and daylight',
    ],
  },
  {
    group: 'Looking back',
    items: [
      'A Friday review, with evidence',
      'What moved, in every world',
      'Where your hours actually went',
      'Meetings count as time spent',
      'GitHub work counts itself',
    ],
  },
  {
    group: 'Ask Nuvo',
    items: [
      'Ask in plain language',
      'It drafts, you decide',
      'Scaffold a project or a week',
      'One tap to undo anything',
    ],
  },
  {
    group: 'Where it runs',
    items: [
      'Native Mac app, auto-updating',
      'Any browser',
      'Installable on iPhone',
      'Five looks, light and dark',
      'Keyboard-first throughout',
      'Live sync across devices',
    ],
  },
] as const

// The refusals, straight from overview.md §2. A capability list attracts
// exactly the buyers the canon names as anti-personas; this disqualifies them
// in the same breath, and reads as confidence rather than apology.
const REFUSALS = [
  ['No assignees, no shared boards.', 'It’s your system, not a team’s.'],
  ['No streaks, no shame.', 'The app reports. It never nags.'],
  ['No AI running your day.', 'Nuvo proposes. You decide.'],
  ['No wiki, no blank canvas.', 'It has opinions on purpose.'],
  ['Nobody watching your calendar.', 'No manager’s dashboard. Ever.'],
] as const

// The agreement plan (brandscript §4) — what we promise, at the moment of
// paying. "Your account is yours alone" is a real differentiator the site has
// never once stated (Question Ledger O4).
const PROMISES = [
  'Fourteen days free, no card',
  'Cancel anytime, in two clicks',
  'Every feature, no tiers, nothing held back',
  'Your account is yours alone — nobody else is ever in it',
  'We’ll tell you the truth, including “you can’t carry this week”',
] as const

// The after-state, not the mechanism — the brandscript's success beats, which
// the page otherwise never states.
const PAYOFF = [
  { when: 'Sunday', body: 'The week is decided, and the arithmetic says you can carry it.' },
  { when: 'Tuesday', body: 'The work is on the hour, and what you needed for it is already there.' },
  { when: 'Friday', body: 'You can show what moved — from evidence, not memory.' },
  { when: 'Every week', body: 'Nothing goes dark for a quarter without you choosing it.' },
] as const

// Keep in step with the app's src/components/billing/plans.ts and the Stripe
// Prices behind STRIPE_PRICE_* — the saving is the number that actually sells
// the annual plan, and "$228 billed yearly" alone hides it.
const PLANS = [
  {
    name: 'Annual',
    perMonth: '19',
    billed: '$228 billed yearly',
    badge: 'Save $120',
    note: 'Two months free. For the way you already think about a year.',
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

/** `quiet` is for the long inventory — 41 accent ticks would shout; the promises
 *  next to the price are few enough to earn the accent. */
function CheckMark({ quiet = false }: { quiet?: boolean }) {
  const px = quiet ? 12 : 15
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={
        quiet
          ? 'mt-[0.32rem] shrink-0 text-[var(--line-strong)]'
          : 'mt-[0.3rem] shrink-0 text-[var(--accent)]'
      }
    >
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth={quiet ? 2 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// "Download for Mac" resolves to the exact latest DMG on hover/focus (the GitHub
// Releases API is CORS-enabled), rewriting href to the asset's direct URL for an
// instant download. The static releases/latest/download/Nuvo.dmg link is the
// safety net when JS is off or the API is unreachable.
function DownloadMacButton({ className = '' }: { className?: string }) {
  const [href, setHref] = useState(DOWNLOAD_MAC_URL)
  const [resolved, setResolved] = useState(false)

  const resolve = useCallback(() => {
    if (resolved) return
    setResolved(true)
    fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const assets: { name?: string; browser_download_url?: string }[] = data?.assets ?? []
        const dmg = assets.find((a) => /\.dmg$/i.test(a.name ?? ''))
        if (dmg?.browser_download_url) setHref(dmg.browser_download_url)
      })
      .catch(() => {
        /* keep the static href */
      })
  }, [resolved])

  return (
    <a
      href={href}
      onPointerEnter={resolve}
      onFocus={resolve}
      className={`btn-primary tap inline-flex items-center gap-2 ${className}`}
    >
      <svg width="15" height="15" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
        <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
      </svg>
      Download for Mac
    </a>
  )
}

function CtaGroup({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <DownloadMacButton />
      <a href={APP_URL} className="btn-ghost tap" rel="noopener noreferrer">
        Open in browser
      </a>
    </div>
  )
}

export default function Home() {
  return (
    <div className="atmosphere min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 pt-5 pb-2 sm:px-8 sm:pt-7">
        <a href="/" className="wordmark text-[1.125rem] text-[var(--text)] tap inline-flex items-center shrink-0">
          Nuvo
        </a>
        <nav className="flex items-center gap-2 sm:gap-3">
          <a href="#capture" className="hidden text-[13px] text-[var(--muted)] tap items-center sm:inline-flex hover:text-[var(--text)]">
            Capture
          </a>
          <a href="#calendars" className="hidden text-[13px] text-[var(--muted)] tap items-center sm:inline-flex hover:text-[var(--text)]">
            Calendars
          </a>
          <a href="#pricing" className="hidden text-[13px] text-[var(--muted)] tap items-center sm:inline-flex hover:text-[var(--text)]">
            Pricing
          </a>
          <a href="/support" className="hidden text-[13px] text-[var(--muted)] tap items-center sm:inline-flex hover:text-[var(--text)]">
            Support
          </a>
          <a href={APP_URL} className="btn-ghost tap hidden text-[13px] sm:inline-flex" rel="noopener noreferrer">
            Open app
          </a>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pb-24 sm:pt-14">
          <div className="max-w-2xl">
            <h1 className="masthead reveal text-display text-[var(--text)]">
              You run more than one life. One system should keep up.
            </h1>
            {/* Two beats, one per element: the headline holds the worlds, the
                support holds the arithmetic. Ends on the question the rest of
                the page answers. */}
            <p className="reveal reveal-delay-1 mt-5 max-w-xl text-pretty hero-support text-[var(--muted)]">
              Work, the side thing, the family calendar, the thing you volunteer for. Nuvo holds
              all of it in one place — then answers the question no other tool will: can you
              actually carry this week?
            </p>
            <CtaGroup className="reveal reveal-delay-2 mt-8" />
          </div>

          <div className="reveal reveal-delay-3 mt-12 sm:mt-16">
            <ScheduleVisual />
          </div>
        </section>

        {/* Emotion / who it's for — the problem, stated without a solution in sight.
            The answer gets its own section immediately after. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">If this is you</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              A to-do list can’t hold what you’re carrying.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              So you keep three systems — and you became the integration layer between them.
            </p>
          </div>

          {/* The indictment as coverage, not prose — each tool's reach drawn
              against the range you actually live across, so the hole is a
              thing you see rather than a claim you read. */}
          <div className="mt-12">
            <CoverageVisual />
          </div>

          {/* Name the villain — singular, blameless, and not the reader, which
              is what makes it usable as an enemy. The chart is the definition,
              so the prose stops at one line. */}
          <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">It has a name</p>
              <h3 className="masthead mt-3 text-[1.75rem] leading-tight text-[var(--text)]">
                Drift.
              </h3>
              <p className="mt-4 text-body text-[var(--muted)]">
                Nothing goes wrong on any given day. Then it’s March, and you can’t point to the
                week you decided to let it go.
              </p>
            </div>
            <DriftVisual />
          </div>
        </section>

        {/* The wedge — the altitude model is the differentiator, so it gets its own
            beat and the visual demonstrates the descent instead of listing nouns. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">How it actually works</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              Most tools are good at one altitude. Nuvo works at all of them.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              The initiative you named in January is a project in March, three tasks this week, and
              9am Tuesday. Same object, the whole way down.
            </p>
          </div>
          {/* The visual carries the argument here — it earns the full width. */}
          <div className="mt-10">
            <FunnelVisual />
          </div>
        </section>

        {/* The flagship answer. Altitude wins attention; this wins trust. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">Before you commit</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                Can you actually carry this week?
              </h2>
              <p className="mt-5 text-body text-[var(--muted)]">
                Nuvo adds up everything you just committed to and measures it against the hours you
                actually have — calibrated against the pace you’ve actually proven, not the pace
                you wish you had. It will tell you when the answer is no.
              </p>
            </div>
            <CapacityVisual />
          </div>
        </section>

        {/* Domains — named in plain language only; the vocabulary lives in the app. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-end lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">The parts of your life</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                Every world you’re responsible for, side by side.
              </h2>
              <p className="mt-5 max-w-md text-body text-[var(--muted)]">
                Not folders, and not tags you’ll forget you made. These are the areas you’re
                permanently responsible for — work, family, the thing you serve, your own health.
                The work grows underneath them, and the week decides what lands on the day across
                all of them, not just the one that pays you.
              </p>
            </div>
            <DomainVisual />
          </div>
        </section>

        {/* Capture */}
        <section
          id="capture"
          className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24"
        >
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">Capture anything</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                Get it out of your head in one keystroke.
              </h2>
              <p className="mt-5 text-body text-[var(--muted)]">
                On Mac, hit <span className="text-[var(--text)] mono">⌥Space</span> from anywhere —
                Slack, a call, a browser tab. Type the way you’d text yourself. Nuvo parses it
                into structure and parks it in the inbox.
              </p>
              <p className="mt-4 text-body text-[var(--muted)]">
                No deciding the project yet. No opening the right board. Just get it out of your
                head. Later you route it under an initiative, pull it into the Week, or drop it
                on Tuesday. The front door stays open so nothing evaporates mid-thought.
              </p>
              <ul className="mt-8 space-y-3 text-[0.9375rem] text-[var(--muted)]">
                <li className="border-t border-[var(--line)] pt-3">
                  <span className="text-[var(--text)] mono">⌥Space</span> — global capture on Mac
                </li>
                <li className="border-t border-[var(--line)] pt-3">
                  <span className="text-[var(--text)] mono">⌘K</span> — same capture inside the app
                </li>
                <li className="border-t border-[var(--line)] pt-3">
                  <span className="text-[var(--text)]">Free text</span> — “tomorrow 9am 30m #work !high”
                </li>
              </ul>
            </div>
            <CaptureVisual />
          </div>
        </section>

        {/* Calendars */}
        <section
          id="calendars"
          className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24"
        >
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">Calendars</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                Every calendar you already live in.
              </h2>
              <p className="mt-5 text-body text-[var(--muted)]">
                Work on Google. Family on Apple. Corp on Microsoft. The youth group ICS feed.
                One grid — meetings and your own work side by side, tinted by which world
                they belong to.
              </p>
              <p className="mt-4 text-body text-[var(--muted)]">
                Scheduled Nuvo work can mirror to a dedicated Google “Nuvo” calendar, so the
                rest of your tools see what you committed — without becoming the source of truth.
              </p>
            </div>
            <CalendarsVisual />
          </div>
        </section>

        {/* Operator polish */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">For operators</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                Built for the load you actually carry.
              </h2>
              <p className="mt-5 text-body text-[var(--muted)]">
                When you’re mid-meeting and three of your worlds are pinging, you need speed and an
                honest week — not another board to maintain. Capture fast. See commitment before
                you overfill. Let unfinished work roll cleanly.
              </p>
              <ul className="mt-8 space-y-3 text-[0.9375rem] text-[var(--muted)]">
                <li className="border-t border-[var(--line)] pt-3">
                  <span className="text-[var(--text)]">Weekly Review &amp; Find</span> — look back,
                  seal the week, surface what next week needs.
                </li>
                <li className="border-t border-[var(--line)] pt-3">
                  <span className="text-[var(--text)]">Groom / On Deck</span> — shape projects before
                  they hit the calendar; cut what won’t fit.
                </li>
                <li className="border-t border-[var(--line)] pt-3">
                  <span className="text-[var(--text)]">Commitment meter</span> — demand vs real
                  capacity, before Tuesday finds out.
                </li>
              </ul>
            </div>
            <OperatorVisual />
          </div>
        </section>

        {/* Cadence */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">Cadence</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              You enter, you decide, you leave.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Sunday composes the week. A morning brief claims the day. An evening shutdown closes
              it. Once a quarter you reset the bets. Each one is minutes, not an afternoon — you
              enter, decide, and leave. The system keeps moving without becoming a second job.
            </p>
            <ul className="mt-8 space-y-3 text-[0.9375rem] text-[var(--text)]">
              <li className="flex gap-3 border-t border-[var(--line)] pt-3">
                <span className="section-label w-24 shrink-0 text-[var(--accent)]">Sunday</span>
                <span className="text-[var(--muted)]">Sweep, bet, pull, compose the week.</span>
              </li>
              <li className="flex gap-3 border-t border-[var(--line)] pt-3">
                <span className="section-label w-24 shrink-0 text-[var(--accent)]">Morning</span>
                <span className="text-[var(--muted)]">Pull from the Week. Name today.</span>
              </li>
              <li className="flex gap-3 border-t border-[var(--line)] pt-3">
                <span className="section-label w-24 shrink-0 text-[var(--accent)]">Shutdown</span>
                <span className="text-[var(--muted)]">Record the gain. Send leftovers back.</span>
              </li>
              <li className="flex gap-3 border-t border-[var(--line)] pt-3">
                <span className="section-label w-24 shrink-0 text-[var(--accent)]">Quarterly</span>
                <span className="text-[var(--muted)]">Name the few bets that get real hours.</span>
              </li>
            </ul>
          </div>
        </section>

        {/* The payoff — the after-state, straight from the brandscript's success
            beats. Every other section is mechanism; this one is what changes. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">What changes</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              Sunday you know. Friday you can prove it.
            </h2>
          </div>
          <ul className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {PAYOFF.map((p) => (
              <li key={p.when} className="border-t border-[var(--line)] pt-4">
                <p className="section-label text-[var(--accent)]">{p.when}</p>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--muted)]">
                  {p.body}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* Where it runs */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="glass-card rounded-2xl border border-[var(--line)] px-6 py-8 sm:px-10 sm:py-10">
            <p className="section-label text-[var(--accent)]">Where it runs</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              Mac, web, and iPhone.
            </h2>
            <p className="mt-4 max-w-xl text-body text-[var(--muted)]">
              One account, every surface. The native Mac app updates itself quietly in the
              background, the web app opens anywhere, and iPhone is next.
            </p>
            <div className="mt-8 grid gap-6 sm:grid-cols-3">
              <div>
                <p className="section-label text-[var(--text)]">Mac</p>
                <p className="mt-1 text-[15px] text-[var(--muted)]">
                  Native app — download above. ⌥Space capture, background auto-updates.
                </p>
              </div>
              <div>
                <p className="section-label text-[var(--text)]">Web</p>
                <p className="mt-1 text-[15px] text-[var(--muted)]">
                  Open in any browser — nothing to install.
                </p>
              </div>
              <div>
                <p className="section-label text-[var(--muted)]">iPhone · Coming soon</p>
                <p className="mt-1 text-[15px] text-[var(--muted)]">
                  Add to Home Screen today; a native app is on the way.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* The depth signal — grouped so it reads as a system, and placed right
            before pricing where abundance justifies a decision instead of
            interrupting the argument. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">Everything included</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              One price. All of it.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              No tiers, no add-ons, nothing saved back for a “pro” plan. This is the whole
              product.
            </p>
          </div>

          <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {INVENTORY.map((g) => (
              <div key={g.group} className="border-t border-[var(--line)] pt-4">
                <p className="section-label text-[var(--accent)]">{g.group}</p>
                <ul className="mt-3 space-y-2">
                  {g.items.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2 text-[0.875rem] leading-snug text-[var(--muted)]"
                    >
                      <CheckMark quiet />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* The refusals. Unusual next to a feature list, which is the point. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">And on purpose</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              What Nuvo refuses to do.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              These aren’t missing. Most of what makes the product coherent is what it
              declines to be.
            </p>
          </div>
          <ul className="mt-10 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            {REFUSALS.map(([no, why]) => (
              <li key={no} className="border-t border-[var(--line)] pt-4">
                <p className="text-[0.9375rem] font-medium leading-snug text-[var(--text)]">{no}</p>
                <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-[var(--muted)]">{why}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Pricing — lands after the value is made, before the closing CTA */}
        <section
          id="pricing"
          className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24"
        >
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">Pricing</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              Less than the three tools it replaces.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              You’re likely paying for a task app, a project tool, and a planner that don’t talk
              to each other. This is one system, one price, and one week that finally adds up.
            </p>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:max-w-3xl">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`glass-card relative rounded-2xl border p-6 sm:p-8 ${
                  p.featured
                    ? 'border-[var(--accent)] shadow-[var(--shadow-2)] sm:-mt-3 sm:pb-11'
                    : 'border-[var(--line)]'
                }`}
              >
                {p.badge && (
                  <span
                    className="section-label absolute -top-2.5 left-6 rounded-full px-2.5 py-1 text-[var(--bg)]"
                    style={{ background: 'var(--accent)' }}
                  >
                    {p.badge}
                  </span>
                )}
                <p className="section-label text-[var(--muted)]">{p.name}</p>
                {/* Prices are numerics — tabular sans, never the Fraunces masthead. */}
                <p className="mt-4 flex items-baseline gap-1.5">
                  <span className="mono text-[3.25rem] font-semibold leading-none tracking-tight text-[var(--text)]">
                    ${p.perMonth}
                  </span>
                  <span className="text-[0.9375rem] text-[var(--muted)]">/month</span>
                </p>
                <p className="mt-3 text-[0.9375rem] text-[var(--muted)]">{p.billed}</p>
                <p className="mt-5 border-t border-[var(--line)] pt-4 text-[0.875rem] leading-relaxed text-[var(--muted)]">
                  {p.note}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
            <a href={APP_URL} className="btn-primary tap" rel="noopener noreferrer">
              Start free — plan your week in ten minutes
            </a>
          </div>

          {/* The agreement plan. Risk reversal is what actually closes this
              buyer; the objection isn't the money, it's abandoning another app. */}
          <ul className="mt-12 grid max-w-3xl gap-x-10 gap-y-3.5 sm:grid-cols-2">
            {PROMISES.map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-[0.9375rem] text-[var(--muted)]">
                <CheckMark />
                <span className="leading-relaxed">{line}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Closing */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-xl text-center">
            <p className="section-label text-[var(--muted)]">Nothing lost</p>
            <h2 className="masthead mt-4 text-lead text-[var(--text)]">
              Built for the person everything runs through.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Catch the loose end. Hold the bet. Land the hour. Every world you’re responsible
              for — finally in one place, finally on the calendar.
            </p>
            <CtaGroup className="mt-10 justify-center" />
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-col gap-4 border-t border-[var(--line)] px-5 py-8 text-[13px] text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span className="wordmark text-[var(--text)]">Nuvo</span>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <a href="/support" className="hover:text-[var(--text)]">
            Support
          </a>
          <a href="/privacy" className="hover:text-[var(--text)]">
            Privacy
          </a>
          <a href="/terms" className="hover:text-[var(--text)]">
            Terms
          </a>
          <a href={ACCESS_MAILTO} className="hover:text-[var(--text)]">
            Contact
          </a>
          <p>© {new Date().getFullYear()} · Built for people who run a lot at once</p>
        </div>
      </footer>
    </div>
  )
}
