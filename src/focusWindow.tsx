// Entry for the desktop's floating focus pill window (focus.html, D-242).
//
// Deliberately NOT main.tsx: that imports App, and App boots the auth client,
// the sync engine and analytics. This window is a mirror of the main window's
// focus (lib/focusPill) — it draws a snapshot and sends taps back.
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./styles/instrument.css";
import "./styles/kit.css";
import "./styles/rail.css";
import "./styles/native.css";
import { installNativeFeel } from "./lib/nativeFeel";
import FocusPillWindow from "./components/focus/FocusPillWindow";

installNativeFeel();
document.documentElement.classList.add("focus-window");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FocusPillWindow />
  </React.StrictMode>,
);
