import { useId, useState } from "react";
import { TextInput } from "../form";
import { Button, SectionHeader } from "../kit";
import {
  ACCOUNT_DELETE_CONFIRM,
  APPLE_DELETE_NOTICE,
  isAccountDeleteConfirm,
  requestAccountDeletion,
  signOutAfterDeletion,
  stripeDeleteCopy,
} from "../../lib/account";
import { workersEnabled } from "../../lib/backend";
import { IAP_ONLY } from "../../lib/billingRail";
import type { PlanSource } from "../../lib/subscription";

/** Two-step wipe. Lives on Settings → Account and on the locked screen —
 *  a locked-out trial still has to be able to leave (App Store 5.1.1v).
 *  Apple / trial copy never mentions Stripe. */
export function DeleteAccount({
  compact = false,
  planSource = null,
}: {
  compact?: boolean;
  planSource?: PlanSource | null;
}) {
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
      <div className={compact ? "mt-3" : ""}>
        {!compact && <SectionHeader title="Leave Nuvo" className="set-group" />}
        <Button kind="ghost" className="tap -ml-2" onClick={() => setOpen(true)} style={{ color: "var(--danger)" }}>
          Delete account
        </Button>
      </div>
    );
  }

  return (
    <div className={compact ? "mt-3" : ""}>
      {!compact && <SectionHeader title="Leave Nuvo" className="set-group" />}
      <div className="set-well !mt-0">
        <div className="set-well-title">Delete this account</div>
        <p className="set-note">
          This permanently deletes your Nuvo account and everything we store — plans, projects, calendar connections,
          and settings. You will not be able to sign back in.
        </p>
        {planSource === "stripe" && (
          <p className="set-note">{stripeDeleteCopy({ workers: workersEnabled, iapOnly: IAP_ONLY })}</p>
        )}
        {planSource === "apple" && <p className="set-note">{APPLE_DELETE_NOTICE}</p>}
        <label htmlFor={inputId} className="set-row-title">
          Type {ACCOUNT_DELETE_CONFIRM} to confirm
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
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        {error && <div className="text-caption text-danger">{error}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <Button kind="danger-solid" size="md" disabled={!ready || busy} onClick={() => void submit()} className="tap">
            {busy ? "Deleting…" : "Delete forever"}
          </Button>
          <Button kind="ghost" size="md" disabled={busy} onClick={cancel} className="tap">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
