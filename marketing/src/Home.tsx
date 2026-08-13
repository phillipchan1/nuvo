import AltitudeVisual from './components/AltitudeVisual'
import CalendarsVisual from './components/CalendarsVisual'
import ChatVisual from './components/ChatVisual'
import ConvergeVisual from './components/ConvergeVisual'
import DomainFloorVisual from './components/DomainFloorVisual'
import LedgerVisual from './components/LedgerVisual'
import OnDeckVisual from './components/OnDeckVisual'
import PlanWeekVisual from './components/PlanWeekVisual'
import ProjectRoomVisual from './components/ProjectRoomVisual'
import ScatterVisual from './components/ScatterVisual'
import { useCallback, useState, type ReactNode } from 'react'
import { useReveal } from './useReveal'
import { ACCESS_MAILTO, APP_URL, DOWNLOAD_MAC_URL, RELEASES_REPO } from './config'

/* ═══════════════════════════════════════════════════════════════════════════
   THE PAGE IS ONE SENTENCE, IN ORDER.

   The operator's own words, and every section below is one clause of it:

     "My crazy scattered life goes into this one funnel, and I know exactly what
      I'm doing every single day and every single week — without losing track of
      the larger projects and initiatives in my life. And I have full visibility
      on everywhere I spend my time."

   That sentence contains three certainties, and they are the product:

     1. I know what today is.
     2. I know the big things are still alive.
     3. I know where the hours went.

   The claim is not any one of them — every competitor sells one. It's holding
   all three AT ONCE, which is the thing a stack of four apps structurally
   cannot do, because the answer isn't a feature of any of them; it's a
   relationship between them. That's §7 (the moat), and it's why this page
   argues from the reader's *desk* rather than from a competitor table.

   WHAT CHANGED FROM THE PREVIOUS VERSION (D-094) AND WHY:

   - The old hero promised "Everything you're accountable for gets done." That
     is the category's most-defeated claim, and — worse — it is the opposite of
     this product's actual stance. The best sentence in the app is "when it says
     you can't carry the week, it still lets you." Leading with omnipotence and
     selling honesty means the reader who believes the headline is the wrong
     customer and the one who doesn't believe it leaves. The new hero refuses
     the false promise in its first clause.

   - The page was ordered as the *pipeline* (in, down, out, measured, ask). That
     is how the software works, not how the wanting works. It's now ordered as
     the sentence above: recognition → one place → today → the big thing →
     the hours. The mechanism is identical; only the reason each screen is on
     screen changed.

   - The competitor table (LANDSCAPE) is retired. Naming five tools invites the
     reader to score us on integrations, mobile depth and onboarding, which
     landscape.md §4 says are the three places we're honestly behind. §7 makes
     the stronger version of the same argument without naming anyone: the parts
     are good, and the answer still isn't in them. Recover the table from git if
     a real comparison page is ever wanted.

   - §2 is new, and it is the section the page has never had: the reader's own
     desk, failing. Everything before this was capability; nothing made the
     reader distrust what they already own.

   Nothing here is a UI we wish we had — every visual is a faithful recreation
   of a shipped surface, driven in the running app.
   ═══════════════════════════════════════════════════════════════════════════ */

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

// Our own ceilings, named in the same breath as the moat — without this, §7 is
// a sales pitch; with it, it's an assessment. It also disqualifies the buyers
// we'd disappoint anyway (personas.md §4). Straight from landscape.md §4.
const LIMITS = [
  ['No team boards.', 'Single-player on purpose. Nobody else is ever in your funnel.'],
  ['Fewer integrations than Akiflow.', 'Capture is fast, but it doesn’t reach into every app yet.'],
  ['The phone is capture and your agenda.', 'Planning the week, projects and the review are desktop today.'],
] as const

// The four reasons a switcher bounces, answered before they're asked. Straight
// from the JTBD anxieties in personas.md §6 — "migrating years of tasks",
// "another system I'll abandon in three weeks", "it'll nag me" — plus O4, the
// single-player promise the site went a year without saying out loud.
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
// paying. "Your account is yours alone" is a real differentiator (ledger O4).
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
      className={`btn-ghost tap inline-flex items-center gap-2 ${className}`}
    >
      <svg width="15" height="15" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
        <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
      </svg>
      Download for Mac
    </a>
  )
}

/** Start free is primary everywhere now. Asking a stranger for a 40MB install
 *  before the argument has landed is a commitment they have no reason to make
 *  yet — and the trial, not the binary, is what we actually want them to take.
 *  The DMG keeps its clever latest-asset resolver; it just stopped leading. */
function CtaGroup({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <a href={APP_URL} className="btn-primary tap" rel="noopener noreferrer">
        Start free
      </a>
      <DownloadMacButton />
    </div>
  )
}

/** A section that rises as it arrives. See useReveal — the un-observed default
 *  is visible, so the prerendered HTML is never blank. */
function Section({
  children,
  className = '',
  id,
}: {
  children: ReactNode
  className?: string
  id?: string
}) {
  const ref = useReveal<HTMLElement>()
  return (
    <section ref={ref} id={id} className={className}>
      {children}
    </section>
  )
}

const SECTION = 'mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24'

export default function Home() {
  return (
    <div className="atmosphere min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 pt-5 pb-2 sm:px-8 sm:pt-7">
        <a href="/" className="wordmark text-[1.125rem] text-[var(--text)] tap inline-flex items-center shrink-0">
          Nuvo
        </a>
        <nav className="flex items-center gap-2 sm:gap-3">
          <a href="#week" className="hidden text-[13px] text-[var(--muted)] tap items-center sm:inline-flex hover:text-[var(--text)]">
            The week
          </a>
          <a href="#bigger" className="hidden text-[13px] text-[var(--muted)] tap items-center sm:inline-flex hover:text-[var(--text)]">
            The bigger picture
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
        {/* ── HERO ────────────────────────────────────────────────────────────
            The promise is *certainty*, and the first clause buys the right to
            claim it by refusing the thing every other planner promises. "Your
            life won't get simpler" is not a hedge — it's the product's actual
            position (it never reduces your obligations; it tells you the truth
            about them), and a reader who has been sold "effortless" four times
            recognizes the refusal as the first honest sentence on a landing
            page in years.

            Reader-facing, per D-057: the site speaks to the person's situation.
            The first-person voice is real and it's used — but in §7, where it's
            an account of *using* a product and can't be argued with, not here,
            where it would make the promise about the builder.

            The visual is unchanged and stays unchanged. AltitudeVisual already
            performs the elevator — one act, three clock speeds, a human cursor
            doing every drag — which is the second clause ("the big thing never
            goes quiet") shown before it's said. */}
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-8 sm:px-8 sm:pb-24 sm:pt-8">
          <div className="max-w-3xl">
            <h1 className="masthead reveal text-display text-[var(--text)]">
              Your life won’t get simpler. Your week can.
            </h1>
            {/* Three lines at 1440 and five on a phone. It was seven and eight:
                the hero's whole job is to be *seen*, and a supporting paragraph
                long enough to push AltitudeVisual under the fold costs the page
                the one thing that proves the claim. The dropped clause ("the big
                thing never goes quiet") isn't lost — it's §5's headline, where it
                has a screen behind it. */}
            <p className="reveal reveal-delay-1 mt-4 max-w-2xl text-pretty hero-support text-[var(--muted)]">
              You’re running three or four lives at once, out of apps that have never been
              introduced. Nuvo is one line from everything you’re responsible for down to what
              you’re doing at 2pm today.
            </p>
            <CtaGroup className="reveal reveal-delay-2 mt-6" />
            <p className="reveal reveal-delay-2 mt-4 text-[0.8125rem] text-[var(--muted)]">
              Fourteen days free, no card. Nothing to import. Nobody else is ever in your account.
            </p>
          </div>

          <div className="reveal reveal-delay-3 mt-8 sm:mt-8">
            <AltitudeVisual />
          </div>
        </section>

        {/* ── 1 · THE DESK ────────────────────────────────────────────────────
            The section this page has never had. Everything the old version did
            was capability — nothing gave the reader a reason to distrust the
            stack they already own, and you cannot sell a system to someone who
            believes they have one.

            It argues from *their desk*, not from a competitor table: four tools,
            each genuinely good, each answering honestly, and the question still
            unanswered at the end. Naming the tools would turn this into a
            feature comparison, which landscape.md §4 says we lose on
            integrations, mobile depth and onboarding. Shapes, not logos.

            It ends UNRESOLVED on purpose. The tension it opens is what the next
            five sections spend. */}
        <Section id="desk" className={SECTION}>
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">The desk you’re working from</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              Four apps. None of them have ever been introduced.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Every one of them is good at its job. Ask any of them the only question that
              actually matters and watch what happens.
            </p>
          </div>
          <div className="mt-10">
            <ScatterVisual />
          </div>
        </Section>

        {/* ── 2 · IN ──────────────────────────────────────────────────────────
            "My crazy scattered life goes into this one funnel." Same image the
            app opens with (orientation/Visuals.tsx → WelcomeHero), so the site
            and the first screen agree about what the product is.

            Labels are six things a person recognizes *carrying*, not six input
            methods — a list of capture surfaces is a feature grid, and the
            argument here is the breadth of what gets caught, not of how. */}
        <Section id="capture" className={SECTION}>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-16">
            <div>
              <p className="section-label text-[var(--accent)]">One place</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                All of it goes in before you can forget it.
              </h2>
              <p className="mt-5 text-body text-[var(--muted)]">
                ⌥Space from anywhere on the Mac. ⌘K inside it. Your voice. Another app, over the
                API. Type it like a text message —{' '}
                <span className="mono text-[var(--text)]">
                  call David tomorrow 9am 30m #church !high
                </span>{' '}
                — and it arrives as structure, in one inbox, out of your head.
              </p>
              <p className="mt-5 text-body text-[var(--muted)]">
                That’s the last time you have to hold it.
              </p>
            </div>
            <ConvergeVisual />
          </div>
        </Section>

        {/* ── 3 · CERTAINTY #1 — I KNOW WHAT TODAY IS ─────────────────────────
            The clause: "I know exactly what I'm doing every single day and
            every single week."

            The differentiating sentence is the first one, and it's aimed
            squarely at the board: a scheduled task IS the block. That is the
            one structural fact that separates this from every list app and
            every project tool, and the page has never once stated it plainly.

            Calendars are folded in here rather than standing alone, because a
            calendar integration isn't a feature — it's the reason the open-hours
            number is true. A standalone "Calendars" section sold plumbing. */}
        <Section id="week" className={SECTION}>
          <div className="max-w-2xl">
            <p className="section-label text-[var(--accent)]">You know what today is</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              And it comes back out onto a Tuesday.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              A board is where work goes to be admired. Here, a scheduled task <em>is</em> the
              block — one row, on one grid, beside the meetings you can’t move. Nothing gets
              re-typed into a calendar, and nothing sits in a column called “In progress” for
              three weeks pretending to be alive.
            </p>
            <p className="mt-5 text-body text-[var(--muted)]">
              Work on Google. Family on Apple. Corp on Microsoft. The youth-group ICS feed nobody
              owns. Nuvo reads every one of them, subtracts what’s already spoken for, and plans
              into what’s genuinely open — so the hour you took for the gym is as real as the
              board call.
            </p>
          </div>

          <div className="mt-8" id="calendars">
            <CalendarsVisual />
          </div>

          <div className="mt-10">
            <PlanWeekVisual />
          </div>
        </Section>

        {/* ── 4 · THE PROOF THAT THE CERTAINTY IS WORTH ANYTHING ──────────────
            The arithmetic used to be a candidate for the hero. It's better here.
            As an opening claim, "it'll tell you the week doesn't fit" is a
            negative and a stranger has no reason to believe the math. Arriving
            *after* the reader has seen the week get planned, it does a different
            and more valuable job: it's the reason to trust the certainty the
            last section just claimed. A planner that can only ever say yes isn't
            measuring anything.

            The second sentence is the whole brand in six words, and it's the one
            place the page is allowed to sound like a manifesto. */}
        <Section className={SECTION}>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">“But is the week real?”</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                It tells you when the week doesn’t fit — then lets you carry it anyway.
              </h2>
              <p className="mt-5 text-body text-[var(--muted)]">
                Everything you’ve committed to, against the hours you actually have left, checked
                against the pace you’ve <em>proven</em> — not the pace you hoped for. When there
                isn’t room for the thing that matters, it says so, and hands you the choice
                instead of a footnote.
              </p>
              <p className="mt-5 text-body text-[var(--muted)]">
                It never refuses you. It just refuses to pretend.
              </p>
            </div>
            <ProjectRoomVisual />
          </div>
        </Section>

        {/* ── 5 · CERTAINTY #2 — THE BIG THING IS STILL ALIVE ─────────────────
            The clause: "without losing track of the larger projects and
            initiatives in my life." This is the half of the promise no list app
            can touch, and in the old page it sat at §3 with no connection to any
            promise at all.

            Drift lives here now, as one sentence, doing the job it's actually
            good at: explaining why *pace* is the thing being measured. As a
            headline it was an accusation aimed at a reader who hadn't agreed to
            anything yet; as the second line of a section about collisions, it's
            the reason the section exists. (Amends the D-094 cut, which removed
            it entirely.) */}
        <Section id="bigger" className={SECTION}>
          <div className="max-w-2xl">
            <p className="section-label text-[var(--accent)]">You don’t lose the bigger picture</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              The thing you committed to in January doesn’t go quiet while you’re busy.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Nothing goes wrong on any given day — that’s exactly how a quarter disappears. So
              every project carries a required pace: remaining effort over the weeks left. Time-box
              them onto the weeks ahead and the collision shows up while it’s still cheap, two big
              things landing on the same week with a month to move one.
            </p>
            <p className="mt-5 text-body text-[var(--muted)]">
              You execute today <em>and</em> you can see the quarter. That’s the part no list app
              has ever been able to do.
            </p>
          </div>
          <div className="mt-10">
            <OnDeckVisual />
          </div>
        </Section>

        {/* ── 6 · CERTAINTY #3 — WHERE THE HOURS WENT ─────────────────────────
            The clause: "full visibility on everywhere I spend my time."

            One question at two focal lengths, and the section says the zoom out
            loud so the pair never reads as two of the same thing. The near view
            carries the differentiated claim (nothing else can attribute an
            attended meeting to a part of your life). The long view carries the
            cost, in the app's own sentence. */}
        <Section className={SECTION}>
          <div className="max-w-2xl">
            <p className="section-label text-[var(--accent)]">You can see where it all went</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              Not a feeling about the week. Evidence.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Every meeting you attended and every block you finished is proof. Nuvo assigns each
              one to the part of your life it belonged to — automatically, and it says so when it
              isn’t sure. Nobody types a timesheet.
            </p>
          </div>

          <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:gap-12">
            <div>
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

          <p className="mt-10 max-w-2xl serif text-[1.25rem] italic leading-snug text-[var(--text)]">
            Some weeks that number is the most useful thing you’ll read all week.
          </p>
        </Section>

        {/* ── 7 · ASK ─────────────────────────────────────────────────────────
            Not a step in the pipeline — a second way to drive every step of it,
            which is why it sits after the mechanism rather than inside it.

            The claim is deliberately not "it has an AI"; every planner has one.
            The claim is *restraint made visible*: it does the thing, it shows
            you the row it changed, and the row carries an undo. Principles 3
            and 4 drawn rather than asserted. */}
        <Section className={SECTION}>
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
        </Section>

        {/* ── 8 · THE MOAT, AND WHY IT'S NOT A COMPARISON ─────────────────────
            This replaces the competitor table, and it's a stronger argument for
            a structural reason: a table invites scoring, and the reader scores
            on integrations, mobile depth and onboarding — the three places
            landscape.md §4 says we lose today. This can't be scored. It
            describes the reader's own desk and ends somewhere no competitor can
            follow, because none of them can answer it without admitting they're
            a part rather than a whole.

            The founder account follows rather than leads, and it's the only
            first-person voice on the page. It's a claim about *using* a product,
            which is the one kind a competitor can't rebut — and per brandscript
            §3, the register is "one of its operators," never "built for me."

            Our own ceilings sit in the same section deliberately. Without them
            the moat paragraph is a sales pitch; with them it's an assessment. */}
        <Section className={SECTION}>
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">Why you can’t just build this yourself</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              You already own the parts. The answer isn’t in any of them.
            </h2>
            <p className="mt-6 text-body text-[var(--muted)]">
              A list app that’s genuinely good at lists. A board where the projects live. A
              calendar that tells the truth about your day. Four good tools — and the thing you
              actually want to know isn’t inside any of them, because it isn’t a feature. It’s a
              relationship between four things that have never met.
            </p>
            <p className="mt-6 serif text-[1.25rem] italic leading-snug text-[var(--text)]">
              No amount of syncing turns a stack into a system.
            </p>
            <p className="mt-6 text-body text-[var(--muted)]">
              That’s the whole reason this exists. Not a better list — the single line the question
              can travel down.
            </p>
          </div>

          {/* The first-person account. One claim nobody can copy, placed where
              it converts: after the mechanism, next to the limits. */}
          <div className="mt-14 max-w-2xl border-t border-[var(--line)] pt-8">
            <p className="section-label text-[var(--muted)]">Why it exists</p>
            <h3 className="masthead mt-3 text-[1.5rem] leading-snug text-[var(--text)]">
              I used Motion. It decided too much for me.
            </h3>
            <p className="mt-5 serif text-[1.125rem] italic leading-relaxed text-[var(--text)]">
              It built my day for me, and when it was wrong about the thing that mattered most,
              there was nothing to argue with. The screen kept getting more complicated and the
              week kept getting less mine.
            </p>
            <p className="mt-5 text-body text-[var(--muted)]">
              So Nuvo does the labor and leaves the judgment. It composes a week and waits. Every
              block drags. When it says you can’t carry the week, it still lets you.
            </p>
            <p className="mt-6 text-[0.9375rem] text-[var(--muted)]">
              — Phil, who’s running four lives and built this for the Sunday night it kept ruining.
            </p>
          </div>

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
        </Section>

        {/* ── 9 · THE REFUSALS ────────────────────────────────────────────────
            The reasons a switcher bounces, answered before they're asked
            (personas.md §6). Headed, because the refusals *are* the product
            (overview.md §2: "these are not 'not yet', they are refusals, and
            they are load-bearing"). */}
        <Section className={SECTION}>
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
        </Section>

        {/* ── 10 · EVERYTHING INCLUDED ────────────────────────────────────────
            The depth signal, grouped so it reads as a system, and placed right
            before pricing where abundance justifies a decision instead of
            interrupting the argument. "Where it runs" is now a group inside it
            rather than its own section — a whole screen given to "we have a Mac
            app" was a section the argument didn't need, and the iPhone line no
            longer advertises a gap: the PWA installs today. */}
        <Section className={SECTION}>
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">Everything included</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">One price. All of it.</h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              No tiers, no add-ons, nothing saved back for a “pro” plan. This is the whole product,
              on the Mac, in any browser, and installed on your phone.
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
        </Section>

        {/* ── 11 · PRICING ────────────────────────────────────────────────────
            Lands after the value is made, before the closing CTA. The framing is
            the stack the reader is currently paying for — which is the argument
            §1 and §8 have been building toward, so the price arrives as a
            consolidation rather than as a new expense. */}
        <Section id="pricing" className={SECTION}>
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">Pricing</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              Less than the four tools it replaces.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              You’re already paying for a task app, a project tool, a calendar add-on and a planner
              that don’t talk to each other. This is one system, one price, and one week that
              finally adds up.
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
        </Section>

        {/* ── CLOSE ───────────────────────────────────────────────────────────
            The three certainties, stated plainly for the first and only time.
            The page opened by refusing to simplify your life and spent nine
            sections earning the right to say what it *does* give you instead —
            so this is the one place the claim can be made flat, with no
            mechanism attached and nothing to decode. */}
        <Section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <p className="section-label text-[var(--muted)]">
              Built for the person everything runs through
            </p>
            <h2 className="masthead mt-4 text-lead text-[var(--text)]">
              You know what today is. You know the big things are moving. You know where the hours
              went.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Three answers, at the same time, from one place. Nothing else you’ve tried has given
              you all three — because nothing else you’ve tried was one system.
            </p>
            <CtaGroup className="mt-10 justify-center" />
          </div>
        </Section>
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
