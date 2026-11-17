# 80 · Settings & integrations

Desktop: sidebar **Settings (⌘,)**, a dialog with a section list on the left
("Settings sections"), closed by **Close settings** or Esc. Phone: the top bar's
**Settings** icon opens a tall sheet listing the sections; **Back to settings
sections** returns to the list. Sections: **Appearance · Schedule · Reminders ·
Calendars · Inbox address · Apps & devices · Labels · Shortcuts** (desktop only) **·
Account · Billing · About**.

### QA-SET-01 · Every section opens
Shell: both · Priority: P0 · Surface: settings:appearance, settings:schedule, settings:reminders, settings:connections, settings:inbound, settings:apps, settings:labels, settings:account, settings:billing, settings:about · Writes: no

**Steps**
1. Open Settings. Open each section in the list, top to bottom.

**Expect**
- Each shows its controls with no error. Phone: no **Shortcuts** section.
- **Account** shows `QA_EMAIL` (if it shows any other email: stop the run, `ABORTED: wrong account`).

### QA-SET-02 · Theme switches and persists
Shell: both · Priority: P1 · Surface: settings:appearance · Writes: yes

**Steps**
1. **Appearance** → set the theme to dark.
2. Close Settings. Reload.
3. Set it back to light.

**Expect**
- The whole app turns dark at once (background and text), stays dark after reload, and returns to light at step 3.

### QA-SET-03 · Week start moves the calendar
Shell: both · Priority: P1 · Surface: settings:schedule · Writes: yes

**Steps**
1. **Schedule** → **Week starts on** → Sunday.
2. Look at the week view (desktop **Week**; phone Calendar **W**).
3. Set it back to Monday.

**Expect**
- After 2 the week's first column is Sunday; after 3 it is Monday again.

### QA-SET-04 · Labels
Shell: both · Priority: P1 · Surface: settings:labels · Writes: yes

**Steps**
1. **Labels** → **New label**: "qa-urgent", **Add**.
2. Capture the task "QA label test #qa-urgent".
3. Back in **Labels**, delete "qa-urgent".

**Expect**
- "qa-urgent" appears in the list next to «calls» and «errand».
- The captured task carries the label.
- After deletion the label is gone from the list and from the task; the task itself still exists.

### QA-SET-05 · Inbox address
Shell: both · Priority: P1 · Surface: settings:inbound · Writes: yes

**Steps**
1. **Inbox address**. Note the address.
2. Click **Copy**.
3. Click **Get a new address**, then **Replace address**.

**Expect**
- An address ending `@inbox.nuvo.day`, with the line "Subject becomes an inbox task. Nothing is scheduled."
- Copy shows "Address copied".
- Replace shows "New address ready — the old one no longer receives" and the address changed.

### QA-SET-06 · App tokens
Shell: both · Priority: P1 · Surface: settings:apps · Writes: yes

**Steps**
1. **Apps & devices** → under **New key**, choose **Inbox**, name it "QA watch", click **Create token**.
2. Click **Done** (do not paste the token anywhere).
3. Click **Revoke** on "QA watch".

**Expect**
- After 1: "Token for QA watch — copy it now" with **Copy token**.
- After 2: a row for "QA watch" reading "never used".
- After 3: toast "Token revoked"; the row moves under a revoked group.

### QA-SET-07 · Calendars screen without connecting
Shell: both · Priority: P2 · Surface: settings:connections · Writes: no

**Steps**
1. **Calendars**. Read the screen. **Do not click** any connect button.

**Expect**
- "No calendars yet" (or equivalent) and the choices **Connect Google**, **Connect Apple Calendar**, **Subscribe to a link**.

### QA-SET-08 · Reminders toggle
Shell: both · Priority: P2 · Surface: settings:reminders · Writes: yes

**Steps**
1. **Reminders** → turn **Remind me** on. If the browser asks for notification permission, **deny** it.
2. Turn **Remind me** off.

**Expect**
- The section's lead-time controls appear when on. Denying permission shows "Notifications are blocked" (or a similar notice), not an error. Turning it off hides the controls again.

### QA-SET-09 · Billing shows the plan, not a checkout
Shell: both · Priority: P2 · Surface: settings:billing · Writes: no

**Steps**
1. **Billing**. Read it. **Do not** click anything that leads to checkout.

**Expect**
- The QA account's plan state is shown (active, or "Free trial · N days left" with an end date). **Share Nuvo** is present.

### QA-SET-10 · About and the welcome tour
Shell: both · Priority: P2 · Surface: settings:about, orientation · Writes: no

**Steps**
1. **About** → **Welcome tour** → **Replay**.
2. On the welcome screen ("Now, down to the hour"), click **Skip**.

**Expect**
- The welcome screen opens over the live app, and **Skip** returns to the app exactly as it was.

### QA-SET-11 · Search (phone)
Shell: phone · Priority: P1 · Surface: search · Writes: no

**Steps**
1. Top bar **Search**. Type "case study".
2. Tap «Write case study: Fernwood» in the results.

**Expect**
- Results are grouped (e.g. **Tasks**, **Projects**) and include «Write case study: Fernwood» and «Case study: Northpine».
- Tapping a result opens that task's sheet.
