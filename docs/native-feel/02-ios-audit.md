# Native feel — iOS audit

*Status: audited 2026-11-07 against the code; driven at 375×812 with touch emulation in the dev
app and in Playwright's iPhone 13 (WebKit) profile. Benchmarks: Reminders, Things, Mail.
Legend as in [01](./01-desktop-audit.md). **Not verified on a real device:** see
[05](./05-verification.md) §Real device.*

## Web-isms

| Item | Current | Native | Sev | Status |
|---|---|---|---|---|
| Tap highlight | never set: grey flash on every tap | none | P0 | **fixed** (`html { -webkit-tap-highlight-color: transparent }`) |
| Callout on long-press | Copy / Look Up / Share on any UI | none on UI | P0 | **fixed** on chrome; content and fields keep it |
| Text selection on long-press | only TaskRow / reorder were `select-none` | none on UI | P0 | **fixed** |
| Tap delay / double-tap zoom | `touch-action: manipulation` on login only | everywhere | P1 | **fixed** on `html` (intersects with each element's own `touch-action`, so `none`/`pan-y` surfaces keep theirs) |
| Sticky hover | 37 ungated `:hover` rules | none | P0 | **fixed** (see 01 §Hover) |
| Input zoom | 16px rule only at ≤767px | never zoom | P1 | **fixed**: `maximum-scale=1` in the viewport (iOS ignores it for pinch since iOS 10, so accessibility zoom still works) |
| Whole-UI rubber-band | page could bounce under fixed chrome | only scrollers bounce | P1 | **fixed** (`overscroll-behavior: none` on `html`/`body`; `.mobile-scroll` keeps `contain`) |

## Press feedback and targets

| Item | Current | Status |
|---|---|---|
| `:active` | ad-hoc `active:bg-*` on ~60 elements; **none on TaskRow**; WebKit doesn't fire `:active` on touch without a touchstart listener | **fixed**: a passive touchstart listener (lib/nativeFeel) plus `native.css` §4. Controls dim to 0.55 instantly and ease back 180ms. Rows grey (`--ink` 7%) so their text stays legible. A press on a child button doesn't also dim the row (`:has`) |
| 44pt targets | `.tap`, `.tap-icon`, `.tap-bloom` | existing |
| Action-sheet rows | n/a | 48px min |

## Rows: swipe and long-press

| Item | Current | Native | Sev | Status |
|---|---|---|---|---|
| Leading swipe | complete | complete | — | existing |
| Trailing swipe | defer to tomorrow (+ undo toast) | — | — | existing |
| Travel past threshold | hard clamp at ±120px | rubber band | P1 | **fixed** (`resistedTravel`: 1:1 to 60px, then UIKit's rubber-band curve) |
| Threshold feedback | none | fill goes solid, label pops, haptic tick | P1 | **fixed**: armed state = solid `--ok`/`--accent` with `--on-accent` text, a 1.08 spring on the label, and `haptic("selection")` once on crossing |
| Settle | 180ms ease-out | spring | P2 | **fixed** (`--ease-native`) |
| Multiple actions per side, swipe-to-reveal tray | one per side | Mail-style trays | P2 | **deferred**: adds actions to a surface (04) |
| Calendar agenda rows | no swipe | — | P2 | **deferred**: would fight the TimePager (same reason the crown has none) |
| Long-press → lifted preview + menu | long-press = enter selection | iOS context menu | P1 | **deferred**: re-assigns an existing gesture (04) |

## Multi-select

| Item | Current | Status |
|---|---|---|
| Enter by long-press, tap to add, bottom `BulkBar` with sheets, "Select all N" | existing on Tasks | existing |
| A visible "Select" button and checkmark circles | none | **deferred**: a new entry point (04) |
| Project detail lists | no selection | **deferred** |

## Sheets

| Item | Current | Native | Sev | Status |
|---|---|---|---|---|
| Drag to dismiss | distance only (30%) | distance **or** a flick | P1 | **fixed**: release velocity > 0.5px/ms over the last 80ms dismisses (`releaseVelocity`) |
| Dragging up | hard stop | rubber band | P2 | **fixed** (`rubberBand`) |
| Snap back | 220ms ease-out | spring | P2 | **fixed** (`--ease-native`) |
| Dismiss curve | `ease-in` | accelerate away | P2 | **fixed** (`cubic-bezier(.4,0,1,1)`) |
| ✕ | `onClose` immediately: vanished in one frame | slides away like a swipe | P1 | **fixed** (✕ runs the same `dismiss`) |
| Grabber, dim, safe area, keyboard inset | present | — | existing |
| Detents (medium/large) | two fixed sizes | detents | P2 | **deferred**: changes every sheet's resting height, and content is designed for the current two. 04 |
| Anchored `FloatingMenu` on the phone | DomainPicker, InitiativePicker, ProjectAttachPicker, record kebab | action sheet | P0 | **fixed**: `FloatingMenu` renders a `Sheet` with 48px hairline rows under `useIsMobile()`. Same children, same acts |
| Native `<select>` (reminders, duration) | iOS wheel | iOS wheel | — | existing (native) |

## Navigation

| Item | Current | Status |
|---|---|---|
| Detail stack push/pop | frames swapped by `key`, no motion | **fixed**: push slides in from the right, pop from the left, on the spring (`.nav-push-in` / `.nav-pop-in`); reduced motion disables both |
| Edge swipe back | none | **fixed**: from the left 24px of a pushed frame the frame follows the finger; past ⅓ width or a flick it pops through `history.back()`, exactly like ‹ |
| Large title collapse | crumbs → name cross-fade at 52px | existing |
| Tab bar | five equal tabs | existing |

## Scroll, keyboard, pickers

| Item | Current | Status |
|---|---|---|
| Momentum | `-webkit-overflow-scrolling` + native | existing |
| Pull to refresh | one, on `<main>`, meaningful (refetch) | existing |
| Keyboard | `useKeyboardInset` (visualViewport) pads sheets; `interactive-widget=resizes-content` | existing; real-device check in 05 |
| Date/time pickers | native `<input type=date/time>` behind styled chips: the iOS wheels | existing (native) |
| Scrollbars on touch | hidden in `.mobile-scroll` only | **fixed** everywhere under a coarse pointer |

## Haptics

Native would tap the finger when a hold arms, a swipe crosses its threshold, a task completes, a
reorder snaps, and on delete. The app now calls `haptic(kind)` (`lib/haptics.ts`) at each of
those points. `TaskRow`'s hold and swipe, `MobileRecordActions`' hold, `MobileDeck`'s pick-up and
drop, and `useLongPressReorder` replaced their scattered `navigator.vibrate` calls with it.

**The limitation, stated plainly:** iOS Safari and WKWebView do not implement the Vibration API,
so on an iPhone every one of these calls is a silent no-op. They fire on Android. Nothing is
faked: no sound, no flash. A native bridge (a Tauri iOS plugin around
`UIImpactFeedbackGenerator`) would plug into `haptic()` and light up every call site at once.
That is native work, so it is listed in [04](./04-out-of-scope.md).
