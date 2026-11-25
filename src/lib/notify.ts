/**
 * Saying a reminder out loud — the OS notification, on every shell (D-258).
 *
 * A browser has `window.Notification`. The Mac and iOS apps run in WKWebView,
 * which has none, so until D-258 a reminder in the native apps could only ever
 * be an in-app toast — invisible unless you happened to be looking at Nuvo.
 * `tauri-plugin-notification` (registered in src-tauri/src/lib.rs) installs a
 * `window.Notification` of its own that posts a real OS notification, so the
 * one code path below serves all three runtimes.
 *
 * What the native one can't do, and why it's fine:
 *   • no `onclick` — the plugin hands back no handle. Clicking it on the Mac
 *     brings Nuvo forward (macOS's default); on iOS it opens the app. Landing on
 *     the named item is a browser-only nicety.
 *   • its `permission` arrives asynchronously (the init script asks the plugin
 *     after load), so `nativePermission()` asks directly instead of trusting
 *     the first synchronous read.
 *
 * This file knows how to speak, not what may be said: that is
 * `_shared/reminderRules.ts`, and nothing here can widen it.
 */

import { isTauri } from "./platform";

export type NotifyPermission = "unsupported" | "default" | "granted" | "denied";

/** The synchronous read — right in a browser, possibly stale for a moment in
 *  the native shells (see `nativePermission`). */
export function notifyPermission(): NotifyPermission {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission as NotifyPermission;
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function tauriInvoke(): Invoke | null {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;
  return internals?.invoke ?? null;
}

/**
 * The native shells' real answer, asked of the plugin. Null outside Tauri (the
 * synchronous read is authoritative there) or if the plugin isn't present —
 * an older build — in which case reminders stay in-app, as they always were.
 */
export async function nativePermission(): Promise<NotifyPermission | null> {
  if (!isTauri()) return null;
  const invoke = tauriInvoke();
  if (!invoke) return null;
  try {
    const granted = await invoke<boolean | null>("plugin:notification|is_permission_granted");
    return granted === null ? "default" : granted ? "granted" : "denied";
  } catch {
    return null;
  }
}

/** Ask the OS. Only ever called at the moment of consent (D-105). */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  const result = (await Notification.requestPermission()) as string;
  // The plugin speaks Tauri's vocabulary ("prompt") where a browser says "default".
  if (result === "prompt" || result === "prompt-with-rationale") return "default";
  return result as NotifyPermission;
}

export interface SystemNotice {
  title: string;
  body?: string;
  /** One notification per reminder; a browser replaces a same-tag one. */
  tag: string;
  onClick?: () => void;
}

/**
 * Post an OS notification. False when this runtime can't (no API, or no
 * permission) — the caller then says it in the app instead.
 */
export function showSystemNotification(notice: SystemNotice): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    if (isTauri()) {
      // The plugin's constructor forwards its options to Rust. Hand it only the
      // fields it understands; it returns nothing to attach a click to.
      new Notification(notice.title, { body: notice.body });
      return true;
    }
    const n = new Notification(notice.title, { body: notice.body, tag: notice.tag, silent: false });
    n.onclick = () => {
      window.focus();
      notice.onClick?.();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}
