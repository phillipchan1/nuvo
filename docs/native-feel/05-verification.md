# Native feel — verification

*Status: run 2026-11-07 on macOS (Apple Silicon), Node 26, against the dev server.*

## What ran, and what it showed

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run build` | green |
| `npm test` (vitest) | **2635 passed, 1 failed, 11 skipped.** The failure is `guard-public-ci › fails closed when checks.yml is renamed to checks.YML`. It also fails on a clean tree on this machine, because a case-insensitive filesystem can't tell the two names apart (same note as D-178/D-179). Not from this change |
| `tests/native-feel.test.ts` (new, 16) | pass: gesture physics, shortcut labels, menu keys + type-ahead, tooltip placement, the context-menu guard, drag cancel, and **a CSS walker that fails on any `:hover` outside `(hover: hover)`** |
| `tests/perf-budget.test.ts` | pass (no new blur, no per-row layer; the reset adds no `backdrop-filter`) |
| `npm run e2e` (Playwright 1.64.1, new): **23 passed** | see below |
| `npm run perf` | **not measured.** The rig aborted on its own guard ("Only 5 events on the grid… Measuring this would report falsely good numbers"): the dev backend returned 503s, so the account looked unloaded. Chrome isn't installed either (ran with Playwright's Chromium via `CHROME_PATH`). **Run it on a loaded account before relying on the perf claim below** |

### Playwright matrix (`e2e/`, harnesses `?rail`, `?rail=phone`, `?sheets=`; writes stubbed, no account touched)

| Spec | desktop-chromium | desktop-webkit | iphone (WebKit, touch) |
|---|---|---|---|
| multi-select: click, ⌘-click toggle, ⇧-click range | ✓ | ✓ | — |
| keyboard: ⇧↓ extends, ⌘A, Esc clears | ✓ | ✓ | — |
| right-click → app menu, Esc dismisses | ✓ | ✓ | — |
| browser menu suppressed on chrome, kept in fields | ✓ | ✓ | — |
| arrow cursor + no selection on controls | ✓ | ✓ | — |
| double-click a control highlights nothing | ✓ | ✓ | — |
| tooltip waits ~500ms, then shows | ✓ | ✓ | — |
| no tap flash, no rubber-band, no hover | — | — | ✓ |
| swipe: short does nothing, past threshold completes | — | — | ✓ |
| long-press enters selection, tap adds, BulkBar counts | — | — | ✓ |
| sheet ✕ dismisses | — | — | ✓ |
| sheet flick (60px, fast) dismisses by **velocity** | — | — | ✓ |
| sheet slow short drag snaps back | — | — | ✓ |
| harness renders, no horizontal scroll, no page errors | ✓ | ✓ | ✓ |

Touch gestures are dispatched as `PointerEvent`s with `pointerType: "touch"`, because
Playwright's touchscreen only taps. Synthetic pointers have no live pointer behind them, so the
iPhone spec shims `setPointerCapture` to a no-op and routes every event to the node the gesture
started on, which is what capture would do. **Standalone PWA mode can't be emulated** in
Playwright (`display-mode: standalone` isn't settable). That stays on the real-device list.

### Driven in the dev app (auto-login, real account, nothing written)

- **Desktop 1440:** buttons wear the arrow. Right-clicking chrome shows no browser menu. A
  `title` tooltip appears styled after the delay. Right-clicking a project in the week rail opens
  "Project actions" with focus inside: ↓ lands on Open, `t` jumps to "Take off this week", Esc
  closes with nothing run. Found and fixed during this pass: the menu was `visibility:hidden`
  while it measured itself, so focus couldn't land; and the rail's window-level keys took ↓
  first until the menu carried `data-nested-surface`.
- **Phone 375×812 (touch emulation):** Projects → a project opens the detail sheet. The Studio
  domain picker now rises as a bottom action sheet, not an anchored dropdown (dismissed with no
  change). ✕ slides the sheet away. `scrollWidth === innerWidth` (no horizontal overflow).
- Console: only pre-existing noise (FullCalendar's `flushSync` warning from `CalendarPane`, and
  503s from the dev backend).

### Existing shortcuts re-tested

⌘A, ⇧↓, Esc and right-click in the rail are covered by e2e. ⌘Z / ⇧⌘Z, ⌘K, 1–3 and the
letter keys were **not touched** by this change: no handler was edited. The only key-path
changes are additive: `armDragCancel` swallows Esc **only during a deck drag**, and `useMenuFocus`
handles keys **only while focus is inside a menu**. The tooltip layer hides on any keydown and
never consumes it.

## Performance reasoning (not a measurement)

- No new `backdrop-filter`, no new per-row compositing layer. Press feedback is **opacity
  only**, and only while a finger is down.
- The `:has()` in the press rules is scoped to `(hover: none) and (pointer: coarse)` and to
  `:active`, so it only invalidates under a live touch.
- Tooltips: one shared element and one rect read per shown tip. Listeners are capture-phase and
  bail on the first check.
- The swipe's rubber band and armed state use the same state updates as before (one `setSwipeX`
  per move); the haptic fires on threshold crossings only.

## Remaining gaps, and what needs a real device

| Needs a real iPhone (PWA standalone + the Tauri iOS shell) | Why |
|---|---|
| `:active` press feel on rows and buttons | WebKit's touch `:active` timing differs from emulation |
| Edge-swipe back in the detail sheet | In Safari (not standalone) the browser's own edge gesture may win; in standalone and Tauri iOS ours should. Check both |
| Sheet flick-to-dismiss with a real finger | Velocity thresholds tuned on synthetic events |
| Haptics | **No-op on iOS by platform design** (02 §Haptics). Check Android Chrome if it matters |
| Keyboard over sheets (`visualViewport`) and `maximum-scale=1` stopping focus-zoom on iPad | Emulators don't raise a keyboard |
| Safe areas at the home indicator with the new action sheets | Simulator or device |
| Long-press callout gone on rows; still present on links/notes | `-webkit-touch-callout` is iOS-only, invisible to Playwright's WebKit |

Deferred and out-of-scope items: [`04-out-of-scope.md`](./04-out-of-scope.md).
