import { useSyncExternalStore } from "react";
import {
  subscribe,
  getSnapshot,
  checkForUpdate,
  restartForUpdate,
  type UpdateState,
} from "../lib/appUpdate";

// Thin binding over the shared desktop-update store (src/lib/appUpdate.ts). Both
// the bottom-right UpdateToast and the Settings → Desktop app panel use this, so
// they always agree on state. Subscribing kicks off the background poll once.
//   • state   — the current update state (idle/checking/downloading/ready/…)
//   • check   — manual "Check for updates" (surfaces checking / up-to-date)
//   • restart — relaunch into a staged update (no-op until one is `ready`)
export function useUpdater(): {
  state: UpdateState;
  check: () => void;
  restart: () => void;
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    state,
    check: () => void checkForUpdate(true),
    restart: () => void restartForUpdate(),
  };
}
