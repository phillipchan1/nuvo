import { supabase } from "./supabase";
import { writeWasEntitled } from "./subscription";
import { clearPersistedCache } from "./sync/persist";
import { clearOutbox } from "./sync/outbox";
import { ACCOUNT_DELETE_CONFIRM } from "../../supabase/functions/_shared/accountDeletion.ts";

export { ACCOUNT_DELETE_CONFIRM, isAccountDeleteConfirm } from "../../supabase/functions/_shared/accountDeletion.ts";

export async function requestAccountDeletion(): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
    "delete-account",
    { body: { confirm: ACCOUNT_DELETE_CONFIRM } },
  );
  const message = data?.error ?? error?.message;
  if (error || !data?.ok) {
    throw new Error(message || "Could not delete your account");
  }
}

/** Device-local traces of this account. Sign-out already drops the read
 *  cache; a wipe also drops the outbox so the next person on this phone
 *  cannot see queued titles. */
export async function wipeLocalAccountData(): Promise<void> {
  await clearOutbox();
  await clearPersistedCache();
  writeWasEntitled(false);
}

export async function signOutAfterDeletion(): Promise<void> {
  await wipeLocalAccountData();
  const { error } = await supabase.auth.signOut();
  if (error) await supabase.auth.signOut({ scope: "local" });
}
