/**
 * The interactions the budget covers. Adding a surface? Add it here — an
 * interaction nobody measures is one nobody notices getting slower.
 *
 * `act(i)` returns an expression evaluated in the page. Alternate on `i` so a
 * repeated trial genuinely changes state: clicking "Inbox" when already on
 * Inbox measures nothing and quietly reports a perfect score.
 *
 * The writes (drag, resize, complete, create, rail drop) live in writes.mjs —
 * they drive trusted mouse input from the rig and undo themselves.
 */
import { evaluate, sleep } from "./cdp.mjs";
import { WRITE_INTERACTIONS } from "./writes.mjs";

/** Go to rung `from` unmeasured, then measure ⌘`to`. */
const nav = (from, to) => async (c, _i, { mark }) => {
  await evaluate(c, `window.__key('${from}',true); return 1;`);
  await sleep(1500);
  await mark();
  await evaluate(c, `window.__key('${to}',true); return 1;`);
};

export const INTERACTIONS = [
  // Each trial starts from the OTHER place, outside the window: a bare ⌘2
  // repeated is ⌘2 on Projects, which measures nothing — the median of five such
  // trials was a perfect 0 for every rung.
  { key: "nav:projects",    label: "⌘2  → Projects",    run: nav("1", "2") },
  { key: "nav:initiatives", label: "⌘3  → Initiatives", run: nav("1", "3") },
  { key: "nav:domains",     label: "⌘4  → Domains",     run: nav("1", "4") },
  { key: "nav:schedule",    label: "⌘1  → Schedule",    run: nav("2", "1") },

  { key: "cal:day",   label: "lens Week ↔ Day",   act: (i) => i % 2 ? `window.__lens('Week')?.click(); return 1;` : `window.__lens('Day')?.click(); return 1;` },
  { key: "cal:month", label: "lens Week ↔ Month", act: (i) => i % 2 ? `window.__lens('Week')?.click(); return 1;` : `window.__lens('Month')?.click(); return 1;` },
  { key: "cal:year",  label: "lens Week ↔ Year",  act: (i) => i % 2 ? `window.__lens('Week')?.click(); return 1;` : `window.__lens('Year')?.click(); return 1;` },

  { key: "cal:travel", label: "week travel (next/prev)", act: (i) => i % 2 ? `window.__titled('Previous')?.click(); return 1;` : `window.__titled('Next')?.click(); return 1;` },
  { key: "cal:today",  label: "Today",                   act: () => `window.__titled('Go to today')?.click(); return 1;` },

  { key: "rail:tabs", label: "rail Today ↔ Inbox", act: (i) => i % 2 ? `document.querySelector('[data-today-tab]')?.click(); return 1;` : `document.querySelector('[data-inbox-tab]')?.click(); return 1;` },

  { key: "popover:open", label: "open event popover",
    act: (i) => `const evs=[...document.querySelectorAll('.fc-event')].filter(x=>x.offsetHeight>10&&x.isConnected);`
              + `const e=evs[${i}%evs.length]||evs[0]; e.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 1;` },

  // Both undo themselves outside the window. An odd number of bare ⌘. trials
  // left focus mode ON, and every interaction after it — the writes included —
  // measured a collapsed rail and a wider grid.
  { key: "focus:toggle", label: "focus mode ⌘.",  act: () => `window.__key('.',true); return 1;`,
    cleanup: (c) => evaluate(c, `window.__key('.',true); return 1;`) },
  { key: "settings:open", label: "open Settings", act: () => `window.__btn('Settings')?.click(); return 1;`,
    cleanup: (c) => evaluate(c, `window.__key('Escape'); return 1;`) },

  ...WRITE_INTERACTIONS,
];
