import { useEffect, useState } from "react";
import { PaneHeader } from "../../form";
import { Icon } from "../../Icon";
import { Button, SectionHeader } from "../../kit";
import { useSubscription } from "../../../hooks/useSubscription";
import { fetchPortalUrl, fetchReferralCode, openBillingUrl } from "../../../lib/stripeBilling";
import { planOf, trialDaysRemaining, type Subscription } from "../../../lib/subscription";
import { shareBlurb } from "../../../lib/referral";
import { WebUpgradeModal } from "./UpgradeModal";

/** Web / macOS Settings → Billing. Stripe portal + friend-codes. An Apple
 *  subscriber who opens the web app is already entitled — we say so and do
 *  not send them through Checkout. */
export function WebBillingPane() {
  const { subscription } = useSubscription();
  const [upgrading, setUpgrading] = useState(false);
  const plan = planOf(subscription);
  const source = subscription?.plan_source ?? null;

  return (
    <div>
      <PaneHeader title="Billing" />

      {plan === "trialing" && subscription ? (
        <TrialingCard subscription={subscription} onUpgrade={() => setUpgrading(true)} />
      ) : plan === "active" && subscription && source === "apple" ? (
        <AppleActiveCard subscription={subscription} />
      ) : plan === "active" && subscription ? (
        <ActiveCard subscription={subscription} />
      ) : (
        <p className="set-note">Loading…</p>
      )}

      {subscription && (plan === "trialing" || (plan === "active" && source !== "apple")) && (
        <ShareCodeBlock
          initial={subscription.referral_code ?? null}
          creditsEarned={subscription.referral_credits_earned ?? 0}
          uses={subscription.referral_uses ?? 0}
        />
      )}

      {upgrading && <WebUpgradeModal onClose={() => setUpgrading(false)} />}
    </div>
  );
}

function ShareCodeBlock({
  initial,
  creditsEarned,
  uses,
}: {
  initial: string | null;
  creditsEarned: number;
  uses: number;
}) {
  const [code, setCode] = useState<string | null>(initial);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (code) return;
    let cancelled = false;
    setBusy(true);
    fetchReferralCode()
      .then((c) => {
        if (!cancelled) setCode(c);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "";
        if (!cancelled && !/not configured/i.test(msg)) {
          setError(msg || "Could not load your code");
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Couldn’t copy — select the code instead");
    }
  };

  return (
    <div>
      <SectionHeader title="Share Nuvo" className="set-group" />
      <p className="set-note">{shareBlurb()}</p>
      {busy && !code ? (
        <p className="set-note mt-2">Getting your code…</p>
      ) : code ? (
        <div className="mt-2 flex items-center gap-2">
          <code className="k-field !h-auto px-3 py-1.5 font-mono text-body text-ink" data-selectable>
            {code}
          </code>
          <Button className="tap" onClick={copy} icon={<Icon name="copy" size={13} />}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : !error ? (
        <p className="set-note mt-2">Your code appears here once friend-codes are on.</p>
      ) : null}
      {uses > 0 && (
        <p className="mt-3 text-body text-ink">
          {uses === 1 ? "1 friend has used your code" : `${uses} friends have used your code`}
          {creditsEarned > 0
            ? ` · you’ve earned ${creditsEarned} free month${creditsEarned === 1 ? "" : "s"}`
            : " · free month when they pay"}
          {creditsEarned > 0 ? ". Credit applies to your next invoice automatically." : "."}
        </p>
      )}
      {uses === 0 && creditsEarned > 0 && (
        <p className="mt-3 text-body text-ink">
          You’ve earned {creditsEarned} free month{creditsEarned === 1 ? "" : "s"} from friends.
          Credit applies to your next invoice automatically.
        </p>
      )}
      {error && <div className="mt-2 text-caption text-danger">{error}</div>}
    </div>
  );
}

function TrialingCard({
  subscription,
  onUpgrade,
}: {
  subscription: Subscription;
  onUpgrade: () => void;
}) {
  const days = trialDaysRemaining(subscription);
  const ends = new Date(subscription.trial_ends_at).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="set-row">
      <div className="set-row-label">
        <span className="set-row-title">
          Free trial · {days} day{days === 1 ? "" : "s"} left
        </span>
        <div className="set-row-desc">Ends {ends}</div>
      </div>
      <div className="set-row-ctl">
        <Button kind="primary" className="tap" onClick={onUpgrade}>
          See plans
        </Button>
      </div>
    </div>
  );
}

function AppleActiveCard({ subscription }: { subscription: Subscription }) {
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const ending = subscription.cancel_at_period_end;

  return (
    <div>
      <div className="set-row">
        <div className="set-row-label">
          <span className="set-row-title">Nuvo · active</span>
          {periodEnd && (
            <div className="set-row-desc" style={ending ? { color: "var(--warn)" } : undefined}>
              {ending ? `Ends ${periodEnd} — you'll keep access until then` : `Renews ${periodEnd}`}
            </div>
          )}
        </div>
      </div>
      <p className="set-note mt-3">Through the App Store. Manage or cancel it on your iPhone.</p>
    </div>
  );
}

function ActiveCard({ subscription }: { subscription: Subscription }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPortal = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await fetchPortalUrl();
      await openBillingUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  };

  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const ending = subscription.cancel_at_period_end;

  return (
    <div>
      <div className="set-row">
        <div className="set-row-label">
          <span className="set-row-title">Nuvo · active</span>
          {periodEnd && (
            <div className="set-row-desc" style={ending ? { color: "var(--warn)" } : undefined}>
              {ending ? `Ends ${periodEnd} — you'll keep access until then` : `Renews ${periodEnd}`}
            </div>
          )}
        </div>
      </div>
      <div className="set-row">
        <div className="set-row-label">
          <span className="set-row-title">Billing</span>
          <div className="set-row-desc">Card, plan, invoices, or cancel.</div>
        </div>
        <div className="set-row-ctl">
          <Button kind={ending ? "primary" : "secondary"} className="tap" disabled={busy} onClick={openPortal}>
            {busy ? "Opening…" : ending ? "Resume subscription" : "Manage billing"}
          </Button>
        </div>
      </div>
      {error && <div className="mt-2 text-caption text-danger">{error}</div>}
    </div>
  );
}
