# Native feel — summary and plan

*Status: **batches 1–3 shipped 2026-11-07** (system reset, primitives, the P0/P1 fixes below).
Deferred and out-of-scope items are listed in [`04-out-of-scope.md`](./04-out-of-scope.md) for a
decision. Verification is in [`05-verification.md`](./05-verification.md).*

Siblings: [`01-desktop-audit.md`](./01-desktop-audit.md) ·
[`02-ios-audit.md`](./02-ios-audit.md) ·
[`03-interaction-primitives.md`](./03-interaction-primitives.md) ·
[`../design-language.md`](../design-language.md) (the visual law this keeps) ·
[`../performance.md`](../performance.md) (the budget it must not break).

**The thesis.** Nuvo already *looked* native. Its interaction *model* was mostly there too:
selection rules (`lib/selection`), an undo stack (`useUndoStack`), one record-actions
vocabulary (`lib/recordActions`), and bottom sheets. What made it feel like a website was a
layer underneath: **the browser's own defaults were never switched off.** A pointing hand on
every button. A grey flash on every tap. Copy/Look Up callouts on long-press. The WebKit
"Reload / Inspect Element" menu on every right-click that wasn't a record. Hover states stuck
after a tap. Native tooltips that took a second to appear. So the fix is mostly at the system
level, in one CSS file and one JS installer, rather than in each component.

**The rule we held.** Every fix changes how an existing act is *triggered, fed back or animated*.
None adds or removes an act, or changes what one writes. When the honest fix would have changed
behaviour (a long-press that opens a menu instead of selecting; an undo for a hard delete), it
went to `04-out-of-scope.md` for a decision and was not built.

## Top findings

| # | Finding | Sev | Platform | Status |
|---|---|---|---|---|
| 1 | `button { cursor: pointer }` globally, plus 50 `cursor-pointer` classes: the hand on every control | P0 | desktop | **fixed** |
| 2 | No `-webkit-tap-highlight-color`: iOS greys every tap | P0 | iOS | **fixed** |
| 3 | No `-webkit-touch-callout` / `user-select` on chrome: long-press raises Copy/Look Up, double-click highlights labels | P0 | both | **fixed** |
| 4 | Right-click on anything that isn't a record shows WebKit's Reload / Inspect menu (in the Mac app too) | P0 | desktop | **fixed** |
| 5 | 37 hand-written `:hover` rules outside `(hover: hover)`: they stick after a tap on iPhone/iPad | P0 | iOS | **fixed** |
| 6 | No `:active` press feedback on touch. TaskRow had none at all, and WebKit doesn't fire `:active` without a touchstart listener | P0 | iOS | **fixed** |
| 7 | Anchored `FloatingMenu` dropdowns (domain / initiative / project pickers, record kebab) reachable on the phone, which breaks the sheetKit rule | P0 | iOS | **fixed** |
| 8 | Sheet drag-to-dismiss only by distance (no flick), hard wall going up, and ✕ closes with no animation | P1 | iOS | **fixed** |
| 9 | Row swipe: hard clamp at ±120px, tint only, no armed state, no haptic | P1 | iOS | **fixed** |
| 10 | Detail stack: frames swap with no push/pop motion and no edge-swipe back | P1 | iOS | **fixed** |
| 11 | Record context menu: no arrow keys, no type-ahead, no focus in/out, fixed-height placement guess | P1 | desktop | **fixed** |
| 12 | Native `title` tooltips (~375): 1s OS delay, no warm-up, unstyled | P1 | desktop | **fixed** |
| 13 | Deck drags (projects, initiatives, week board) can't be cancelled with Esc | P1 | desktop | **fixed** |
| 14 | Selection looks identical whether the window is key or not | P2 | desktop | **fixed** |
| 15 | Shortcut hints hard-code ⌘ off-Mac | P2 | desktop | **fixed** (menus + shortcuts sheet) |
| 16 | Focus-zoom on iPad / wide iOS (the 16px input rule is phone-width only) | P1 | iOS | **fixed** (`maximum-scale=1`; pinch still works) |
| 17 | `navigator.vibrate` scattered in 4 files, a no-op on iOS | P2 | iOS | **consolidated** in `lib/haptics` (still a no-op on iOS; see 02 §Haptics) |
| 18 | A right-click menu acts on one item even when several are selected | P1 | desktop | **deferred**: changes what an act touches (04) |
| 19 | Long-press on a task selects rather than opening an iOS context menu | P1 | iOS | **deferred**: re-assigns an existing gesture (04) |
| 20 | Project/initiative delete is a guarded hard delete with no undo | P1 | both | **out of scope**: needs a data-model undo path (04) |

**P0 count at the start: 7. Open P0s now: 0.**

## The plan, as batched

| Batch | What | Commit |
|---|---|---|
| 1 · System reset | `src/styles/native.css` (tap flash, callout, selection, cursors, `:active`, overscroll, autofill, scrollbars, spring token), `lib/nativeFeel.ts` (`:active` enabler, context-menu guard, spellcheck, image drag, window-key class), hover gating in `index.css`, the cursor sweep, viewport | 1 |
| 2 · Primitives | `lib/gesture`, `lib/haptics`, `hooks/usePlatformInput`, `lib/shortcutLabel`, `hooks/useMenuFocus`, `lib/tooltips`, `lib/dragCancel` | 1 |
| 3 · Surfaces | Tasks (row swipe + press), Projects/Initiatives (record menu, deck Esc-cancel, pickers → action sheets, detail stack edge-swipe + motion), Calendar (week board Esc-cancel), Sheet physics | 2 |
| 4 · Verification | `tests/native-feel.test.ts`, Playwright (`e2e/`, `npm run e2e`), docs | 3 |

The user's brief asked for a checkpoint after the audit. The session ran unattended on the
user's instruction ("do it to completion without my intervention"), so the plan above was
executed directly, and anything that needed a product decision was parked rather than built.
