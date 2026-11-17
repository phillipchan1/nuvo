# 60 · The week — plan it, read it

The weekly ritual runs on both shells through one composer. Desktop: the door
button at the top of the Schedule's left rail (**Plan the week** / **The plan** /
**Review**). Phone: **Tasks** → **Week**, the **Plan the week** card (or
**Adjust the week's plan** once the week has a plan).

The seed already put four projects on this week. The readout runs first, while
the week is exactly as seeded; the desktop plan then targets **next week**.

### QA-WEEK-01 · The week's readout
Shell: both · Priority: P1 · Surface: week-crown · Writes: no

**Steps**
1. Desktop: read the Schedule rail's crown. Phone: **Tasks** → **Week**, read the readiness and the **To place** section.

**Expect**
- The crown/sidebar's "This week" group lists the four on-week projects.
- Seven loose tasks are shown as not yet placed (phone: under **To place**; desktop: in the crown's per-project rows, marked as having no time).
- The desktop sidebar shows a "This week n/m" group whose rows open each project.

### QA-WEEK-02 · Plan next week on the desktop
Shell: desktop · Priority: P0 · Surface: week-ritual · Writes: yes

**Steps**
1. **Schedule**. In the left rail's crown, click the door button (**Plan the week** or **The plan**). If an overlay opens first, use its **Plan the week** / **Re-plan the week** action.
2. In the plan, set **Which week** to next week.
3. Bring «Pricing page experiment» into the week if it is offered; accept the proposed blocks as they are.
4. Click **Commit {n} things** (⌘↵). Then **Done**.
5. Click **Next** in the Schedule bar to view next week.

**Expect**
- The plan opens in the rail with the hero "Shape the week." and a commit button naming how many things it will commit.
- After committing it says "Committed".
- Next week now carries the committed work: «Pricing page experiment» (if added) is on next week's crown, and any accepted blocks sit on next week's grid.
- This week is unchanged — the four seeded projects are still on it.

### QA-WEEK-03 · Plan the week on the phone
Shell: phone · Priority: P0 · Surface: week-ritual, phone:tasks · Writes: yes

**Steps**
1. **Tasks** → **Week**. Tap **Plan** on the **Plan the week** card (or **Adjust the week's plan**).
2. Step **Open time** ("What room does this week have?"): tap **That's my open time**.
3. Step **Projects** ("What are you moving this week?"): leave as is, tap **That's what I'm moving**.
4. Step **The rest**: tap **See the week**.
5. Step **The week** ("Here's the week"): tap **Commit the week**, then **Done**.

**Expect**
- A full-screen flow titled "Plan the week · …", a stepper reading **Open time · Projects · The rest · The week** and a capacity meter.
- Each primary button advances exactly one step; **Back** returns one step.
- Committing shows "Committing…" then a summary with **Done**; afterwards the Week segment's card reads **This week** (not **Plan the week**).
- No project disappeared from the week that was on it before.

### QA-WEEK-04 · Take a project off the week inside the plan
Shell: phone · Priority: P2 · Surface: week-ritual · Writes: no

**Steps**
1. Open the plan as in QA-WEEK-03, go to the **Projects** step.
2. Tap the remove control on «Meetup talk» (accessible name "Take Meetup talk off this week").
3. Close the flow with **Close** without committing.

**Expect**
- In the step, «Meetup talk» left the list and the capacity meter changed.
- After closing without committing, «Meetup talk» is still on this week (crown and **Week** segment unchanged).

### QA-WEEK-05 · Rollover carries yesterday's open work
Shell: both · Priority: P2 · Surface: rollover · Writes: no
Manual: run only when the seed ran on an earlier day than the test (e.g. seed on a Monday, test on Tuesday)

**Steps**
1. Open today.

**Expect**
- Open tasks from earlier days (e.g. «Draft migration email to customers», or anything left planned yesterday) now sit on today with no time; nothing done was moved.
