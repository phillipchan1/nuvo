# 20 · Tasks — lists, the task sheet, trash

A task wears one row everywhere. Opening a task: desktop click opens its
inspector; phone tap opens a bottom sheet titled **Task**.

### QA-TASK-01 · The three lists
Shell: phone · Priority: P0 · Surface: phone:tasks · Writes: no

**Steps**
1. **Tasks** tab. Tap each segment: **Today**, **Week**, **Inbox**.

**Expect**
- The **Tasks** bottom-bar tab carries an inbox count badge (accessible name "Tasks, 6 in inbox").
- **Today** lists today's seeded tasks; «Invoice October retainer» sits under **Done**.
- **Week** has **To place** with the seven loose tasks (e.g. «Case study: Northpine», «Outline talk»).
- **Inbox** lists exactly the six seeded inbox tasks in seeded order, «Reply to Dana about the venue» first.

### QA-TASK-02 · Rename, notes, duration persist
Shell: both · Priority: P0 · Surface: task-sheet · Writes: yes

**Steps**
1. Open «Look into standing desk».
2. Change the title to "QA standing desk research".
3. In **Notes**, type "QA note line".
4. Set the duration to 1h (phone: the **Duration** chip "1h").
5. Close the sheet/inspector (phone: **Close**).
6. Reload and open the task again.

**Expect**
- The title, note and 1h duration all survived the reload.

### QA-TASK-03 · Plan a task for tomorrow, then back to Inbox
Shell: phone · Priority: P1 · Surface: task-sheet · Writes: yes

**Steps**
1. **Tasks** → **Inbox**. Tap «Schedule dentist».
2. In **Plan**, tap **Tomorrow**.
3. Go to **Calendar** → **D**, tap **Next day**.
4. Tap «Schedule dentist», then in **Plan** tap **Inbox**.

**Expect**
- After step 2 the sheet closed and the Inbox count dropped by one.
- Tomorrow lists «Schedule dentist» (no time).
- After step 4 it is back in the Inbox.

### QA-TASK-04 · Set a time with Reschedule
Shell: phone · Priority: P1 · Surface: task-sheet · Writes: yes

**Steps**
1. Open «Call the plumber».
2. Tap **Reschedule**, set **Time** to 4:00pm, tap **Set date & time**.
3. View today on the **D** face.

**Expect**
- «Call the plumber» is a block at 4:00pm today.

### QA-TASK-05 · Swipe to complete, swipe to tomorrow
Shell: phone · Priority: P1 · Surface: phone:tasks · Writes: yes

**Steps**
1. **Tasks** → **Today**. Swipe «Order printer ink» to the right.
2. Click **Undo** on the toast.
3. Swipe «Order printer ink» to the left.

**Expect**
- Step 1 reveals **Done** and completes it; toast "Marked done — Order printer ink".
- Step 2 reopens it.
- Step 3 reveals **Tomorrow** and removes it from Today; it is on tomorrow's list.

### QA-TASK-06 · Project, priority, label from the sheet
Shell: both · Priority: P1 · Surface: task-sheet · Writes: yes

**Steps**
1. Open «Return the router».
2. Set **Project** to «Garage clean-out».
3. Set **Priority** to **Medium**.
4. Close, then open «Garage clean-out».

**Expect**
- «Return the router» is in «Garage clean-out»'s tasks, with medium priority and still labelled **errand**.
- It has left the Inbox.

### QA-TASK-07 · Steps inside a task
Shell: both · Priority: P2 · Surface: task-sheet · Writes: yes

**Steps**
1. Open «Renew passport».
2. In **Steps**, add "QA find old passport", then "QA book photo".
3. Tick "QA find old passport".
4. Close and reopen.

**Expect**
- Two steps, the first done, in the order added. Neither appears as its own task in the Inbox.

### QA-TASK-08 · Repeat from the sheet
Shell: both · Priority: P2 · Surface: task-sheet · Writes: yes

**Steps**
1. Open «Run».
2. Open **Repeat**, choose **Every weekday**.
3. Look at tomorrow and the next weekday on the calendar.

**Expect**
- «Run» appears at 7:15am on following weekdays.

### QA-TASK-09 · Trash and restore
Shell: phone · Priority: P0 · Surface: trash · Writes: yes

**Steps**
1. Open «Read: Shape Up ch. 3» and tap **Trash** in the sheet's foot.
2. On the **Tasks** tab, tap the trash icon (accessible name "Trash · 2").
3. Restore «Read: Shape Up ch. 3» (the row's restore action).

**Expect**
- Step 1: toast "Task deleted" with **Undo**; it leaves the Inbox.
- Step 2: Trash lists «Read: Shape Up ch. 3» and «Old gym membership form».
- Step 3: it is back in the Inbox; Trash shows one item.

### QA-TASK-10 · Delete forever asks first
Shell: phone · Priority: P1 · Surface: trash · Writes: yes

**Steps**
1. Open Trash. On «Old gym membership form» tap **Delete forever**.
2. Confirm **Delete forever?**.

**Expect**
- It asked before deleting.
- Trash now reads "Trash is empty" and the trash icon is gone from the Tasks header.

### QA-TASK-11 · Filter
Shell: phone · Priority: P2 · Surface: phone:tasks · Writes: no

**Steps**
1. **Tasks** → **Inbox**. Tap **Filter tasks**.
2. Under **Labels**, pick **calls**. Close the filter.
3. Clear the filter.

**Expect**
- With the filter, only «Reply to Dana about the venue» shows, and the button reads "Filters — 1 active".
- Cleared, all six are back.

### QA-TASK-12 · Multi-select and bulk act
Shell: phone · Priority: P2 · Surface: phone:tasks · Writes: yes

**Steps**
1. **Tasks** → **Inbox**. Press and hold «Reply to Dana about the venue» for about a second.
2. Tap «Schedule dentist».
3. In the bar that appears, tap **Priority** and choose High.

**Expect**
- Holding started selection; both rows show as selected.
- The bar offers **When**, **Priority**, **Label**, **Move**, **Done**, **Inbox**, **Trash**, **Clear selection**.
- Both tasks are now high priority. ＋ and ✦ were hidden while selecting and return after.

### QA-TASK-13 · Pull loose work onto today
Shell: phone · Priority: P1 · Surface: phone:tasks · Writes: yes

**Steps**
1. **Tasks** → **Week**. On «Outline talk» under **To place**, tap **Today**.

**Expect**
- «Outline talk» leaves **To place** and appears on **Today**.
