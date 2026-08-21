import type { ReactNode } from 'react'
import { APP_URL, PRIVACY_URL, RELEASES_REPO, SUPPORT_EMAIL, SUPPORT_MAILTO, SUPPORT_RESPONSE } from '../config'
import { appUrlWithCode } from '../referral'

/*
  Support — the page that has to be true.
  ---------------------------------------
  Two jobs people conflate: HELP (how do I do the thing) and SUPPORT (something
  broke, or I need a human). This page does both, plus the trust furniture that
  makes it read as an actual company: a stated reply window, system
  requirements, where your data lives, how to cancel, how to leave.

  AUDITED against master (2026-07-25). Every instruction below names a surface
  that exists in the app today:
    · Settings sections            → src/components/SettingsModal.tsx SECTIONS
    · Shortcuts                    → src/components/ShortcutsModal.tsx GROUPS
    · Capture grammar              → src/lib/nlp.ts (LABEL_RE / PRIORITY_RE / ROUTE_RE / NOTE_RE)
    · ⌥Space panel                 → src-tauri/src/lib.rs
    · Billing / portal / cancel    → src/components/billing/BillingPane.tsx
    · Google-only sign-in          → src/components/Login.tsx
  Deliberately absent: forward-to-inbox email, the inbound capture API, and any
  refund promise — the first two don't ship on master, and the third isn't ours
  to invent. Support docs that overpromise generate the tickets they were
  written to prevent.
*/

const NAV = [
  ['contact', 'Get help'],
  ['start', 'Start here'],
  ['guides', 'Guides'],
  ['shortcuts', 'Shortcuts'],
  ['troubleshooting', 'Troubleshooting'],
  ['account', 'Account & billing'],
  ['data', 'Your data'],
  ['requirements', 'Requirements'],
  ['releases', 'Releases'],
] as const

const FIRST_RUN = [
  {
    title: 'Sign in',
    body: 'Nuvo signs in with Google — one button, no password to remember. The 14-day trial starts on its own and never asks for a card.',
  },
  {
    title: 'Name the parts of your life',
    body: 'On first run you pick your domains — the areas you’re permanently responsible for. Work, family, the thing you serve, your own health. Nothing is seeded for you, so they’re yours from the first minute.',
  },
  {
    title: 'Connect a calendar',
    body: 'Settings (⌘,) → Calendars. Google, Microsoft 365, Apple/iCloud, or an ICS feed. Connect the one your meetings actually live in — Nuvo can’t tell you what you have room for until it can see what’s already there.',
  },
  {
    title: 'Set your hours and time zone',
    body: 'Settings → Schedule. Working hours bound where Nuvo proposes focus blocks; the time zone decides what “3pm” means. Both take ten seconds and prevent most confusion later.',
  },
  {
    title: 'Capture something',
    body: 'Press ⌘K in the app, or ⌥Space anywhere on your Mac. Type it like a text message. It lands in the inbox — nothing is scheduled until you say so.',
  },
  {
    title: 'Compose a week',
    body: 'Open the Sunday flow and walk it: what moved, what you’re betting on, what you’re pulling in, and where it lands. That composed week is the gate — it’s what makes the rest of the app work.',
  },
] as const

const CALENDARS = [
  ['Google', 'Two-way', 'Events read in; scheduled Nuvo work can mirror out to a calendar named “Nuvo”.'],
  ['Microsoft 365', 'Read only', 'Events appear in Nuvo. Nuvo never writes back to M365.'],
  ['Apple / iCloud', 'Two-way', 'Connect with your Apple ID and an app-specific password (CalDAV).'],
  ['ICS subscription', 'Read only', 'Paste a feed URL — the youth group calendar, a sports schedule, a shared team feed.'],
] as const

const GRAMMAR = [
  ['tomorrow 9am', 'Dates and times, written how you’d say them. “next tuesday”, “fri 2pm”.'],
  ['30m · 1h · 1h30', 'How long it takes. Feeds the week’s arithmetic.'],
  ['#label', 'A label. Type as many as you like.'],
  ['!high · !med · !low', 'Priority.'],
  ['@project', 'Route it — to a project, initiative, or domain by name.'],
  ['// a note', 'Everything after the slashes becomes the description, untouched.'],
] as const

const SHORTCUTS = [
  {
    group: 'Anywhere',
    rows: [
      ['⌥Space', 'Capture from anywhere on your Mac (native app)'],
      ['⌘K', 'Command bar'],
      ['⌘J', 'Toggle Nuvo, the assistant'],
      ['⌘,', 'Settings'],
      ['?', 'The shortcut panel, in the app'],
    ],
  },
  {
    group: 'Moving around',
    rows: [
      ['⌘1 – ⌘4', 'Jump to a floor — Schedule, Projects, Initiatives, Domains'],
      ['⌘↑ / ⌘↓', 'Travel the ladder'],
      ['⌘[', 'Back'],
      ['⌘.', 'Focus — hide the panels'],
    ],
  },
  {
    group: 'The Schedule',
    rows: [
      ['S · W · D · M', 'Spread, Week, Day, Month'],
      ['= / −', 'Next / previous period'],
      ['⌘T', 'Today'],
    ],
  },
  {
    group: 'Inbox & tasks',
    rows: [
      ['J / K', 'Move the cursor'],
      ['↵', 'Open the task'],
      ['E · T · N', 'Plan for today · tomorrow · next week'],
      ['R', 'Reschedule — pick a date'],
      ['F', 'Mark done or reopen'],
      ['I', 'Send it back to the inbox'],
      ['X', 'Move to trash'],
      ['C', 'Capture'],
    ],
  },
  {
    group: 'Create',
    rows: [
      ['P', 'New project'],
      ['I', 'New initiative'],
    ],
  },
] as const

const TROUBLE = [
  {
    q: '⌥Space doesn’t open capture',
    a: (
      <>
        <p>
          Another app has claimed the same hotkey — that’s almost always it. Quit the app that
          owns ⌥Space (Spotlight replacements, launchers and clipboard managers are the usual
          suspects), then relaunch Nuvo so it can register the shortcut.
        </p>
        <p className="mt-3">
          ⌥Space only works in the native Mac app, and only while Nuvo is running. It doesn’t
          need to be the front app — that’s the point of it — but it does need to be open.
          Inside the app, ⌘K does the same job.
        </p>
      </>
    ),
  },
  {
    q: 'An orange “reconnect” banner appeared',
    a: (
      <>
        <p>
          A calendar’s credentials expired or were revoked. Nuvo shows the banner rather than
          quietly falling behind — sync never fails silently here.
        </p>
        <p className="mt-3">
          Settings (⌘,) → Calendars → <strong className="text-[var(--text)]">Reconnect</strong> on
          the account that’s flagged. For iCloud, generate a fresh app-specific password first;
          Apple invalidates the old one when you change your Apple ID password.
        </p>
      </>
    ),
  },
  {
    q: 'Some events aren’t showing on the grid',
    a: (
      <>
        <p>
          Check Settings → Calendars. Each connected account lists its individual calendars, and
          any you’ve hidden stay out of the planning surface on purpose — that’s how you keep the
          birthdays feed from pretending to be work.
        </p>
        <p className="mt-3">
          If a whole account is missing, it may need reconnecting. If a single event is missing,
          give sync a minute, then reload.
        </p>
      </>
    ),
  },
  {
    q: 'My Nuvo work isn’t appearing in Google Calendar',
    a: (
      <>
        <p>
          Scheduled work mirrors to a dedicated Google calendar named{' '}
          <strong className="text-[var(--text)]">Nuvo</strong>, created on first connect. Make sure
          that calendar is ticked visible in Google Calendar’s own sidebar — it’s easy to miss on
          a busy account.
        </p>
        <p className="mt-3">
          The mirror is one-directional by design: Nuvo is the source of truth for its own blocks,
          so edits you make to a mirrored event in Google get overwritten on the next sync. Move
          the block in Nuvo instead.
        </p>
      </>
    ),
  },
  {
    q: 'Times are landing an hour or two off',
    a: (
      <p>
        Settings → Schedule → Time zone. Nuvo plans in the zone you set, so a stale one from a
        trip will shift everything by exactly that offset. Set it to where you actually are.
      </p>
    ),
  },
  {
    q: 'Unfinished work moved to today on its own',
    a: (
      <p>
        That’s rollover, and it’s deliberate. Overnight, anything left undone from yesterday
        comes forward to today with its duration intact and its time cleared, carrying a ↻ badge
        so you can see it rolled. Repeating occurrences never roll — a missed Tuesday standup
        doesn’t become a Wednesday one.
      </p>
    ),
  },
  {
    q: 'The Mac app won’t open, or macOS says it can’t be verified',
    a: (
      <p>
        Nuvo’s Mac builds are signed with an Apple Developer ID and notarized by Apple, so this
        shouldn’t happen. If it does, you likely have a partial download — delete it, empty the
        trash, and download again from the link on{' '}
        <a href="/" className="text-[var(--accent)] underline-offset-2 hover:underline">
          nuvo.day
        </a>
        . If it persists, email us with the exact wording of the message.
      </p>
    ),
  },
  {
    q: 'The Mac app isn’t updating',
    a: (
      <p>
        It updates itself quietly in the background, so normally there’s nothing to do. To force
        it: Settings → About → check for updates, which also shows the version you’re on and
        what changed. If the check fails, download the current build and install over the top —
        your data lives in your account, not in the app.
      </p>
    ),
  },
  {
    q: 'How do I get Nuvo on my iPhone?',
    a: (
      <p>
        Open <span className="mono text-[var(--text)]">app.nuvo.day</span> in Safari, tap Share,
        then <strong className="text-[var(--text)]">Add to Home Screen</strong>. It installs as a
        full-screen app with the same account and live sync. A native iPhone app is on the way.
      </p>
    ),
  },
  {
    q: 'I can’t sign in',
    a: (
      <p>
        Nuvo signs in with Google only, so there’s no Nuvo password to reset. Make sure you’re
        signed into the Google account you originally used — a second work account will land you
        in a different, empty Nuvo account. If you’re stuck, email us from the address you expect
        to be signed in with, and we’ll sort it out.
      </p>
    ),
  },
] as const

/** Section shell — the page is long, so every section is anchored, hairline-ruled,
 *  and reads the same way. */
function Section({
  id,
  label,
  title,
  intro,
  children,
}: {
  id: string
  label: string
  title: string
  intro?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-8 border-t border-[var(--line)] pt-10 first:border-t-0 first:pt-0">
      <p className="section-label text-[var(--muted)]">{label}</p>
      <h2 className="masthead mt-3 text-[1.65rem] leading-tight text-[var(--text)] sm:text-[2rem]">
        {title}
      </h2>
      {intro && <div className="mt-4 max-w-2xl text-body text-[var(--muted)]">{intro}</div>}
      <div className="mt-8">{children}</div>
    </section>
  )
}

/** Disclosure — native <details>, so it works without JS, is keyboard-navigable,
 *  and Cmd-F finds closed content in most browsers. */
function Disclose({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="disclose group border-t border-[var(--line)]">
      <summary className="tap flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[0.9375rem] font-medium text-[var(--text)]">
        <span>{q}</span>
        <span className="disclose-mark shrink-0 text-[var(--muted)]" aria-hidden />
      </summary>
      <div className="pb-6 text-[0.9375rem] leading-relaxed text-[var(--muted)]">{children}</div>
    </details>
  )
}

export default function Support() {
  return (
    <div className="atmosphere min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 pt-5 pb-2 sm:px-8 sm:pt-7">
        <a href="/" className="wordmark text-[1.125rem] text-[var(--text)] tap inline-flex items-center">
          Nuvo
        </a>
        <nav className="flex items-center gap-2 sm:gap-3">
          <a href={SUPPORT_MAILTO} className="hidden text-[13px] text-[var(--muted)] tap items-center sm:inline-flex hover:text-[var(--text)]">
            Email us
          </a>
          <a href={appUrlWithCode(APP_URL)} className="btn-ghost tap text-[13px]" rel="noopener noreferrer">
            Open app
          </a>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        {/* Hero */}
        <div className="max-w-2xl">
          <p className="section-label text-[var(--muted)]">Support</p>
          <h1 className="masthead mt-3 text-display text-[var(--text)]">Help, and a human.</h1>
          <p className="mt-5 text-body text-[var(--muted)]">
            How everything works, what to do when it doesn’t, and where to find us. Nuvo is a
            small operation — the person who answers your email is the person who builds the
            thing.
          </p>
        </div>

        <div className="mt-14 lg:grid lg:grid-cols-[10.5rem_minmax(0,1fr)] lg:gap-14">
          {/* Desktop table of contents. On a phone the page is simply read top to
              bottom — a sticky rail there costs more than it gives. */}
          <nav className="sticky top-8 hidden self-start lg:block" aria-label="On this page">
            <p className="section-label text-[var(--muted)]">On this page</p>
            <ul className="mt-4 space-y-1">
              {NAV.map(([id, label]) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="block py-1 text-[0.875rem] text-[var(--muted)] transition-colors hover:text-[var(--text)]"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0 space-y-16 sm:space-y-20">
            {/* ── Contact ───────────────────────────────────────────────── */}
            <Section
              id="contact"
              label="Get help"
              title="Two ways to get unstuck."
              intro="One is instant and lives inside the app. The other is us."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="glass-card rounded-2xl border border-[var(--accent)] p-6 shadow-[var(--shadow-2)]">
                  <p className="section-label text-[var(--accent)]">Email</p>
                  <p className="mt-3 text-[0.9375rem] leading-relaxed text-[var(--muted)]">
                    Anything at all — a bug, a question, billing, or a feature you wish existed.
                  </p>
                  <a href={SUPPORT_MAILTO} className="btn-primary tap mt-5 w-full">
                    {SUPPORT_EMAIL}
                  </a>
                  <p className="mt-4 text-[0.875rem] text-[var(--muted)]">{SUPPORT_RESPONSE}</p>
                </div>

                <div className="glass-card rounded-2xl border border-[var(--line)] p-6">
                  <p className="section-label text-[var(--muted)]">Ask Nuvo</p>
                  <p className="mt-3 text-[0.9375rem] leading-relaxed text-[var(--muted)]">
                    Press <span className="mono text-[var(--text)]">⌘J</span> in the app and ask in
                    plain language. Fastest route for “how do I…” — it knows your actual week, so
                    the answer is about your data, not a generic doc.
                  </p>
                </div>
              </div>

              <div className="mt-8 border-t border-[var(--line)] pt-5">
                <p className="section-label text-[var(--text)]">What to include</p>
                <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-[var(--muted)]">
                  Four lines gets it fixed in one round trip instead of four: what you were doing,
                  what you expected, what happened instead, and where — the Mac app, a browser, or
                  your phone. Your version is in Settings → About.
                </p>
              </div>
            </Section>

            {/* ── Start here ────────────────────────────────────────────── */}
            <Section
              id="start"
              label="Start here"
              title="The first fifteen minutes."
              intro="New account? Do these six things in this order. Everything else in Nuvo assumes they’re done."
            >
              <ol className="space-y-6">
                {FIRST_RUN.map((step, i) => (
                  <li key={step.title} className="flex gap-5 border-t border-[var(--line)] pt-5">
                    <span className="mono shrink-0 text-[0.875rem] font-semibold text-[var(--accent)]">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[0.9375rem] font-medium text-[var(--text)]">{step.title}</p>
                      <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-[var(--muted)]">
                        {step.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-8 text-[0.9375rem] leading-relaxed text-[var(--muted)]">
                You can replay the guided welcome tour any time from Settings → About →{' '}
                <strong className="text-[var(--text)]">Replay</strong>.
              </p>
            </Section>

            {/* ── Guides ────────────────────────────────────────────────── */}
            <Section
              id="guides"
              label="Guides"
              title="How each part works."
              intro="Grouped the way you’d actually go looking. Open what you need."
            >
              <div className="space-y-10">
                {/* Capture */}
                <div>
                  <h3 className="section-label text-[var(--accent)]">Capture</h3>
                  <div className="mt-3">
                    <Disclose q="The three doors into the inbox">
                      <p>
                        <strong className="text-[var(--text)]">⌥Space</strong> — anywhere on your
                        Mac, without leaving what you’re in. A small panel drops in, takes the
                        keystrokes, and vanishes. Nuvo never steals your window.
                      </p>
                      <p className="mt-3">
                        <strong className="text-[var(--text)]">⌘K</strong> — the command bar inside
                        the app.
                      </p>
                      <p className="mt-3">
                        <strong className="text-[var(--text)]">C</strong> — jumps your cursor into
                        the capture field on the Schedule, for when you’re already there.
                      </p>
                      <p className="mt-3">
                        All three land in the same place: the inbox. Nothing is scheduled, routed,
                        or decided until you decide it.
                      </p>
                    </Disclose>
                    <Disclose q="Writing a capture — the grammar">
                      <p>
                        Type it like you’d text yourself. Nuvo reads the structure out of the
                        sentence and shows you what it understood, so a wrong guess is visible and
                        one tap to remove.
                      </p>
                      <p className="mt-4 mb-3 text-[var(--text)]">
                        <span className="mono">
                          call David tomorrow 9am 30m #church !high @sermon // bring the outline
                        </span>
                      </p>
                      <dl className="mt-4 divide-y divide-[var(--line)] border-t border-[var(--line)]">
                        {GRAMMAR.map(([token, meaning]) => (
                          <div key={token} className="grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-5">
                            <dt className="mono text-[0.875rem] text-[var(--text)]">{token}</dt>
                            <dd className="text-[0.9375rem] leading-relaxed">{meaning}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="mt-4">
                        None of it is required. “pick up the dry cleaning” is a perfectly good
                        capture.
                      </p>
                    </Disclose>
                    <Disclose q="Capturing by voice">
                      <p>
                        Every field in Nuvo is a plain text input, so your system dictation works
                        everywhere without a special mode — tap the mic on iOS, or use macOS
                        dictation, and talk. The same parsing applies to what comes out.
                      </p>
                    </Disclose>
                  </div>
                </div>

                {/* Calendars */}
                <div>
                  <h3 className="section-label text-[var(--accent)]">Calendars &amp; sync</h3>
                  <div className="mt-3">
                    <Disclose q="Connecting a calendar">
                      <p>
                        Settings (<span className="mono text-[var(--text)]">⌘,</span>) →{' '}
                        <strong className="text-[var(--text)]">Calendars</strong>. Connect as many
                        accounts as you like, from as many providers as you like — that’s the
                        point. Work on Google, family on Apple, corp on Microsoft, the volunteer
                        thing as an ICS feed.
                      </p>
                      <div className="mt-5 overflow-x-auto">
                        <table className="w-full min-w-[30rem] border-collapse text-left text-[0.9375rem]">
                          <thead>
                            <tr className="border-b border-[var(--line-strong)]">
                              <th className="section-label pb-2 pr-4 font-semibold text-[var(--muted)]">Provider</th>
                              <th className="section-label pb-2 pr-4 font-semibold text-[var(--muted)]">Direction</th>
                              <th className="section-label pb-2 font-semibold text-[var(--muted)]">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {CALENDARS.map(([name, dir, note]) => (
                              <tr key={name} className="border-b border-[var(--line)] align-top">
                                <td className="py-3 pr-4 text-[var(--text)]">{name}</td>
                                <td className="py-3 pr-4 whitespace-nowrap text-[var(--muted)]">{dir}</td>
                                <td className="py-3 leading-relaxed text-[var(--muted)]">{note}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Disclose>
                    <Disclose q="Connecting Apple / iCloud Calendar">
                      <p>
                        Apple requires an app-specific password rather than your Apple ID password.
                        It takes about a minute:
                      </p>
                      <ol className="mt-3 list-decimal space-y-2 pl-5">
                        <li>
                          Go to <span className="mono text-[var(--text)]">appleid.apple.com</span>{' '}
                          and sign in.
                        </li>
                        <li>
                          Open <strong className="text-[var(--text)]">Sign-In and Security</strong> →{' '}
                          <strong className="text-[var(--text)]">App-Specific Passwords</strong>.
                        </li>
                        <li>Generate one, and name it something like “Nuvo”.</li>
                        <li>
                          Copy the password Apple shows — it looks like{' '}
                          <span className="mono text-[var(--text)]">abcd-efgh-ijkl-mnop</span> — and
                          paste it into Nuvo with your Apple ID.
                        </li>
                      </ol>
                      <p className="mt-3">
                        Changing your Apple ID password invalidates app-specific passwords. If
                        iCloud sync stops after a password change, generate a new one and
                        reconnect.
                      </p>
                    </Disclose>
                    <Disclose q="Hiding the calendars you don’t plan around">
                      <p>
                        Settings → Calendars lists every individual calendar under each account,
                        with a toggle. Hide the birthday feed, the holidays feed, the one your
                        company auto-subscribed you to. Hidden calendars don’t show on the grid and
                        don’t count against your available hours — which is the part that matters,
                        because a fake-busy calendar makes the week’s arithmetic lie.
                      </p>
                    </Disclose>
                    <Disclose q="The “Nuvo” mirror calendar">
                      <p>
                        On first Google connect, Nuvo finds or creates a calendar named{' '}
                        <strong className="text-[var(--text)]">Nuvo</strong> and reconciles your
                        scheduled work to it. That way anyone looking at your calendar — including
                        your other tools — sees the time you committed, without Google becoming the
                        source of truth.
                      </p>
                      <p className="mt-3">
                        It’s one-directional on purpose: edit the block in Nuvo, not in Google. If
                        you’d rather no one saw it, hide or delete the Nuvo calendar in Google — or
                        don’t connect Google at all.
                      </p>
                    </Disclose>
                  </div>
                </div>

                {/* The week */}
                <div>
                  <h3 className="section-label text-[var(--accent)]">Planning your week</h3>
                  <div className="mt-3">
                    <Disclose q="The four pools, and the one gate">
                      <p>
                        Work moves through Nuvo in one direction, and there’s exactly one gate.
                        Understanding this is most of understanding the app.
                      </p>
                      <dl className="mt-4 divide-y divide-[var(--line)] border-t border-[var(--line)]">
                        {[
                          ['Inbox', 'Raw captures. You never plan straight out of here — you process it first.'],
                          ['Backlog', 'Processed and deliberately undated. Project work waits here without nagging you. It never rolls, and it never shows up on Today uninvited.'],
                          ['The Week', 'What you actually committed to carry. This is the gate: nothing reaches a day without passing through a week you agreed to.'],
                          ['Today', 'It has a date, and maybe an hour. A scheduled task IS the block on your calendar — there’s no second copy to keep in step.'],
                        ].map(([name, body]) => (
                          <div key={name} className="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-5">
                            <dt className="text-[0.9375rem] font-medium text-[var(--text)]">{name}</dt>
                            <dd className="text-[0.9375rem] leading-relaxed">{body}</dd>
                          </div>
                        ))}
                      </dl>
                    </Disclose>
                    <Disclose q="The Sunday flow">
                      <p>
                        Sunday is where the week gets decided, and it’s minutes, not an afternoon.
                        You see what moved, sweep what’s loose, name the priorities you’re betting
                        on, pull the work those priorities need, and compose it onto real days.
                      </p>
                      <p className="mt-3">
                        You can run it any day — it’s called Sunday because that’s when most people
                        want it, not because the app enforces a calendar. Miss one and nothing
                        breaks; you just start the week without the gate closed behind you.
                      </p>
                    </Disclose>
                    <Disclose q="“Can you carry this week?” — how the arithmetic works">
                      <p>
                        Nuvo adds up what your in-flight projects need this week and divides it by
                        the hours you actually have — your working hours, minus the meetings your
                        calendars already know about.
                      </p>
                      <p className="mt-3">
                        Roughly <strong className="text-[var(--text)]">0.7 to 1.0</strong> is a week
                        you can carry. Over 1.0 and you’re making a promise the hours don’t
                        support. Well under, and something you said mattered isn’t being pulled in.
                      </p>
                      <p className="mt-3">
                        The ceiling is calibrated against the pace you’ve actually proven over the
                        last four weeks — not the pace you wish you had — with a little room to
                        grow. A brand-new account has no history to calibrate against, and it will
                        say so rather than pretend.
                      </p>
                    </Disclose>
                    <Disclose q="Priorities, and why they want to be projects">
                      <p>
                        A priority is a named outcome for the week. You can write one as pure
                        intention, but it gets useful when it’s bound to a real project — then its
                        progress is derived from actual finished work instead of your memory of it,
                        and Friday can show you what moved without you keeping score.
                      </p>
                    </Disclose>
                    <Disclose q="Putting work on the hour">
                      <p>
                        Drag from the rail onto the grid. Drag the block to move it, drag its edge
                        to resize. That block is the task — there’s no separate event to reconcile,
                        which is why moving it in Nuvo just works everywhere else too.
                      </p>
                      <p className="mt-3">
                        Standing time works the other way round: protect a recurring window — the
                        6–8am block, Thursday afternoons — and matching work is drawn into it when
                        the week is composed.
                      </p>
                    </Disclose>
                  </div>
                </div>

                {/* The day */}
                <div>
                  <h3 className="section-label text-[var(--accent)]">Your day</h3>
                  <div className="mt-3">
                    <Disclose q="Morning and evening">
                      <p>
                        The morning brief pulls from the week you already committed to and asks you
                        to name today — it isn’t a blank page, because the decisions were made on
                        Sunday.
                      </p>
                      <p className="mt-3">
                        The evening close leads with what moved, then sends leftovers back to the
                        week rather than letting them pile onto tomorrow by default.
                      </p>
                    </Disclose>
                    <Disclose q="Rollover, overdue, and repeats">
                      <p>
                        <strong className="text-[var(--text)]">Rollover</strong> — overnight,
                        unfinished work from yesterday comes forward to today. It keeps its
                        duration, loses its time, and carries a ↻ badge so a task that’s rolled
                        four times is visibly a task that’s rolled four times.
                      </p>
                      <p className="mt-3">
                        <strong className="text-[var(--text)]">Overdue</strong> — a block goes
                        overdue an hour after it was meant to end, and pins to the top of today in
                        orange. One hour of grace, then it says something.
                      </p>
                      <p className="mt-3">
                        <strong className="text-[var(--text)]">Repeats never roll.</strong> A missed
                        Monday standup doesn’t become a Tuesday standup. Recurring work either
                        happened or it didn’t.
                      </p>
                    </Disclose>
                  </div>
                </div>

                {/* The ladder */}
                <div>
                  <h3 className="section-label text-[var(--accent)]">Domains, initiatives &amp; projects</h3>
                  <div className="mt-3">
                    <Disclose q="What each level is for">
                      <dl className="divide-y divide-[var(--line)]">
                        {[
                          ['Domain', 'An area of lasting responsibility — one you’ve committed to keep showing up in. Work, family, health, the thing you serve. Not a folder, not a tag you’ll forget you made. It carries a color that identifies its work everywhere else in the app.'],
                          ['Initiative', 'A big outcome under a domain — usually about a quarter’s worth. “Launch the new service.” “Get back to running.”'],
                          ['Project', 'A finite thing that gets finished. It has a size and a finish line, and those two numbers are what let Nuvo say how much of it belongs in this week.'],
                          ['Task', 'The atom. Give it a date and it’s planned; give it an hour and it’s a block on your calendar.'],
                        ].map(([name, body]) => (
                          <div key={name} className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-5">
                            <dt className="text-[0.9375rem] font-medium text-[var(--text)]">{name}</dt>
                            <dd className="text-[0.9375rem] leading-relaxed">{body}</dd>
                          </div>
                        ))}
                      </dl>
                      <p className="mt-4">
                        <span className="mono text-[var(--text)]">⌘1</span> –{' '}
                        <span className="mono text-[var(--text)]">⌘4</span> jump between the floors;{' '}
                        <span className="mono text-[var(--text)]">⌘↑</span> and{' '}
                        <span className="mono text-[var(--text)]">⌘↓</span> travel the ladder.
                      </p>
                    </Disclose>
                    <Disclose q="On Deck — deciding which weeks hold what">
                      <p>
                        A timeline of your projects across the coming weeks. This is the coarse
                        call — is this a February thing or an April thing — made before anything
                        touches an hour. Drag a project onto a week and the demand it creates shows
                        up immediately, so overload is visible while it’s still cheap to fix.
                      </p>
                    </Disclose>
                    <Disclose q="Grooming — making work ready before it’s scheduled">
                      <p>
                        Work that isn’t shaped can’t be honestly scheduled: you can’t estimate it,
                        so it can’t be measured against your hours. Grooming is the short pass that
                        gives a project an outcome and its tasks a size. Readiness reports where the
                        funnel needs you — it’s a thermometer, not a scoreboard, and it never nags.
                      </p>
                    </Disclose>
                    <Disclose q="Looking back — the weekly review">
                      <p>
                        A Friday pass that closes the week from evidence rather than memory:
                        completed blocks, meetings you actually attended, and — if you connect it —
                        the work you shipped on GitHub. It surfaces at most one real finding, and
                        stays quiet when there isn’t one. Manufactured insight is worse than
                        silence.
                      </p>
                    </Disclose>
                  </div>
                </div>

                {/* Nuvo */}
                <div>
                  <h3 className="section-label text-[var(--accent)]">Ask Nuvo</h3>
                  <div className="mt-3">
                    <Disclose q="What the assistant will and won’t do">
                      <p>
                        <span className="mono text-[var(--text)]">⌘J</span> opens Nuvo. Ask in plain
                        language — it can scaffold a project into tasks, propose a week, prepare
                        the pre-work for a block, or just answer a question about your own funnel.
                      </p>
                      <p className="mt-3">
                        It <strong className="text-[var(--text)]">drafts into quiet places</strong>{' '}
                        and waits. It does not move work onto your calendar, reschedule your day, or
                        act while you’re away. Everything it does shows up as a card you can undo in
                        one tap. That’s a product decision, not a limitation: an assistant that runs
                        your day removes the judgment the whole app exists to build.
                      </p>
                    </Disclose>
                    <Disclose q="What it can see">
                      <p>
                        To answer usefully it needs context, so your prompt goes out with the
                        relevant slice of your planning data — the tasks, calendar snippets, and
                        project structure the question actually needs — to the language-model
                        provider that generates the proposal. It’s used to answer you, and for
                        nothing else. Details are in the{' '}
                        <a
                          href={PRIVACY_URL}
                          className="text-[var(--accent)] underline-offset-2 hover:underline"
                        >
                          privacy policy
                        </a>
                        .
                      </p>
                    </Disclose>
                  </div>
                </div>

                {/* Preferences */}
                <div>
                  <h3 className="section-label text-[var(--accent)]">Settings &amp; appearance</h3>
                  <div className="mt-3">
                    <Disclose q="What’s in Settings">
                      <dl className="divide-y divide-[var(--line)]">
                        {[
                          ['Appearance', 'Five looks, each in light and dark. Purely cosmetic — pick the one you want to sit in all day.'],
                          ['Schedule', 'Working hours, which day your week starts on, and your time zone.'],
                          ['Calendars', 'Connect, reconnect, and choose which individual calendars are visible.'],
                          ['Integrations', 'Other sources of finished work, like GitHub.'],
                          ['Labels', 'The #labels you’ve created.'],
                          ['Account', 'Who you’re signed in as, and sign out.'],
                          ['Billing', 'Your plan, card, invoices, and cancellation.'],
                          ['About', 'Your version, what changed in each release, and a replay of the welcome tour.'],
                        ].map(([name, body]) => (
                          <div key={name} className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-5">
                            <dt className="text-[0.9375rem] font-medium text-[var(--text)]">{name}</dt>
                            <dd className="text-[0.9375rem] leading-relaxed">{body}</dd>
                          </div>
                        ))}
                      </dl>
                    </Disclose>
                  </div>
                </div>
              </div>
            </Section>

            {/* ── Shortcuts ─────────────────────────────────────────────── */}
            <Section
              id="shortcuts"
              label="Shortcuts"
              title="Keyboard, first."
              intro={
                <>
                  Nuvo is built to be driven without the mouse. Press{' '}
                  <span className="mono text-[var(--text)]">?</span> in the app for this same list,
                  in context.
                </>
              }
            >
              <div className="grid gap-x-12 gap-y-9 sm:grid-cols-2">
                {SHORTCUTS.map((g) => (
                  <div key={g.group}>
                    <p className="section-label border-b border-[var(--line-strong)] pb-2 text-[var(--accent)]">
                      {g.group}
                    </p>
                    <dl className="divide-y divide-[var(--line)]">
                      {g.rows.map(([keys, what]) => (
                        <div key={keys} className="flex items-baseline justify-between gap-4 py-2.5">
                          <dd className="text-[0.9375rem] leading-snug text-[var(--muted)]">{what}</dd>
                          <dt className="mono shrink-0 text-[0.8125rem] font-medium text-[var(--text)]">
                            {keys}
                          </dt>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
              <p className="mt-8 text-[0.9375rem] leading-relaxed text-[var(--muted)]">
                <span className="mono text-[var(--text)]">⌥Space</span> is the only shortcut that
                works outside the app, and it needs the native Mac app to be running.
              </p>
            </Section>

            {/* ── Troubleshooting ───────────────────────────────────────── */}
            <Section
              id="troubleshooting"
              label="Troubleshooting"
              title="When something isn’t right."
              intro="The handful of things that actually go wrong, and what to do about each."
            >
              <div>
                {TROUBLE.map((t) => (
                  <Disclose key={t.q} q={t.q}>
                    {t.a}
                  </Disclose>
                ))}
              </div>
              <p className="mt-8 text-[0.9375rem] leading-relaxed text-[var(--muted)]">
                Not here?{' '}
                <a href={SUPPORT_MAILTO} className="text-[var(--accent)] underline-offset-2 hover:underline">
                  Email us
                </a>{' '}
                — genuinely, that’s what it’s for.
              </p>
            </Section>

            {/* ── Account & billing ─────────────────────────────────────── */}
            <Section
              id="account"
              label="Account &amp; billing"
              title="The money questions."
              intro="Answered plainly, because nobody should have to email support to find out how to leave."
            >
              <div>
                <Disclose q="How the trial works">
                  <p>
                    Fourteen days, every feature, no card. It starts by itself when you sign up and
                    you can see exactly how many days are left in Settings → Billing. When it ends,
                    Nuvo asks you to choose a plan — it doesn’t charge you quietly, because it
                    never had a card to charge.
                  </p>
                </Disclose>
                <Disclose q="What it costs">
                  <p>
                    <strong className="text-[var(--text)]">$29 a month</strong>, or{' '}
                    <strong className="text-[var(--text)]">$19 a month billed annually</strong> —
                    $228 a year, which saves $120. There are no tiers and no add-ons: both plans
                    are the entire product.
                  </p>
                </Disclose>
                <Disclose q="A friend sent me a code">
                  <p>
                    Type it in Stripe Checkout when you subscribe — there&apos;s an &ldquo;Add
                    promotion code&rdquo; field. Or open the link they sent (
                    <span className="mono text-[var(--text)]">nuvo.day/?code=…</span>
                    ); we remember it through the trial and apply it at checkout. You get{' '}
                    <strong className="text-[var(--text)]">50% off your first month</strong>.
                    The person who shared gets a free month on their bill when you actually
                    pay (not when you start the trial) — up to six free months outstanding.
                    There is no affiliate marketplace; if someone loves Nuvo, they just give
                    you their code.
                  </p>
                  <p className="mt-3">
                    Already on Nuvo and want to share? Settings → Billing shows{' '}
                    <strong className="text-[var(--text)]">your code</strong>.
                  </p>
                </Disclose>
                <Disclose q="Changing your card, plan, or invoices">
                  <p>
                    Settings → Billing → <strong className="text-[var(--text)]">Manage billing</strong>{' '}
                    opens the secure Stripe portal, where you can update your card, switch between
                    monthly and annual, and download every invoice. Nuvo never sees or stores your
                    card number.
                  </p>
                </Disclose>
                <Disclose q="Cancelling">
                  <p>
                    Settings → Billing → Manage billing → cancel. Two clicks, no exit interview, no
                    “are you sure” maze. You keep full access until the end of the period you’ve
                    already paid for, and Settings will show you that date.
                  </p>
                  <p className="mt-3">
                    Changed your mind before it lapses? The same pane offers{' '}
                    <strong className="text-[var(--text)]">Resume subscription</strong>.
                  </p>
                  <p className="mt-3">
                    Your calendars are unaffected either way — they live in Google, Apple, and
                    Microsoft, and they stay there.
                  </p>
                </Disclose>
                <Disclose q="Signing in, and signing in on another device">
                  <p>
                    Nuvo signs in with Google, so there’s no separate password. Sign in with the
                    same Google account on the Mac app, any browser, and your phone — it’s one
                    account and everything syncs live between them.
                  </p>
                  <p className="mt-3">
                    One account is one person’s system by design. There are no seats, no shared
                    projects, and nobody else is ever in your account.
                  </p>
                </Disclose>
                <Disclose q="Deleting your account">
                  <p>
                    Email{' '}
                    <a href={SUPPORT_MAILTO} className="text-[var(--accent)] underline-offset-2 hover:underline">
                      {SUPPORT_EMAIL}
                    </a>{' '}
                    from the address on the account and we’ll delete it, along with the planning
                    data in it. If you’d rather just cut the calendar link, you can disconnect any
                    calendar yourself in Settings → Calendars at any time — that revokes Nuvo’s
                    access immediately.
                  </p>
                </Disclose>
                <Disclose q="Refunds and anything unusual">
                  <p>
                    Email us and tell us what happened. Billing edge cases are handled by a person,
                    not a policy page.
                  </p>
                </Disclose>
              </div>
            </Section>

            {/* ── Data ──────────────────────────────────────────────────── */}
            <Section
              id="data"
              label="Your data"
              title="Where it lives, and who can see it."
              intro={
                <>
                  The short version. The binding version is the{' '}
                  <a href={PRIVACY_URL} className="text-[var(--accent)] underline-offset-2 hover:underline">
                    privacy policy
                  </a>
                  .
                </>
              }
            >
              <ul className="space-y-5">
                {[
                  ['It’s yours, and it’s isolated.', 'Your planning data sits in a private database with row-level security — only your signed-in account can read or write it. Accounts never see each other.'],
                  ['Calendar credentials go in a vault.', 'OAuth tokens and app-specific passwords are stored separately from application data, never in plain tables.'],
                  ['Google data is used for one thing.', 'Syncing your calendars and scheduling your work. Nuvo follows Google’s Limited Use requirements: it is never sold, never used for advertising, and never used to train general AI models.'],
                  ['We don’t sell anything to anybody.', 'The business model is the subscription. That’s the whole model — which is why there’s no incentive to do anything else with your calendar.'],
                  ['You can leave with your calendars intact.', 'They live in Google, Apple, and Microsoft. Disconnecting Nuvo stops the sync and changes nothing about the calendars themselves.'],
                ].map(([head, body]) => (
                  <li key={head} className="border-t border-[var(--line)] pt-4">
                    <p className="text-[0.9375rem] font-medium text-[var(--text)]">{head}</p>
                    <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-[var(--muted)]">{body}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-8 text-[0.9375rem] leading-relaxed text-[var(--muted)]">
                Want a copy of your data, or have a question this doesn’t answer? Email{' '}
                <a href={SUPPORT_MAILTO} className="text-[var(--accent)] underline-offset-2 hover:underline">
                  {SUPPORT_EMAIL}
                </a>
                .
              </p>
            </Section>

            {/* ── Requirements ──────────────────────────────────────────── */}
            <Section
              id="requirements"
              label="Requirements"
              title="What you need to run it."
            >
              <dl className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
                {[
                  ['Mac', 'The native app is a universal build — Apple Silicon and Intel. It installs from a signed, notarized DMG and updates itself in the background.'],
                  ['Web', 'Any current browser — Chrome, Safari, Edge, Firefox. Nothing to install.'],
                  ['iPhone', 'Open app.nuvo.day in Safari and Add to Home Screen. A native app is on the way.'],
                  ['Account', 'A Google account to sign in with, and a calendar worth connecting.'],
                ].map(([name, body]) => (
                  <div key={name} className="grid gap-1 py-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-5">
                    <dt className="text-[0.9375rem] font-medium text-[var(--text)]">{name}</dt>
                    <dd className="text-[0.9375rem] leading-relaxed text-[var(--muted)]">{body}</dd>
                  </div>
                ))}
              </dl>
            </Section>

            {/* ── Releases ──────────────────────────────────────────────── */}
            <Section
              id="releases"
              label="Releases"
              title="What version you’re on."
              intro="Settings → About shows your version, what changed in each release, and a manual update check. The Mac app updates itself in the background, so you’re usually already current."
            >
              <a
                href={`https://github.com/${RELEASES_REPO}/releases`}
                className="btn-ghost tap"
                target="_blank"
                rel="noopener noreferrer"
              >
                All releases
              </a>
            </Section>

            {/* Closing */}
            <div className="border-t border-[var(--line)] pt-10">
              <div className="glass-card rounded-2xl border border-[var(--line)] px-6 py-8 sm:px-10">
                <h2 className="masthead text-[1.5rem] text-[var(--text)]">Still stuck?</h2>
                <p className="mt-3 max-w-xl text-body text-[var(--muted)]">
                  Write to us. Tell us what you were trying to do. There’s no ticket queue and no
                  bot — just the person who built this.
                </p>
                <a href={SUPPORT_MAILTO} className="btn-primary tap mt-6">
                  Email {SUPPORT_EMAIL}
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="mx-auto flex max-w-5xl flex-col gap-3 border-t border-[var(--line)] px-5 py-8 text-[13px] text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span className="wordmark text-[var(--text)]">Nuvo</span>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <a href="/" className="hover:text-[var(--text)]">
            Home
          </a>
          <a href="/privacy" className="hover:text-[var(--text)]">
            Privacy
          </a>
          <a href={SUPPORT_MAILTO} className="hover:text-[var(--text)]">
            Contact
          </a>
          <p>© {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  )
}
