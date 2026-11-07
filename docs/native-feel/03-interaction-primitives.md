# Native feel — the interaction primitives

*Status: built 2026-11-07. Guarded by `tests/native-feel.test.ts` (unit) and `e2e/`
(Playwright, `npm run e2e`).*

**The thesis.** The brief listed a set of primitives to build. Most of them already existed
here under other names, and building a second copy would break this repo's first rule (one
module per act: CLAUDE.md, D-146, D-162). So this file maps each requested primitive to what
already carries it, and adds only what was missing. **No new runtime dependency:** the repo has
no dnd-kit, framer-motion or radix, and every primitive below is a few dozen lines on pointer
events, WAAPI or CSS. The one new devDependency is `@playwright/test`, which the brief asked for.

| Requested primitive | Lives in | New / existing |
|---|---|---|
| Global CSS reset for web-isms | `src/styles/native.css` (loaded after `index.css` from `main.tsx`) | **new** |
| JS half of the reset | `src/lib/nativeFeel.ts` → `installNativeFeel()` in `main.tsx` | **new** |
| `usePlatformInput()` | `src/hooks/usePlatformInput.ts`: `finePointer`, `coarsePointer`, `canHover`, `anyCoarse`, `mac` (media queries, never UA alone) | **new** |
| Modifier glyphs | `src/lib/shortcutLabel.ts`: `"⇧⌘Z"` → `"Ctrl+Shift+Z"` off-Mac | **new** |
| Selection model (`useSelection`) | `lib/selection.ts` (pure moves) + `tasks/useTaskListKeys.ts` (keys) + `hooks/useCollectionSelection.ts` (tables, marquee) | existing |
| Focused vs. unfocused selection | `html.window-inactive` (nativeFeel) + `native.css` §12 | **new** |
| `ContextMenu` | `RecordContextMenu` + `TaskActionsMenu` over **one action vocabulary each** (`lib/recordActions`, `lib/taskActs`); the phone reaches the same `buildRecordActions` via `MobileRecordActions` | existing |
| Menu keyboard + focus | `src/hooks/useMenuFocus.ts`: focus in, ↑↓/Home/End, type-ahead, focus back | **new** |
| Drag layer | `hooks/useListReorder`, FullCalendar's `Draggable` + `calendar/gestureCancel`, `lib/slots.resolveBlockDrop` (D-170) | existing |
| Esc-cancel for the remaining drags | `src/lib/dragCancel.ts` → `armDragCancel(onCancel)` | **new** |
| `Pressable` | `lib/a11y.pressable()` (role, tabindex, Enter/Space) + `native.css` §3–§4 (cursor, press, tap highlight) | existing + **new CSS** |
| `Sheet` / `Modal` | `mobile/Sheet.tsx` (phone), `ui.tsx Modal` (responsive), `mobile/sheetKit.tsx` | existing, Sheet physics upgraded |
| Desktop dropdown → iOS action sheet | `floors/parts.FloatingMenu` branches on `useIsMobile()` | **new** branch |
| `SwipeableRow` | `TaskRow`'s swipe (the one task row, D-111) | existing, physics upgraded |
| Gesture physics | `src/lib/gesture.ts`: `rubberBand` (UIKit c=0.55), `resistedTravel`, `releaseVelocity` (last 80ms) | **new** |
| Haptics | `src/lib/haptics.ts`: `haptic("selection" \| "light" \| "medium" \| "success" \| "warning")` | **new** |
| Undo toast + stack | `hooks/useUndoStack.tsx` (⌘Z/⇧⌘Z, coalescing, toasts) | existing |
| Tooltips | `src/lib/tooltips.ts` (installed by nativeFeel, pointer-fine only) | **new** |
| Spring motion | `--ease-native` (a `linear()` spring, cubic fallback) + `--d-native` (320ms; ~0 under reduced motion) | **new tokens** |
| Navigation-stack motion | `.nav-push-in` / `.nav-pop-in` + edge-swipe in `MobileDetailSheet` | **new** |

## The rules the reset follows

1. **Input capability, not user agent.** Hover rules sit behind `(hover: hover)`, press rules
   behind `(hover: none) and (pointer: coarse)`, tooltips behind `(hover: hover) and
   (pointer: fine)`. The layout breakpoint (`useIsMobile`) is a separate question and is
   unchanged.
2. **Zero specificity for defaults.** Every element-level default in `native.css` is wrapped in
   `:where()`, so any component that decided its own cursor, selection or transition wins
   without `!important`.
3. **Chrome is not text; content is.** `user-select: none` is an opt-in list of chrome
   (controls, ARIA roles, nav, rows). Content keeps selection by default, and `[data-selectable]`
   opts a region back in inside chrome. Fields and contenteditable are always selectable, which
   WebKit needs said explicitly.
4. **The browser's context menu survives where it's useful.** It stays on fields, links,
   selected text and `[data-selectable]`, and ⇧-right-click always gets it. A component that
   handles `contextmenu` itself is never second-guessed: the guard runs in bubble phase and
   skips anything already `defaultPrevented`.
5. **Opacity-only press feedback.** Transform belongs to the lift/grab language and to drag
   ghosts. A per-row transform would cost a layer per row (perf rule 2).
6. **No fake haptics.** See 02 §Haptics.

## How a surface uses them

```ts
// A new drag:
const disarm = armDragCancel(() => { cancelled = true; up(); });
// …in up(): disarm(); if (cancelled) target = null;

// A new menu (role="menuitem" buttons inside):
useMenuFocus(menuRef, open);          // + data-nested-surface on the container

// A new touch gesture:
const travel = resistedTravel(dx, FIRE_PX, MAX_PX);
if (releaseVelocity(samples) > 0.5) commit();
haptic("selection");                  // when it arms
```
