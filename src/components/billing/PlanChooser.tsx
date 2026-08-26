import { useState } from "react";
import { Icon } from "../Icon";
import { startCheckout, openBillingUrl, type CheckoutPlan } from "../../lib/stripeBilling";
import { INCLUDED, PLANS } from "./plans";

/** The sell. Shared by the upgrade modal and the paywall so the offer reads
 *  identically wherever someone meets it — an explicit choice (annual
 *  preselected, never assumed) then one commit button. */
export function PlanChooser({ cta = "Continue to checkout" }: { cta?: string }) {
  const [plan, setPlan] = useState<CheckoutPlan>("annual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await startCheckout(plan);
      await openBillingUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  };

  return (
    <div>
      <div role="radiogroup" aria-label="Choose a plan" className="grid gap-2 sm:grid-cols-2">
        {PLANS.map((p) => {
          const selected = plan === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPlan(p.id)}
              className={`tap fast rounded-lg border p-3.5 text-left ${
                selected
                  ? "glass-lift border-accent bg-accent-soft"
                  : "border-line bg-surface-2 hover:border-line-strong"
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-body font-medium text-ink">{p.label}</span>
                {p.badge && (
                  <span className="section-label ml-auto text-accent">{p.badge}</span>
                )}
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="mono text-lead text-ink">${p.perMonth}</span>
                <span className="text-caption text-muted">/mo</span>
              </div>
              <div className="mt-0.5 text-caption text-muted">{p.billed}</div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={go}
        className="tap fast mt-3 w-full rounded-md border border-accent bg-accent px-4 py-3 text-body font-medium text-on-accent shadow-sm hover:brightness-110 active:translate-y-px disabled:bg-surface-2 disabled:text-muted disabled:shadow-none"
      >
        {busy ? "Taking you to checkout…" : cta}
      </button>

      {error && <div className="mt-2 text-caption text-signal">{error}</div>}

      <ul className="mt-5 space-y-2">
        {INCLUDED.map((line) => (
          <li key={line} className="flex items-start gap-2.5 text-caption text-muted">
            <Check />
            <span className="leading-snug">{line}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 border-t border-line pt-3 text-micro text-muted">
        Cancel anytime · Secure checkout by Stripe
      </div>
    </div>
  );
}

function Check() {
  return (
    <Icon name="check" size={14} className="mt-0.5 shrink-0 text-accent" />
  );
}
