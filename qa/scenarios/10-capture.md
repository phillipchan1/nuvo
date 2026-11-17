# 10 · Capture — one door, three kinds

There is exactly one capture surface. Desktop: ⌘K (Ctrl+K) opens a dialog titled
**Capture**. Phone: the round **Capture** (＋) button opens a bottom sheet titled
**Capture**. Both hold one text line (accessible name "Capture a task, event or
slot") and a kind switch **Task · Event · Slot**. Typed words are parsed: the
parts that were understood are highlighted as you type.

### QA-CAP-01 · Free text becomes structure
Shell: both · Priority: P0 · Surface: capture · Writes: yes

**Steps**
1. Open capture.
2. With **Task** selected, type exactly: "QA call the bank tomorrow 2pm 30m #calls !high"
3. Before submitting, look at the line.
4. Submit (Enter; phone: **Add task**).
5. Go to tomorrow on the calendar.

**Expect**
- At step 3, "tomorrow 2pm", "30m", "#calls" and "!high" are highlighted; "QA call the bank" is not.
- Tomorrow has a 2:00–2:30pm block titled "QA call the bank" (the tokens are gone from the title).
- Opening it shows priority **High** and the label **calls**.

### QA-CAP-02 · A route sends work into a project
Shell: both · Priority: P1 · Surface: capture · Writes: yes

**Steps**
1. Open capture, **Task** selected.
2. Type "QA draft FAQ page @meetup" and submit.
3. Open «Meetup talk» (Projects).

**Expect**
- "QA draft FAQ page" is in «Meetup talk»'s task list.
- It is **not** in the Inbox.

### QA-CAP-03 · An unknown route stays in the title
Shell: both · Priority: P2 · Surface: capture · Writes: yes

**Steps**
1. Capture the task "QA ask about @nothing-here".

**Expect**
- An Inbox task titled exactly "QA ask about @nothing-here" exists. No project was created.

### QA-CAP-04 · A repeat makes a series, not one task
Shell: both · Priority: P1 · Surface: capture · Writes: yes

**Steps**
1. Capture the task "QA water plants every monday".
2. Look at the next two Mondays on the calendar (phone: **W** face, then **Next week**).

**Expect**
- "QA water plants" appears on each of the next Mondays, marked as repeating (a repeat glyph, or **Repeat** showing "Weekly on Monday" when opened).

### QA-CAP-05 · The sentence survives a kind switch
Shell: both · Priority: P1 · Surface: capture · Writes: yes

**Steps**
1. Open capture. With **Task** selected, type "QA focus block friday 10am 2h".
2. Switch the kind to **Slot** (desktop shortcut ⌘3).
3. Check the text line and the Slot face's time.
4. Add it (phone: **Add slot**).
5. Open Friday on the calendar.

**Expect**
- At step 3 the line still reads "QA focus block friday 10am 2h"; the Slot face shows Friday 10:00am, 2h.
- Friday has a 10:00am–12:00pm block "QA focus block" that can hold tasks (opening it shows a **Tasks** section, "Nothing here yet").

### QA-CAP-06 · Event needs a calendar
Shell: both · Priority: P2 · Surface: capture · Writes: no

**Steps**
1. Open capture and look at the **Event** choice.

**Expect**
- With no calendar connected, **Event** is unavailable and the door says "Connect a calendar in Settings to capture events too." (or equivalent wording on desktop). Nothing crashes when it's tapped.

### QA-CAP-07 · Empty submit is refused politely
Shell: both · Priority: P2 · Surface: capture · Writes: no

**Steps**
1. Open capture, leave the line empty, press Enter (phone: tap **Add task**).

**Expect**
- Nothing is created. Phone shows "Nothing to add — type what needs doing."; desktop either shows that or does nothing. No error toast.

### QA-CAP-08 · Tapping empty time captures at that time
Shell: phone · Priority: P1 · Surface: capture, phone:calendar · Writes: yes

**Steps**
1. **Calendar** → **D** face, today.
2. Tap an empty stretch at about 1:00pm.
3. Type "QA tapped block" and tap **Add block**.

**Expect**
- The capture sheet opened with the time already set near 1:00pm.
- A block "QA tapped block" now sits at that time on today.

### QA-CAP-09 · The launch doors
Shell: both · Priority: P2 · Surface: shortcut-doors · Writes: no

**Steps**
1. Open `QA_APP_URL/?shortcut=capture`. Close what opened.
2. Open `QA_APP_URL/?shortcut=chat`. Close what opened.
3. Open `QA_APP_URL/?shortcut=today`.
4. Open `QA_APP_URL/?shortcut=bogus`.

**Expect**
- 1 opens capture. 2 opens the Nuvo chat. 3 lands on today (phone: **Tasks** → **Today**).
- After each, the `?shortcut=` part is gone from the address bar.
- 4 opens the app normally and does nothing else.
