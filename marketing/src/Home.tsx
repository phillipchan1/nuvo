import CalendarsVisual from './components/CalendarsVisual'
import ChapelVisual from './components/ChapelVisual'
import OnDeckVisual from './components/OnDeckVisual'
import PlanWeekVisual from './components/PlanWeekVisual'
import ProjectRoomVisual from './components/ProjectRoomVisual'
import SpineVisual from './components/SpineVisual'
import WorldsVisual from './components/WorldsVisual'
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
    group: 'Plan the week',
    items: [
      'Four questions, one planned week',
      'Your real open hours, first',
      'Work placed onto the hour for you',
      'Projects split across sittings',
      'Standing time for recurring work',
      'A remedy when it doesn’t fit',
      'Drag, resize, overrule anything',
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

// What the week caught for you.
//
// This replaced the four step-questions, which were the flow's mechanics — true,
// but an explanation of how it works, and nobody buys a planner because they
// admire its steps. The feeling being sold is *relief*: the things you were
// quietly afraid you'd drop came back on their own, with a time on them. So each
// line is the worry in the operator's own voice, answered by an hour.
//
// All three are real behaviors, not a mood: a carried task keeps its ↻N and
// returns under Leftovers; a domain that's gone quiet contributes one small
// piece; an unsorted capture gets themed and slotted. (`src/lib/intake.ts`,
// `useWeekDraft`.)
const PLAN_CAUGHT = [
  ['The thing that’s slipped three weeks running.', 'Monday, 3:00pm'],
  ['The part of your life nobody’s asking about.', 'Wednesday, 30 minutes'],
  ['That note you typed at a stoplight.', 'Thursday, 9:30am'],
] as const

// The field, as ceilings — never as a checkbox matrix.
//
// A feature grid invites the reader to score us on integrations, mobile depth
// and onboarding, which are the three places landscape.md §4 says we're honestly
// behind today. Ceilings do the opposite: naming what each tool is genuinely
// great at earns the right to say where it stops, and the reader has already
// paid for most of these — they don't need to be argued with, they need to be
// recognized.
//
// Every "stops at" line is either in landscape.md §2 or corroborated outside our
// own docs (2026-07-27): reviewers describe Todoist/Asana calendars as deadline
// views with no external events and no availability awareness, and describe the
// AI planners as executing scheduling grunt work — Motion "cannot decide what
// matters — that is still on you."
const LANDSCAPE = [
  ['Akiflow · Sunsama', 'The best capture and time-blocking there is.', 'The week is the ceiling. A project can never be behind.'],
  ['Motion · Reclaim', 'Genuinely good at placing work in open time.', 'Neither can tell you what matters. That was always yours.'],
  ['Asana · Notion', 'Real project structure, dependencies, a portfolio.', 'Work goes in and never comes out onto a Tuesday.'],
  ['Things · Todoist', 'Beautiful, fast lists. Deserved taste.', 'No calendar truth, no capacity, no pace.'],
  ['Apple · Google Calendar', 'The truth about every meeting you have.', 'Nothing about intent. Your priorities aren’t on it.'],
] as const

// Naming our own ceilings right after naming everyone else's is what makes the
// list above read as analysis instead of trash talk — and it disqualifies the
// buyers we'd disappoint anyway (personas.md §4). Straight from landscape.md §4.
const LIMITS = [
  ['No team boards.', 'Single-player on purpose. Nobody else is ever in your funnel.'],
  ['Fewer integrations than Akiflow.', 'Capture is fast, but it doesn’t reach into every app yet.'],
  ['The phone is capture and your agenda.', 'Planning the week, projects and the review are desktop today.'],
] as const

// The three reasons a switcher bounces, answered before they're asked. Straight
// from the JTBD anxieties in personas.md §6 — "migrating years of tasks",
// "another system I'll abandon in three weeks", "it'll nag me" — plus O4, the
// single-player promise the site has never once said out loud.
//
// This is what's left of the old "what Nuvo refuses to do" list. Framed as
// refusals it read as a manifesto aimed at nobody; framed as the answer to a
// worry, every line is doing work.
const TRUST = [
  ['Start empty.', 'It’s useful on day one. Nothing to migrate.'],
  ['It never nags.', 'No streaks, no red badges, no debt ledger.'],
  ['Yours alone.', 'No shared board, no manager’s dashboard, nobody else in your account.'],
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
          <a href="#plan" className="hidden text-[13px] text-[var(--muted)] tap items-center sm:inline-flex hover:text-[var(--text)]">
            Plan the week
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

      {/* ── The page is the questions in the operator's head, in order ────────
          Not a feature tour and not an argument — six questions a real operator
          actually asks, each answered by a screen instead of a paragraph. Every
          visual below is a faithful recreation of a surface that exists, driven
          in the running app at 1440×900 on 2026-07-27. Nothing on this page is a
          UI we wish we had.

            hero  the app, as it actually looks
            1     "I need to time block my week — and I don't know if it fits"
            2     "do I have space for the projects that matter?"
            3     "how does a big thing become hours that get worked?"
            4     "I can't see what's going on in each part of my life"
            5     "I need fast execution AND long-term planning, in one tool"
            then  calendars · trust · where it runs · everything · price

          The word count above the buy zone is about ninety. That's deliberate:
          people scroll and look. Anything that had to be *read* to land is a
          section that hasn't earned its screen yet. */}
      <main>
        {/* Hero — the offer as a plane, not a screen.
            The hero used to be the Schedule, which put a week grid at the top of
            the page and another one in the very next section. It also sold only
            one of the three things that actually matter here. The offer is
            breadth × altitude × speed, and no single screen holds all three —
            so the hero is a diagram, drawn so it can never be mistaken for UI. */}
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pb-24 sm:pt-14">
          <div className="max-w-2xl">
            <h1 className="masthead reveal text-display text-[var(--text)]">
              Multiple jobs. Multiple domains. Multiple projects. One tool to rule them all.
            </h1>
            <p className="reveal reveal-delay-1 mt-5 max-w-xl text-pretty hero-support text-[var(--muted)]">
              From the promise you made in January to the hour it happens on Wednesday — every world
              you run, at every speed.
            </p>
            <CtaGroup className="reveal reveal-delay-2 mt-8" />
          </div>

          <div className="reveal reveal-delay-3 mt-12 sm:mt-16">
            <WorldsVisual />
          </div>
        </section>

        {/* 1 · "I need to time block my week. I don't know if I have enough time
               to do everything." Both halves answered by one screen: the labor
               disappears, and the meter says whether it fits. */}
        <section
          id="plan"
          className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24"
        >
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">
              “I need to time block my week — and I don’t know if it all fits.”
            </p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">Ten minutes on Sunday.</h2>
          </div>

          <div className="mt-10">
            <PlanWeekVisual />
          </div>

          <p className="section-label mt-14 text-[var(--muted)]">Without being asked</p>
          <ul className="mt-5 grid gap-x-10 gap-y-7 sm:grid-cols-3">
            {PLAN_CAUGHT.map(([worry, landed]) => (
              <li key={worry} className="border-t border-[var(--line)] pt-4">
                <p className="serif text-[1.125rem] italic leading-snug text-[var(--text)]">
                  {worry}
                </p>
                <p className="mono mt-2 text-[0.9375rem] text-[var(--accent)]">{landed}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* 2 · "I need to know if I have space to do the important things — the
               projects." The screen says no out loud, and then offers the two
               acts that resolve it (D-039). The buttons are the copy. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">
                “Do I have room for the projects that matter?”
              </p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                And if you don’t, a choice — not a footnote.
              </h2>
            </div>
            <ProjectRoomVisual />
          </div>
        </section>

        {/* 3 · Two questions, one screen — which is a fact about the product, not
               a saving of space. "How does a big thing get provisioned across
               weeks" and "which world am I starving" are answered by the same
               floor: projects time-boxed into sprints, above a coverage grid
               where a world with nothing in it is an empty row.

               This replaced three shrunken panels of three different screens.
               They read as UI while being nobody's actual screen — the exact
               overpromise the site now refuses. One screen, whole, instead. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">
              “How does a big thing turn into hours — and what am I starving?”
            </p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              Time-box the weeks. Watch the empty rows.
            </h2>
          </div>
          <div className="mt-10">
            <OnDeckVisual />
          </div>
        </section>

        {/* 4 · "I don't have visibility into the main areas of my life in terms of
               what I'm working toward." The domain's own floor: the vow, then
               thirteen weeks of whether you showed up, then what it cost you. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">
                “What am I actually working toward here?”
              </p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                Each world, and whether you showed up.
              </h2>
            </div>
            <ChapelVisual />
          </div>
        </section>

        {/* 5 · "I need extremely fast execution day to day, but also long-term
               planning — one tool." The proof is the app's own spine. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">
              “I need both — the year, and what I do in ten minutes.”
            </p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">Both speeds, one system.</h2>
          </div>
          <div className="mt-10">
            <SpineVisual />
          </div>
        </section>

        {/* It fits the calendars you already keep. */}
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
                Work on Google. Family on Apple. Corp on Microsoft. The youth group ICS feed. One
                grid — so the hour you took for the gym is as real as the board call.
              </p>
            </div>
            <CalendarsVisual />
          </div>
        </section>

        {/* The field — as ceilings, and then the reason this exists at all.
            Placed here, last before the price, because "I already have a tool
            for this" is the final objection standing between the reader and a
            card. Everything above earns the right to make it. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">The field</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              You’ve already tried to solve this.
            </h2>
          </div>

          <ul className="mt-10">
            {LANDSCAPE.map(([tool, nails, stops]) => (
              <li
                key={tool}
                className="grid gap-x-8 gap-y-1 border-t border-[var(--line)] py-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.1fr)] sm:items-baseline"
              >
                <p className="masthead text-[1.0625rem] leading-snug text-[var(--text)]">{tool}</p>
                <p className="text-[0.9375rem] leading-snug text-[var(--muted)]">{nails}</p>
                <p className="text-[0.9375rem] leading-snug text-[var(--text)]">{stops}</p>
              </li>
            ))}
          </ul>

          <div className="mt-10 max-w-2xl">
            <p className="masthead text-[1.375rem] leading-snug text-[var(--text)]">
              Every one of them owns an altitude. Nuvo owns the elevator.
            </p>
            {/* Verifiable, and stronger than any superlative: the multi-domain,
                quarter-to-week practice is a thriving category of paper planners
                and templates. Nobody has put it in software that also holds the
                calendar. */}
            <p className="mt-4 text-body text-[var(--muted)]">
              The system you actually want, you’ve probably already bought on paper.
            </p>
          </div>
        </section>

        {/* Why it exists. The guide needs empathy before authority (brandscript
            §3), and this is the most first-hand thing on the page: it's not a
            competitive claim, it's the reason someone sat down and built it.
            Written in the first person precisely so nothing here is a claim
            about another company's product — only about using one. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">Why this exists</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              I used Motion. It decided too much for me.
            </h2>
            <p className="mt-6 serif text-[1.125rem] italic leading-relaxed text-[var(--text)]">
              It built my day for me, and when it was wrong about the thing that mattered most,
              there was nothing to argue with — no way to see why it chose that. The screen kept
              getting more complicated and the week kept getting less mine.
            </p>
            <p className="mt-5 text-body text-[var(--muted)]">
              So Nuvo does the labor and leaves the judgment. It composes a week and waits. Every
              block drags. Every number tells you where it came from. When it says you can’t carry
              the week, it still lets you.
            </p>
            <p className="mt-6 text-[0.9375rem] text-[var(--muted)]">
              — Phil, who runs four worlds and built this for the Sunday night it kept ruining.
            </p>
          </div>

          {/* Our own ceilings, named in the same breath. Without this the list
              above is trash talk; with it, it's analysis. */}
          <ul className="mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-3">
            {LIMITS.map(([title, body]) => (
              <li key={title} className="border-t border-[var(--line)] pt-4">
                <p className="text-[0.9375rem] font-medium leading-snug text-[var(--text)]">
                  {title}
                </p>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--muted)]">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* The three reasons a switcher bounces, answered before they're asked
            (personas.md §6). This replaced the refusals manifesto. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-3">
            {TRUST.map(([title, body]) => (
              <li key={title} className="border-t border-[var(--line)] pt-4">
                <p className="masthead text-[1.25rem] leading-snug text-[var(--text)]">{title}</p>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--muted)]">{body}</p>
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
