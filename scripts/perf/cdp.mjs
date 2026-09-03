// Minimal zero-dependency CDP client. Node 25 has a global WebSocket.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, headless = true, width = 1440, height = 900 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nuvo-rig-"));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    `--window-size=${width},${height}`,
    "--no-first-run", "--no-default-browser-check",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--hide-scrollbars",
    "about:blank",
  ];
  if (headless) args.unshift("--headless=new");
  const proc = spawn(CHROME, args, { stdio: "ignore", detached: false });

  let targets = null;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = await r.json();
      if (targets.some((t) => t.type === "page")) break;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  if (!targets) throw new Error("Chrome did not expose a debugging endpoint");
  const page = targets.find((t) => t.type === "page");
  const client = await connect(page.webSocketDebuggerUrl);
  client.kill = () => { try { proc.kill("SIGKILL"); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} };
  return client;
}

export function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const listeners = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
      } else {
        (listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    });
    ws.addEventListener("error", reject);
    ws.addEventListener("open", () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        const mid = ++id; pending.set(mid, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
      on: (method, fn) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); },
      close: () => ws.close(),
    }));
  });
}

/** Evaluate an async expression in the page and return its JSON value. */
export async function evaluate(client, expr) {
  const r = await client.send("Runtime.evaluate", {
    expression: `(async () => { ${expr} })()`,
    awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails).slice(0, 300));
  }
  return r.result.value;
}

/** Trusted mouse input — this is what arms libraries that ignore synthetic events. */
export async function mouse(client, type, x, y, extra = {}) {
  await client.send("Input.dispatchMouseEvent", {
    type, x: Math.round(x), y: Math.round(y),
    button: extra.button ?? "left",
    buttons: extra.buttons ?? (type === "mouseReleased" ? 0 : 1),
    clickCount: extra.clickCount ?? (type === "mouseMoved" ? 0 : 1),
    ...extra,
  });
}

export { sleep };
