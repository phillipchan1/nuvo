/**
 * Web Push subscription — the plumbing, kept away from the rules.
 *
 * This file knows how to get a browser to hand over a push endpoint and how to
 * store it. It knows nothing about *what* may be pushed; that is decided by
 * `_shared/reminderRules.ts` and enforced server-side, so no amount of editing
 * here can widen what Nuvo is allowed to say (D-102, D-105).
 *
 * Where this works, and where it doesn't:
 *
 *   installed iOS PWA    yes, iOS 16.4+ — and ONLY when added to the home
 *                        screen. Safari in a tab cannot subscribe, which is why
 *                        the Settings copy says "install first" rather than
 *                        showing an error nobody can act on.
 *   desktop browsers     yes.
 *   Tauri (Mac / iOS)    no service worker by design, so no Web Push. Those
 *                        shells use native notifications while running — see
 *                        `notifyNative` in `lib/notify.ts`.
 */

import { supabase } from "./supabase";
import { detectDeviceTz } from "./timezone";

/** Baked in at build time. Public by definition — it is the key clients encrypt
 *  TO; the private half never leaves the edge function's secrets. Absent in a
 *  build with no VAPID configured, which is a supported state: reminders still
 *  work in the foreground, and Settings says background delivery is unavailable. */
export const VAPID_PUBLIC_KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "";

export function pushConfigured(): boolean {
  return VAPID_PUBLIC_KEY.length > 0;
}

/** Whether this runtime could ever subscribe. False in Tauri (no SW), in an
 *  insecure context, and in browsers without the API. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    window.isSecureContext &&
    !("__TAURI_INTERNALS__" in window)
  );
}

/** VAPID keys travel as base64url; `applicationServerKey` wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function keyToBase64(key: ArrayBuffer | null): string {
  if (!key) return "";
  const bytes = new Uint8Array(key);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** "iPhone · Safari" — cosmetic, for the Settings list of where reminders go. */
function describeDevice(): string {
  const ua = navigator.userAgent;
  const platform =
    /iPhone/.test(ua) ? "iPhone" :
    /iPad/.test(ua) ? "iPad" :
    /Android/.test(ua) ? "Android" :
    /Macintosh/.test(ua) ? "Mac" :
    /Windows/.test(ua) ? "Windows" : "This device";
  const browser =
    /CriOS|Chrome/.test(ua) ? "Chrome" :
    /Firefox/.test(ua) ? "Firefox" :
    /Safari/.test(ua) ? "Safari" : "browser";
  return `${platform} · ${browser}`;
}

export type SubscribeOutcome =
  | { ok: true; endpoint: string }
  | { ok: false; reason: "unsupported" | "unconfigured" | "denied" | "failed"; detail?: string };

/**
 * Subscribe this device and record it.
 *
 * Idempotent: an existing subscription is reused rather than replaced, and the
 * row is upserted on `(user_id, endpoint)` — re-running this on every launch is
 * cheap and is what keeps `time_zone` fresh when someone travels.
 */
export async function subscribeToPush(): Promise<SubscribeOutcome> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  if (!pushConfigured()) return { ok: false, reason: "unconfigured" };
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return { ok: false, reason: "denied" };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const sub =
      existing ??
      (await registration.pushManager.subscribe({
        // Required by every browser, and the honest contract anyway: every push
        // Nuvo sends shows a notification. There is no silent channel here.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }));

    const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
    const p256dh = json.keys?.p256dh ?? keyToBase64(sub.getKey("p256dh"));
    const auth = json.keys?.auth ?? keyToBase64(sub.getKey("auth"));
    if (!p256dh || !auth) return { ok: false, reason: "failed", detail: "no encryption keys" };

    const { data: u } = await supabase.auth.getUser();
    const userId = u.user?.id;
    if (!userId) return { ok: false, reason: "failed", detail: "not signed in" };

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh,
        auth,
        label: describeDevice(),
        time_zone: detectDeviceTz(),
      },
      { onConflict: "user_id,endpoint" },
    );
    if (error) return { ok: false, reason: "failed", detail: error.message };

    return { ok: true, endpoint: sub.endpoint };
  } catch (e) {
    return { ok: false, reason: "failed", detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Stop sending to this device, and forget it.
 *
 * Both halves matter: unsubscribing without deleting the row leaves the
 * dispatcher pushing into an endpoint that will 410 forever, and deleting
 * without unsubscribing leaves the browser holding a subscription nobody uses.
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  } catch {
    /* a device that can't unsubscribe is pruned server-side on its first 410 */
  }
}

/** Is THIS device currently set up to receive background reminders? */
export async function hasPushSubscription(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}
