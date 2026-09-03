#!/usr/bin/env node
/**
 * Whole-app interaction budget. `npm run perf`
 *
 * Drives a REAL, VISIBLE Chrome over CDP and measures every interaction in
 * interactions.mjs against budgets.json. Fails the run when a budget is
 * exceeded, printing what moved.
 *
 * Why a real browser: the numbers only mean something in a visible page. A
 * hidden/background tab clamps setTimeout to 1000ms and never fires
 * requestAnimationFrame, so frame pacing reads as perfect and timing reads as
 * noise. Several hours were lost to that before this rig existed.
 *
 * Why CDP input: events from Input.dispatch* are TRUSTED, so the Event Timing
 * API reports real INP and libraries that ignore synthetic events (FullCalendar's
 * dragger, notably) actually respond.
 *
 * Usage:
 *   npm run dev            # in another shell — the rig needs the app running
 *   npm run perf
 *   npm run perf -- --update      # rewrite budgets.json from this run
 *   npm run perf -- --url=http://localhost:5717
 *   npm run perf -- --headful     # watch it drive
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, evaluate, sleep } from "./cdp.mjs";
import { INSTALL, INSTALL_ON_LOAD } from "./probe.mjs";
import { INTERACTIONS } from "./interactions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const UPDATE = argv.includes("--update");
const HEADFUL = argv.includes("--headful");
const URL = arg("url", "http://localhost:5717");
const REPEATS = Number(arg("repeats", "3"));

const BUDGET_PATH = resolve(HERE, "budgets.json");
const cfg = JSON.parse(readFileSync(BUDGET_PATH, "utf8"));

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const c = await launch({ headless: !HEADFUL });
let failed = 0;
try {
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  // Install the probe on EVERY document, before any app code runs. The dev
  // server reloads the page on any HMR update, which would otherwise wipe every
  // global mid-run and fail the sweep with a confusing "not a function".
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTALL_ON_LOAD });
  await c.send("Page.navigate", { url: URL });

  // Wait for the grid to STABILISE, not merely to be non-empty. Queries stream in,
  // and a half-loaded week is cheap to render — gating on `fc > 0` measures a
  // 4-event grid and reports falsely good numbers, which is worse than no check.
  let events = 0;
  let stable = 0;
  let last = -1;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const s = await evaluate(c, `
      const skip=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Skip'); if(skip) skip.click();
      return { fc: document.querySelectorAll('.fc-event').length };`);
    if (s.fc > 0 && s.fc === last) stable++; else stable = 0;
    last = s.fc;
    if (stable >= 4) { events = s.fc; break; }
  }
  if (events && events < 10) {
    console.error(`\n  Only ${events} events on the grid after waiting — the account looks unloaded.`);
    console.error("  Measuring this would report falsely good numbers. Aborting.\n");
    process.exit(2);
  }
  if (!events) {
    console.error(`\n  Could not reach a loaded Schedule at ${URL}.`);
    console.error("  Is `npm run dev` running, and does .env.local have VITE_DEV_EMAIL / VITE_DEV_PASSWORD?\n");
    process.exit(2);
  }

  await evaluate(c, INSTALL);
  await evaluate(c, `window.__btn('Week')?.click(); return 1;`);
  await sleep(2500);
  // warm every floor so first-mount chunk loads are not charged to an interaction
  for (const k of ["2", "3", "4", "1"]) { await evaluate(c, `window.__key('${k}',true); return 1;`); await sleep(2200); }

  const blurLayers = await evaluate(c, `return window.__blurLayers ? window.__blurLayers() : -1;`);
  const baseline = cfg._baselineEventCount ?? events;
  const drift = Math.abs(events - baseline) / Math.max(baseline, 1);
  console.log(`\n  ${URL} · ${events} events on the week grid · ${blurLayers} live blur layers`);
  if (drift > 0.4) {
    console.log(`  NOTE: the account holds ${events} events vs a ${baseline}-event baseline.`);
    console.log("        Budgets scale with data volume — re-baseline (--update) rather than chase this.");
  }
  console.log();

  // The app can reload underneath us (Vite HMR, a config edit, a crash recovery),
  // which wipes every global the probe installed. Re-arm rather than die.
  const ensureProbe = async () => {
    const alive = await evaluate(c, `return typeof window.__report === 'function';`);
    if (alive) return;
    let st = 0, prev = -1;
    for (let i = 0; i < 40; i++) {
      const s = await evaluate(c, `
        const skip=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Skip'); if(skip) skip.click();
        return { fc: document.querySelectorAll('.fc-event').length };`);
      if (s.fc > 0 && s.fc === prev) st++; else st = 0;
      prev = s.fc;
      if (st >= 3) break;
      await sleep(1000);
    }
    await evaluate(c, INSTALL);
    await evaluate(c, `window.__btn('Week')?.click(); return 1;`);
    await sleep(2000);
  };

  const measure = async (act, i) => {
    await ensureProbe();
    await evaluate(c, `window.__key('Escape'); return 1;`);
    await sleep(450);
    await evaluate(c, `window.__reset(); window.__frameOn(); return 1;`);
    await evaluate(c, act(i));
    await sleep(1400);
    return evaluate(c, `window.__frameOff(); return window.__report();`);
  };

  const rows = [];
  for (const { key, label, act } of INTERACTIONS) {
    const runs = [];
    for (let i = 0; i < REPEATS; i++) runs.push(await measure(act, i));
    const got = {
      forcedLayout: median(runs.map((r) => r.forcedLayout)),
      blockedMs: median(runs.map((r) => r.blockedMs)),
      dropped: median(runs.map((r) => r.dropped)),
      worstFrameMs: median(runs.map((r) => r.worstFrameMs)),
    };
    const budget = cfg.budgets[key];
    const breaches = budget
      ? Object.keys(budget).filter((m) => got[m] > budget[m])
      : [];
    if (breaches.length) failed++;
    rows.push({ key, label, got, budget, breaches });
  }

  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  console.log(`  ${pad("interaction", 26)}${num("layout", 9)}${num("blocked", 9)}${num("drop", 6)}${num("worst", 7)}   budget`);
  console.log("  " + "-".repeat(78));
  for (const r of rows) {
    const mark = r.breaches.length ? "FAIL" : "ok";
    const b = r.budget ? `${r.budget.forcedLayout}/${r.budget.blockedMs}ms/${r.budget.dropped}` : "(none)";
    console.log(
      `  ${pad(r.label, 26)}${num(r.got.forcedLayout, 9)}${num(r.got.blockedMs + "ms", 9)}${num(r.got.dropped, 6)}${num(r.got.worstFrameMs + "ms", 7)}   ${pad(b, 18)} ${mark}`,
    );
    for (const m of r.breaches) {
      console.log(`      ${m}: ${r.got[m]} > ${r.budget[m]}`);
    }
  }

  if (blurLayers > cfg.global.maxBlurLayers) {
    failed++;
    console.log(`\n  FAIL  ${blurLayers} live backdrop-filter layers > budget ${cfg.global.maxBlurLayers}.`);
    console.log("        Each is a compositing layer re-blurred whenever anything beneath it moves.");
  }

  if (UPDATE) {
    for (const r of rows) {
      cfg.budgets[r.key] = {
        forcedLayout: Math.max(50, Math.ceil((r.got.forcedLayout * 1.35) / 50) * 50),
        blockedMs: Math.max(40, Math.ceil((r.got.blockedMs * 1.5) / 10) * 10),
        dropped: r.got.dropped + 1,
      };
    }
    cfg._baselineEventCount = events;
    cfg.global.maxBlurLayers = Math.max(cfg.global.maxBlurLayers, blurLayers + 4);
    writeFileSync(BUDGET_PATH, JSON.stringify(cfg, null, 2) + "\n");
    console.log(`\n  Rewrote ${BUDGET_PATH} from this run. Explain the change in the commit.`);
    failed = 0;
  }

  console.log(failed ? `\n  ${failed} budget(s) exceeded.\n` : "\n  All interactions within budget.\n");
} finally {
  c.kill();
}
process.exit(failed ? 1 : 0);
