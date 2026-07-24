import { ACCESS_EMAIL, ACCESS_MAILTO } from '../config'

export default function Privacy() {
  const updated = 'July 24, 2026'

  return (
    <div className="atmosphere min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 pt-5 pb-2 sm:px-8 sm:pt-7">
        <a href="/" className="wordmark text-[1.125rem] text-[var(--text)] tap inline-flex items-center">
          Nuvo
        </a>
        <a href="/" className="btn-ghost tap text-[13px]">
          Back
        </a>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <p className="section-label text-[var(--muted)]">Legal</p>
        <h1 className="masthead mt-3 text-display text-[var(--text)]">Privacy Policy</h1>
        <p className="mt-4 text-body text-[var(--muted)]">Last updated {updated}</p>

        <div className="privacy-prose mt-12 space-y-10 text-[0.975rem] leading-relaxed text-[var(--muted)]">
          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Who we are</h2>
            <p className="mt-3">
              Nuvo (“we”, “us”) is a single-user life management application. This policy
              explains what we collect, why, and how Google user data is handled when you
              connect Google Calendar. Questions:{' '}
              <a href={ACCESS_MAILTO} className="text-[var(--accent)] underline-offset-2 hover:underline">
                {ACCESS_EMAIL}
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Account &amp; planning data</h2>
            <p className="mt-3">
              When you create an account we store your email and authentication credentials
              via our provider (Supabase Auth). Inside the app we store the planning data you
              create: domains, initiatives, projects, tasks, time blocks, labels, week
              commitments, settings, and related notes. That data is yours. It is stored in a
              private database with row-level security so only your signed-in account can read
              or write it.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Google Calendar</h2>
            <p className="mt-3">
              If you choose to connect Google Calendar, Nuvo requests these OAuth scopes:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <code className="text-[var(--text)]">https://www.googleapis.com/auth/calendar</code>{' '}
                — read and write calendar events so Nuvo can sync your calendars, show them on
                the planning surface, and write scheduled tasks back (including a dedicated
                “Nuvo” mirror calendar).
              </li>
              <li>
                <code className="text-[var(--text)]">https://www.googleapis.com/auth/userinfo.email</code>{' '}
                — identify which Google account you connected.
              </li>
            </ul>
            <p className="mt-3">
              We store OAuth refresh tokens in a secured vault (not in plain application
              tables), plus calendar list metadata and mirrored event data needed to keep
              your schedule in sync. Google Calendar data is used solely to provide Nuvo’s
              calendar sync and scheduling features to you.
            </p>
            <p className="mt-3">
              Nuvo’s use of information received from Google APIs adheres to the{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className="text-[var(--accent)] underline-offset-2 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. We do not sell Google user data. We
              do not use it for advertising. We do not allow humans to read it except with
              your consent, for security, to comply with law, or as part of providing the
              service you requested (e.g. support you initiate).
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Microsoft 365, Apple Calendar &amp; ICS</h2>
            <p className="mt-3">
              Optional connections work the same spirit: credentials are stored in a secured
              vault; event data is synced only to power your planning surface.
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong className="text-[var(--text)]">Microsoft 365</strong> — calendar
                read access (events appear in Nuvo; Nuvo does not write back to M365).
              </li>
              <li>
                <strong className="text-[var(--text)]">Apple / iCloud Calendar</strong> —
                you connect with Apple ID + an app-specific password for two-way CalDAV sync.
              </li>
              <li>
                <strong className="text-[var(--text)]">ICS subscriptions</strong> — read-only
                feeds; the feed URL is stored so we can refresh events.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Assistant &amp; AI features</h2>
            <p className="mt-3">
              When you use Nuvo’s assistant, prompts and the planning context needed to
              answer (tasks, calendar snippets, project structure) may be sent to our
              language-model provider to generate proposals. That processing is in service of
              features you invoke. We do not use your Google Calendar content to train
              generalized AI models.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Device-local preferences</h2>
            <p className="mt-3">
              Appearance (skins / themes), some timezone preferences, and similar UI settings
              may be stored on your device (e.g. localStorage). They are not required for
              core sync.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Retention &amp; deletion</h2>
            <p className="mt-3">
              We retain your account and planning data while your account is active. You can
              disconnect Google (or other calendars) in Settings at any time — that revokes
              further API access and we stop syncing that account. To delete your Nuvo
              account and associated data, email{' '}
              <a href={ACCESS_MAILTO} className="text-[var(--accent)] underline-offset-2 hover:underline">
                {ACCESS_EMAIL}
              </a>
              . We will delete or anonymize personal data within a reasonable period, except
              where we must retain records for legal or security reasons.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Sharing</h2>
            <p className="mt-3">
              We do not sell personal data. We use infrastructure processors (hosting, auth,
              database, email delivery if applicable, AI inference for assistant features)
              solely to run Nuvo. They process data under our instructions.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Security</h2>
            <p className="mt-3">
              Access tokens and calendar credentials are stored in a vault. Application data
              is protected with authentication and row-level security. No method of
              transmission or storage is perfectly secure; we work to protect your data with
              industry-standard practices.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Children</h2>
            <p className="mt-3">
              Nuvo is not directed at children under 13. We do not knowingly collect personal
              information from children.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Changes</h2>
            <p className="mt-3">
              We may update this policy as Nuvo evolves. The “Last updated” date above will
              change when we do. Material changes that affect Google user data use will be
              called out clearly.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Contact</h2>
            <p className="mt-3">
              Privacy requests and questions:{' '}
              <a href={ACCESS_MAILTO} className="text-[var(--accent)] underline-offset-2 hover:underline">
                {ACCESS_EMAIL}
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <footer className="mx-auto flex max-w-3xl flex-col gap-3 border-t border-[var(--line)] px-5 py-8 text-[13px] text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span className="wordmark text-[var(--text)]">Nuvo</span>
        <p>© {new Date().getFullYear()}</p>
      </footer>
    </div>
  )
}
