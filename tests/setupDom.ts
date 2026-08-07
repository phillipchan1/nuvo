/**
 * Shared setup for the DOM-level suites.
 *
 * Loaded for every test file, node ones included, so everything here has to be
 * safe without a document. The IndexedDB shim is unconditional because the sync
 * layer reaches for it at import time; the Testing Library wiring is guarded.
 */
import "fake-indexeddb/auto";
import { afterEach } from "vitest";

if (typeof document !== "undefined") {
  const [{ cleanup }] = await Promise.all([
    import("@testing-library/react"),
    import("@testing-library/jest-dom/vitest"),
  ]);
  afterEach(() => cleanup());

  // jsdom ships no crypto.randomUUID in older versions and no structuredClone
  // at all — both are load-bearing for the outbox and for query persistence.
  if (typeof crypto === "undefined" || !crypto.randomUUID) {
    const nodeCrypto = await import("node:crypto");
    Object.defineProperty(globalThis, "crypto", {
      value: nodeCrypto.webcrypto,
      configurable: true,
    });
  }
  globalThis.structuredClone ??= (v: unknown) => JSON.parse(JSON.stringify(v));
}
