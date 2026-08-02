// Captures Chrome/Android's `beforeinstallprompt` so the app can offer an
// "Install Nuvo" row from Settings → About instead of relying on the browser's
// own (easily missed) install icon. Import for side effect from main.tsx —
// the event fires early, often before React mounts.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/** True when the captured prompt is available (Android/desktop Chrome). */
export function canPromptInstall(): boolean {
  return deferred !== null;
}

/** Show the browser's install dialog; resolves to whether it remains available. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const evt = deferred;
  deferred = null;
  await evt.prompt();
  await evt.userChoice.catch(() => undefined);
  listeners.forEach((l) => l());
  return canPromptInstall();
}

/** Subscribe to availability changes (for the Settings row). */
export function onInstallAvailabilityChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Already running as an installed app? */
export function isStandaloneDisplay(): boolean {
  return (
    (navigator as { standalone?: boolean }).standalone === true ||
    (typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches)
  );
}

/** iOS Safari — no beforeinstallprompt; install is Share → Add to Home Screen. */
export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
