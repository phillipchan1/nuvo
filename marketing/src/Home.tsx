import AssistantVisual from './components/AssistantVisual'
import CalendarsVisual from './components/CalendarsVisual'
import CaptureVisual from './components/CaptureVisual'
import CadenceVisual from './components/CadenceVisual'
import CarryVisual from './components/CarryVisual'
import CommitmentVisual from './components/CommitmentVisual'
import DeckVisual from './components/DeckVisual'
import DomainChapelVisual from './components/DomainChapelVisual'
import ReflectVisual from './components/ReflectVisual'
import OperatorVisual from './components/OperatorVisual'
import ScheduleVisual from './components/ScheduleVisual'
import ThemesVisual from './components/ThemesVisual'
import { ACCESS_MAILTO, APP_URL } from './config'

const CAPABILITIES = [
  {
    label: 'One funnel',
    title: 'Nothing gets lost',
    body: 'Domains, projects, tasks, and blocks — one system, not five apps.',
  },
  {
    label: 'Capture',
    title: 'Every thought lands',
    body: 'One keystroke from anywhere. The inbox holds it till you route it.',
  },
  {
    label: 'Schedule',
    title: 'The task is the block',
    body: 'Drag work onto Tuesday. It lives on the hour, not on a board.',
  },
  {
    label: 'The Week',
    title: 'Commit before you schedule',
    body: 'Only what you commit reaches Today. The rest stays quiet.',
  },
  {
    label: 'Intelligence',
    title: 'Help where it counts',
    body: 'Nuvo drafts and proposes. You decide what reaches the calendar.',
  },
  {
    label: 'Standing',
    title: 'Protect your hours',
    body: 'Recurring slots claim the time that matters. Sunday fills them.',
  },
] as const

function CtaGroup({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <a href={APP_URL} className="btn-primary tap" rel="noopener noreferrer">
        Open app
      </a>
      <a href={ACCESS_MAILTO} className="btn-ghost tap">
        Request access
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
              One funnel for every domain you run.
            </h1>
            <p className="reveal reveal-delay-1 mt-5 max-w-xl text-pretty hero-support text-[var(--muted)]">
              Work, church, family, the side project — each with its own tools that don’t talk.
              Nuvo holds all of it in one place, and lands it on the calendar. So nothing
              important slips.
            </p>
            <CtaGroup className="reveal reveal-delay-2 mt-8" />
          </div>

          <div className="reveal reveal-delay-3 mt-12 sm:mt-16">
            <ScheduleVisual />
          </div>
        </section>

        {/* Problem — the emotional core, carried visually */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">The problem</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              You’re not disorganized. You’re outnumbered.
            </h2>
            <p className="mt-5 max-w-xl text-body text-[var(--muted)]">
              Task apps keep checklists. Project apps keep boards. Calendars keep meetings.
              The important things slip through the cracks between them.
            </p>
          </div>
          <div className="mt-10 sm:mt-12">
            <CarryVisual />
          </div>
        </section>

        {/* Domains — full-width band */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">Domains</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              Are you still showing up where it matters?
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              A domain isn’t a folder or a tag — it’s a place you’re called to be faithful. Nuvo
              holds a standing vow for each one and tracks your presence over a quarter, so a world
              gone quiet can’t hide.
            </p>
          </div>
          <div className="mt-10 sm:mt-12">
            <DomainChapelVisual />
          </div>
        </section>

        {/* Capture */}
        <section
          id="capture"
          className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24"
        >
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">Capture</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                Get it out of your head in two seconds.
              </h2>
              <p className="mt-5 text-body text-[var(--muted)]">
                Mid-call, mid-Slack, mid-thought — hit one key, type like you’d text yourself, and
                it’s captured. Decide where it lives later. Nothing evaporates.
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

        {/* Capacity — the "do I have time?" fear, answered */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
            <div className="lg:order-2">
              <p className="section-label text-[var(--muted)]">Capacity</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                Find out it won’t fit on Sunday — not Thursday at 11pm.
              </h2>
              <p className="mt-5 max-w-md text-body text-[var(--muted)]">
                Every domain wants hours you don’t have. Nuvo weighs what you’ve committed against
                the week you actually own, and shows the overflow while you can still cut it — on
                purpose, not in a panic.
              </p>
            </div>
            <div className="lg:order-1">
              <CommitmentVisual />
            </div>
          </div>
        </section>

        {/* Assistant — the AI that proposes, you decide */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:gap-16">
            <div>
              <p className="section-label text-[var(--muted)]">Nuvo</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                An assistant that proposes — you decide.
              </h2>
              <p className="mt-5 text-body text-[var(--muted)]">
                Ask in plain language. Nuvo drafts real work — scheduled, dated, done — and hands it
                back as live cards you keep or reverse with one tap. It never touches your calendar
                without you.
              </p>
            </div>
            <AssistantVisual />
          </div>
        </section>

        {/* Capabilities */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <p className="section-label text-[var(--muted)]">How it holds</p>
          <h2 className="masthead mt-3 max-w-2xl text-lead text-[var(--text)]">
            One system, all the way down.
          </h2>

          <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c, i) => (
              <li key={c.label} className="border-t border-[var(--line)] pt-5">
                <div className="flex items-baseline gap-3">
                  <span className="masthead text-[1.5rem] leading-none text-[var(--line-strong)]">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <p className="section-label text-[var(--accent)]">{c.label}</p>
                </div>
                <h3 className="mt-3 text-[1.125rem] font-medium leading-snug text-[var(--text)]">
                  {c.title}
                </h3>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--muted)]">{c.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* On Deck — the project-planning modality */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">On Deck</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              Time-box a project like you time-box a Tuesday.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Drag each project onto the week you’ll actually do it. See what’s ready, what’s still
              raw, and which weeks are overloaded — before you commit a single hour.
            </p>
          </div>
          <div className="mt-10 sm:mt-12">
            <DeckVisual />
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
                Every calendar you already live in — on one grid.
              </h2>
              <p className="mt-5 text-body text-[var(--muted)]">
                Google, Apple, Microsoft, the ICS feed. Meetings and your blocks side by side,
                tinted by domain. Your work can mirror back out — without becoming yet another
                place to check.
              </p>
            </div>
            <CalendarsVisual />
          </div>
        </section>

        {/* Operator polish */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
            <div className="lg:order-2">
              <p className="section-label text-[var(--muted)]">For operators</p>
              <h2 className="masthead mt-3 text-lead text-[var(--text)]">
                Fast enough to keep up with your day.
              </h2>
              <p className="mt-5 text-body text-[var(--muted)]">
                Three domains pinging at once needs speed and an honest week — not another board to
                maintain. Capture fast, decide once, let unfinished work roll cleanly to tomorrow.
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
                  <span className="text-[var(--text)]">Midnight rollover</span> — unfinished work
                  returns to Today, time cleared, duration kept.
                </li>
              </ul>
            </div>
            <div className="lg:order-1">
              <OperatorVisual />
            </div>
          </div>
        </section>

        {/* Reflect — the weekly review / reporting modality */}
        <section className="mx-auto max-w-6xl border-t border-[var(--line)] px-5 py-16 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <p className="section-label text-[var(--muted)]">Reflect</p>
            <h2 className="masthead mt-3 text-lead text-[var(--text)]">
              See the week you actually lived.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Every Friday, Nuvo draws your week from real data — how many priorities landed, where
              your hours actually went, and everything you shipped. Not a dashboard. A mirror.
            </p>
          </div>
          <div className="mt-10 sm:mt-12">
            <ReflectVisual />
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
              You enter, decide, and leave.
            </h2>
            <p className="mt-5 text-body text-[var(--muted)]">
              Short rituals with clear end states — so the system keeps moving without becoming a
              second job.
            </p>
          </div>
          <div className="mt-12">
            <CadenceVisual />
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
              Today: Mac capture with ⌥Space, desktop app, installable iOS PWA. Next: native
              iPhone and Watch — dictate a loose task from the wrist into the same funnel.
            </p>
            <div className="mt-8 flex flex-wrap gap-6">
              <div>
                <p className="section-label text-[var(--muted)]">Now</p>
                <p className="mt-1 text-[15px] text-[var(--text)]">macOS · ⌥Space · iOS PWA</p>
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
