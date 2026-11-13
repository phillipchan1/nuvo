import { useEffect, useState } from "react";
import { Icon } from "../../Icon";
import { Button } from "../../kit";
import {
  catalogProductIds,
  confirmApplePurchase,
  fetchIapCatalog,
  iapErrorMessage,
  loadIapProducts,
  purchaseIap,
  restoreAndConfirm,
  type IapProduct,
} from "../../../lib/iap";
import { useSubscription } from "../../../hooks/useSubscription";

const INCLUDED = [
  "Every calendar in one place — Google, Outlook, iCloud",
  "Nuvo, your planning copilot",
  "Projects, initiatives, and domains",
  "Weekly planning and review flows",
  "The Mac app and your iPhone",
];

/** StoreKit-only pay. If products are missing, a stub — never another rail.
 *  The 14-day trial is the same `subscriptions` row every signup gets. */
export function IapChooser({ cta = "Subscribe" }: { cta?: string }) {
  const { refetch } = useSubscription();
  const [products, setProducts] = useState<IapProduct[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setProducts(null);
    (async () => {
      const catalog = await fetchIapCatalog();
      const ids = catalogProductIds(catalog);
      const { products: loaded, reason: why } = await loadIapProducts(ids);
      if (cancelled) return;
      setReason(why);
      setProducts(loaded);
      const annual = catalog.annual ? loaded.find((p) => p.id === catalog.annual) : undefined;
      setSelected((annual ?? loaded[0])?.id ?? null);
    })().catch((e) => {
      if (cancelled) return;
      setReason(e instanceof Error ? e.message : String(e));
      setProducts([]);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const subscribe = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const purchase = await purchaseIap(selected);
      await confirmApplePurchase(purchase);
      await refetch();
    } catch (e) {
      setError(iapErrorMessage(e, "Purchase didn’t complete"));
    } finally {
      // An entitled refetch unmounts the paywall; anything else must not
      // leave the button on "Working…" with nothing to press.
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      await restoreAndConfirm();
      await refetch();
    } catch (e) {
      setError(iapErrorMessage(e, "Restore didn’t complete"));
    } finally {
      setBusy(false);
    }
  };

  if (products === null) {
    return <p className="set-note doc-pulse">Loading App Store products…</p>;
  }

  if (products.length === 0) {
    return (
      <div>
        <p className="set-note">
          Subscriptions aren’t available from the App Store on this build yet. Your work is still here. Try
          again after the next update, or write us if you need a hand.
        </p>
        {reason && <p className="set-note mt-2 break-words">{reason}</p>}
        <Button size="md" full disabled={busy} onClick={() => setAttempt((n) => n + 1)} className="tap mt-4">
          Try again
        </Button>
        <Button kind="ghost" size="md" full disabled={busy} onClick={restore} className="tap mt-2">
          Restore purchases
        </Button>
        {error && <div className="mt-2 text-caption text-danger">{error}</div>}
        <div className="plan-links">
          <a href="https://nuvo.day/terms" target="_blank" rel="noreferrer" className="tap">
            Terms
          </a>
          <a href="https://nuvo.day/privacy" target="_blank" rel="noreferrer" className="tap">
            Privacy
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div role="radiogroup" aria-label="Choose a plan" className="plan-grid" data-one="">
        {products.map((p) => {
          const on = selected === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setSelected(p.id)}
              className="plan-card tap"
            >
              <span className="plan-card-head">
                <span>{p.displayName || p.id}</span>
              </span>
              {p.duration ? <span className="plan-card-sub">{p.duration}</span> : null}
              {p.displayPrice ? <span className="plan-card-price">{p.displayPrice}</span> : null}
              {p.description ? <span className="plan-card-sub">{p.description}</span> : null}
            </button>
          );
        })}
      </div>

      <Button kind="primary" size="md" full disabled={busy || !selected} onClick={subscribe} className="tap mt-3">
        {busy ? "Working…" : cta}
      </Button>

      <Button kind="ghost" size="md" full disabled={busy} onClick={restore} className="tap mt-2">
        Restore purchases
      </Button>

      {error && <div className="mt-2 text-caption text-danger">{error}</div>}

      <ul className="plan-included">
        {INCLUDED.map((line) => (
          <li key={line}>
            <Icon name="check" size={14} />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <p className="set-note plan-fine">
        Payment is charged to your Apple ID. The subscription renews automatically unless you cancel at least 24
        hours before the end of the current period. Manage it in your Apple ID settings.
      </p>
      <div className="plan-links">
        <a href="https://nuvo.day/terms" target="_blank" rel="noreferrer" className="tap">
          Terms
        </a>
        <a href="https://nuvo.day/privacy" target="_blank" rel="noreferrer" className="tap">
          Privacy
        </a>
      </div>
    </div>
  );
}
