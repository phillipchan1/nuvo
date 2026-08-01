import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { isTauri as isTauriShell, isMac } from "./lib/platform";

const isTauri = isTauriShell();

// Reserve left inset for macOS traffic lights when running in Tauri.
if (isTauri) {
  document.documentElement.classList.add("tauri");
  if (isMac()) document.documentElement.classList.add("tauri-macos");
}

// Register the PWA service worker — web/installed only. Never inside the Tauri
// webview (it ships no SW and owns its own updater), and only in a secure
// context (https / localhost). The virtual module exists only in web builds.
if (!isTauri && "serviceWorker" in navigator && window.isSecureContext) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        // The SW uses `autoUpdate`, but the browser only looks for a new one on
        // navigation or ~daily — and an installed iOS PWA never checks on resume.
        // That left fresh deploys hidden behind the cached app. Nudge the SW to
        // check on launch, whenever the app regains focus, and hourly while open;
        // autoUpdate then activates the new build (and reloads) on its own.
        onRegisteredSW(_swUrl, registration) {
          if (!registration) return;
          const check = () => void registration.update();
          check();
          setInterval(check, 60 * 60 * 1_000);
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") check();
          });
          window.addEventListener("focus", check);
        },
      });
    })
    .catch(() => {
      /* no SW in this build (e.g. Tauri bundle) — ignore */
    });
}

// Dev verify harnesses — reached at ?emblem / ?planweek / ?daycal / ?meet / ?invite, no auth/shell.
const params = new URLSearchParams(window.location.search);
const showEmblemHarness = import.meta.env.DEV && params.has("emblem");
const showPlanWeekHarness = import.meta.env.DEV && params.has("planweek");
const showDayCalHarness = import.meta.env.DEV && params.has("daycal");
const showMeetHarness = import.meta.env.DEV && params.has("meet");
const showInviteHarness = import.meta.env.DEV && params.has("invite");

if (showInviteHarness) {
  void import("./components/InviteHarness").then(({ default: InviteHarness }) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <InviteHarness />
      </React.StrictMode>,
    );
  });
} else if (showMeetHarness) {
  void import("./components/MeetHarness").then(({ default: MeetHarness }) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <MeetHarness />
      </React.StrictMode>,
    );
  });
} else if (showEmblemHarness) {
  void import("./components/floors/EmblemHarness").then(({ default: EmblemHarness }) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <EmblemHarness />
      </React.StrictMode>,
    );
  });
} else if (showDayCalHarness) {
  void import("./components/mobile/MobileDayHarness").then(({ default: MobileDayHarness }) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <MobileDayHarness />
      </React.StrictMode>,
    );
  });
} else if (showPlanWeekHarness) {
  void import("./components/mobile/PlanWeekHarness").then(({ default: PlanWeekHarness }) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <PlanWeekHarness />
      </React.StrictMode>,
    );
  });
} else {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
