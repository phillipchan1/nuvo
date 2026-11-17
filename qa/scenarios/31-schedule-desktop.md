# 31 · Schedule on the desktop — rail, grid, inspector

Desktop shell only. The Schedule page's bar has the breadcrumb, the view tabs
**Week · Day · Month · Year · Spread** (keys 1–5), and **Previous** / **Today** /
**Next**. On the left, a rail: the week crown on top, then tabs **Today** and
**Inbox** (and a trash icon when anything is trashed), a filter, and a
**Capture** box at the foot.

### QA-SCHED-01 · Every calendar view renders
Shell: desktop · Priority: P0 · Surface: desktop:schedule, calendar-view:week, calendar-view:day, calendar-view:month, calendar-view:year, calendar-view:spread · Writes: no

**Steps**
1. **Schedule**. Click each view tab in turn: **Week**, **Day**, **Month**, **Year**, **Spread**.

**Expect**
- Each renders within 3 seconds with no error.
- **Week** shows today's column with «Write case study: Fernwood» at 9:00am and the Wednesday «Marketing site v2» sitting from 1:00 to 3:00pm.
- **Month** shows today's date marked. **Year** shows twelve months.
- Pressing the digit keys 1–5 switches views the same way (when no text field has focus).

### QA-SCHED-02 · Travel
Shell: desktop · Priority: P1 · Surface: desktop:schedule · Writes: no

**Steps**
1. **Week** view. Click **Next**, then **Next**, then **Today**.

**Expect**
- The breadcrumb's span changes each time; **Today** returns to the current week.

### QA-SCHED-03 · Draw a block on the grid
Shell: desktop · Priority: P0 · Surface: desktop:schedule, draft-card · Writes: yes

**Steps**
1. **Week** view. On tomorrow's column, press and drag on empty time from about 2:00pm to 3:00pm, then release.
2. In the card that appears, with **Task** chosen under "Make a", type "QA drawn block" into "Task title…".
3. Click **Create** (or ⌘↵).

**Expect**
- A one-hour block "QA drawn block" sits tomorrow 2:00–3:00pm. Still there after reload.

### QA-SCHED-04 · Inspector edits
Shell: desktop · Priority: P0 · Surface: task-sheet · Writes: yes

**Steps**
1. Click «Review billing cutover plan» on the grid.
2. In the inspector: set **Priority** to **Low**; under **Steps** ("Break this into steps") add "QA list open questions"; under **Notes** type "QA inspector note".
3. Press Esc. Reload. Click the block again.

**Expect**
- Priority, the step and the note all survived the reload.

### QA-SCHED-05 · Right-click a task row
Shell: desktop · Priority: P1 · Surface: task-menu · Writes: yes

**Steps**
1. Left rail **Today** tab. Right-click «Call the plumber».
2. Choose **Tomorrow**.

**Expect**
- The menu lists, among others: **Open**, **Rename**, **Mark done**, **Today**, **Tomorrow**, **Next week**, **Move to…**, **Duplicate**, **Trash**.
- «Call the plumber» leaves Today and appears on tomorrow.

### QA-SCHED-06 · The rail's lists and capture box
Shell: desktop · Priority: P1 · Surface: desktop:schedule · Writes: yes

**Steps**
1. Left rail: click the **Inbox** tab.
2. In the **Capture** box at the rail's foot, type "QA rail capture" and press Enter.
3. Click the **Today** tab.

**Expect**
- The **Inbox** tab lists the six seeded inbox tasks plus "QA rail capture".
- The tab labels carry counts ("Today 8", "Inbox 7" or similar — counts match what each list shows).

### QA-SCHED-07 · Trash and restore from the rail
Shell: desktop · Priority: P1 · Surface: trash · Writes: yes

**Steps**
1. Left rail **Inbox**: select «Read: Shape Up ch. 3» and press ⌫ (Backspace).
2. Click the trash icon (accessible name "Trash · 2").
3. Click **Restore** on «Read: Shape Up ch. 3».

**Expect**
- 1 removes it from the Inbox with an **Undo** toast.
- Trash lists it and «Old gym membership form».
- After 3 it is back in the Inbox.

### QA-SCHED-08 · Keyboard on a list
Shell: desktop · Priority: P2 · Surface: task-menu · Writes: yes

**Steps**
1. Left rail **Inbox**. Click «Schedule dentist» once to select it.
2. Press **J** (selection moves down), then **K** (back up).
3. Press **E**.

**Expect**
- J/K move the highlight between rows.
- **E** marks «Schedule dentist» done (an **Undo** toast appears).

### QA-SCHED-09 · Filter and save a view
Shell: desktop · Priority: P2 · Surface: desktop:schedule · Writes: yes

**Steps**
1. Left rail **Inbox**. Click the filter icon ("Filter tasks (/)").
2. Under **Priority**, choose High.
3. **Save view**, name it "QA high only".
4. **Clear** the filter.

**Expect**
- With the filter, only «Renew passport» remains.
- "QA high only" appears as a saved view and re-applies the filter when chosen.

### QA-SCHED-10 · Slot popover and its contents
Shell: desktop · Priority: P1 · Surface: slot-sheet · Writes: yes

**Steps**
1. **Week** view. Click the Wednesday «Marketing site v2» sitting.
2. In its **Inside** list, remove «Nav + footer pass» (its "Take “Nav + footer pass” out of the slot" control).

**Expect**
- The popover lists «Case study photos» and «Nav + footer pass».
- After 2, only «Case study photos» is inside; «Nav + footer pass» still exists (on Wednesday, outside the block).

### QA-SCHED-11 · Recurring upkeep
Shell: desktop · Priority: P2 · Surface: recurring-upkeep · Writes: yes

**Steps**
1. Schedule bar → **More calendar tools** → **Recurring upkeep**.
2. Type "QA replace HVAC filter" into "New upkeep task", click **Add**.
3. **Done**.

**Expect**
- The panel lists the new series; reopening the panel still shows it.

### QA-SCHED-12 · Shortcuts sheet
Shell: desktop · Priority: P2 · Surface: settings:shortcuts · Writes: no

**Steps**
1. Click on empty space so nothing is focused, then press **?**.

**Expect**
- A dialog "Keyboard shortcuts" with groups including Schedule, Task lists and Calendar blocks. Esc closes it.
