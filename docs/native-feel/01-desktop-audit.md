# Native feel — desktop audit

*Status: audited 2026-11-07 against the code, and driven in the dev app (Chromium) at 1440 and in
the `?rail` harness. Benchmarks: Things 3, Linear, Fantastical, Notion Calendar. Legend:
**fixed** · **deferred** (decision needed, see [04](./04-out-of-scope.md)) · **existing**
(already native, recorded so it isn't "fixed" twice).*

Platform is detected by input capability (`(hover: hover) and (pointer: fine)`), so a
touchscreen laptop gets the mouse half while its mouse is primary and keeps every touch path.

## Cursor

| Location | Current | Native | Sev | Status |
|---|---|---|---|---|
| `index.css` `button { cursor: pointer }` | the hand on every button | arrow | P0 | **fixed**: `cursor: default` |
| 50 × `cursor-pointer` (TaskRow, Collection, WeekBoard, SlotCreate, form `Select`, hidden date inputs over chips, `<summary>`, `<label>`) | hand | arrow | P0 | **fixed**: removed; `native.css` gives every ARIA control the arrow at zero specificity |
| `.lane-cell`, `.evt-plan-ghost`, all-day `.fc-daygrid-day-frame` | hand | arrow | P1 | **fixed** |
| Links (`a[href]`, recognised URLs in notes) | hand | hand | — | **kept** |
| Text fields / contenteditable | text | text | — | **kept**; date/time/file inputs get the arrow |
| Calendar event resize edges | `ew-resize` / grab | same | — | existing |

## Hover

| Location | Current | Native | Sev | Status |
|---|---|---|---|---|
| 37 hand-written `:hover` rules in `index.css` (`.row-hover`, `.deck-card`, `.lift`, `.lane-cell`, `.slot-open`, `.inline-edit`, `.field`, the `.fc` event rules, agent chips…) | applied on any device | only where the pointer hovers | P0 | **fixed**: each wrapped in `@media (hover: hover)` by rule-splitting, so `:focus` halves of the same selector list stay global. `tests/native-feel.test.ts` fails on a new ungated one |
| Tailwind `hover:` utilities (~400) | already `@media (hover: hover)` in Tailwind v4 | — | — | existing |
| Hover fades | 130ms `--d-fast` on rows; Schedule lift instant | instant or ≤150ms | P2 | existing (in budget); context-menu items now highlight instantly |
| Row affordances on hover | `opacity-0 group-hover:opacity-100` + `:focus-within` | same | — | existing |

## Press feedback and text selection

| Location | Current | Native | Sev | Status |
|---|---|---|---|---|
| Buttons, tabs, rows, nav, menus, labels | selectable; double-click a button highlights its label | not selectable | P0 | **fixed**: `user-select: none` on chrome (`:where`, so a component can opt back in); fields, contenteditable and `[data-selectable]` explicitly selectable |
| Content (chat replies, notes, descriptions) | selectable | selectable | — | kept: not in the chrome list |
| Menus open on `contextmenu` | yes | yes | — | existing |
| Tabs / segmented controls activate on click | click | mousedown on macOS | P2 | **deferred**: most are `<button>`s whose click also drives keyboard activation; changing them one by one risks double-fire. Logged in 04 |

## No browser artifacts

| Location | Current | Native | Sev | Status |
|---|---|---|---|---|
| Right-click on chrome, empty rail, empty grid, Spine, WeekBoard cards, slot run headers, Shipped wall, DomainFloor | WebKit menu (Reload, Inspect Element) | nothing, or the app's menu | P0 | **fixed**: `nativeFeel` swallows `contextmenu` unless a component handled it, or the target is a field, link, selected text or `[data-selectable]`. ⇧-right-click always gets the browser menu (dev escape hatch) |
| Images / SVG icons | draggable as ghost files | not draggable | P1 | **fixed**: `-webkit-user-drag: none` + `dragstart` guard |
| Focus ring after a click | `:focus-visible` already used for rings | — | — | existing; `:focus:not(:focus-visible) { outline: none }` added as a backstop |
| Autofill styling (Login) | yellow/blue wash | app surface | P2 | **fixed** |

## Selection model

| Surface | Current | Native | Sev | Status |
|---|---|---|---|---|
| Rail + every `TaskListView` | click / ⌘ / ⇧ / ⌘A / ↑↓ / ⇧↑↓ / Esc / ⌫ with undo | same | — | existing (`useTaskListKeys`, `lib/selection`) |
| Calendar blocks | ⇧ and ⌘ both toggle; no range | ⇧ = range in time order | P2 | **deferred**: a time range across days needs a rule (04) |
| Collection table | click/⌘/⇧/marquee/Esc/⌫; no ⌘A, no arrows | ⌘A + arrows | P1 | **deferred**: `selectAll` exists but binding keys there collides with the rail's keyOwner; logged in 04 |
| Decks, groom walls, WeekBoard | no selection | — | P2 | **deferred**: multi-select there would be a new capability |
| Focused vs. unfocused selection | identical | grey when the window isn't key | P2 | **fixed**: `html.window-inactive` (lib/nativeFeel) greys multi-selected rows |

## Context menus

| Menu | Current | Native | Sev | Status |
|---|---|---|---|---|
| `RecordContextMenu` (projects, initiatives: decks, groom walls, Collection, WeekPanel) | Esc only; no focus; fixed 280px placement guess | ↑↓, Home/End, type-ahead, focus in and back, flips by measured size | P1 | **fixed** (`useMenuFocus`, `role="menu"`, `data-nested-surface` so the rail stands down) |
| `TaskActionsMenu` | ↑↓ / Enter / printed letters / ⌫; hints | + type-ahead | P2 | existing; letters are shortcuts there, so no type-ahead (it would fight them). Hints now platform-spelled |
| `FloatingMenu` (pickers) | anchored, no keys | ↑↓ + type-ahead on desktop | P1 | **fixed** on desktop (`useMenuFocus`); a sheet on phones |
| Calendar event/slot menus (`CalendarPane`) | no `role="menu"`, no arrows | as above | P1 | **deferred**: lives inside the 240KB CalendarPane with its own key layer; risk of breaking the D-158 key grammar. 04 |
| Acting on the selection | one item | the whole selection | P1 | **deferred**: changes what an act touches. 04 |
| Submenus with a safe triangle | "Move to…" swaps the menu body | real submenu | P2 | **deferred** |

## Drag and drop

| Implementation | Threshold | Esc | Autoscroll | Count badge | Status |
|---|---|---|---|---|---|
| `useListReorder` (rail, TaskListView) | 6px | yes | yes | n/a | existing |
| FullCalendar rail → grid, in-grid | 6px | yes (`gestureCancel`) | yes | "N tasks" | existing |
| `OnDeckPlanner`, `InitiativeDeck`, `WeekBoard` | 5px | **no** | no | no | **fixed: Esc / ⌘Tab / pointercancel cancel with nothing written** (`lib/dragCancel`). Autoscroll is **deferred** (the decks are horizontal scrollers with sticky gutters; measure first) |

## Keyboard, undo, confirm

| Item | Current | Status |
|---|---|---|
| ⌘Z / ⇧⌘Z | `useUndoStack`, 30 deep, coalescing | existing |
| ⌫ on tasks | trash with an undo toast | existing |
| Enter-to-rename | ⌘E (Enter opens) | **kept**: Enter-opens is the app's grammar (D-158). Logged in 04 |
| Modifier glyphs | ⌘ hard-coded | **fixed** in menus and the shortcuts sheet (`lib/shortcutLabel`); remaining inline hints still say ⌘. The app is Mac-first, so P2 |
| "Are you sure" | no `window.confirm` anywhere; inline confirms only where no undo exists (hard deletes, server event deletes) | **out of scope**: each needs an undo path in the data model (04) |

## Tooltips, popovers, chrome

| Item | Current | Status |
|---|---|---|
| ~375 `title=` | OS tooltip, ~1s, unstyled | **fixed**: `lib/tooltips` lifts `title` on hover, shows a styled tip after 500ms, then instantly for 400ms (warm-up). The accessible name is preserved (`aria-label` while hovered when the title was the only name) |
| Popover dismissal | outside-click + Esc everywhere | existing |
| Focus return | Modal/Sheet only (`useDialogFocus`) | **fixed** for record + picker menus; other popovers deferred |
| Scrollbars | thin, trackless WebKit thumb | existing; Firefox gets `scrollbar-width: thin` |
| Overscroll | page could rubber-band in a browser | **fixed**: `overscroll-behavior: none` on `html`/`body` |
| Title-bar drag regions (Tauri) | `data-tauri-drag-region` already wired | existing |
| Spellcheck | on in every field | **fixed**: off for one-line inputs (unless set), on for textareas/contenteditable |
