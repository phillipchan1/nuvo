import CalendarsVisual from './components/CalendarsVisual'
import CaptureVisual from './components/CaptureVisual'
import DomainVisual from './components/DomainVisual'
import FunnelVisual from './components/FunnelVisual'
import OperatorVisual from './components/OperatorVisual'
import ScheduleVisual from './components/ScheduleVisual'
import ThemesVisual from './components/ThemesVisual'
import { useCallback, useState } from 'react'
import { ACCESS_MAILTO, APP_URL, DOWNLOAD_MAC_URL, RELEASES_REPO } from './config'

const CAPABILITIES = [
  {
    label: 'One system',
    title: 'Nothing gets lost',
    body: 'A yearly bet becomes projects, becomes tasks, becomes Tuesday at 9 — without ever leaving Nuvo or being re-typed. Finish the hour and the bet above it moves.',
  },
  {
    label: 'Capture',
    title: 'Every loose thought lands',
    body: '⌥Space on Mac. ⌘K in the app. Type freely — dates, durations, labels. Inbox holds it until you route it.',
  },
  {
    label: 'Schedule',
    title: 'Granular where it counts',
    body: 'A scheduled task is the block. Drag work onto Tuesday. Project tools stop at the board — Nuvo lands on the hour.',
  },
  {
    label: 'The Week',
    title: 'Commit before you schedule',
    body: 'Inbox stays raw. Backlog stays quiet. The Week is the gate — only what you commit reaches Today.',
  },
  {
    label: 'Intelligence',
    title: 'Help in the right places',
    body: 'Scaffold a project. Compose a week. Prepare a block. Nuvo proposes — you promote toward the calendar.',
  },
  {
    label: 'Standing',
    title: 'Protect the hours that matter',
    body: 'Standing slots claim recurring affinity time. Sunday routes matching work into them.',
  },
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
    featured: true,
  },
  {
    name: 'Monthly',
    perMonth: '29',
    billed: 'Billed monthly',
    badge: null,
    featured: false,
  },
] as const

const INCLUDED = [
  'Every calendar — Google, Microsoft, iCloud, ICS',
  'Nuvo, your planning copilot',
  'Domains, initiatives, projects, blocks',
  'Sunday planning and Friday review',
  'The native Mac app and ⌥Space capture',
  'Installable on your iPhone',
] as const

function CheckMark() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="mt-[0.3rem] shrink-0 text-[var(--accent)]"
    >
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="1.6"
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
            <p className="reveal reveal-delay-1 mt-5 max-w-xl text-pretty hero-support text-[var(--muted)]">
              Work, the side thing, the family calendar, the thing you volunteer for. Nuvo is one
              continuous system from the year you’re planning down to the hour you’re working — so
              what matters actually gets time.
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
            <div className="mt-6 space-y-5 text-body text-[var(--muted)]">
              <p>
                Work has three teams and a roadmap. There’s a season starting somewhere else you’re
                responsible for. Family has a calendar that doesn’t care about your sprint. And
                somewhere there’s a project that mattered in January and hasn’t been touched since
                March.
              </p>
              <p>
                So you keep three systems. Task apps keep checklists and are blind to the quarter.
                Project tools keep boards and have never once told you what Tuesday looks like.
                Calendars keep meetings, so the actual work is invisible.
              </p>
              <p className="text-[var(--text)]">
                You became the integration layer between them. Every re-typed task is a chance to
                drop something — and you can’t answer the only question that matters: is the thing
                I said mattered actually getting hours?
              </p>
            </div>
          </div>
        </section>

        {/* The wedge — the altitude model is the differentiator, so it gets its own
            beat and the visual demonstrates the descent instead of listing nouns. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:items-start">
            <div>
              <p className="section-label text-[var(--muted)]">How it actually works</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                Most tools are good at one altitude. Nuvo works at all of them.
              </h2>
              <div className="mt-6 space-y-5 text-body text-[var(--muted)]">
                <p>
                  Nuvo is one continuous system from <span className="text-[var(--text)]">“this
                  matters this year”</span> down to <span className="text-[var(--text)]">“this is
                  happening at 9am.”</span> Something you commit to at the top becomes real hours
                  at the bottom — and the hours roll back up as proof it moved.
                </p>
                <p>
                  The initiative you named in January is a project in March, three tasks this week,
                  and 9am Tuesday. One object, all the way down. No re-entry, no translating
                  between apps, no project quietly dying in a board while your week fills up with
                  something else.
                </p>
                <p className="text-[var(--text)]">
                  That round trip is the whole thing. It’s why a full week in Nuvo means the work
                  you chose is the work that happened.
                </p>
              </div>
            </div>
            <FunnelVisual />
          </div>
        </section>

        {/* Domains */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-end lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">The parts of your life</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                Every world you’re responsible for, side by side.
              </h2>
              <p className="mt-5 max-w-md text-body text-[var(--muted)]">
                A domain isn’t a folder or a tag you’ll forget you made. It’s an area you’re
                permanently responsible for — work, family, the thing you serve, your own health.
                Initiatives and projects grow underneath them, and the week decides what lands on
                the day across all of them, not just the one that pays you.
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
                Every loose task has a home.
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

        {/* Capabilities */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <p className="section-label text-[var(--muted)]">How it holds</p>
          <h2 className="masthead mt-3 max-w-2xl text-lead text-[var(--text)]">
            Every altitude — down to the hour.
          </h2>

          <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <li key={c.label} className="border-t border-[var(--line)] pt-5">
                <p className="section-label text-[var(--accent)]">{c.label}</p>
                <h3 className="mt-2 text-[1.0625rem] font-medium leading-snug text-[var(--text)]">
                  {c.title}
                </h3>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--muted)]">{c.body}</p>
              </li>
            ))}
          </ul>
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
                One grid — meetings and your blocks side by side, tinted by domain.
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
                When you’re mid-meeting and three domains are pinging, you need speed and an
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

        {/* Themes */}
        <section
          id="themes"
          className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24"
        >
          <p className="section-label text-[var(--muted)]">Appearance</p>
          <h2 className="masthead mt-3 max-w-2xl text-lead text-[var(--text)]">
            You’ll be in here every day. It should suit you.
          </h2>
          <p className="mt-5 max-w-2xl text-body text-[var(--muted)]">
            Five materials — Aurora glass, Flat, Terminal (Dracula, Nord, Tokyo Night…),
            Blueprint, E-Ink — each with its own moods and schemes, light and dark. Quiet enough
            to sit open all day next to your editor.
          </p>
          <div className="mt-10">
            <ThemesVisual />
          </div>
        </section>

        {/* Cadence */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">Cadence</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              Short rituals. Clear end states.
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

        {/* Pricing — lands after the value is made, before the closing CTA */}
        <section
          id="pricing"
          className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24"
        >
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">Pricing</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              One subscription. Everything you run.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Fourteen days free — no card. After that, one plan covers all of it: every calendar,
              every part of your life, the Mac app, and your phone. No seats, no tiers, nothing
              held back for a higher plan.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:max-w-3xl">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`glass-card rounded-2xl border p-6 sm:p-7 ${
                  p.featured
                    ? 'border-[var(--accent)] shadow-[var(--shadow-2)]'
                    : 'border-[var(--line)]'
                }`}
              >
                <div className="flex items-baseline gap-3">
                  <p className="section-label text-[var(--text)]">{p.name}</p>
                  {p.badge && (
                    <span className="section-label ml-auto text-[var(--accent)]">{p.badge}</span>
                  )}
                </div>
                {/* Prices are numerics — tabular sans, never the Fraunces masthead. */}
                <p className="mt-5 flex items-baseline gap-1.5">
                  <span className="mono text-[2.75rem] font-semibold leading-none tracking-tight text-[var(--text)]">
                    ${p.perMonth}
                  </span>
                  <span className="text-[0.9375rem] text-[var(--muted)]">/month</span>
                </p>
                <p className="mt-2.5 text-[0.9375rem] text-[var(--muted)]">{p.billed}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <a href={APP_URL} className="btn-primary tap" rel="noopener noreferrer">
              Start 14 days free
            </a>
            <p className="text-[0.9375rem] text-[var(--muted)]">
              No credit card · Cancel anytime
            </p>
          </div>

          <ul className="mt-14 grid max-w-3xl gap-x-10 gap-y-3.5 sm:grid-cols-2">
            {INCLUDED.map((line) => (
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
          <a href="/privacy" className="hover:text-[var(--text)]">
            Privacy
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
