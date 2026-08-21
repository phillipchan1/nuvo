import { APP_URL, SUPPORT_EMAIL, SUPPORT_MAILTO } from '../config'
import { appUrlWithCode } from '../referral'

/**
 * /share — the public friend-code explainer.
 *
 * Not an affiliate portal (N-17): no apply form, no leaderboard, no commissions.
 * Operators self-mint in Settings → Billing; this page is what you point a
 * friend (or a beta) at so the offer isn't buried in Support.
 */

export default function Share() {
  return (
    <div className="atmosphere min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 pt-5 pb-2 sm:px-8 sm:pt-7">
        <a href="/" className="wordmark text-[1.125rem] text-[var(--text)] tap inline-flex items-center">
          Nuvo
        </a>
        <a href={appUrlWithCode(APP_URL)} className="btn-ghost tap text-[13px]" rel="noopener noreferrer">
          Open app
        </a>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <p className="section-label text-[var(--muted)]">Share Nuvo</p>
        <h1 className="masthead mt-3 text-display text-[var(--text)]">A code for people who already love it.</h1>
        <p className="mt-5 max-w-xl text-lead text-[var(--muted)]">
          Not an affiliate program. If Nuvo fits how you run your life, you get a personal
          code — your friends save on their first month, and you get a free month when they
          actually pay.
        </p>

        <div className="mt-14 grid gap-10 border-t border-[var(--line)] pt-10 sm:grid-cols-2 sm:gap-12">
          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Your friend</h2>
            <p className="mt-3 text-[0.975rem] leading-relaxed text-[var(--muted)]">
              <strong className="text-[var(--text)]">50% off their first month</strong>. They open
              the link you sent (
              <span className="mono text-[var(--text)]">nuvo.day/?code=…</span>
              ), or type your code at Stripe Checkout when they subscribe. We remember it
              through the trial.
            </p>
          </section>
          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">You</h2>
            <p className="mt-3 text-[0.975rem] leading-relaxed text-[var(--muted)]">
              <strong className="text-[var(--text)]">One free month</strong> on your bill when
              they pay — not when they start the trial. Up to six free months outstanding.
              Quiet credit, no leaderboard.
            </p>
          </section>
        </div>

        <section className="mt-14 border-t border-[var(--line)] pt-10">
          <h2 className="masthead text-[1.35rem] text-[var(--text)]">How you get your code</h2>
          <p className="mt-3 max-w-xl text-[0.975rem] leading-relaxed text-[var(--muted)]">
            Nothing to apply for. Sign in →{' '}
            <strong className="text-[var(--text)]">Settings → Billing → Share Nuvo</strong>.
            The first time you open that pane we mint a unique code — your first name plus a
            short tag, like <span className="mono text-[var(--text)]">PHIL-K7RM</span>, so it
            stays yours even if a thousand Phils show up. Copy it, or send{' '}
            <span className="mono text-[var(--text)]">nuvo.day/?code=YOURCODE</span>.
          </p>
          <a
            href={appUrlWithCode(APP_URL)}
            className="btn-primary tap mt-8 inline-flex"
            rel="noopener noreferrer"
          >
            Open Nuvo
          </a>
        </section>

        <section className="mt-14 border-t border-[var(--line)] pt-10">
          <h2 className="masthead text-[1.35rem] text-[var(--text)]">Someone sent you a code?</h2>
          <p className="mt-3 max-w-xl text-[0.975rem] leading-relaxed text-[var(--muted)]">
            Open their link, or type the code in Checkout under &ldquo;Add promotion
            code.&rdquo; Questions:{' '}
            <a href={SUPPORT_MAILTO} className="text-[var(--accent)] underline-offset-2 hover:underline">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </section>
      </main>

      <footer className="mx-auto flex max-w-3xl flex-col gap-3 border-t border-[var(--line)] px-5 py-8 text-[13px] text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span>© {new Date().getFullYear()} Nuvo</span>
        <nav className="flex flex-wrap gap-x-4 gap-y-2">
          <a href="/support" className="hover:text-[var(--text)]">
            Support
          </a>
          <a href="/privacy" className="hover:text-[var(--text)]">
            Privacy
          </a>
          <a href="/terms" className="hover:text-[var(--text)]">
            Terms
          </a>
        </nav>
      </footer>
    </div>
  )
}
