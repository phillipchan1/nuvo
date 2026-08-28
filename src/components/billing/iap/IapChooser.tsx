import { useEffect, useState } from "react";
import { Icon } from "../../Icon";
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const catalog = await fetchIapCatalog();
      const ids = catalogProductIds(catalog);
      if (ids.length === 0) {
        if (!cancelled) setProducts([]);
        return;
      }
      const loaded = await loadIapProducts(ids);
      if (cancelled) return;
      setProducts(loaded);
      const annual = catalog.annual ? loaded.find((p) => p.id === catalog.annual) : undefined;
      setSelected((annual ?? loaded[0])?.id ?? null);
    })().catch(() => {
      if (!cancelled) setProducts([]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      setBusy(false);
    }
  };

  if (products === null) {
    return <div className="text-caption text-muted">Loading App Store products…</div>;
  }

  if (products.length === 0) {
    return (
      <div>
        <p className="text-caption leading-relaxed text-muted">
          Subscriptions aren’t available from the App Store on this build yet. Your work is
          still here. Try again after the next update, or write us if you need a hand.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={restore}
          className="tap fast mt-4 w-full py-3 text-caption text-muted hover:text-ink"
        >
          Restore purchases
        </button>
        {error && <div className="mt-2 text-caption text-signal">{error}</div>}
        <div className="mt-4 flex items-center gap-4">
          <a
            href="https://nuvo.day/terms"
            target="_blank"
            rel="noreferrer"
            className="tap inline-flex items-center text-caption text-muted hover:text-ink"
          >
            Terms
          </a>
          <a
            href="https://nuvo.day/privacy"
            target="_blank"
            rel="noreferrer"
            className="tap inline-flex items-center text-caption text-muted hover:text-ink"
          >
            Privacy
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div role="radiogroup" aria-label="Choose a plan" className="grid gap-2">
        {products.map((p) => {
          const on = selected === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setSelected(p.id)}
              className={`tap fast rounded-lg border p-3.5 text-left ${
                on
                  ? "glass-lift border-accent bg-accent-soft"
                  : "border-line bg-surface-2 hover:border-line-strong"
              }`}
            >
              <div className="text-body font-medium text-ink">{p.displayName || p.id}</div>
              {p.duration ? (
                <div className="mt-0.5 text-caption text-muted">{p.duration}</div>
              ) : null}
              {p.displayPrice ? (
                <div className="mt-1.5 mono text-lead text-ink">{p.displayPrice}</div>
              ) : null}
              {p.description ? (
                <div className="mt-0.5 text-caption text-muted">{p.description}</div>
              ) : null}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={busy || !selected}
        onClick={subscribe}
        className="tap fast mt-3 w-full rounded-md border border-accent bg-accent px-4 py-3 text-body font-medium text-on-accent shadow-sm hover:brightness-110 active:translate-y-px disabled:bg-surface-2 disabled:text-muted disabled:shadow-none"
      >
        {busy ? "Working…" : cta}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={restore}
        className="tap fast mt-2 w-full py-3 text-caption text-muted hover:text-ink"
      >
        Restore purchases
      </button>

      {error && <div className="mt-2 text-caption text-signal">{error}</div>}

      <ul className="mt-5 space-y-2">
        {INCLUDED.map((line) => (
          <li key={line} className="flex items-start gap-2.5 text-caption text-muted">
            <Icon name="check" size={14} className="mt-0.5 shrink-0 text-accent" />
            <span className="leading-snug">{line}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 border-t border-line pt-3 text-micro text-muted">
        Payment is charged to your Apple ID. The subscription renews automatically unless you
        cancel at least 24 hours before the end of the current period. Manage it in your
        Apple ID settings.
      </div>
      <div className="mt-2 flex items-center gap-4">
        <a
          href="https://nuvo.day/terms"
          target="_blank"
          rel="noreferrer"
          className="tap inline-flex items-center text-caption text-muted hover:text-ink"
        >
          Terms
        </a>
        <a
          href="https://nuvo.day/privacy"
          target="_blank"
          rel="noreferrer"
          className="tap inline-flex items-center text-caption text-muted hover:text-ink"
        >
          Privacy
        </a>
      </div>
    </div>
  );
}
