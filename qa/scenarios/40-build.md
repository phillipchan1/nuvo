# 40 · Projects & Initiatives — the four faces, the record, the lifecycle

Projects and Initiatives each have four faces in this order: **On Deck · Groom ·
Table · Shipped**. (Phone calls the third one **All**.) Desktop: tabs in the
page bar (keys 1–4). Phone: a segmented control ("View") at the top of the tab.

Lifecycle acts live in one menu. Desktop: right-click a card. Phone: press and
hold a row in **All** / **Groom** / **Shipped**, or tap **⋯** inside the record.
The menu offers **Open · Ship it… / Reopen · Park (waiting) / Resume · Delete**.

### QA-BUILD-01 · All four faces render, both altitudes
Shell: both · Priority: P0 · Surface: desktop:projects, desktop:initiatives, phone:projects, phone:initiatives, build-face:ondeck, build-face:groom, build-face:all, build-face:shipped · Writes: no

**Steps**
1. Open Projects. Visit **On Deck**, **Groom**, **Table** (phone: **All**), **Shipped**.
2. Do the same on Initiatives.

**Expect**
- Projects **On Deck**: the four on-week projects sit in this week's column; «Pricing page experiment» and «Family photo book» are in the pool ("Needs a week").
- Projects **Table/All** lists all eight seeded projects.
- Projects **Shipped** shows «Newsletter relaunch».
- Initiatives **Table/All** lists «Q4 relaunch» and «Home reset».
- No face is blank or errors.

### QA-BUILD-02 · Create a project
Shell: desktop · Priority: P0 · Surface: desktop:projects, create-record · Writes: yes

**Steps**
1. Projects → **On Deck**. Click **New project** (or press **P**).
2. Name: "QA garden beds". Outcome: "QA three raised beds built".
3. Set **Domain** to «Family».
4. Under tasks, add "QA buy lumber". Click **Create project** (or **Create with 1 tasks**).

**Expect**
- "QA garden beds" appears in the pool and in **Table** under Family, with one task.

### QA-BUILD-03 · Create a project on the phone
Shell: phone · Priority: P0 · Surface: phone:projects, create-record · Writes: yes

**Steps**
1. **Projects** → **On Deck**. Tap the add button **Project**.
2. Type "QA garden beds phone" into "Name a project…" and press Enter.
3. Switch to **All**.

**Expect**
- "QA garden beds phone" is listed under **All**.

### QA-BUILD-04 · The project record
Shell: both · Priority: P0 · Surface: record · Writes: yes

**Steps**
1. Open «Marketing site v2» (click/tap it in **Table**/**All**).
2. Check the tasks and the comment.
3. Add a task "QA final QA pass" (desktop: "Add a task (T)"; phone: "Add a task").
4. Add a comment "QA comment from the bot" (desktop: "Add a comment…").
5. Close and reopen the record.

**Expect**
- The record shows outcome "Homepage + 3 case studies live", its tasks include «Write case study: Fernwood», «Case study: Northpine», «Case study photos».
- The comment "Client wants the Fernwood study first." is there.
- After reopening, the new task and the new comment are both present.

### QA-BUILD-05 · Ship and reopen
Shell: both · Priority: P1 · Surface: record-actions · Writes: yes

**Steps**
1. Open the lifecycle menu on «Meetup talk» and choose **Ship it…**.
2. In the dialog ("Ship Meetup talk?"), confirm **Ship it**.
3. Go to **Shipped**.
4. Open the menu on «Meetup talk» again and choose **Reopen**.

**Expect**
- After 2–3, «Meetup talk» is in **Shipped** alongside «Newsletter relaunch».
- After 4 it is back among open projects and gone from **Shipped**.

### QA-BUILD-06 · Park and resume
Shell: both · Priority: P1 · Surface: record-actions · Writes: yes

**Steps**
1. Open the lifecycle menu on «Shed roof repair». It should offer **Resume** (it is parked).
2. Choose **Resume**.
3. Open the menu on «Family photo book», choose **Park (waiting)**.

**Expect**
- «Shed roof repair» leaves the parked group (desktop **Groom** → **Parked** column) and shows as open.
- «Family photo book» now shows as parked/waiting.

### QA-BUILD-07 · Take a project off the week
Shell: both · Priority: P1 · Surface: record-actions, week-crown · Writes: yes

**Steps**
1. Open the lifecycle menu on «Garage clean-out». Choose **Take off this week**.
2. If asked, confirm **Take it off**.
3. Look at the week crown (desktop: the Schedule rail's top; phone: Calendar → **W**, open the crown).

**Expect**
- The menu asked first, because the project has a timed block this week («Haul boxes to donation»).
- The crown lists three projects, not four. «Garage clean-out» is in On Deck's pool.

### QA-BUILD-08 · Delete asks first
Shell: both · Priority: P1 · Surface: record-actions · Writes: yes
After: QA-BUILD-02 or QA-BUILD-03

**Steps**
1. Open the lifecycle menu on the project you created ("QA garden beds" / "QA garden beds phone").
2. Choose **Delete project**. Read the dialog. Click **Delete**.

**Expect**
- The dialog reads `Delete "QA garden beds"?` (or the phone name) with "This can't be undone." and **Cancel** / **Delete**.
- The project is gone from every face.

### QA-BUILD-09 · Groom a raw project
Shell: both · Priority: P2 · Surface: build-face:groom · Writes: yes

**Steps**
1. Projects → **Groom**. Find «Pricing page experiment».
2. Change its outcome (desktop: "What does done look like?"; phone: **Outcome**) to "QA annual toggle shipped to 50%".
3. Add a step "QA write the variant copy".

**Expect**
- Both edits persist after reload, and the task appears in the project's record.

### QA-BUILD-10 · Initiative record and key result
Shell: both · Priority: P1 · Surface: record · Writes: yes

**Steps**
1. Open «Q4 relaunch».
2. Check **Key results** and **Projects**.
3. Add a key result "QA case studies live" (desktop: "Add a key result (K)").

**Expect**
- «Annual plan signups» shows 12 of 40.
- Projects lists «Marketing site v2», «Billing migration», «Pricing page experiment».
- The new key result is listed and survives a reload.

### QA-BUILD-11 · Drag a pool project onto a week
Shell: desktop · Priority: P2 · Surface: build-face:ondeck · Writes: yes

**Steps**
1. Projects → **On Deck**. Drag «Pricing page experiment» from the pool onto next week's column.

**Expect**
- It now sits in next week's column and has left the pool. This week's column is unchanged.
