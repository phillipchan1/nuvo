import AltitudeVisual from './components/AltitudeVisual'
import CalendarsVisual from './components/CalendarsVisual'
import ChatVisual from './components/ChatVisual'
import ConvergeVisual from './components/ConvergeVisual'
import DomainFloorVisual from './components/DomainFloorVisual'
import LedgerVisual from './components/LedgerVisual'
import OnDeckVisual from './components/OnDeckVisual'
import PlanWeekVisual from './components/PlanWeekVisual'
import ProjectRoomVisual from './components/ProjectRoomVisual'
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
      'What moved, in each of your lives',
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
      'One-tap undo on every write',
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

// The field, as ceilings — never as a checkbox matrix.
//
// A feature grid invites the reader to score us on integrations, mobile depth
// and onboarding, which are the three places landscape.md §4 says we're honestly
// behind today. Ceilings do the opposite: the reader has already paid for most
// of these and doesn't need to be argued with, only recognized.
//
// One line each. There used to be a middle column naming what each tool is
// genuinely great at — good writing, and it earned the right to say where each
// one stops. It's gone because the sentence above the list now does that job
// once ("genuinely good at the altitude it owns"), so the column had become a
// second read of the same concession, five times over. Recover it from git if
// this ever becomes a real comparison page.
//
// Every line here is either in landscape.md §2 or corroborated outside our own
// docs (2026-07-27): reviewers describe Todoist/Asana calendars as deadline
// views with no external events and no availability awareness, and describe the
// AI planners as executing scheduling grunt work — Motion "cannot decide what
// matters — that is still on you."
const LANDSCAPE = [
  ['Akiflow · Sunsama', 'The week is the ceiling. A project can never be behind.'],
  ['Motion · Reclaim', 'Neither can tell you what matters. That was always yours.'],
  ['Asana · Notion', 'Work goes in and never comes out onto a Tuesday.'],
  ['Things · Todoist', 'No calendar truth, no capacity, no pace.'],
  ['Apple · Google Calendar', 'Nothing about intent. Your priorities aren’t on it.'],
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
  [
    'It won’t run your day for you.',
    'It composes a week and waits. Every block drags, every number says where it came from, and you promote the work — never the software.',
  ],
  ['It won’t nag you.', 'No streaks, no red badges, no debt ledger. It reports; you decide.'],
  [
    'It won’t show anyone else.',
    'Nobody else is ever in your funnel. No shared board, no manager’s dashboard, no one watching your calendar.',
  ],
  [
    'It won’t make you migrate.',
    'Useful on day one with an empty backlog. Nothing to import, nothing to set up before it earns its place.',
  ],
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
        {/* Hero — the act, demonstrated. Not the offer, diagrammed.
            Beat one is unchanged and stays unchanged: recognition with no jargon
            and no label to accept. Rotating an identity noun ("the todo app for
            Solopreneurs / Overemployed / …") was rejected and stays rejected —
            P1 has no name for itself, half those labels are business structure
            rather than self-image, and "todo app" caps the claim at the ceiling
            this product exists to break (D-057, personas.md §4).

            The headline is the promise, in two beats that are the operator's own
            words: *nothing gets lost* (everything converges) and *everything gets
            done* (it descends to an hour). Those aren't one feeling — they're the
            two distinct fears, and they map exactly onto the product's two
            motions. The recognition beat moved into the subhead rather than out:
            "you live more than one life" still has to arrive, it just no longer
            has to arrive first, because the visual is now carrying the claim that
            beat two used to.

            The hero used to be a lives × altitude plane. A diagram is an argument
            you have to decode: in four seconds a stranger learned Nuvo has
            categories and time horizons, and never learned there was a planner
            in it. The empty cells were load-bearing to us and read as an
            unfinished mockup to everyone else. So the hero demonstrates instead:
            one act — pool left, grid of time right — performed three times at
            three clock speeds, which is the elevator claim shown rather than
            argued. A cursor does every drag. See AltitudeVisual. */}
        {/* The whole visual has to clear the fold at 1440×900, or the argument of
            the section is the one thing the reader never sees. That budget is
            why the h1 runs to max-w-3xl and the gaps below it are tighter than
            the rest of the page. */}
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-8 sm:px-8 sm:pb-24 sm:pt-8">
          <div className="max-w-3xl">
            <h1 className="masthead reveal text-display text-[var(--text)]">
              Nothing you’re carrying gets lost. Everything you’re accountable for gets done.
            </h1>
            <p className="reveal reveal-delay-1 mt-4 max-w-xl text-pretty hero-support text-[var(--muted)]">
              You live more than one life. One funnel holds all of them — from what you’re
              responsible for, down to the hour on your calendar.
            </p>
            <CtaGroup className="reveal reveal-delay-2 mt-6" />
          </div>

          <div className="reveal reveal-delay-3 mt-8 sm:mt-8">
            <AltitudeVisual />
          </div>
        </section>

        {/* 1 · In. "Nothing gets lost" is half the hero's promise, and it's the
               half a reader will refuse to believe on assertion — everyone has
               been promised an inbox. So show the motion instead: loose things,
               out of register, finding one line. Same image the app opens with
               (orientation/Visuals.tsx → WelcomeHero, "the one image the whole
               product is"), so the site and the first screen agree.

               Labels are six things a person recognizes *carrying*, not six
               input methods — a list of capture surfaces is a feature grid, and
               the argument here is breadth of what gets caught, not of how. */}
        <section
          id="capture"
          className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24"
        >
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">“I just thought of something.”</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                It gets in before you can forget it.
              </h2>
              <p className="mt-5 text-body text-[var(--muted)]">
                ⌥Space from anywhere on the Mac. ⌘K inside it. Your voice. Another app, over the
                API. Type it like a text message —{' '}
                <span className="mono text-[var(--text)]">
                  call David tomorrow 9am 30m #church !high
                </span>{' '}
                — and it arrives as structure, in one inbox, out of your head.
              </p>
            </div>
            <ConvergeVisual />
          </div>
        </section>

        {/* 2 · Down, onto time that's actually free. The other half of the
               promise, and the place the calendars earn their keep — which is
               why they're folded in here rather than standing alone. A calendar
               integration isn't a feature; it's the reason the free-hours number
               is true. A standalone "Calendars" section sold plumbing.

               ProjectRoomVisual joins it for the same reason: "how much room is
               there" and "what happens when there's none" are one question. */}
        <section
          id="plan"
          className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24"
        >
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">“Do I even have the hours?”</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              It plans against the time you actually have left.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Work on Google. Family on Apple. Corp on Microsoft. The youth-group ICS feed. Nuvo
              reads every one of them, subtracts what’s already spoken for, and plans into what’s
              genuinely open — so the hour you took for the gym is as real as the board call.
            </p>
          </div>

          <div className="mt-8" id="calendars">
            <CalendarsVisual />
          </div>

          <div className="mt-10">
            <PlanWeekVisual />
          </div>

          {/* PLAN_CAUGHT lived here — three worries ("the thing that's slipped
              three weeks running", "that note you typed at a stoplight")
              answered by an hour. Cut, not because it was untrue but because
              the capture section one screen above is now the *same list*, and
              moving ("the one you keep re-remembering" travelling into the
              inbox) beats sitting. Saying it twice made the first one feel
              like a claim the second had to back up. */}

          <div className="mt-16 grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">
                “And when there isn’t room for the thing that matters?”
              </p>
              <h3 className="masthead mt-3 text-[1.5rem] leading-snug text-[var(--text)]">
                It says so — and gives you the choice, not a footnote.
              </h3>
            </div>
            <ProjectRoomVisual />
          </div>
        </section>

        {/* 3 · Out. The collision you can't see yet — Q2 on the ledger, and the
               only question on this page nothing else touches.

               Its heading used to be "Time-box the weeks. Watch the empty rows."
               The second half was the *domain* question ("which life am I
               starving"), which §4 below answers properly with a quarter of
               evidence behind it. Asking it here too meant the reader met it
               twice and got a worse answer first. On Deck is about *time*, so
               it says one thing about time. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">
              “What’s going to blow up that I can’t see yet?”
            </p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              Three weeks out, before it’s a problem.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Every project carries a required pace — remaining effort over the weeks left. Time-box
              them onto the weeks ahead and the collision shows up while it’s still cheap: two big
              things landing on the same week, in the middle of the month, with time to move one.
            </p>
          </div>
          <div className="mt-10">
            <OnDeckVisual />
          </div>
        </section>

        {/* 4 · Measured — one section, two focal lengths.
               This was three sections saying one thing. The ledger answered
               "where did my week go", the domain floor answered "each life, and
               whether you showed up", and Friday's first row said "what got
               hours" — the *same measurement*, per life, three times, across
               four screens. The reader doesn't experience that as thoroughness;
               they experience it as the page repeating itself.

               It's one question at two focal lengths, so it's now one section
               that says so out loud: this week, then the last quarter. The
               near view carries the differentiated claim (nothing else can
               attribute an attended meeting to a part of your life). The long
               view carries the cost, in the app's own sentence. Neither is
               redundant once the zoom is named. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">“Where is my time actually going?”</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              Then it tells you where the hours went.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Every meeting you attended and every block you finished is evidence. Nuvo assigns each
              one to the part of your life it belonged to — automatically, and it says so when it
              isn’t sure. Nobody types a timesheet.
            </p>
          </div>

          <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:gap-12">
            <div>
              {/* Numeric, because "This week" / "The last quarter" are already
                  written inside the two screens — the eyebrow's job is to name
                  the *zoom*, and repeating the visual's own label made the pair
                  read as two of the same thing again. */}
              <p className="section-label text-[var(--accent)]">Seven days</p>
              <div className="mt-4">
                <LedgerVisual />
              </div>
            </div>
            <div>
              <p className="section-label text-[var(--accent)]">Thirteen weeks</p>
              <div className="mt-4">
                <DomainFloorVisual />
              </div>
            </div>
          </div>

          {/* The long view earns the only hard sentence on the page, and the
              product writes it about you — we don't. */}
          <p className="mt-10 max-w-2xl serif text-[1.25rem] italic leading-snug text-[var(--text)]">
            Some weeks that number is the most useful thing you’ll read all week.
          </p>
        </section>

        {/* 5 · Ask. Not a step in the pipeline — a second way to drive every
               step of it, which is why it sits after the mechanism rather than
               inside it.

               The claim is deliberately not "it has an AI"; every planner has
               one now, and the field table below is about to point out that the
               AI planners still can't tell you what matters. The claim is
               *restraint made visible*: it does the thing, it shows you the row
               it changed, and the row carries an undo. That's Principles 3 and
               4 drawn rather than asserted, and it sets up "It won't run your
               day for you" further down.

               Thirty-eight tools ship (agent/toolDefs.ts). The ones named here
               are those a stranger can judge without knowing the vocabulary. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">“Just do it for me.”</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                Or ask, and watch it show its work.
              </h2>
              <p className="mt-5 text-body text-[var(--muted)]">
                Say it the way you’d say it to a person. Nuvo can capture, schedule, reschedule,
                start a project, set a key result, decline the meeting — and every time it touches
                something, it hands back the actual row it changed, with an undo on it.
              </p>
              <p className="mt-5 text-body text-[var(--muted)]">
                It drafts into quiet places and waits. Nothing reaches your calendar because the
                assistant felt strongly about it.
              </p>
            </div>
            <ChatVisual />
          </div>
        </section>

        {/* 6 · Why this exists — and the field, in one section.
               These were two, back to back, and they argued the same case
               twice: the founder story is *about Motion*, and then the ceilings
               table said the Motion thing again two inches below it. Worse, the
               table carried a middle column naming what each tool is great at,
               which had become a second copy of the intro line above it — so
               every row was read twice before it said anything.

               Now: the first-person account leads, because it's the one thing
               on this page nobody can copy and it can't be argued with (it's a
               claim about *using* a product, not about the product). The
               ceilings follow as one scannable line each, and the fairness that
               the "what it nails" column used to carry moved into a single
               sentence above them. Roughly half the reading, same argument.

               The middle column's copy is worth recovering from git if this
               ever needs to be a real comparison page — it was good, it just
               wasn't earning a second read here. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">Why this exists</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              I used Motion. It decided too much for me.
            </h2>
            <p className="mt-6 serif text-[1.125rem] italic leading-relaxed text-[var(--text)]">
              It built my day for me, and when it was wrong about the thing that mattered most,
              there was nothing to argue with. The screen kept getting more complicated and the week
              kept getting less mine.
            </p>
            <p className="mt-5 text-body text-[var(--muted)]">
              So Nuvo does the labor and leaves the judgment. It composes a week and waits. Every
              block drags. When it says you can’t carry the week, it still lets you.
            </p>
            <p className="mt-6 text-[0.9375rem] text-[var(--muted)]">
              — Phil, who’s living four lives and built this for the Sunday night it kept ruining.
            </p>
          </div>

          {/* The rest of the field, as ceilings. One line each — the reader has
              already paid for most of these and doesn't need to be argued with,
              only recognized. */}
          <p className="mt-14 max-w-2xl text-body text-[var(--muted)]">
            It wasn’t only Motion. Every tool I tried is genuinely good at the altitude it owns —
            and stops at its edge.
          </p>

          <ul className="mt-8">
            {LANDSCAPE.map(([tool, stops]) => (
              <li
                key={tool}
                className="grid gap-x-8 gap-y-1 border-t border-[var(--line)] py-3.5 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] sm:items-baseline"
              >
                <p className="masthead text-[1.0625rem] leading-snug text-[var(--text)]">{tool}</p>
                <p className="text-[0.9375rem] leading-snug text-[var(--muted)]">{stops}</p>
              </li>
            ))}
          </ul>

          <p className="masthead mt-10 max-w-2xl text-[1.375rem] leading-snug text-[var(--text)]">
            Every one of them owns an altitude. Nuvo owns the elevator.
          </p>

          {/* Our own ceilings, named in the same breath. Without this the list
              above is trash talk; with it, it's analysis — and it disqualifies
              the buyers we'd disappoint anyway (personas.md §4). */}
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

        {/* The reasons a switcher bounces, answered before they're asked
            (personas.md §6) — now headed, because the refusals *are* the
            product (overview.md §2: "these are not 'not yet', they are
            refusals, and they are load-bearing"). Unheaded, three orphan
            paragraphs after the founder story read as filler.

            "Nobody else is in your funnel" is Question Ledger row O4, which the
            docs flag as a real differentiator the site has never once stated. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">Before you ask</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">What Nuvo won’t do.</h2>
          </div>
          <ul className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
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

        {/* Closing — the hero's own sentence, returned. The page opens on the
            promise and closes on it, and everything between is the mechanism
            that earns it. The old label here was already "Nothing lost"; it was
            circling this line without saying it. */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <p className="section-label text-[var(--muted)]">
              Built for the person everything runs through
            </p>
            <h2 className="masthead mt-4 text-lead text-[var(--text)]">
              Nothing you’re carrying gets lost. Everything you’re accountable for gets done.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Ten minutes on Sunday. A Friday that can prove it.
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
