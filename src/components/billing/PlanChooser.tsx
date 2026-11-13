import { useState } from "react";
import { Icon } from "../Icon";
import { Button } from "../kit";
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
      <div role="radiogroup" aria-label="Choose a plan" className="plan-grid">
        {PLANS.map((p) => {
          const selected = plan === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPlan(p.id)}
              className="plan-card tap"
            >
              <span className="plan-card-head">
                <span>{p.label}</span>
                {p.badge && <span className="k-chip" data-tone="accent">{p.badge}</span>}
              </span>
              <span className="plan-card-price">
                ${p.perMonth}
                <small>/mo</small>
              </span>
              <span className="plan-card-sub">{p.billed}</span>
            </button>
          );
        })}
      </div>

      <Button kind="primary" size="md" full disabled={busy} onClick={go} className="tap mt-3">
        {busy ? "Taking you to checkout…" : cta}
      </Button>

      {error && <div className="mt-2 text-caption text-danger">{error}</div>}

      <ul className="plan-included">
        {INCLUDED.map((line) => (
          <li key={line}>
            <Check />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <p className="set-note plan-fine">Cancel anytime · Secure checkout by Stripe</p>
    </div>
  );
}

function Check() {
  return (
    <Icon name="check" size={14} />
  );
}
