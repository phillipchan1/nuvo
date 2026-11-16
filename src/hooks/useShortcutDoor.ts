import { useEffect, useRef } from "react";
import { isTauri } from "../lib/platform";
import { shortcutFromUrl, type Shortcut } from "../lib/shortcuts";

// The link the app was LAUNCHED by is one act, not one per shell: an iPad that
// crosses the breakpoint (rotation, Split View) mounts the other shell, and a
// second `getCurrent()` would replay the widget tap that started the app.
let launchLinkConsumed = false;

/**
 * Every door that opens the app somewhere other than where you left it — the
 * PWA manifest shortcuts (`?shortcut=…`), the iOS widgets' `nuvo://` links, and
 * whatever App Intents add next. ONE listener and ONE parser (`lib/shortcuts`);
 * the shell that is mounted supplies how to act on it, because an iPad can
 * wear either shell (D-218) and a widget's ＋ must open capture in both.
 *
 * `apply` should be stable (useCallback) — it re-subscribes when it changes.
 */
export function useShortcutDoor(apply: (act: Shortcut) => void): void {
  // Manifest shortcuts (long-press the installed app's icon). Consumed once,
  // then stripped from the URL so a reload doesn't re-open the overlay.
  const shortcutDone = useRef(false);
  useEffect(() => {
    if (shortcutDone.current) return;
    shortcutDone.current = true;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("shortcut")) return;
    const act = shortcutFromUrl(url.href);
    url.searchParams.delete("shortcut");
    window.history.replaceState(history.state, "", url);
    if (act) apply(act);
  }, [apply]);

  // The native shell's deep links — what the lock-screen widgets actually fire
  // (`nuvo://capture`, `nuvo://chat`). Two paths, because a cold launch and a
  // resume deliver the URL differently: `getCurrent()` reads the link the app
  // was *started* by, `onOpenUrl` catches every one after that. Loaded lazily so
  // the PWA/web bundle never pulls the Tauri plugin in.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let done = false;
    const open = (urls: string[] | null) => {
      if (done || !urls?.length) return;
      const act = shortcutFromUrl(urls[urls.length - 1]);
      if (!act) return;
      done = true;
      apply(act);
    };
    void (async () => {
      try {
        const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
        const off = await onOpenUrl((urls) => {
          done = false; // a fresh tap is a fresh act
          open(urls);
        });
        if (cancelled) {
          off();
          return;
        }
        unlisten = off;
        if (launchLinkConsumed) return;
        launchLinkConsumed = true;
        open(await getCurrent());
      } catch {
        /* no deep-link plugin (older shell / web) — the in-app doors still work */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [apply]);
}
