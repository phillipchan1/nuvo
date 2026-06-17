import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const isTauri = "__TAURI_INTERNALS__" in globalThis;

// Reserve left inset for macOS traffic lights when running in Tauri.
if (isTauri) {
  document.documentElement.classList.add("tauri");
  const mac =
    navigator.userAgent.includes("Mac") ||
    navigator.platform === "MacIntel" ||
    navigator.platform === "MacArm";
  if (mac) document.documentElement.classList.add("tauri-macos");
}

// Register the PWA service worker — web/installed only. Never inside the Tauri
// webview (it ships no SW and owns its own updater), and only in a secure
// context (https / localhost). The virtual module exists only in web builds.
if (!isTauri && "serviceWorker" in navigator && window.isSecureContext) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {
      /* no SW in this build (e.g. Tauri bundle) — ignore */
    });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
