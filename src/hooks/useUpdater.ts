import { useCallback, useEffect, useState } from "react";

// Guard: only import Tauri modules when running inside the Tauri shell.
const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type UpdateState =
  | { status: "idle" }
  | { status: "available"; version: string; body: string | null }
  | { status: "downloading"; progress: number }
  | { status: "ready" }
  | { status: "error"; message: string };

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    async function check() {
      try {
        const { check: checkForUpdate } = await import(
          "@tauri-apps/plugin-updater"
        );
        const update = await checkForUpdate();
        if (cancelled || !update) return;
        setState({
          status: "available",
          version: update.version,
          body: update.body ?? null,
        });
      } catch (err) {
        console.warn("[updater] check failed:", err);
      }
    }

    // Check 3 s after startup, then every hour
    const t = setTimeout(check, 3_000);
    const interval = setInterval(check, 60 * 60 * 1_000);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearInterval(interval);
    };
  }, []);

  const install = useCallback(async () => {
    if (!isTauri() || state.status !== "available") return;
    try {
      const { check: checkForUpdate } = await import(
        "@tauri-apps/plugin-updater"
      );
      const { relaunch } = await import("@tauri-apps/plugin-process");
      const update = await checkForUpdate();
      if (!update) return;

      setState({ status: "downloading", progress: 0 });

      let totalBytes = 0;
      let downloadedBytes = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
          downloadedBytes = 0;
          setState({ status: "downloading", progress: 0 });
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          const pct =
            totalBytes > 0
              ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100))
              : 0;
          setState({ status: "downloading", progress: pct });
        } else if (event.event === "Finished") {
          setState({ status: "ready" });
        }
      });

      await relaunch();
    } catch (err) {
      setState({ status: "error", message: String(err) });
    }
  }, [state.status]);

  const dismiss = useCallback(() => setState({ status: "idle" }), []);

  return { state, install, dismiss };
}
