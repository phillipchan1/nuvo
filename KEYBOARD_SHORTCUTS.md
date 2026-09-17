# Nuvo Keyboard Shortcuts — Complete Audit

## System-Wide (Global)

| Shortcut | Action | File | Notes |
|----------|--------|------|-------|
| Cmd+1–5 | Jump to rung (Now, Day, Project, Initiative, Domain) | AppShell.tsx | Ladder navigation |
| Cmd+↑/↓ | Navigate the ladder (zoom in/out) | AppShell.tsx | Vertical/horizontal |
| Cmd+[ | Go back (macOS convention) | AppShell.tsx | Also works in browser |
| Cmd+J | Toggle agent sidebar | AppShell.tsx | Works from any floor |
| Cmd+K | Open command bar (task capture) | Planner.tsx | Global task entry |
| Cmd+, | Open settings | Planner.tsx | Configuration |

## Task lists — the rail, a record, a slot, the groom wall (D-146)

One grammar, defined in `src/components/tasks/useTaskListKeys.ts`; the Shortcuts panel
(`?`) lists the same keys.

| Shortcut | Action |
|----------|--------|
| j / k (↓ / ↑) | Move the cursor |
| Enter | Open the task |
| e | Complete / reopen |
| t | When… (type a day or a time) |
| v | Move to… (project, initiative, domain, out of a slot) |
| 1–4 | Priority high … none (1–3 switch rail tabs when no row is selected) |
| x | Select — then any key acts on all |
| ⌫ | Trash (with undo) |
| ⌘E | Rename in place |
| ⌥↑ / ⌥↓ | Reorder |
| a / ⇧A | Add below / above the cursor |
| Esc | Clear the selection, then the cursor |

The rail adds: n (next week) · i (back to inbox) · r (date and time) · # (label) ·
b (remind) · u (restore, Trash tab) · / (filter) · c (the capture box, same as a).

In any add box: ↵ add and stay · ⌘↵ add and leave · Esc clear, then leave ·
↑↓ ↵ ⇥ pick a # / @ suggestion.

A task's steps (the checklist — every row is a field, so the same grammar in the
keys a field can spare): ↑↓ walk the steps and the add box · ↵ next step ·
⌘↵ tick · ⌥↑↓ move · ⌫ on an empty step removes it · Esc abandon the edit.

## Modal Composers (New Project / New Initiative)

### Field Navigation
| Shortcut | Action | Notes |
|----------|--------|-------|
| Enter | Move to next field | Title → Outcome → Create |
| Escape | Close modal without saving | |

**Files:** `NewProject.tsx` (lines 178–195), `NewInitiative.tsx` (lines 113–127)

**Current limitation:** No keyboard shortcut to *open* these modals on the Portfolio/Initiatives floors.

## Collection Views (Projects / Initiatives)

| Feature | Keyboard | Status | Notes |
|---------|----------|--------|-------|
| New project | N | ✅ ADDED | Opens NewProject modal on PortfolioFloor |
| New initiative | N | ✅ ADDED | Opens NewInitiative modal on InitiativesFloor |
| Delete selected | None | ⏳ TODO | Right-click context menu only |
| View toggle | None | ⏳ TODO | Button-only (Table/Board/Calendar/Timeline) |
| Keyboard focus in table | Arrow keys | ⏳ TODO | Not wired up |

## Calendar Pane

| Shortcut | Action |
|----------|--------|
| Arrow Left | Previous month/week |
| Arrow Right | Next month/week |
| T | Jump to today |

---

## Assessment & Recommendations

### ✅ Strengths

1. **Consistent modifier pattern:** Cmd (macOS) / Ctrl (Windows) for system-level actions
2. **Vim bindings:** j/k for navigation in left rail (familiar to power users)
3. **Mnemonics:** E (today), T (tomorrow), W (week), D (done), X (delete), S (schedule) are intuitive
4. **Task-centric:** Heavily optimized for the day/week planner (hot path)

### ⚠️ Gaps & Inconsistencies

1. **No "new" shortcut for projects/initiatives**
   - Command bar (`Cmd+K`) is for tasks only
   - Projects/Initiatives require clicking the "+ new" button
   - Inconsistent with task capture (`C` in LeftRail)

2. **Collection views keyboard-blind**
   - Can't navigate table rows with arrow keys
   - Can't toggle views via keyboard
   - Can't delete items via keyboard

3. **No global "escape" hierarchy**
   - Each modal handles Escape independently
   - Works, but no unified escape-stack navigation

4. **Scattered documentation**
   - Hints in UI (LeftRail footer, Keycap components)
   - No central reference or help screen

---

## Proposed Keyboard Shortcut Additions

### 1. New Project/Initiative (Priority: High)
On the **Portfolio** and **Initiatives** floors:
- **N** → Open "New Project" modal (or "N" + "P")
- **N** + **I** → Open "New Initiative" modal

*Rationale:* Mirrors the CommonCtrl pattern (N for New); avoids collision with existing bindings.

**Alternative:** Use Cmd+Shift+P and Cmd+Shift+I (command palettes often use this).

### 2. Collection Keyboard Navigation (Priority: Medium)
In table/board/calendar/timeline:
- **Arrow keys:** Navigate rows/cards
- **J/K:** Navigate (consistent with LeftRail)
- **Enter:** Open selected record
- **Delete:** Move to trash (already works in LeftRail)

### 3. Global New/Capture Patterns (Priority: Medium)
Unify "new" across contexts:
- **Cmd+K** → Command bar (already exists, works for tasks)
- **Cmd+Shift+K** → New project (context-aware)
- **Or:** Separate palette for structural items (projects, initiatives, domains)

### 4. Help/Cheat Sheet (Priority: Low)
- **?** → Show keyboard shortcut help overlay
- Visible in every view

---

## Implementation Checklist

- [x] Add **N** to open NewProject on PortfolioFloor
- [x] Add **N** to open NewInitiative on InitiativesFloor
- [x] Add visual hint for new shortcuts in floor headers
- [ ] Update Collection component to handle keyboard nav in all views
- [ ] Document shortcuts in a help modal (triggered by **?**)
- [ ] Test macOS (Cmd) and Windows (Ctrl) modifier behavior

---

## Questions for User

1. **Preference for project/initiative shortcuts?**
   - Single key: `N` (conflicts with potential "next"?)
   - Chord: `N+P`, `N+I` (more discoverable but more typing)
   - Cmd+Shift+P, Cmd+Shift+I (system-like, but more fingers)

2. **Should collection tables be fully keyboard-navigable?**
   - This is a nice-to-have for power users
   - May add complexity to the selection/marquee system

3. **Where to surface the shortcuts?**
   - Help modal (**?**)
   - Footer hints (like LeftRail shows)
   - Both?
