# Native feel — out of scope, for your decision

*Status: open as of 2026-11-07. Nothing here was built. Each item either changes behaviour
(what an act does, touches or how it is reached), needs a data-model change, or needs native
code. The brief's hard constraint was "functionality stays the same", so these wait for a call.*

| # | Item | Why it isn't a feel fix | What deciding yes would take |
|---|---|---|---|
| 1 | **Right-click menus act on the whole selection** (tasks, records, calendar blocks) | Today the menu acts on the clicked item. Acting on N is a different act with different undo. `TaskMenus` (`t`/`v`) already do bulk, so the precedent exists | Per action: a bulk form + one undo entry; right-click on an unselected row first selects it (Finder) |
| 2 | **Long-press a task → iOS context menu** (lifted preview, blurred background) | Long-press currently **enters multi-select**. Re-assigning it moves selection behind a "Select" item | Decide the gesture order: menu first (iOS) with "Select" inside, or keep hold-to-select |
| 3 | **"Select" button + checkmark circles** (iOS edit mode) | A new entry point to existing bulk acts | Pairs with #2 |
| 4 | **Undo for project/initiative delete** (replace the in-menu confirm) | `deleteProject` / `deleteInitiative` are hard deletes; an undo needs soft delete or a full snapshot re-insert, with children | Soft-delete column + a restore act, or keep the confirm |
| 5 | **Undo for the Collection's armed bulk delete, Trash "Delete forever", event deletes** | Server-side or permanent deletes; there is no inverse | Same as #4; event deletes would need re-creation through Google, with new ids |
| 6 | **Undo for deck drags** (`updateProject` / `updateInitiative` record none) | Adding entries to the undo stack changes what ⌘Z does after a drag | Small: wrap the two writes in `recordUndo` with the old span. Low risk; recommended |
| 7 | **Calendar event menu: `role="menu"`, arrows, type-ahead** | Inside `CalendarPane` (240KB) with its own key layer; risk of breaking D-158's key grammar | Move the menu into a component, then `useMenuFocus` |
| 8 | **⇧-click range on calendar blocks** | ⇧ currently toggles. A range across days needs an ordering rule | Define "between" in time order |
| 9 | **⌘A / arrows in the Collection table** | Collides with the rail's `keyOwner` arbitration | Give the table a keyOwner slot |
| 10 | **Sheet detents** (medium/large) | Changes every sheet's resting height; content is laid out for two sizes | Per-sheet opt-in, starting with the task sheet |
| 11 | **Mail-style multi-action swipe trays** | Adds actions to rows | Choose the actions per side |
| 12 | **Native haptics on iOS** | Needs a Tauri iOS plugin (Swift) around `UIImpactFeedbackGenerator`; the PWA can never have them | Plugin + wire into `lib/haptics.haptic()` (all call sites are ready) |
| 13 | **Tabs/segmented controls activate on mousedown** | Would need each control audited for click-driven keyboard activation and double-fire | Per-control, starting with the floor RungTabs |
| 14 | **Enter to rename** (Things) | Enter opens a task: the app's grammar (D-158), with ⌘E to rename | Keep, unless you want the Things grammar |
| 15 | **Drag autoscroll on the decks** | The decks scroll horizontally under sticky gutters; edge autoscroll must not fight them | Measure on a lived-in deck first |
| 16 | **Multi-item drag with a count badge on the decks** | The decks have no selection to drag (see 01 §Selection) | Follows a selection model there |
