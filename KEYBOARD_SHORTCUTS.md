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

## Schedule View — Left Rail

### Navigation
| Shortcut | Action | Notes |
|----------|--------|-------|
| 1 | Switch to Inbox tab | |
| 2 | Switch to Week tab | |
| 3 | Switch to Today tab | |
| j | Move down (or Arrow Down) | Vim-style |
| k | Move up (or Arrow Up) | Vim-style |
| Enter | Open selected task | |

### Task Actions (on selected task or multi-selection)
| Shortcut | Action | Notes |
|----------|--------|-------|
| E | Plan for today | Immediate |
| T | Plan for tomorrow | |
| W | Plan for next week | Future planning |
| S | Schedule task (pick time) | Opens date/time picker |
| D | Mark done / Reopen | Toggle |
| X | Move to trash | Destructive |
| # | Open label picker | |
| C | Focus capture input | Focuses the quick-capture field |
| Escape | Clear selection / Close context menu | |

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
