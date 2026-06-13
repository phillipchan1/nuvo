import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applySavedFont } from "./components/FontPlayground";
import "./index.css";

// Apply the auditioned typeface before first paint to avoid a font flash.
applySavedFont();

// Reserve left inset for macOS traffic lights when running in Tauri.
if ("__TAURI_INTERNALS__" in globalThis) {
  document.documentElement.classList.add("tauri");
  const mac =
    navigator.userAgent.includes("Mac") ||
    navigator.platform === "MacIntel" ||
    navigator.platform === "MacArm";
  if (mac) document.documentElement.classList.add("tauri-macos");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
