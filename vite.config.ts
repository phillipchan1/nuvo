import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const host = process.env.TAURI_DEV_HOST;

// The running app version, baked in for display (Settings → Desktop app). CI
// rewrites package.json's version to <major>.<minor>.<run> right before the
// build, so production shows the real shipped version; dev shows the base.
const appVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version as string;

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
    id: "/",
    name: "Nuvo",
    short_name: "Nuvo",
    description: "Your day, on one surface.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone"],
    // Kept deliberately: installed Android honours it and the phone shell is a
    // portrait design; every other surface ignores it. The landscape-phone fix
    // is useIsMobile's pointer/orientation query, NOT this — see D-075 in
    // docs/product/decisions.md.
    orientation: "portrait",
    theme_color: "#f4f1ea",
    background_color: "#f4f1ea",
    icons: [
      { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
      { src: "/pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Capture a task",
        short_name: "Capture",
        url: "/?shortcut=capture",
        icons: [{ src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Ask Nuvo",
        short_name: "Ask Nuvo",
        url: "/?shortcut=chat",
        icons: [{ src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Today",
        short_name: "Today",
        url: "/?shortcut=today",
        icons: [{ src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  },
  workbox: {
    // SPA: serve index.html for any navigation so a cold standalone launch works
    // offline. Supabase API/realtime live on another origin, so same-origin
    // navigateFallback never intercepts them.
    navigateFallback: "/index.html",
    globPatterns: ["**/*.{js,css,html,woff,woff2,png,svg,ico}"],
    // Startup images are fetched once by iOS at install time — precaching all
    // twenty into every visitor's SW cache is pure weight.
    globIgnores: ["splash/**"],
    cleanupOutdatedCaches: true,
  },
});

// Pure SPA static bundle — no SSR, no server runtime.
export default defineConfig({
  plugins: [react(), tailwindcss(), pwa],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
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
    rollupOptions: {
      output: {
        // The two vendor slabs that would otherwise sit inside the entry chunk.
        // Splitting them keeps every initial file well under the workbox 2 MiB
        // precache ceiling and lets them cache independently of app code —
        // react/supabase change on dependency bumps, the entry on every deploy.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "vendor-react";
          if (id.includes("node_modules/@supabase/")) return "vendor-supabase";
          return undefined;
        },
      },
    },
  },
});
