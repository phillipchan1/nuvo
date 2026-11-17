# 30 · Calendar on the phone — one chrome, five lenses

Phone shell only. The Calendar tab has a **horizon ladder** (accessible name
"Time horizon"): an Agenda glyph, then **D**, **W**, **M**, **Y**. Travel is
**Previous ⟨unit⟩** / **Next ⟨unit⟩** plus a **Today** button that never moves or
disappears. The big title at the top (the "hero") names the span on screen.

### QA-CAL-01 · Each lens renders and the hero names it
Shell: phone · Priority: P0 · Surface: phone:calendar · Writes: no

**Steps**
1. **Calendar** tab. Choose each face in turn: Agenda, **D**, **W**, **M**, **Y**.

**Expect**
- Agenda → hero "Agenda", a list of the next 14 days.
- **D** → hero "Today" with a short read beside it (e.g. "3h open"), a time canvas.
- **W** → hero "This week", seven columns.
- **M** → hero is the month name, a month grid with a day plan below it.
- **Y** → hero is the year, twelve small months.
- The top bar shows no separate date line on this tab.

### QA-CAL-02 · Travel and Today
Shell: phone · Priority: P0 · Surface: phone:calendar · Writes: no

**Steps**
1. **D** face. Note where the **Today** button sits.
2. Tap **Next day** twice. Check the hero and the **Today** button.
3. Tap **Today**.
4. Swipe the canvas from right to left once.

**Expect**
- After 2: hero reads a date like "November 18" (not "Today"); **Today** is in exactly the same place and size as in step 1 (accessible name "Back to today").
- After 3: hero is "Today" again.
- After 4: hero is "Tomorrow".

### QA-CAL-03 · Month: first tap selects, second tap opens
Shell: phone · Priority: P1 · Surface: phone:calendar · Writes: no

**Steps**
1. **M** face. Tap tomorrow's date once.
2. Tap the same date again.

**Expect**
- After 1: tomorrow is highlighted and the plan under the grid now lists tomorrow's tasks («Homepage hero copy», «Rehearse talk (run 1)»). The face is still **M**.
- After 2: the **D** face opens on tomorrow (hero "Tomorrow").

### QA-CAL-04 · Year: a month opens the month
Shell: phone · Priority: P2 · Surface: phone:calendar · Writes: no

**Steps**
1. **Y** face. Tap next month.

**Expect**
- The **M** face opens on next month; hero is that month's name.

### QA-CAL-05 · The week crown
Shell: phone · Priority: P1 · Surface: phone:calendar, week-crown · Writes: no

**Steps**
1. **W** face. Find the strip just under the calendar chrome starting "This week".
2. Tap it to open it.
3. Tap «Marketing site v2» in the open crown.

**Expect**
- Shut, it shows a row of coloured pips and an amber dot (there's work with no time yet). Its accessible name says how many projects landed and mentions pieces with no time.
- Open, it lists the four on-week projects: «Marketing site v2», «Billing migration», «Garage clean-out», «Meetup talk».
- Step 3 opens the project's record sheet.
- Switching to **M** keeps the shut strip visible.

### QA-CAL-06 · A sitting opens its block sheet
Shell: phone · Priority: P1 · Surface: phone:calendar, slot-sheet · Writes: yes

**Steps**
1. **W** face of this week. Tap the Wednesday 1:00–3:00pm «Marketing site v2» block.
2. In the sheet's **Tasks** section, type "QA hero photo crop" into "Add a task to this block" and submit.
3. Close the sheet and reopen the block.

**Expect**
- The sheet is titled **Block** and lists «Case study photos» and «Nav + footer pass» with a count like "0/2 done".
- After 2 it lists three tasks, the new one included; still there after reopening.

### QA-CAL-07 · Rename a block on the Day canvas
Shell: phone · Priority: P1 · Surface: phone:calendar, task-sheet · Writes: yes

**Steps**
1. **D** face, today. Tap «Pick up kids».
2. Change the title (accessible name "Task title") to "QA pick up kids + groceries". Close.

**Expect**
- The block at 3:15pm now reads "QA pick up kids + groceries". Still so after reload.

### QA-CAL-08 · Jump to a date
Shell: phone · Priority: P2 · Surface: phone:calendar · Writes: no

**Steps**
1. **D** face. Tap the hero ("Today").
2. In the date picker that opens, choose the 1st of next month.

**Expect**
- The Day face shows that date; the hero names it.
