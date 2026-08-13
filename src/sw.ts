/// <reference lib="webworker" />
/**
 * Nuvo's service worker.
 *
 * ── Why this file exists at all ─────────────────────────────────────────────
 *
 * The PWA plugin used to run in `generateSW` mode, where workbox writes the
 * whole worker and there is nowhere to put custom code. That was fine until
 * reminders needed to reach a CLOSED app: a `push` handler can only live in the
 * worker, so the build moved to `injectManifest` and this became the worker.
 *
 * The precaching behaviour is deliberately unchanged — `precacheAndRoute` +
 * `cleanupOutdatedCaches` + the SPA navigation fallback are exactly what
 * `generateSW` was emitting, restated by hand. If this file drifts from that,
 * offline launches break, and they are load-bearing (an installed iOS PWA opened
 * on a plane).
 *
 * `skipWaiting` + `clientsClaim` keep `registerType: "autoUpdate"` behaving as
 * before: a new build activates on its own rather than waiting for every tab to
 * close, which is what makes the hourly update check in `main.tsx` actually
 * deliver.
 *
 * Never runs inside Tauri — `main.tsx` guards registration, and the plugin is
 * disabled at build time for the desktop bundle (`TAURI_BUILD=1`).
 */

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { clientsClaim } from "workbox-core";

declare const self: ServiceWorkerGlobalScope;

// Injected at build time by vite-plugin-pwa. Must be referenced exactly once.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA: any navigation serves index.html, so a cold standalone launch works
// offline. Supabase lives on another origin, so same-origin navigation fallback
// never intercepts it.
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

self.skipWaiting();
clientsClaim();

// ── Reminders ───────────────────────────────────────────────────────────────
// What may be said is decided long before it gets here — the server sends a
// title, a one-line body and where to land, all produced by
// `_shared/reminderRules.ts`. This worker does no deciding of its own, which is
// deliberate: a nudge must not be able to enter through a code path nobody
// reviews (D-102, D-105).

interface ReminderPayload {
  title: string;
  body: string;
  /** The claim key — also the notification tag, so one anchor can never stack. */
  key: string;
  /** Where a tap should land. */
  url?: string;
}

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: ReminderPayload | null = null;
  try {
    payload = event.data.json() as ReminderPayload;
  } catch {
    payload = null;
  }
  if (!payload?.title) return;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // One notification per anchor. Without a tag, a retried send would stack a
      // second copy of the same meeting. (`renotify` is deliberately omitted —
      // it isn't in the DOM lib's NotificationOptions, and re-alerting for a tag
      // we already showed is the wrong behaviour anyway.)
      tag: payload.key,
      // `--signal` on the paper. Only used where a platform draws it.
      badge: "/pwa-192x192.png",
      icon: "/pwa-192x192.png",
      data: { url: payload.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? "/";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Focus a window that is already open rather than opening a second one —
      // an installed PWA has exactly one, and launching a duplicate is how you
      // lose whatever the user had on screen.
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          // The shell listens for this and applies it through the same
          // navigation the in-app reminder click uses.
          client.postMessage({ type: "nuvo:reminder-open", url: target });
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
