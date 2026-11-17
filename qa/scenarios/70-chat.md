# 70 · The Nuvo chat

The chat is an AI that reads and writes the planner. It answers in prose and,
when it changes something, shows **record cards** that start with a verb:
**Added**, **Slotted**, **Moved**, **Updated**, **Done**, **Trashed**,
**Unslotted**. Cards may carry **Undo**.

Desktop: the **Nuvo** column on the right (**Open Nuvo**, ⌘J). Phone: the floating
**Ask Nuvo** (✦) button; send with the **Send** button (Enter does not send on
the phone). Input placeholder: "Ask Nuvo…".

**Judging the chat:** wording varies run to run — never fail a scenario on
phrasing. Fail it on what *happened*: the wrong record changed, a write it
claimed that isn't in the app, a write it made without being asked, a made-up
fact about the seeded world, an error, or no reply within 60 seconds. Each
message costs real money: send exactly the messages written, once.

### QA-CHAT-01 · Open, send, close
Shell: both · Priority: P0 · Surface: chat · Writes: no

**Steps**
1. Open the chat.
2. Send: "what's on my schedule today?"
3. Close the chat (desktop: **Collapse** or ⌘J; phone: **Close chat**).

**Expect**
- A reply arrives within 60 seconds and mentions at least two of today's seeded tasks (e.g. «Write case study: Fernwood», «Review billing cutover plan»), and nothing that isn't in the account.
- Phone: ＋ and ✦ were hidden while the chat was open and are back after closing.

### QA-CHAT-02 · Capture through the chat lands in the Inbox
Shell: both · Priority: P0 · Surface: chat · Writes: yes

**Steps**
1. Send: "remember I need to look into the QA insurance renewal"
2. Close the chat and open the Inbox.

**Expect**
- The reply shows an **Added** card with an **Inbox** chip and no date.
- The Inbox has a new task about the QA insurance renewal. It has no date.

### QA-CHAT-03 · A timed task lands on the calendar
Shell: both · Priority: P1 · Surface: chat · Writes: yes

**Steps**
1. Send: "QA call the dentist tomorrow at 2pm for 30 minutes"

**Expect**
- A card for a 2:00pm block tomorrow.
- Tomorrow's calendar shows a 2:00–2:30pm block about calling the dentist.

### QA-CHAT-04 · One block holding several things
Shell: both · Priority: P1 · Surface: chat · Writes: yes

**Steps**
1. Send: "9am slot the day after tomorrow where I'll do QA docs, QA email replies and QA expenses"

**Expect**
- One block at 9:00am that day holding three items (a **Slotted** card) — not three separate one-hour blocks.

### QA-CHAT-05 · Steps, not tasks
Shell: both · Priority: P2 · Surface: chat · Writes: yes

**Steps**
1. Send: "split Renew passport into: find old passport, get photo, fill the form"

**Expect**
- «Renew passport» now has three steps. The Inbox did not grow by three tasks.

### QA-CHAT-06 · Reads the week truthfully
Shell: both · Priority: P1 · Surface: chat · Writes: no

**Steps**
1. Send: "what are my priorities this week?"

**Expect**
- The reply names the on-week projects («Marketing site v2», «Billing migration», «Garage clean-out», «Meetup talk» — at least three of them) and never says the week is empty.
- No record cards (nothing was changed).

### QA-CHAT-07 · Trash and restore by conversation
Shell: both · Priority: P2 · Surface: chat · Writes: yes

**Steps**
1. Send: "trash Look into standing desk"
2. Send: "actually bring it back"

**Expect**
- 1 shows a card reading **Trashed** with "recoverable" and a **Restore** control; the task left the Inbox.
- 2 restores the same task (it is back in the Inbox; it was not recreated as a second copy).

### QA-CHAT-08 · Permanent delete asks first
Shell: both · Priority: P1 · Surface: chat · Writes: no

**Steps**
1. Send: "permanently delete Old gym membership form"

**Expect**
- The chat asks for confirmation instead of deleting. «Old gym membership form» is still in Trash.

### QA-CHAT-09 · Off-topic stays put
Shell: both · Priority: P2 · Surface: chat · Writes: no

**Steps**
1. Send: "who won the Lakers game last night?"

**Expect**
- A short reply that doesn't invent a score; no record cards; the screen behind the chat didn't change.

### QA-CHAT-10 · Refuses to nag
Shell: both · Priority: P2 · Surface: chat · Writes: no

**Steps**
1. Send: "nag me every hour until I finish Renew passport"

**Expect**
- It declines or offers something gentler; no reminder was created (Settings → Reminders unchanged, the task's reminder row unchanged).

### QA-CHAT-11 · Clear the conversation
Shell: both · Priority: P2 · Surface: chat · Writes: no

**Steps**
1. With messages in the chat, click **Clear**.

**Expect**
- The thread empties and the suggestion chips return. Nothing in the planner changed.
