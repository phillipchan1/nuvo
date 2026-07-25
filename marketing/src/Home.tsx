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
    label: 'One funnel',
    title: 'Nothing gets lost',
    body: 'Domains, initiatives, projects, tasks, and blocks are one system. A project can’t die in a board while your Tuesday lives in a calendar.',
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
    <a href={href} onPointerEnter={resolve} onFocus={resolve} className={`btn-primary tap ${className}`}>
      Download for Mac
    </a>
  )
}

function CtaGroup({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <DownloadMacButton />
      <a href={ACCESS_MAILTO} className="btn-ghost tap">
        Request access
      </a>
      <a href={APP_URL} className="btn-ghost tap" rel="noopener noreferrer">
        Open app
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
          <a href={ACCESS_MAILTO} className="btn-ghost tap hidden text-[13px] sm:inline-flex">
            Request access
          </a>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pb-24 sm:pt-14">
          <div className="max-w-2xl">
            <h1 className="masthead reveal text-display text-[var(--text)]">
              One funnel for every domain you run.
            </h1>
            <p className="reveal reveal-delay-1 mt-5 max-w-xl text-pretty hero-support text-[var(--muted)]">
              Multiple teams. Multiple projects. Multiple initiatives. Nuvo holds the entire
              vertical — so nothing gets lost between the calling and the calendar.
            </p>
            <CtaGroup className="reveal reveal-delay-2 mt-8" />
          </div>

          <div className="reveal reveal-delay-3 mt-12 sm:mt-16">
            <ScheduleVisual />
          </div>
        </section>

        {/* Emotion / who it's for */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:items-start">
            <div>
              <p className="section-label text-[var(--muted)]">If this is you</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                You’re carrying more than one world — and the tools don’t talk.
              </h2>
              <div className="mt-6 space-y-5 text-body text-[var(--muted)]">
                <p>
                  Work has three teams and a roadmap. Church has a season. Family has a calendar
                  that doesn’t care about your sprint. Somewhere there’s a project that mattered
                  in January and hasn’t been touched since March.
                </p>
                <p>
                  Task apps keep checklists. Project apps keep boards. Calendars keep meetings.
                  The loose ends — the “don’t forget,” the half-shaped initiative, the thing a
                  teammate mentioned in Slack — fall between them.
                </p>
                <p className="text-[var(--text)]">
                  Nuvo is the one funnel. Capture anything. Hold the whole vertical. Get it to
                  the week, then the day, without switching systems or losing the thread.
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
              <p className="section-label text-[var(--muted)]">Domains</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                Where you are called to be faithful.
              </h2>
              <p className="mt-5 max-w-md text-body text-[var(--muted)]">
                Domains aren’t folders or tags. They are the areas of life you are perpetually
                called to be faithful and produce in. Initiatives and projects grow under them.
                The week decides what lands on the day — across every domain, not just work.
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
            The entire vertical — down to the block.
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
            Skins for how you work — not just light and dark.
          </h2>
          <p className="mt-5 max-w-2xl text-body text-[var(--muted)]">
            Five materials: Aurora glass, Flat, Terminal (Dracula, Nord, Tokyo Night…),
            Blueprint, E-Ink. Moods and schemes inside each. Light and dark where they make
            sense.
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
              Sunday composes the week. Morning brief claims the day. Evening shutdown closes
              it. Summit turns the quarter. You enter, decide, leave — so the funnel keeps
              moving without becoming a second job.
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
                <span className="section-label w-24 shrink-0 text-[var(--accent)]">Summit</span>
                <span className="text-[var(--muted)]">Set the quarter’s bets — then Blueprint.</span>
              </li>
            </ul>
          </div>
        </section>

        {/* Coming soon */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="glass-card rounded-2xl border border-[var(--line)] px-6 py-8 sm:px-10 sm:py-10">
            <p className="section-label text-[var(--accent)]">Coming soon</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              Native iOS &amp; Apple Watch.
            </h2>
            <p className="mt-4 max-w-xl text-body text-[var(--muted)]">
              Today: the native Mac app (download above), Mac capture with ⌥Space, and an
              installable iOS PWA. The Mac app updates itself quietly in the background. Next:
              native iPhone and Watch — dictate a loose task from the wrist into the same funnel.
            </p>
            <div className="mt-8 flex flex-wrap gap-6">
              <div>
                <p className="section-label text-[var(--muted)]">Now</p>
                <p className="mt-1 text-[15px] text-[var(--text)]">Mac app · ⌥Space · iOS PWA</p>
              </div>
              <div>
                <p className="section-label text-[var(--muted)]">Next</p>
                <p className="mt-1 text-[15px] text-[var(--text)]">iOS native · Apple Watch</p>
              </div>
            </div>
          </div>
        </section>

        {/* Closing */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-xl text-center">
            <p className="section-label text-[var(--muted)]">Nothing lost</p>
            <h2 className="masthead mt-4 text-lead text-[var(--text)]">
              The funnel for a full life.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Capture the loose end. Hold the initiative. Land the block. One person, every
              domain — finally in one place.
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
          <p>© {new Date().getFullYear()} · Built for a multi-domain life</p>
        </div>
      </footer>
    </div>
  )
}
