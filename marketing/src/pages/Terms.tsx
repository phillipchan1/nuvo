import { ACCESS_EMAIL, ACCESS_MAILTO, GOVERNING_LAW } from '../config'

export default function Terms() {
  const updated = 'August 26, 2026'

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
        <h1 className="masthead mt-3 text-display text-[var(--text)]">Terms of Service</h1>
        <p className="mt-4 text-body text-[var(--muted)]">Last updated {updated}</p>

        <div className="privacy-prose mt-12 space-y-10 text-[0.975rem] leading-relaxed text-[var(--muted)]">
          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Agreement</h2>
            <p className="mt-3">
              These terms govern your use of Nuvo (“Nuvo”, “we”, “us”) — the web app, the
              installable iOS home-screen app, and the macOS desktop app. By creating an
              account or using Nuvo you agree to them. If you don’t agree, don’t use Nuvo.
              How we handle your data is covered separately in our{' '}
              <a href="/privacy" className="text-[var(--accent)] underline-offset-2 hover:underline">
                Privacy Policy
              </a>
              , which forms part of these terms.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">What Nuvo is</h2>
            <p className="mt-3">
              Nuvo is a personal planning application. It holds your domains, initiatives,
              projects, tasks and time blocks, and — if you connect them — reads your
              calendars so your commitments and your work appear on one surface. Nuvo is a
              single-player tool: each account is one person’s system. It is not a shared
              workspace, a system of record, or a substitute for your own judgment about what
              to do with your time.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Your account</h2>
            <p className="mt-3">
              You need an account to use Nuvo. You’re responsible for keeping your login
              credentials secure and for everything done under your account. Tell us promptly
              at{' '}
              <a href={ACCESS_MAILTO} className="text-[var(--accent)] underline-offset-2 hover:underline">
                {ACCESS_EMAIL}
              </a>{' '}
              if you believe your account has been compromised. You must be at least 13 years
              old, and old enough to enter a contract where you live.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Trial, subscription &amp; billing</h2>
            <p className="mt-3">
              Nuvo starts with a 14-day free trial. No card is charged during the trial. After
              it ends, continued use requires a paid subscription — billed monthly or annually
              at the prices shown on our pricing page at the time you subscribe.
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                <strong className="text-[var(--text)]">Renewal.</strong> Subscriptions renew
                automatically at the end of each billing period until you cancel.
              </li>
              <li>
                <strong className="text-[var(--text)]">Cancelling.</strong> You can cancel any
                time from Settings → Billing. Cancellation takes effect at the end of the
                period you’ve already paid for; you keep access until then.
              </li>
              <li>
                <strong className="text-[var(--text)]">Refunds.</strong> Payments are
                non-refundable except where required by law — but if something went genuinely
                wrong, email us and we’ll deal with it like reasonable people.
              </li>
              <li>
                <strong className="text-[var(--text)]">Payments.</strong> Card processing is
                handled by Stripe. We don’t store your card number.
              </li>
              <li>
                <strong className="text-[var(--text)]">Price changes.</strong> We may change
                prices, but not for a period you’ve already paid for, and we’ll give you at
                least 30 days’ notice by email before a change hits your renewal.
              </li>
              <li>
                <strong className="text-[var(--text)]">Taxes.</strong> Prices exclude any tax
                we’re required to collect; where we must, it’s added at checkout.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Your content is yours</h2>
            <p className="mt-3">
              You keep all rights to what you put into Nuvo. You grant us only the permission
              we need to run the service for you: to store, process, back up, sync and display
              your content, and to send the parts needed for a feature you invoke to the
              providers that power it (for example, our language-model provider when you use
              the assistant). We do not claim ownership, and we do not use your content to
              train generalized AI models.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Connected accounts</h2>
            <p className="mt-3">
              Connecting Google Calendar, Microsoft 365, Apple/iCloud Calendar or an ICS feed
              is optional. When you connect one, you authorize Nuvo to access that account on
              your behalf for the purposes described in the{' '}
              <a href="/privacy" className="text-[var(--accent)] underline-offset-2 hover:underline">
                Privacy Policy
              </a>
              , and you confirm you’re allowed to grant that access. Your use of those services
              stays governed by their own terms. You can disconnect any of them in Settings at
              any time. We are not responsible for a third-party provider changing, throttling
              or discontinuing its API.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Acceptable use</h2>
            <p className="mt-3">Don’t use Nuvo to:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>break the law, or infringe someone else’s rights;</li>
              <li>
                access another person’s account or data, or probe, scan or stress-test our
                systems without written permission;
              </li>
              <li>
                resell, sublicense or share your account, or run Nuvo as a service for other
                people;
              </li>
              <li>
                scrape, or hammer our API or the APIs we depend on, in a way that degrades the
                service for anyone else;
              </li>
              <li>
                upload malware, or attempt to circumvent authentication, rate limits or billing.
              </li>
            </ul>
            <p className="mt-3">
              We may suspend an account that is actively harming the service or other users,
              and will tell you why.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Availability &amp; changes</h2>
            <p className="mt-3">
              We work to keep Nuvo running and to keep it improving. We don’t promise
              uninterrupted availability — maintenance happens, providers have outages, and
              features change. We may add, alter or remove features. If we discontinue Nuvo
              entirely, we’ll give reasonable notice and a window to export your data.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Ending it</h2>
            <p className="mt-3">
              You can stop using Nuvo whenever you like. Delete your account in the app
              (Settings → Account → Delete account, or on the locked screen if you are
              locked out) by typing DELETE. That wipes the Nuvo account and the planning
              data we store. Apple subscriptions must be cancelled in Apple Account
              settings first; a Stripe subscription on the web or Mac is cancelled as part
              of the wipe. If you cannot open the app, email{' '}
              <a href={ACCESS_MAILTO} className="text-[var(--accent)] underline-offset-2 hover:underline">
                {ACCESS_EMAIL}
              </a>{' '}
              from the address on the account. We may terminate or suspend your account for
              a material breach of these terms, or for non-payment. On termination your
              right to use Nuvo ends; deletion of your data follows the retention section of
              the Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Disclaimers</h2>
            <p className="mt-3">
              Nuvo is provided “as is” and “as available”, without warranties of any kind,
              express or implied, including merchantability, fitness for a particular purpose,
              and non-infringement. Nuvo’s assistant produces suggestions, not advice — what
              you do with your time, money, health or commitments remains your decision. We do
              not warrant that sync with a third-party calendar will be complete, timely or
              error-free. Keep your own records for anything that matters.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Limitation of liability</h2>
            <p className="mt-3">
              To the fullest extent the law allows, we are not liable for indirect, incidental,
              special, consequential or punitive damages, or for lost profits, lost data, or
              missed commitments. Our total liability arising out of or relating to Nuvo is
              limited to the amount you paid us in the 12 months before the event giving rise
              to the claim. Some jurisdictions don’t allow these limits; where that’s so, they
              apply to the extent permitted.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Changes to these terms</h2>
            <p className="mt-3">
              We may update these terms as Nuvo evolves. The “Last updated” date above will
              change when we do, and we’ll notify you by email or in-app before a material
              change takes effect. Continuing to use Nuvo after that means you accept the
              revised terms.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Governing law</h2>
            <p className="mt-3">
              These terms are governed by the laws of {GOVERNING_LAW}, without regard to its
              conflict-of-laws rules, and the courts located there have exclusive jurisdiction
              — except that either of us may seek injunctive relief anywhere appropriate.
            </p>
          </section>

          <section>
            <h2 className="masthead text-[1.35rem] text-[var(--text)]">Contact</h2>
            <p className="mt-3">
              Questions about these terms:{' '}
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
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <a href="/privacy" className="hover:text-[var(--text)]">
            Privacy
          </a>
          <a href="/support" className="hover:text-[var(--text)]">
            Support
          </a>
          <a href="/" className="hover:text-[var(--text)]">
            Home
          </a>
          <p>© {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  )
}
