# Mobile readiness & desktop parity audit — 2026-08-12

**Status:** complete · fixes landed in this pass
**Scope:** every desktop surface in `AppShellInner` against its `MobileShell` equivalent, plus
the mechanical passes (interaction patterns · tap targets · overflow · IA · virtual keyboard).
**Verified at:** 375×812, iOS UA, touch emulation, via the `?build` dev harness
(`src/components/mobile/BuildFacesHarness.tsx`) — plus `npm run typecheck`, `npm test`
(744 passing), `npm run build`.

> **Headline:** the phone was already close. The mobile shell carries the five destinations,
> the decks at both altitudes, the weekly ritual, the record, search, settings and the chat —
> and the mechanical passes (Phases 3, 4, 7) came back essentially clean, because this
> codebase already has `.tap` / `.tap-icon` / `.tap-bloom`, `pb-safe`/`pt-safe`, `.fab-clear`,
> and a device-level 16px input floor. **The real gaps were whole faces of the Build
> altitudes, and one act — delete — that a phone simply could not perform.**

---

## 1 · Executive summary

### The parity gap table

Only rows with a gap are listed; §5 is the full checklist.

| Feature | Desktop | Mobile (before) | Gap | Status |
|---|---|---|---|---|
| **Project rung · Groom face** | `GroomFloor` — every in-flight project stands up as a column; shape outcome + steps in place | — | **Missing entirely.** The phone could *place* a project on a week but not *say what done meant*. | **Fixed** — `MobileGroom scope="project"` |
| **Initiative rung · Groom face** | `InitiativeGroomFloor` — define the objective, set the key results | — | **Missing entirely.** | **Fixed** — `MobileGroom scope="initiative"` |
| **Project rung · Shipped face** | `ShippedWall rung="project"` — the retrospective wall, grouped by month | — | **Missing entirely.** The one surface whose whole job is to feel good was desk-only. | **Fixed** — `MobileShipped scope="project"` |
| **Initiative rung · Shipped face** | `ShippedWall rung="initiative"` — grouped by quarter | — | **Missing entirely.** | **Fixed** — `MobileShipped scope="initiative"` |
| **Delete a project / initiative** | Right-click any card → `Delete …` with confirm; also the record modal's `DeleteBtn` | — | **Missing entirely.** A project started on the phone could be renamed, shipped, parked and re-homed there but never removed — **the phone could make a mess it could not clean up.** | **Fixed** — long-press + the record's ⋯ |
| **Park / Resume, Ship from a list** | Right-click → `Park (waiting)` / `Ship it…` | Only inside the record, via the Status select | **Demoted** — two extra taps from any list. | **Fixed** — same menu |
| **Attribute a finished project to a domain** | `ShippedWall`'s one action — Nuvo's suggested home, one click | — | Missing with the wall. | **Fixed** — carried into `MobileShipped` |
| **Multi-select + bulk delete / status** | `Collection` — shift/⌘-click, marquee, `SelectionBulkBar` | — | **Missing entirely.** | **Open decision** — see §3 |
| **Summit ritual (decide the quarter)** | `SummitRitual` flow | — | Missing — deliberate (`CLAUDE.md`, D-031's sibling). | **Open decision** — see §3 |
| **Evening shutdown** | `openOverlay("evening")` from ⌘K | — | Missing. | **Open decision** — see §3 |
| **Command palette *actions*** | ⌘K runs 15 commands (go to today, run a ritual, switch calendar view, toggle theme…) | `MobileSearch` finds *items* only | **Degraded** — the phone's search is a jump list, not a command surface. | **Open decision** — see §3 |
| **Calendar week/spread views** | Spread · Day · Week · Month | Month · List · Day | Missing week grid — **deliberate**, D-044 ("a seven-column time grid can't be tapped at 375px"). | Accepted divergence |
| **Collection board / table / timeline** | Three Collection layouts | Flat "All" list | **Deliberate** (`CLAUDE.md`). The All list reaches the same records. | Accepted divergence |

### The interaction patterns that were mistranslated, by impact

1. **Right-click had no touch equivalent at all** (Phase 2's headline row). Every record
   lifecycle act lived behind a mouse button the phone doesn't have. This is what made
   Delete desktop-only — not a decision, just a pattern that never got translated.
   → **Fixed:** long-press on document rows, plus a visible **⋯** in the record's title row.
2. **The two shells were about to disagree about *what* the acts are.** The desktop's action
   list was a private function inside `RecordContextMenu.tsx`. Adding a second menu would
   have meant a second copy — the exact drift `CLAUDE.md` legislates against for planning
   rules. → **Fixed:** the vocabulary moved to `src/lib/recordActions.ts` and **both** shells
   build from it. The extracted function body is byte-identical to the original.
3. **A hidden gesture was about to become the only path.** Long-press is an accelerator, not
   an affordance — nothing announces it. → Every act it reaches is *also* reachable from the
   record's always-visible ⋯, so nothing depends on knowing to hold.

---

## 2 · Fix log

| Component / file | Issue | Fix applied |
|---|---|---|
| `src/lib/recordActions.ts` *(new)* | The record lifecycle vocabulary (Open · Ship/Reopen · Park/Resume · Delete) was private to the desktop right-click menu, so a phone menu would have had to copy it. | Extracted `buildRecordActions()` — pure, takes the snapshot + the writes, returns the acts. One vocabulary, two shells. |
| `src/components/RecordContextMenu.tsx` | Held the only copy of the above. | Now imports it. Body unchanged (verified by diff against `HEAD`); this is the *presentation* of the acts only. |
| `src/components/mobile/MobileRecordActions.tsx` *(new)* | No touch equivalent of right-click. | `useRecordActions()` — a 450ms long-press (matching the deck's pick-up hold) that opens the acts as a bottom `Sheet`, with an in-place confirm for the destructive one. Cancels on >10px travel so scrolling never fires it, and swallows the click that follows a fired hold so the row doesn't also navigate. |
| `src/components/mobile/detail/MobileDetailSheet.tsx` | A record open on the phone had no lifecycle acts and could not be deleted. | Added the visible **⋯** in the title row (the discoverable path). Deleting the open record now falls back to the parent frame, or closes — never leaves you on a "this project is gone" screen. |
| `src/components/mobile/Sheet.tsx` | No trailing-action slot in the title row. | Optional `action` prop, rendered left of ✕, opted out of drag-to-dismiss like the row's other controls. |
| `src/components/mobile/detail/verticalDetail.tsx` | `VerticalList` rows had no hold path. | `hold` prop threaded to `Row` for project + initiative rows. |
| `src/components/mobile/MobileGroom.tsx` *(new)* | The Groom face was desktop-only at both altitudes. | The same act as a vertical stack of cards, thinnest-first, over the **same** read models (`readOnDeck` lanes / `allOpenInitiativeLanes` + `initiativeReadinessAxes`). Each card carries only the fields that close its open checks, and marks which check each one closes. |
| `src/components/mobile/MobileShipped.tsx` *(new)* | The Shipped wall was desktop-only at both altitudes. | Grouped rows over the shared `readShipped` model (projects by month, bets by quarter — the desktop's grain), with the rail's headline figure in the masthead and the wall's one action (attribute an orphaned win, via the same `suggestDomainForText` matcher) carried over. |
| `src/components/mobile/MobileProjects.tsx`, `MobileInitiatives.tsx` | Two faces (On Deck · All) against the desktop's four. | Four segments, in the desktop's order: **On Deck · Groom · All · Shipped**. Measured at 375px: 84.8×44px each, no clipping, no overflow. The persisted segment key migrates forward (an unknown value falls back to On Deck). |
| `src/components/mobile/detail/verticalDetail.tsx` — `TaskComposer` | The composer row wore `.tap`'s 44px, but the actual focus target (the `<input>`) computed to **40.8px** and the padding around it was dead — tapping the row's edge did nothing. | Wrapper `div` → `<label>`, so the whole 44px band (including the ＋) focuses the field. Zero visual change; also fixes the record, which shares this composer. |
| `src/components/mobile/MobileGroom.tsx` — outcome/objective fields | An auto-growing one-line `AreaField` computes to **21px** — half a thumb, on the primary act of the surface. | Wrapped in a `<label className="tap-h">`, giving the caret a 44px band without drawing a box around it. |
| `src/components/mobile/BuildFacesHarness.tsx` *(new)*, `src/main.tsx` | The new faces had no way to be driven without a live account. | `?build` dev harness (the `?domains` / `?daycal` / `?planweek` precedent): both faces at both altitudes, at 375px, over fixtures covering raw / mid-groom / ready / parked and shipped-attributed / shipped-orphaned. DEV-only, tree-shaken from production. |

### What was actually driven, not assumed

In the harness at 375px with touch emulation:

- long-press a Shipped row → the acts sheet opens with `Open · Reopen · Park (waiting) · Delete project`;
- `Delete project` → the confirm step (`Delete "Obi handoff doc"?` · "This can't be undone.");
- confirm → the row leaves the wall;
- type an outcome into a raw Groom card → the Defined check closes;
- **＋ A number to move…** adds a key result on the initiative face;
- zero page errors.

Sweeps over the rendered faces: **0** horizontal overflows, **0** effective tap targets under
44px (measuring the `<label>` band, not the bare field), **0** inputs computing under 16px.

---

## 3 · Open product decisions — these need your call

1. **Multi-select on the phone — build it, or say no once?**
   Desktop `Collection` has shift/⌘-click, marquee selection and a bulk bar (delete, status).
   Mobile has nothing. The standard translation is long-press → selection mode → tap to
   add/remove, but **long-press is now spent** on the record's acts, and the deck already
   spends it on pick-up. A third meaning for one gesture is worse than the gap.
   **Recommendation: decline it, and log the decline.** Bulk editing is a filing-cabinet act,
   and the phone's job in this product is capture, placement and shaping. If you want it, the
   honest cost is an explicit "Select" affordance in the All segment's header, not a gesture.
2. **Summit (decide the quarter) on the phone.** Deliberately desktop-only today. Plan the
   week *is* on the phone (D-031), so the asymmetry is a real question, not an oversight.
   **Recommendation: leave it.** A quarter is decided at a desk once every 13 weeks; the
   phone's Initiatives deck already lets you place and shape bets between Summits.
3. **Evening shutdown.** Desktop-only, reachable from ⌘K. This one *is* a phone-shaped
   ritual (it happens away from the desk, at the end of the day). **Recommendation: worth a
   mobile surface** — a Tasks-tab card in the Today segment, the way Plan the week rides the
   Week segment. Not built here; it needs an anchor pass first.
4. **Commands in mobile search.** ⌘K runs 15 actions; `MobileSearch` only finds items. Adding
   a "Do" section (Plan the week · toggle theme · Settings · replay the tour) is small and
   would close the last IA gap. **Recommendation: yes, next pass** — most of the 15 are
   desktop-only concepts (calendar views, focus mode), so it needs a curated subset, which is
   a product call rather than a port.
5. **One gesture, two meanings — confirm the rule.** As shipped: on **document** surfaces
   (All · Shipped · Groom rows) a hold means *what can I do to this*; on the **deck** a hold
   means *pick it up*. Every record reaches the same acts through the record's ⋯ regardless.
   I believe this is right — the deck is a drag surface and its hold is already taught — but
   it is a divergence from "pick one pattern and apply it consistently," so it should be an
   explicit decision rather than an artifact.

---

## 4 · The mechanical passes

**Phase 2 · interaction translation** — hover-revealed actions: none reach the phone
un-translated (mobile rows show their ✕ always, per the record's existing note; task rows carry
swipe actions via `mobile/swipe.ts`). Right-click: **was** the gap, now translated. Drag: the
decks use long-press touch drag *and* every move has a tap path (the record's week/quarter
picker) — D-030's rule, still held. Keyboard shortcuts: nothing is shortcut-only; every
desktop hotkey maps to a visible control. Multi-pane: the phone uses drill-in + bottom sheets
throughout, never a squeezed sidebar. Tooltips: the new surfaces carry no hover-only text.

**Phase 3 · tap targets & spacing** — the `.tap` (44×44) / `.tap-h` (height-only) /
`.tap-icon` (44px hit area from a 32px glyph, via `::after`) / `.tap-bloom` vocabulary already
existed and is applied. Two real misses found and fixed (above). Spacing sits on the 4px
Tailwind scale throughout the new surfaces.

**Phase 4 · responsive layout & overflow** — measured at 375px: no horizontal overflow in any
new face; the four-segment header fits with room. Safe areas are handled at the shell
(`pt-safe` / `pb-safe`) and inside `Sheet` (the grab pill owns the notch inset so it stays
swipe-able); content clears the FAB pair via `.fab-clear`. Long content truncates
(`truncate` + `min-w-0`) rather than pushing the row.

**Phase 5 · navigation & IA** — the new faces cost **zero** extra taps versus desktop: both
are one tap from the tab you were already on, exactly like the desktop's face switcher. The
one remaining IA gap is commands-in-search (§3.4).

**Phase 6 · performance parity** — not re-measured in this pass, and I'd rather say so than
imply it. The new faces are pure renders over read models the app already computes for the
decks (`readOnDeck`, `readShipped`) with no new queries, so they add no fetch cost; but the
CPU-throttled latency and touch-drag FPS checks the brief asks for want a real account on a
real device, which this environment does not have. Carried forward.

**Phase 7 · virtual keyboard & input** — already solved app-wide and confirmed empirically:
`index.css` forces `font-size: 16px !important` on `input, textarea, select, .field,
[contenteditable]` below 768px (measured: **0** inputs under 16px), `useKeyboardInset` pads
sheets above the keyboard, and the composers use plain text `<input>`s so iOS dictation works.
Numeric fields carry `inputMode="decimal"`.

---

## 5 · Parity checklist

| Surface / act | Desktop | Mobile | Notes |
|---|---|---|---|
| Schedule / calendar | `CalendarPane` (Spread·Day·Week·Month) | `MobileCalendar` (Month·List·Day) | Week grid deliberately absent — D-044 |
| Tasks: Today · Week · Inbox | `LeftRail` | Tasks tab segments | ✓ |
| Capture | ⌘N / composer | ＋ FAB, `parseCapture` | ✓ |
| Task edit (plan · duration · repeat · priority · labels · domain · project · delete) | Task row + context menu | `MobileTaskSheet` | ✓ |
| Nuvo chat | `AgentSidebar` (⌘J) | ✦ launcher, screen-aware | ✓ |
| Search | ⌘K spotlight | `MobileSearch` | Items ✓, **commands ✗** (§3.4) |
| Plan the week | `SundayRitual` | `MobilePlanWeek` | One composer, `useWeekDraft` |
| Summit | `SummitRitual` | — | Deliberate (§3.2) |
| Evening shutdown | overlay | — | **Gap** (§3.3) |
| Projects · On Deck | `OnDeckFloor` | Projects ▸ On Deck | ✓ |
| Projects · **Groom** | `GroomFloor` | **Projects ▸ Groom** | **New this pass** |
| Projects · Table / All | `PortfolioFloor` | Projects ▸ All | Flat list by design |
| Projects · **Shipped** | `ShippedWall` | **Projects ▸ Shipped** | **New this pass** |
| Initiatives · On Deck | `InitiativeOnDeckFloor` | Initiatives ▸ On Deck | ✓ |
| Initiatives · **Groom** | `InitiativeGroomFloor` | **Initiatives ▸ Groom** | **New this pass** |
| Initiatives · Table / All | `InitiativesFloor` | Initiatives ▸ All | Flat list by design |
| Initiatives · **Shipped** | `ShippedWall` | **Initiatives ▸ Shipped** | **New this pass** |
| Domains wall + open domain | `DomainFloor` | `MobileDomains` + `MobileDomainScreen` | One voice, `lib/domainRead.ts` — verified at `?domains` |
| Record: name · outcome · placement · tasks/KRs · comments · status | `RecordModal` | detail `Sheet` | ✓ (D-069) |
| Record: **ship · park · delete** | right-click / `DeleteBtn` | **⋯ + long-press** | **New this pass** |
| Create project / initiative / domain | `CreateRecord`, P / I | deck inline add, ＋ domain | ✓ |
| Attribute a shipped win | `ShippedWall` | **`MobileShipped`** | **New this pass** |
| Bulk select / delete | `Collection` | — | **Open** (§3.1) |
| Settings (all 7 sections) | side-nav modal | drill-in `Sheet` | ✓ |
| Recurring upkeep | panel | `RecurringUpkeepPanel` | ✓ |
| Sync queue / refused writes | Settings ▸ About | same, + floating toast | ✓ (D-095) |
| Onboarding / welcome tour | `Orientation` | `Orientation mobile` | ✓ |
| Keyboard shortcuts reference | `ShortcutsModal` | — | N/A on touch |

---

## 6 · What I did not do

- **Phase 6's throttled latency + touch-FPS measurements** — needs a real account on a real
  device (see above). Everything else in the brief was measured, not assumed.
- **The four open decisions in §3** — each changes what the product *is* on a phone, and
  `CLAUDE.md` says that is an anchor-pass call, not a build-pass one.
- **No desktop behavior was changed.** The one desktop file touched
  (`RecordContextMenu.tsx`) had its action list extracted, not edited; the extracted body
  diffs clean against `HEAD` apart from the signature.
