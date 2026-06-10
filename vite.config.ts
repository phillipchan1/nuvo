import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Pure SPA static bundle — no SSR, no server runtime (Tauri-ready).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
