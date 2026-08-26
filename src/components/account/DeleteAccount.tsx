import { useId, useState } from "react";
import { Btn } from "../ui";
import { TextInput } from "../form";
import {
  ACCOUNT_DELETE_CONFIRM,
  isAccountDeleteConfirm,
  requestAccountDeletion,
  signOutAfterDeletion,
} from "../../lib/account";

/** Two-step wipe. Lives on Settings → Account and on the locked screen —
 *  a locked-out trial still has to be able to leave (App Store 5.1.1v). */
export function DeleteAccount({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const ready = isAccountDeleteConfirm(typed);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestAccountDeletion();
      await signOutAfterDeletion();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete your account");
      setBusy(false);
    }
  };

  const cancel = () => {
    if (busy) return;
    setOpen(false);
    setTyped("");
    setError(null);
  };

  if (!open) {
    return (
      <div className={compact ? "mt-3" : "mt-8"}>
        {!compact && <div className="section-label mb-2">Leave Nuvo</div>}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="tap fast text-caption text-muted hover:text-signal"
        >
          Delete account
        </button>
      </div>
    );
  }

  return (
    <div className={compact ? "mt-3" : "mt-8"}>
      {!compact && <div className="section-label mb-2">Leave Nuvo</div>}
      <div className="rounded-lg border border-line px-3.5 py-3">
        <div className="text-body text-ink">Delete this account</div>
        <p className="mt-1 text-caption leading-snug text-muted">
          This permanently deletes your Nuvo account and everything we store —
          plans, projects, calendar connections, and settings. You will not be
          able to sign back in.
        </p>
        <p className="mt-2 text-caption leading-snug text-muted">
          If you subscribed through Apple, cancel in Apple Account settings first
          (Settings → your name → Subscriptions). We cannot cancel an App Store
          subscription for you.
        </p>
        <p className="mt-2 text-caption leading-snug text-muted">
          If you pay through the web or Mac, we cancel that Stripe subscription
          when you delete.
        </p>
        <label htmlFor={inputId} className="mt-3 block text-caption text-ink">
          Type <span className="mono">{ACCOUNT_DELETE_CONFIRM}</span> to confirm
        </label>
        <TextInput
          id={inputId}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-label={`Type ${ACCOUNT_DELETE_CONFIRM} to confirm`}
          className="mt-1.5"
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        {error && <div className="mt-2 text-caption text-signal">{error}</div>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Btn kind="signal" disabled={!ready || busy} onClick={() => void submit()} className="tap">
            {busy ? "Deleting…" : "Delete forever"}
          </Btn>
          <Btn disabled={busy} onClick={cancel} className="tap">
            Cancel
          </Btn>
        </div>
      </div>
    </div>
  );
}
