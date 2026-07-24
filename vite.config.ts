import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const host = process.env.TAURI_DEV_HOST;

// The same `vite build` feeds both the iOS PWA and the Tauri desktop bundle. A
// service worker must NOT ship inside the Tauri webview (custom protocol, can
// cache-trap the app, and Tauri owns its own updater). The Tauri build sets
// TAURI_BUILD=1 (see tauri.conf.json beforeBuildCommand) so the plugin — and
// therefore sw.js / manifest — is only emitted for the web build.
const isTauriBuild = process.env.TAURI_BUILD === "1";

const pwa = VitePWA({
  // Disabled (not removed) for Tauri builds: no sw.js / manifest is emitted, yet
  // the virtual:pwa-register module still resolves to a no-op so the bundle that
  // imports it in main.tsx still builds.
  disable: isTauriBuild,
  registerType: "autoUpdate",
  // We register the SW ourselves in main.tsx, guarded against the Tauri webview.
  injectRegister: false,
  includeAssets: ["apple-touch-icon.png", "favicon.png"],
  manifest: {
    name: "Nuvo",
    short_name: "Nuvo",
    description: "Your day, on one surface.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#f4f1ea",
    background_color: "#f4f1ea",
    icons: [
      { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
      { src: "/pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  workbox: {
    // SPA: serve index.html for any navigation so a cold standalone launch works
    // offline. Supabase API/realtime live on another origin, so same-origin
    // navigateFallback never intercepts them.
    navigateFallback: "/index.html",
    globPatterns: ["**/*.{js,css,html,woff,woff2,png,svg,ico}"],
    cleanupOutdatedCaches: true,
  },
});

// Pure SPA static bundle — no SSR, no server runtime.
export default defineConfig({
  plugins: [react(), tailwindcss(), pwa],
  clearScreen: false,
  server: {
    // Unique from the Vite default (5173) so other local Vite apps don't collide
    // with Tauri's fixed `devUrl`.
    port: process.env.PORT ? Number(process.env.PORT) : 5717,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5718 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: ["es2021", "chrome100", "safari13"],
    sourcemap: false,
  },
});
