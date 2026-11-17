# 00 · Smoke — run first; stop the run if a P0 here fails

Every file starts from a fresh seed (`qa/WORLD.md`); scenarios in a file run top to bottom.

### QA-AUTH-01 · Sign in with the QA account
Shell: both · Priority: P0 · Surface: auth · Writes: no

**Steps**
1. In a fresh browser profile, open `QA_APP_URL/?review`.
2. Choose **Sign in with email**.
3. Type `QA_EMAIL` into the email field (placeholder "you@example.com") and `QA_PASSWORD` into **Password**.
4. Submit.

**Expect**
- The sign-in page is replaced by the app within 10 seconds — no "Your 14 days are up" screen, no welcome walkthrough.
- Desktop: a sidebar on the left and one panel. Phone: a bottom bar reading **Calendar · Tasks · Projects · Initiatives · Domains**, opened on **Calendar**.
- No error toast.

### QA-SMOKE-01 · The seeded day is on screen
Shell: both · Priority: P0 · Surface: phone:calendar, desktop:schedule · Writes: no
After: QA-AUTH-01

**Steps**
1. Desktop: open the Schedule page from the sidebar. Phone: stay on **Calendar** and choose the **D** (Day) face of the horizon ladder; tap **Today** if it isn't already today.

**Expect**
- Today shows «Write case study: Fernwood» at 9:00am and «Review billing cutover plan» at 11:30am.
- «Invoice October retainer» is shown as done.
- «Shutdown review» sits at 5:00pm.
- Nothing appears twice.

### QA-SMOKE-02 · Capture a task and see it land
Shell: both · Priority: P0 · Surface: capture · Writes: yes
After: QA-AUTH-01

**Steps**
1. Desktop: press ⌘K (Ctrl+K off a Mac). Phone: tap the round **Capture** (＋) button above the bottom bar.
2. With **Task** selected in the kind switch, type "QA smoke task" and press Enter (phone: tap **Add task**).
3. Go to the inbox. Desktop: **Schedule** → the left rail's **Inbox** tab. Phone: **Tasks** tab → **Inbox** segment.

**Expect**
- The capture surface closes. Desktop also shows a toast "Task added".
- "QA smoke task" is in the Inbox, alongside the six seeded inbox tasks.
- Reload the page: it is still there.

### QA-SMOKE-03 · Complete and undo
Shell: both · Priority: P0 · Surface: tasks · Writes: yes
After: QA-AUTH-01

**Steps**
1. Find «Order printer ink» in today's list (desktop: **Schedule** → left rail **Today** tab; phone: **Tasks** → **Today**).
2. Tick its check (accessible name **Mark done**).
3. On the toast that appears, click **Undo**.

**Expect**
- After step 2 the row reads as done and a toast says "Marked done — Order printer ink" with **Undo**.
- After step 3 the row is open again, in its original place.
- Reload: it is still open.

### QA-SMOKE-04 · Every top-level place opens
Shell: both · Priority: P0 · Surface: phone:tasks, phone:projects, phone:initiatives, phone:domains, desktop:projects, desktop:initiatives, desktop:domains · Writes: no
After: QA-AUTH-01

**Steps**
1. Visit every page once. Desktop: the sidebar's **Schedule**, **Projects**, **Initiatives**, **Domains** (or ⌘1–⌘4). Phone: each bottom-bar tab, left to right.

**Expect**
- Each one renders content within 5 seconds: no blank panel, no endless skeleton, no error.
- Projects shows «Marketing site v2»; Initiatives shows «Q4 relaunch»; Domains shows «Studio», «Family», «Health», «Side project».
- Phone: no horizontal scrollbar on any tab.
