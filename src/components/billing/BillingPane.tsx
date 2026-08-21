import { useEffect, useState } from "react";
import { Btn } from "../ui";
import { useSubscription } from "../../hooks/useSubscription";
import {
  fetchPortalUrl,
  fetchReferralCode,
  openBillingUrl,
  trialDaysRemaining,
  type Subscription,
} from "../../lib/subscription";
import { shareBlurb } from "../../lib/referral";
import { UpgradeModal } from "./UpgradeModal";

/** Settings is for MANAGING a subscription — the selling happens in
 *  UpgradeModal. This pane only ever sees the two entitled states: a
 *  non-entitled account never reaches Settings, LockedScreen replaces the
 *  whole app first (see App.tsx's gating). */
export function BillingPane() {
  const { subscription } = useSubscription();
  const [upgrading, setUpgrading] = useState(false);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-head font-semibold text-ink">Billing</h2>
        <p className="mt-0.5 text-caption leading-snug text-muted">Your plan and payment method.</p>
      </div>

      {subscription?.status === "trialing" ? (
        <TrialingCard subscription={subscription} onUpgrade={() => setUpgrading(true)} />
      ) : subscription?.status === "active" ? (
        <ActiveCard subscription={subscription} />
      ) : (
        <div className="text-caption text-muted">Loading…</div>
      )}

      {subscription && (subscription.status === "trialing" || subscription.status === "active") && (
        <ShareCodeBlock
          initial={subscription.referral_code ?? null}
          creditsEarned={subscription.referral_credits_earned ?? 0}
        />
      )}

      {upgrading && <UpgradeModal onClose={() => setUpgrading(false)} />}
    </div>
  );
}

/** Their personal code + any free months already earned. Quiet — no referral
 *  counts of other people (P9). Lives on Billing because that's already
 *  "what's my plan?" (P8). */
function ShareCodeBlock({
  initial,
  creditsEarned,
}: {
  initial: string | null;
  creditsEarned: number;
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
        // Coupon not configured yet (503) — stay quiet; Phil still seeds via
        // scripts/create-referral-codes.mjs. Don't paint an error into Billing.
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
    <div className="mt-6 border-t border-line pt-4">
      <div className="text-label uppercase tracking-wider text-muted">Share Nuvo</div>
      <p className="mt-1 text-caption leading-snug text-muted">{shareBlurb()}</p>
      {busy && !code ? (
        <div className="mt-2 text-caption text-muted">Getting your code…</div>
      ) : code ? (
        <div className="mt-2 flex items-center gap-2">
          <code className="mono rounded-md border border-line bg-surface-2 px-3 py-2 text-body text-ink">
            {code}
          </code>
          <Btn kind="ghost" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Btn>
        </div>
      ) : !error ? (
        <div className="mt-2 text-caption text-muted">
          Your code will appear here once friend-codes are turned on. Nothing to apply for —
          open this pane and we mint one.
        </div>
      ) : null}
      {creditsEarned > 0 && (
        <p className="mt-3 text-caption leading-snug text-ink">
          You’ve earned {creditsEarned} free month{creditsEarned === 1 ? "" : "s"} from friends.
          Credit applies to your next invoice automatically.
        </p>
      )}
      {error && <div className="mt-2 text-caption text-signal">{error}</div>}
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
    <div>
      <div className="rounded-lg border border-line bg-surface-2 p-3">
        <div className="text-label uppercase tracking-wider text-muted">Current plan</div>
        <div className="mt-0.5 text-body text-ink">
          Free trial · {days} day{days === 1 ? "" : "s"} left
        </div>
        <div className="mt-1 text-caption text-muted">Ends {ends}</div>
      </div>
      <div className="mt-4">
        <Btn kind="primary" onClick={onUpgrade}>
          See plans
        </Btn>
      </div>
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
      <div className="rounded-lg border border-line bg-surface-2 p-3">
        <div className="text-label uppercase tracking-wider text-muted">Current plan</div>
        <div className="mt-0.5 text-body text-ink">Nuvo · active</div>
        {periodEnd && (
          <div className={`mt-1 text-caption ${ending ? "text-signal" : "text-muted"}`}>
            {ending ? `Ends ${periodEnd} — you'll keep access until then` : `Renews ${periodEnd}`}
          </div>
        )}
      </div>
      <div className="mt-4">
        <Btn kind={ending ? "primary" : "ghost"} disabled={busy} onClick={openPortal}>
          {busy ? "Opening…" : ending ? "Resume subscription" : "Manage billing"}
        </Btn>
      </div>
      <p className="mt-2 text-caption text-muted">
        Update your card, switch plans, download invoices, or cancel.
      </p>
      {error && <div className="mt-2 text-caption text-signal">{error}</div>}
    </div>
  );
}
