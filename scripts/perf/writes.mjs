/**
 * Calendar WRITE interactions — the gestures that change data, driven with
 * trusted CDP input so FullCalendar's dragger and the rail's Draggable arm the
 * way they do under a real hand.
 *
 * Each one measures from the COMMIT — the release of a drag, the press of a
 * checkbox, ↵ in the composer — not the gesture leading up to it. The moves
 * before a release are the drag's own cost; what this file holds the line on
 * is what a write costs once it is made: the cache patch, the renders it
 * fans out to, the grid reconcile, the outbox drain and the Realtime echo.
 *
 * Every write is undone OUTSIDE the measured window (drag back, uncheck, ⌘Z),
 * so a run leaves the account as it found it and every trial measures the same
 * act in the same direction. Run against the local dummy account
 * (scripts/local/seed-dummy.sh) — never production data.
 *
 * The geometry is read before the window opens: the probe counts every
 * getBoundingClientRect, and the rig's own reads must not be charged to the app.
 */
import { evaluate, mouse, sleep } from "./cdp.mjs";

/** In-page helpers, (re)installed by each setup — a reload wipes them. */
const GEO = `
const R = (window.__rig ||= {});
R.scroller = () => document.querySelector('.fc-timegrid-body')?.closest('.fc-scroller');
R.slotPx = () => {
  const lanes = [...document.querySelectorAll('td.fc-timegrid-slot-lane')];
  return lanes.length > 1 ? lanes[1].getBoundingClientRect().top - lanes[0].getBoundingClientRect().top : 0;
};
R.view = () => { const s = R.scroller(); return s ? s.getBoundingClientRect() : null; };
// Everything already standing in a day column, as vertical extents — or only
// the slots: a task dropped over a meeting just overlaps it, but one dropped
// into a slot JOINS it, which is a different write.
R.taken = (date, slotsOnly) => [...document.querySelectorAll('td.fc-timegrid-col[data-date="' + date + '"] .fc-timegrid-event-harness')]
  .filter((h) => !slotsOnly || h.querySelector('.evt-slot'))
  .map((h) => h.getBoundingClientRect()).filter((r) => r.height > 0);
// The first open stretch of \`slots\` quarter-hours in a column, inside the
// visible part of the grid, clear of every block by a slot's margin.
R.free = (date, slots, avoidY) => {
  const col = document.querySelector('td.fc-timegrid-col[data-date="' + date + '"]');
  const v = R.view(); const px = R.slotPx();
  if (!col || !v || !px) return null;
  const c = col.getBoundingClientRect();
  const taken = R.taken(date);
  const lanes = [...document.querySelectorAll('td.fc-timegrid-slot-lane')].map((l) => l.getBoundingClientRect().top);
  for (const top of lanes) {
    const bottom = top + slots * px;
    if (top < v.top + px || bottom > v.bottom - px) continue;
    if (avoidY != null && top <= avoidY + px && bottom >= avoidY - px) continue;
    if (taken.some((r) => r.top < bottom + px && r.bottom > top - px)) continue;
    return { x: c.left + c.width / 2, y: top + px / 2, top, bottom, px };
  }
  return null;
};
R.dates = () => [...document.querySelectorAll('td.fc-timegrid-col[data-date]')].map((c) => c.dataset.date);
R.block = (id) => document.querySelector('.fc-timegrid-event[data-task-id="' + id + '"]');
`;

const geo = (c, body) => evaluate(c, GEO + body);

/** Press → move in steps → (window opens) → release. */
async function dragTo(c, from, to, mark, { steps = 10, hold = 60 } = {}) {
  await mouse(c, "mouseMoved", from.x, from.y, { buttons: 0 });
  await sleep(40);
  await mouse(c, "mousePressed", from.x, from.y);
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    await mouse(c, "mouseMoved", from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await sleep(16);
  }
  await sleep(hold); // let the last move's hit-test and mirror land
  if (mark) await mark();
  await mouse(c, "mouseReleased", to.x, to.y);
}

async function click(c, at, mark) {
  await mouse(c, "mouseMoved", at.x, at.y, { buttons: 0 });
  await sleep(60);
  if (mark) await mark();
  await mouse(c, "mousePressed", at.x, at.y);
  await mouse(c, "mouseReleased", at.x, at.y);
}

async function key(c, k, { meta = false } = {}) {
  const base = {
    key: k,
    code: k === "Enter" ? "Enter" : k === "Escape" ? "Escape" : `Key${k.toUpperCase()}`,
    windowsVirtualKeyCode: k === "Enter" ? 13 : k === "Escape" ? 27 : k.toUpperCase().charCodeAt(0),
    modifiers: meta ? 4 : 0,
  };
  await c.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(k === "Enter" ? { text: "\r" } : {}) });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

/** ⌘Z through the app's own undo stack — the same path a hand would take. */
const undo = (c) => evaluate(c, `window.__key('z', true); return 1;`);

// The rig picks its subjects once per run and keeps them, so every trial moves
// the same block the same distance.
const state = {};

/**
 * A timed task block, on the visible grid, with an open hour below it. Chosen
 * once; re-found by id every trial (the element is FullCalendar's to replace).
 */
async function rigBlock(c) {
  const found = await geo(c, `
    const want = ${JSON.stringify(state.blockId ?? null)};
    const px = R.slotPx(); const v = R.view();
    if (!px || !v) return null;
    const pick = (el) => {
      const r = el.getBoundingClientRect();
      const date = el.closest('td.fc-timegrid-col')?.dataset.date;
      return { id: el.dataset.taskId, date, x: r.left + r.width / 2, top: r.top, bottom: r.bottom, h: r.height, px };
    };
    if (want) { const el = R.block(want); return el ? pick(el) : { why: 'the rig block left the grid' }; }
    const why = [];
    for (const el of document.querySelectorAll('.fc-timegrid-event.evt-task[data-task-id]')) {
      if (el.classList.contains('evt-done') || el.classList.contains('evt-allday')) continue;
      const b = pick(el);
      const at = b.date + '@' + Math.round(b.top) + '+' + Math.round(b.h);
      if (b.h < 3 * px) { why.push(at + ' short'); continue; }
      if (b.top < v.top + px || b.bottom + 5 * px > v.bottom) { why.push(at + ' off-view'); continue; }
      const below = R.taken(b.date, true).filter((r) => r.top < b.bottom + 5 * px && r.bottom > b.bottom);
      if (below.length) { why.push(at + ' crowded'); continue; }
      return b;
    }
    return { why: why.join(', ') || 'no open timed task blocks' };`);
  if (!found?.id) {
    throw new Error(`no timed task block with an open hour below it is on the visible grid (${found?.why ?? "no grid"})`);
  }
  if (!state.blockId) state.blockId = found.id;
  return found;
}

const checkbox = (c, id) =>
  geo(c, `
    const r = R.block(${JSON.stringify(id)})?.querySelector('[data-done-toggle]')?.getBoundingClientRect();
    return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;`);

/**
 * Uncheck the rig block if it's done, and make sure it took. One blind click
 * was not enough: a missed uncheck left the block done, the next trial's
 * "complete" then UNchecked it, and the median mixed the two acts.
 */
async function reopen(c) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const done = await evaluate(c, `return !!document.querySelector('.fc-timegrid-event.evt-done[data-task-id="${state.blockId}"]');`);
    if (!done) return;
    const at = await checkbox(c, state.blockId);
    if (at) await click(c, at);
    await sleep(800);
  }
  throw new Error("couldn't uncheck the rig block again");
}

export const WRITE_INTERACTIONS = [
  {
    key: "write:drag",
    label: "drag a block +1h",
    settleMs: 2000,
    run: async (c, _i, { mark }) => {
      const b = await rigBlock(c);
      state.before = b;
      // Grab the title, clear of the checkbox (left) and the resize edges.
      const from = { x: b.x + 6, y: b.top + Math.min(b.h / 2, 2 * b.px) };
      await dragTo(c, from, { x: from.x, y: from.y + 4 * b.px }, mark);
    },
    verify: async (c) => {
      const b = await rigBlock(c);
      const moved = b.top - state.before.top;
      return Math.abs(moved - 4 * b.px) < b.px / 2 ? null : `the block moved ${Math.round(moved)}px, not ${Math.round(4 * b.px)}`;
    },
    cleanup: async (c) => {
      const b = await rigBlock(c);
      const from = { x: b.x + 6, y: b.top + Math.min(b.h / 2, 2 * b.px) };
      await dragTo(c, from, { x: from.x, y: from.y - 4 * b.px });
    },
  },
  {
    key: "write:resize",
    label: "resize a block +30m",
    settleMs: 2000,
    run: async (c, _i, { mark }) => {
      const b = await rigBlock(c);
      // The end handle only exists under a hovering pointer.
      await mouse(c, "mouseMoved", b.x, b.top + b.h / 2, { buttons: 0 });
      await sleep(120);
      const h = await geo(c, `
        const r = R.block(${JSON.stringify(b.id)})?.querySelector('.fc-event-resizer-end')?.getBoundingClientRect();
        return r && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;`);
      if (!h) throw new Error("the rig block shows no end resizer");
      state.before = b;
      await dragTo(c, h, { x: h.x, y: h.y + 2 * b.px }, mark, { steps: 6 });
    },
    verify: async (c) => {
      const b = await rigBlock(c);
      const grew = b.h - state.before.h;
      return Math.abs(grew - 2 * b.px) < b.px / 2 ? null : `the block grew ${Math.round(grew)}px, not ${Math.round(2 * b.px)}`;
    },
    cleanup: async (c) => {
      const b = await rigBlock(c);
      await mouse(c, "mouseMoved", b.x, b.top + b.h / 2, { buttons: 0 });
      await sleep(120);
      const h = await geo(c, `
        const r = R.block(${JSON.stringify(b.id)})?.querySelector('.fc-event-resizer-end')?.getBoundingClientRect();
        return r && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;`);
      if (h) await dragTo(c, h, { x: h.x, y: h.y - 2 * b.px }, null, { steps: 6 });
    },
  },
  {
    key: "write:complete",
    label: "complete a block",
    settleMs: 2000,
    run: async (c, _i, { mark }) => {
      const b = await rigBlock(c);
      await reopen(c);
      const at = await checkbox(c, b.id);
      if (!at) throw new Error("the rig block has no checkbox");
      await click(c, at, mark);
    },
    verify: async (c) =>
      (await evaluate(c, `return !!document.querySelector('.fc-timegrid-event.evt-done[data-task-id="${state.blockId}"]');`))
        ? null
        : "the block isn't checked off",
    // Uncheck it again: the next trial (and the next interaction) needs it open.
    cleanup: (c) => reopen(c),
  },
  {
    key: "write:create",
    label: "draw-create a task ↵",
    settleMs: 2000,
    run: async (c, i, { mark }) => {
      // A different open hour than the rig block's, so the trials never collide.
      const spot = await geo(c, `
        const dates = R.dates();
        for (const d of [...dates].reverse()) { const f = R.free(d, 4); if (f) return { ...f, date: d }; }
        return null;`);
      if (!spot) throw new Error("no open hour on the visible grid to draw in");
      await dragTo(c, { x: spot.x, y: spot.y }, { x: spot.x, y: spot.y + 3 * spot.px }, null, { steps: 6 });
      await sleep(700); // the composer arrives and takes the caret
      await c.send("Input.insertText", { text: `perf rig ${i + 1}` });
      await sleep(150);
      await mark();
      await key(c, "Enter");
    },
    verify: async (c, i) => {
      const title = JSON.stringify(`perf rig ${i + 1}`);
      const found = await evaluate(
        c,
        `return [...document.querySelectorAll('.fc-timegrid-event [data-evt-title]')].some((t) => t.textContent.trim() === ${title});`,
      );
      return found ? null : "no new block with the typed title on the grid";
    },
    cleanup: async (c) => {
      await sleep(200);
      await undo(c);
    },
  },
  {
    key: "write:rail-drop",
    label: "drop a rail task on the grid",
    settleMs: 2000,
    run: async (c, _i, { mark }) => {
      await evaluate(c, `document.querySelector('[data-inbox-tab]')?.click(); return 1;`);
      await sleep(500);
      const plan = await geo(c, `
        const row = [...document.querySelectorAll('[data-task-drag]')].find((el) => {
          const r = el.getBoundingClientRect();
          return r.height > 10 && r.top > 0 && r.bottom < innerHeight;
        });
        if (!row) return null;
        const r = row.getBoundingClientRect();
        for (const d of R.dates()) { const f = R.free(d, 4); if (f) return { id: row.dataset.taskDrag, from: { x: r.left + Math.min(60, r.width / 2), y: r.top + r.height / 2 }, to: { x: f.x, y: f.y + f.px } }; }
        return null;`);
      if (!plan) throw new Error("no inbox row, or no open hour to drop it on");
      state.dropped = plan.id;
      await dragTo(c, plan.from, plan.to, mark, { steps: 14, hold: 120 });
    },
    verify: async (c) =>
      (await evaluate(c, `return !!document.querySelector('.fc-timegrid-event[data-task-id="${state.dropped}"]');`))
        ? null
        : "the inbox row didn't become a block on the grid",
    // The drop is a silent-undo `block`: ⌘Z puts it back in the inbox.
    cleanup: async (c) => {
      await sleep(200);
      await undo(c);
    },
  },
  {
    key: "cal:settle",
    label: "settle after week travel",
    settleMs: 2500,
    // Travel lands (cal:travel measures that frame); this is everything that
    // trails it — the new span's queries resolving, neighbours warming, the
    // grid reconciling what arrived. Always one week forward from this week, so
    // each trial lands on the same (warmed) span.
    run: async (c, _i, { mark }) => {
      await evaluate(c, `window.__titled('Next')?.click(); return 1;`);
      await sleep(250);
      await mark();
    },
    cleanup: async (c) => {
      await evaluate(c, `window.__titled('Go to today')?.click(); return 1;`);
    },
  },
];
