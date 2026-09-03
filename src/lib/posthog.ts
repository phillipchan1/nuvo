/** Production telemetry — crashes, masked replays, no planner contents.
 *
 *  Nuvo is a personal planner. Autocapture of button text would send task
 *  titles; unmasked replay would send the day. So we capture exceptions and
 *  pageviews, mask every input and every text node in recordings, and identify
 *  by account id only. Never email, never calendar/task copy. See D-114.
 */
import posthog from "posthog-js";
import { isSpotlightWindow, isTauri } from "./platform";

export { posthog };

const TOKEN = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN as string | undefined;
const HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || "https://us.i.posthog.com";

let started = false;

/** Element-text leftovers from autocapture. Exception messages stay — those
 *  are code, not the operator's day. */
const STRIP_PROPS = ["$el_text", "$el_content"] as const;

export function sanitizeCaptureProperties(properties: Record<string, unknown>): void {
  for (const key of STRIP_PROPS) delete properties[key];
}

export function isPosthogEnabled(): boolean {
  return started;
}

/** Call once from the App mount path. No-op without a project token, in the
 *  ⌥Space window (a second client on the same origin), or under test. */
export function initPosthog(): void {
  if (started) return;
  if (!TOKEN) return;
  if (typeof window === "undefined") return;
  if (isSpotlightWindow()) return;
  if (import.meta.env.MODE === "test") return;

  // Session replay (rrweb + mask-every-text-node) taxes the WKWebView main thread
  // on every pointermove during FullCalendar drags — exceptions still ship.
  const disableSessionRecording = isTauri();

  posthog.init(TOKEN, {
    api_host: HOST,
    ui_host: HOST.includes("eu.") ? "https://eu.posthog.com" : "https://us.posthog.com",
    defaults: "2026-05-30",
    person_profiles: "identified_only",
    autocapture: false,
    capture_pageview: "history_change",
    capture_pageleave: true,
    capture_exceptions: true,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    disable_surveys: true,
    enable_recording_console_log: false,
    rageclick: false,
    disable_session_recording: disableSessionRecording,
    mask_all_text: true,
    mask_all_element_attributes: true,
    session_recording: disableSessionRecording
      ? undefined
      : {
          maskAllInputs: true,
          maskTextSelector: "*",
          recordHeaders: false,
          recordBody: false,
        },
    before_send: (event) => {
      if (event?.properties) sanitizeCaptureProperties(event.properties);
      return event;
    },
    loaded: (ph) => {
      ph.register({
        environment: import.meta.env.PROD ? "production" : "development",
        shell: isTauri() ? "tauri" : "web",
        app_version: __APP_VERSION__,
      });
    },
  });
  started = true;
}

/** Account id only — never email or name. */
export function identifyUser(userId: string): void {
  if (!started || !userId) return;
  posthog.identify(userId);
}

export function resetUser(): void {
  if (!started) return;
  posthog.reset();
}

export function captureAppException(
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  if (!started) return;
  posthog.captureException(error, extra);
}
