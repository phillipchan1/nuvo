# 50 · Domains — the wall and the open domain

### QA-DOM-01 · The wall
Shell: both · Priority: P0 · Surface: desktop:domains, phone:domains · Writes: no

**Steps**
1. Open Domains.

**Expect**
- Four cards: «Studio», «Family», «Health», «Side project», each with its name and mandate ("Ship work clients feel", …).
- Desktop shows how much was kept this week ("… kept this week" or "Nothing kept this week"). Phone shows "4 domains".

### QA-DOM-02 · Open a domain
Shell: both · Priority: P1 · Surface: domain · Writes: no

**Steps**
1. Open «Studio».

**Expect**
- The domain screen shows its mandate, **The last quarter**, **The Gain**, and what's in flight, including «Q4 relaunch» and its projects.
- Desktop: **All domains** (or Esc) returns to the wall. Phone: **Close**/back returns.

### QA-DOM-03 · Edit the mandate
Shell: both · Priority: P1 · Surface: domain · Writes: yes

**Steps**
1. Open «Health». Change the mandate to "QA move every single day".
2. Leave the domain and reopen it. Reload.

**Expect**
- The new mandate shows on the card and the domain screen after reload.

### QA-DOM-04 · Create a domain
Shell: both · Priority: P1 · Surface: domain · Writes: yes

**Steps**
1. Desktop: **New domain**. Phone: the **Domain** button by the count.
2. Name it "QA Community".
3. Return to the wall.

**Expect**
- Five domain cards; "QA Community" is one. Phone count reads "5 domains".

### QA-DOM-05 · Park and resume a domain
Shell: both · Priority: P1 · Surface: domain, record-actions · Writes: yes
After: QA-DOM-04

**Steps**
1. Desktop: right-click "QA Community". Phone: press and hold its card. Choose **Park domain…**, confirm **Park**.
2. Find it in the parked fold. Choose **Resume** on it.

**Expect**
- After 1 it moved into a separate parked group under the live domains.
- After 2 it is back among live domains.

### QA-DOM-06 · Delete a domain
Shell: both · Priority: P2 · Surface: domain, record-actions · Writes: yes
After: QA-DOM-04

**Steps**
1. Open the menu on "QA Community", choose **Delete domain**, confirm.

**Expect**
- It asks first. Afterwards four domains remain and nothing seeded disappeared.
