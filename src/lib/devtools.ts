import { useEffect, useState } from "react";
import { toast } from "sonner";
import { isDesktopTauri } from "./platform";

const KEY = "nuvo.developerMode";
const CHANGE = "nuvo-developer-mode";

export function isDeveloperMode(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setDeveloperMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* private browsing / blocked storage */
  }
  window.dispatchEvent(new Event(CHANGE));
}

/** Desktop-only: open the webview inspector. */
export async function openDevTools(): Promise<void> {
  if (!isDesktopTauri()) {
    toast.error("DevTools only exist in the Mac app.");
    return;
  }
  if (!isDeveloperMode()) {
    toast.error("Turn on Developer mode first.");
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_devtools");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[nuvo] open_devtools failed:", e);
    toast.error(msg || "Couldn't open DevTools");
  }
}

export function useDeveloperMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(isDeveloperMode);
  useEffect(() => {
    const sync = () => setOn(isDeveloperMode());
    window.addEventListener(CHANGE, sync);
    return () => window.removeEventListener(CHANGE, sync);
  }, []);
  return [
    on,
    (next) => {
      setDeveloperMode(next);
      setOn(next);
    },
  ];
}

/** ⌘⌥I opens DevTools when developer mode is enabled (desktop only). */
export function useDeveloperModeShortcut() {
  const [on] = useDeveloperMode();
  useEffect(() => {
    if (!on || !isDesktopTauri()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.altKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        void openDevTools();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);
}
