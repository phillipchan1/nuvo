# 90 · Account — sign out, and the things a bot must not do alone

Run this file last.

### QA-ACCT-01 · Sign out and back in
Shell: both · Priority: P0 · Surface: auth · Writes: no

**Steps**
1. Settings → **Account** → **Sign out**.
2. Sign in again exactly as in QA-AUTH-01.

**Expect**
- After 1: the sign-in page ("Task management for the ambitious") with **Continue with Google**; no planner data visible; the browser's back button does not return to the app.
- After 2: the app is back with the same data.

### QA-ACCT-02 · Delete account guard (do not delete)
Shell: both · Priority: P1 · Surface: account-delete · Writes: no

**Steps**
1. Settings → **Account** → **Leave Nuvo** → **Delete account**.
2. Look at **Delete forever** without typing anything.
3. Type "delete" (lower case).
4. Click **Cancel**.

**Expect**
- A "Delete this account" panel asking "Type DELETE to confirm".
- **Delete forever** stays disabled at 2 and at 3 (only exact upper-case DELETE enables it).
- **Cancel** closes the panel; the account is untouched.

### QA-ACCT-03 · Delete account for real
Shell: desktop · Priority: P2 · Surface: account-delete · Writes: yes
Manual: only on a throwaway account made for this, never the standing QA account — deleting it means someone must recreate and re-verify the account before the next run

**Steps**
1. Settings → **Account** → **Leave Nuvo** → **Delete account**, type "DELETE", click **Delete forever**.
2. Try to sign in with the same credentials.

**Expect**
- 1 signs you out.
- 2 fails (the password account no longer exists).

### QA-ACCT-04 · Paywall when the trial is over
Shell: both · Priority: P2 · Surface: paywall · Writes: no
Manual: needs an account whose trial has ended (set by hand in the database); never click through to checkout

**Steps**
1. Sign in to the lapsed account.

**Expect**
- "Your 14 days are up" with **Subscribe and continue**, **Sign out**, **Need help?**. No planner data shown.

### QA-ACCT-05 · Google calendar connect, sync and RSVP
Shell: desktop · Priority: P2 · Surface: calendar-sync · Writes: yes
Manual: needs a dedicated test Google account with a few events, connected by a human once

**Steps**
1. Settings → **Calendars** shows the test Google account.
2. On the Schedule, open one of its events. Set **Going?** / RSVP to Maybe.
3. Capture an **Event** "QA event from Nuvo" tomorrow 4pm via ⌘K.

**Expect**
- The account's events appear on the grid.
- The RSVP sticks after reload.
- The new event appears on the grid and, within a minute, in the Google calendar.
