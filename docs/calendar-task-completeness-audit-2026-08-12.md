# Calendar & Task feature-completeness audit — 2026-08-12

Benchmarked against Google Calendar, Apple Calendar, Fantastical, Notion Calendar/Cron,
Todoist, TickTick, Things 3, Microsoft To Do, Sunsama.

Ratings are from reading the code, not from the docs. ✅ Full · ⚠️ Partial · ❌ Missing.

> **Reading note.** Nuvo is deliberately not a general-purpose calendar or a general-purpose
> to-do app — it is a planner whose thesis is the funnel (domains → initiatives → projects →
> tasks → time). Several ❌ rows below are *correct product decisions*, not defects; those are
> marked **(by design)** and excluded from the top-10 ranking. The ranking only contains gaps
> that hurt the planner Nuvo is actually trying to be.

---

## CALENDAR

| Capability | Status | Evidence | Gap | Impact |
|---|---|---|---|---|
| Views: day / week / month / agenda / year | ⚠️ | `src/components/CalendarPane.tsx:39` (`CalView = timeGridWeek \| timeGridDay \| dayGridMonth \| board`), switcher at `:2446`; mobile modes at `src/components/mobile/MobileCalendar.tsx:64` (`month \| schedule \| day`) | **No year view** on either shell. **No agenda/list view on desktop** — "Spread" (`board`) is a week-board (`floors/WeekBoard.tsx`), not an agenda; the phone has one (`schedule`), the desktop does not. Conversely the phone has **no week grid**. | med |
| Smooth view switching | ✅ | `CalendarPane.tsx:846` (`api.changeView`), keys `S/W/D/M` at `:572-574`, persisted view state; mobile persists mode to localStorage `MobileCalendar.tsx:57,97` | — | — |
| Drag-to-create | ✅ | `CalendarPane.tsx:2715-2723` (`selectable`, `selectMirror`, `select={onSelect}`) → opens `DraftComposer` | Phone creates via `MobileNewEventSheet`, not drag (correct for touch) | — |
| Drag-to-reschedule | ✅ | `CalendarPane.tsx:2725` `eventDrop={onDrop}`; `editable` per-event at `:902,942,983,1037`; read-only events explicitly non-editable `:983` (`writable && !e.all_day`) | All-day external events are **not** draggable (`:983`) | low |
| Drag-to-resize duration | ✅ | `CalendarPane.tsx:2726` `eventResize={onResize}`; `snapDuration: 00:15` `:2599` | — | — |
| All-day events | ✅ | `CalendarPane.tsx:2582` `allDaySlot`, `:2583` `allDayText="anytime"`; `DraftComposer.tsx:95,196`; `MobileNewEventSheet.tsx:36,104`; `types.ts:216` `all_day` | — | — |
| Multi-day (spanning) events | ⚠️ | `DraftComposer.tsx:83` (`multiDay`), `lib/dates.ts` `allDayRangeFromStart`; `MobileEventSheet.tsx:183-186` preserves inclusive end | Multi-day works for **all-day** spans only. A multi-day **timed** event is not composable in the UI, and an all-day range can't be resized by dragging (see row above). | low |
| Recurring events — full RRULE | ⚠️ | Engine `supabase/functions/_shared/recurrence.ts:8` (`freq = daily \| weekly \| monthly`); picker `src/components/RecurrencePicker.tsx:410` (Day/Week/Month only), `:344` (`bymonthday = anchorDay`) | **No `yearly`.** **No BYSETPOS** — "last Friday of the month", "2nd Tuesday" are unrepresentable; monthly is always by day-of-month, silently taken from the anchor (`:437-439` just states it, no control). Ends-on/ends-after ✅ (`:445-470`). Inbound Google series with unsupported rules round-trip through `fromGoogleRRULE` and can be lossy on an ALL-scope edit. | **high** |
| Timezone: event tz vs viewer tz, DST | ⚠️ | `src/lib/timezone.ts:9-53` (device zone, DST-correct via `Intl`), `TimeZoneChip.tsx`, `useHomeTimezone.ts`; writes as UTC instants `supabase/functions/google-events/index.ts:20`; agent converts per-request client tz `agent/tools.ts:135-160` | Viewer-side is right. But **an event carries no timezone of its own** — you can't create "9am Tokyo time"; `ExternalEvent` (`types.ts:208-224`) has no tz column and Google's `start.timeZone` is only read on the recurring-instance path (`google-events/index.ts:486`). **`task-mirror/index.ts:69` hardcodes `America/Los_Angeles`** on every mirrored block. | med |
| Multiple calendars, color-coding, show/hide | ✅ | `types.ts:191-206` (`CalendarInfo.color/visible`), `types.ts:238` `hidden_calendar_ids`, per-event hide `types.ts:242,263` (`hidden_events` — Fantastical-style), Settings UI `SettingsModal.tsx:725-740` | — | — |
| Attendees / invites / RSVP | ⚠️ | `GuestsInput.tsx`, `DraftComposer.tsx:406`, `useCalendar.ts:276` (`rsvp`), `:440` (`invite`); RSVP UI `SlideOver.tsx:1358-1386,1627`; phone `MobileEventSheet.tsx:135-148`; normalization `types.ts:416-469`; M365 read-only RSVP `migrations/…56_self_rsvp_m365.sql` | **RSVP is Google-only** — `useCalendar.ts:277` hardcodes `supabase.functions.invoke("google-events")`. An iCloud (writable!) or M365 invite can be *read* but not answered in Nuvo. No proposed-new-time, no optional-attendee UI. | med |
| Free/busy & availability | ⚠️ | Own availability: `lib/now.ts` `readDay`/`toBusyBlocks`, `useFindTime.ts`, `lib/compose.ts` | **No attendee free/busy** — zero hits for `freeBusy` anywhere in `src`/`supabase`. Scheduling with guests is blind to their calendars. | med |
| Working hours | ✅ | `types.ts:236-237` (`work_start_minutes`/`work_end_minutes`, 480/990), Settings `SettingsModal.tsx:527-541`, consumed by `compose.ts`/`useFindTime.ts:32` | Single global window; no per-weekday hours | low |
| Reminders / notifications | ❌ | Exhaustive grep for `reminder`/`Notification(`/`requestPermission`/`showNotification`/`VALARM` across `src` + `supabase` returns **only** `_shared/caldav.ts:112,138` (filtering reminder *lists* out of discovery) | **Nothing anywhere.** No event alerts, no task due alerts, no push, no local notification, no lead-time config, no Web Push registration in the SW. This is the single largest absolute gap. | **high** |
| Location field | ✅ | `types.ts:214` `location`; edit `SlideOver.tsx:1227,1780-1790`; create `DraftComposer`; phone `MobileEventSheet.tsx:95` | Plain text only — no place autocomplete, no map/travel-time | low |
| Video-conferencing link auto-generation | ✅ | `_shared/conferencing.ts` (`joinUrl`, `conferenceName`, `shouldAddMeet`), `useCalendar.ts:463` (`addMeet`), pref `types.ts:256` `auto_add_meet`, UI `DraftComposer.tsx:413-441`, `MobileNewEventSheet.tsx:243` | **Google Meet only.** No Zoom/Teams link minting (Teams links are read-back only, `types.ts:459-465`). | low |
| Notes on events | ✅ | `SlideOver.tsx:1228,1304-1309` (HTML→plain-text round trip), `useCalendar.ts:190-193` (`description` rides to the provider, stripped before the row write) | — | — |
| Attachments on events | ❌ | Only surface with attachments is the **chat**: `lib/agentAttachments.ts`, `lib/agentTypes.ts` — data-URL, in-message, never persisted to a record | No file on an event or a task | low |
| Event templates | ❌ | `SeriesTemplate` (`useRecurrence.ts`) is a *recurrence* template, not a user-facing event template | — | low |
| Event duplication | ⚠️ | Duplicate exists for **tasks** `CalendarPane.tsx:2250` and **slots** `:2317` | **No Duplicate on an external calendar event** — the event context menu (`CalendarPane.tsx:1975-2170`) offers Open-in-Google, Move to…, → Task, Delete, and nothing else. | med |
| Natural-language quick-add | ✅ | `src/lib/nlp.ts` (`parseCapture`, chrono-node lazy-loaded `:1-9`, date aliases `:50-64`, `#label` `:37`, `!priority` `:38`, `@route` `:41`, `//note` `:44`, repeat phrases via `parseRecurrencePhrase`); agent `toolDefs.ts:415` `create_task.capture` | NL quick-add creates **tasks**, not calendar events — "lunch with Sam Thu 1pm" becomes a scheduled task/block, not a guest-bearing event, unless routed through the agent's `create_calendar_event`. | low |
| Search across events | ❌ | `lib/spotlightNav.ts:22-28` — `SearchHitData.kind` is `task \| project \| initiative \| domain`; `buildSearchHits` (`:32-76`) never walks events. Phone: `MobileSearch.tsx:3-4,72-79` — same four kinds. Agent: `toolDefs.ts:795` `list_tasks` only. | **You cannot search your calendar in Nuvo, on any surface, by any means.** Finding a past meeting requires scrolling the grid or opening Google. | **high** |
| External sync: Google / Outlook / iCal / CalDAV | ⚠️ | Read: `google-sync`, `m365-sync`, `ics-sync`, `icloud-sync` + `_shared/caldav.ts`; write: `lib/calendarWrite.ts:5-7` — **write-back is Google + iCloud only; M365 and ICS are read-only**; subscribe `ics-subscribe/index.ts` | **No export**: zero hits for `.ics` generation / `BEGIN:VEVENT` / `text/calendar` in `src`. No import of an `.ics` *file* (only feed subscription). M365 users get a read-only calendar. | med |
| Sharing (public link, per-calendar permissions) | ❌ **(by design)** | Single-player, per-account model — `CLAUDE.md` §1, `docs/product/overview.md` §2.1. Only "sharing" reference is Settings copy pointing at Google's own publish flow (`SettingsModal.tsx:995`) | Correct for the product | — |
| Undo / redo on calendar edits | ⚠️ | Undo: `CalendarPane.tsx:287,1395,1422,1487,1513` (drag + resize of slots *and* external events), stack `hooks/useUndoStack.tsx`, tiers `lib/undoTiers.ts` | **No redo** — `useUndoStack.tsx:184`: `if (e.shiftKey) return; // redo — not in v1`. Undo covers drag/resize but **not** event create, delete, RSVP, move-to-calendar, or field edits (`useCalendar.ts` records no undo at all — zero `recordUndo` hits in that file). Deletes are confirm-then-permanent (`CalendarPane.tsx:2113` "This can't be undone"). | med |
| Offline support & conflict handling | ⚠️ | Strong for Nuvo's own data: `lib/sync/ops.ts:32-45` `SYNC_TABLES`, per-field LWW `ops.ts:14-24` + `migrations/…53_offline_sync.sql:2-11`, transport `lib/sync/transport.ts`, status `hooks/useOutbox.ts` | **`external_events` is not in `SYNC_TABLES`** — every calendar-event write is online-only and fails hard offline. Correct given the provider is the source of truth, but the app doesn't say so: the failure is a toast, not a queued edit. | med |

---

## TASKS / TODO

| Capability | Status | Evidence | Gap | Impact |
|---|---|---|---|---|
| Quick-add with NL due-date parsing | ✅ | `lib/nlp.ts` (see above); ⌘K `NuvoSpotlight.tsx:819`, global ⌥Space `SpotlightWindow.tsx`, phone ＋ FAB `QuickTaskSheet.tsx`, agent `toolDefs.ts:415` | Best-in-class here | — |
| Subtasks / checklists, ≥2 levels | ❌ | `Task` (`lib/types.ts:32-69`) has **no `parent_task_id`**; grep for `parent_task`/`subtask` across `src` + `supabase` returns only prose comments | A task is a leaf. The funnel (project → task) substitutes for one level of nesting, but there is no in-task checklist. Todoist/Things/TickTick all have this. | **high** |
| Priorities | ✅ | `types.ts:8,44` (`none\|low\|medium\|high`), UI `LeftRail`/`TaskRow`, capture `!high` `nlp.ts:38`, agent `toolDefs.ts:426` | — | — |
| Tags / labels | ✅ | `types.ts:68,185-189`, `task_labels` join, `useCalendar.ts:630` `useLabels`, picker `LeftRail.tsx:782`, capture `#tag` `nlp.ts:37` | No label-scoped view/filter (see Filters row) | — |
| Custom fields | ❌ **(by design)** | Zero hits for `custom_field` anywhere | Nuvo's schema is opinionated (energy, readiness, domain, key result) rather than user-extensible — consistent with P10/P11 | — |
| Projects / lists | ✅ | Full vertical: `lib/vertical.ts`, `projects`/`initiatives`/`domains` tables | — | — |
| …with custom sort | ⚠️ | `types.ts:62` `sort_order`; hand-order in the rail `LeftRail.tsx:114-119,424-446` + `hooks/useListReorder.ts`; inside a slot `SlideOver.tsx:2384-2389` | Sort is **hand-order only, and only in the rail/slot**. No sort-by-due-date/priority/name control anywhere. `floors/TaskList.tsx:156` even notes the project record's list has no reorder. | med |
| …with sections | ❌ | Rail "bands" (`useListReorder.bandOf`) are derived zones (inbox/today/scheduled), not user-created sections | Todoist sections / Things headings have no equivalent | low |
| Due date vs scheduled/start date | ✅ | `types.ts:40-43` — `do_date` (when you'll do it) vs `deadline` (when it's due) vs `start_time` (the block). Three distinct concepts, one more than most competitors. Overdue read `lib/dates.ts` `isOverdue` | — | — |
| Recurring tasks | ⚠️ | `types.ts:100-121` `Recurrence` + `hooks/useRecurrence.ts` (materialized occurrences, THIS/FOLLOWING/ALL scopes `types.ts:226`), `RecurringUpkeepPanel.tsx`, agent `toolDefs.ts:439` | **No "repeat N days after completion"** — the engine is anchor-driven (`_shared/recurrence.ts:66-120`), so a "water plants every 3 days *after I last did it*" task is unrepresentable. Same daily/weekly/monthly-only ceiling as events. | med |
| Dependencies / blocking | ❌ **(by design)** | Zero hits for `depends_on`/`blocked_by` | Single-player planner; readiness gating substitutes | — |
| Views: list | ✅ | `floors/TaskList.tsx`, `LeftRail.tsx`, `mobile/MobileTaskList.tsx` | — | — |
| Views: board / kanban | ⚠️ | `ondeck/GroomWall.tsx` (project-per-column grooming wall), `ondeck/InitiativeGroomWall.tsx`, `floors/WeekBoard.tsx` (week spread), `ondeck/OnDeckPlanner.tsx` (project × week) | These are *project*-level boards. There is **no task kanban by status** — and `floors/Collection.tsx:1-5` records that Board · Calendar · Timeline were **retired** from collections, leaving Table only. | low |
| Views: calendar overlay of tasks | ✅ | A scheduled task **is** a calendar block (`CLAUDE.md`; `types.ts:40-42`), rendered by `CalendarPane` `:1027-1040` and `mobile/dayPlan.ts:121` | Genuinely better than the competition here | — |
| Filters and saved / custom views | ❌ | Zero hits for `savedView`/`filterBy`/`activeFilter`; `Collection.tsx` filters projects/initiatives only; `LeftRail` tabs (Inbox/Week/Today) are fixed | No "@errand + high priority + due this week" query, no saved filter. Todoist/TickTick centre their whole UX on this. | med |
| Bulk actions | ⚠️ | `LeftRail.tsx:88` (`selectedIds`), shift-range `:89`, bulk bar `:730-775` — plan-today, back-to-inbox, complete, trash; collection marquee `hooks/useCollectionSelection.ts`, `floors/collectionSelection.tsx` | Four verbs only. **No bulk label, bulk priority, bulk project-move, bulk schedule.** No bulk actions on the phone. | med |
| Drag-to-reorder | ✅ | `hooks/useListReorder.ts` (pointer events — Tauri swallows HTML5 DnD, `:6-14`), `LeftRail.tsx:393`, ⌥↑/⌥↓ `:453-470` | Rail + slot children only | — |
| Snooze / defer | ⚠️ | Swipe-left on phone → tomorrow `mobile/MobileTaskList.tsx:72-73`; keys `E`/`T`/`N` (today/tomorrow/next week) `ShortcutsModal.tsx:51-53`; `R` reschedule picker | Presets only — no "snooze until <arbitrary datetime>", no snooze-with-reminder (there are no reminders at all). | low |
| Reminders / notifications | ❌ | Same as calendar — nothing exists | A task with a `deadline` will never tell you about it | **high** |
| Comments | ⚠️ | `record_comments` — `migrations/…31_project_log.sql`, `…32_record_log.sql` (project **or** initiative, `record_comments_one_parent`), UI `record/RecordLog.tsx`, `hooks/useRecordLog.ts` | **Tasks have no comments** — the constraint at `…32:14-16` allows exactly one of `project_id`/`initiative_id`. Task notes are a single text field. | low |
| Attachments | ❌ | Chat-only (`lib/agentAttachments.ts`) | — | low |
| Completion history | ⚠️ | `types.ts:46` `completed_at`; `lib/shipped.ts`, `floors/ShippedWall.tsx`/`ShippedRail.tsx`, week review `lib/weekEvidence.ts` + `migrations/…33_week_reviews.sql`, `floors/WeekArchiveGallery.tsx` | Rich at the week/project altitude. **No per-task history** — no "completed on <date>" log view, no streaks for recurring tasks, no per-task audit trail. | low |
| Archive | ⚠️ | Projects/initiatives: Park (waiting) / Resume / Ship — `lib/recordActions.ts:76-95`; weeks: `WeekArchiveGallery.tsx` | **Tasks have no archive and no trash view.** `status = "trashed"` (`types.ts:7`) is written but never *listed* — every surface filters it out (`CalendarPane.tsx:1027`, `MobileSearch.tsx:74`, `AgentRecordCards.tsx:141`). Once the 6-second undo toast expires, a trashed task is unrecoverable from the UI. | med |
| Search | ⚠️ | `lib/spotlightNav.ts:32-76` (⌘K + ⌥Space, tasks included `:34-46`), `mobile/MobileSearch.tsx` | Title-only substring match. **No notes-body search**, no label/date/status operators, no completed-task search (`buildSearchHits` walks `data.tasks`, which excludes trashed; done tasks depend on the snapshot window). | med |
| Keyboard shortcuts for core actions | ⚠️ | `ShortcutsModal.tsx:9-71` — views `S/W/D/M`, floors ⌘1–4, ladder ⌘↑/↓, capture `C`, ⌘K, ⌘J, ⌘,, `P`/`I`, and a full task row set (`J/K`, `E/T/N`, `F`, `R`, `I`, `X`, `#`, ⌥↑/↓); `?` opens the panel | Rail-centric. **Collection tables are keyboard-blind** (no arrow nav, no keyboard delete — flagged as open in `KEYBOARD_SHORTCUTS.md`). No shortcut to create an **event**. `KEYBOARD_SHORTCUTS.md` itself is stale vs `ShortcutsModal.tsx` (it documents `D`=done, the modal ships `F`). | low |
| Offline support | ✅ | `lib/sync/ops.ts:32-45` covers `tasks`, `task_labels`, `slots`, `recurrences`, `projects`, `initiatives`, `domains`, `key_results`, `labels`, `user_settings`, `record_comments`, `week_reviews`, `sprints`; client-generated ids `:11-16`; per-field LWW `:17-24`; IndexedDB `lib/sync/idb.ts`; honest copy `hooks/useOutbox.ts:24-35` | Genuinely strong — better than Todoist's model on conflict merge | — |
| Undo | ⚠️ | `hooks/useUndoStack.tsx` (30-deep, 6s toast, coalescing, tiers in `lib/undoTiers.ts`), ⌘Z global | **No redo** (`:184`). Undo is toast-scoped in practice. | low |

---

## CROSS-CUTTING (Nuvo's Calendar + Initiatives + Projects + Tasks model)

| Capability | Status | Evidence | Gap | Impact |
|---|---|---|---|---|
| Time-blocking: task ↔ calendar event, two-way sync | ⚠️ | **Inside Nuvo it's ✅ and better than the field** — a scheduled task *is* a time block, one `tasks` row (`types.ts:40-42`), rendered natively `CalendarPane.tsx:1027-1040`. Push to the native calendar: `supabase/functions/task-mirror/index.ts`, `slot-mirror/index.ts`. Conversions both ways: `CalendarPane.tsx:2253` (→ Event), `:2098` (→ Task) | The **external** half is one-directional and Google-only: `task-mirror/index.ts:8` — "Mirror writes are one-directional (app → Google); the app's version wins", gated on `mirror_calendar_id` which only `google-oauth/index.ts:125` ever sets. So (a) an **iCloud-only or M365-only user's blocks never reach their phone's native calendar at all**, and (b) moving a mirrored block in Google Calendar is silently reverted on the next reconcile. Also `task-mirror/index.ts:69` stamps `America/Los_Angeles` on every mirrored block. | **high** |
| Unified "what's on my plate today" | ✅ | One busy-model shared by every surface: `lib/now.ts` (`readDay`, `toBusyBlocks`), phone `mobile/dayPlan.ts:121` `buildDayPlan` → month/schedule/day all read it (`MobileCalendar.tsx:44,292,417,553`, `MobileDayView.tsx:155`); desktop Today rail `LeftRail.tsx`; week `lib/readiness.ts:208-255` | Tasks + events + slots + free gaps in one read. This is Nuvo's strongest area. | — |
| Mobile parity | ⚠️ | Very high overall: `MobileCalendar` (month/schedule/day), `MobileEventSheet` (edit, all-day toggle, location, recurrence THIS/ALL, RSVP, delete), `MobileNewEventSheet` (all-day, repeat, guests, Meet, calendar picker), `MobileTaskList`, `MobileRecordActions`, `MobileSearch`, harnesses at `?domains`/`?build` | Deltas: **no week grid on the phone**; **no bulk actions** (`LeftRail.tsx:730-775` has no mobile twin); no drag-to-create/resize on the calendar (defensible on touch); collection Table is desktop-only. Conversely the **desktop lacks the phone's agenda view**. | med |
| Agent tool coverage for the above | ⚠️ | 39 tools, `supabase/functions/agent/toolDefs.ts:44-891`. Covers: vertical CRUD (`:111-349`), tasks (`create_task :415`, `create_recurring_task :439`, `plan_task :461`, `schedule_task :477`, `unschedule_task :582`, `reschedule_task :596`, `complete_task :613`, `trash_task :627`, `move_to_inbox :641`, `update_task :655`, `list_tasks :795`), slots (`:494-568`), events (`create_calendar_event :694`, `move_event :673`, `reschedule_event :735`, `cancel_event :753`, `decline_event :774`), priorities (`:809-859`), contacts/invites (`:874-891`), UI (`point_at :44`) | **Human-only paths with no agent tool:** search events (none — `list_tasks` is tasks-only); **accept/tentative an invite** (only `decline_event` exists — the agent can say no but never yes); edit an event's location / notes / all-day flag (`create_calendar_event` accepts them, no updater does); duplicate anything; hide/show a calendar; edit or delete a **recurrence series** (it can create one, `:439`, but not change or end it); labels (`create_task.label_names :427` only — no add/remove on an existing task); bulk anything; reorder; `update_task` (`:655`) can't set `do_date`, `duration_minutes`, project/domain, or labels. **Agent-only, no UI twin:** none found — every writing tool has a surface. | med |

---

## Top 10 highest-impact gaps, ranked

1. **No reminders or notifications of any kind.** Nothing in `src` or `supabase` registers a
   notification, requests permission, or stores a lead time. A planner that holds your deadlines
   and your meetings and never speaks first is a planner you must remember to open — which
   quietly puts a second reminder system (the phone's) back in the loop. *Biggest single gap.*

2. **You cannot search the calendar.** `lib/spotlightNav.ts:22-28` and `mobile/MobileSearch.tsx`
   index four kinds — task, project, initiative, domain. Events are absent on every surface and
   from the agent. "When did I last meet Sam?" is unanswerable inside Nuvo.

3. **Task-block mirroring is Google-only and one-directional.** `task-mirror/index.ts:8` +
   `google-oauth/index.ts:125`: an iCloud-only or M365-only user's time blocks never leave Nuvo,
   and any edit made in Google is reverted on the next reconcile. Given iCloud *is* a writable
   provider (`lib/calendarWrite.ts:5-7`), this is an asymmetry, not a policy.

4. **Recurrence ceiling: daily / weekly / monthly-by-date only.**
   `_shared/recurrence.ts:8` + `RecurrencePicker.tsx:410,344`. No yearly (birthdays, renewals),
   no BYSETPOS ("last Friday of the month" — the shape most real standing commitments take),
   and no completion-anchored repeat for tasks. Also a lossy round-trip risk on ALL-scope edits
   of inbound Google series.

5. **No subtasks or checklists.** `lib/types.ts:32-69` has no `parent_task_id`. The funnel gives
   you project→task, but not a checklist inside a task — a table-stakes affordance in Todoist,
   Things, TickTick, and Microsoft To Do.

6. **No filters or saved views.** Zero hits for `savedView`/`filterBy`. Fixed tabs only. As soon
   as the task count outgrows the rail there is no way to ask a question of your own list.

7. **Undo is partial and there is no redo.** `useUndoStack.tsx:184`. Calendar undo covers drag and
   resize (`CalendarPane.tsx:1395-1518`) but not create, delete, RSVP, move-to-calendar, or field
   edits — and `useCalendar.ts` records no undo at all. Event deletes are explicitly permanent.

8. **Trashed tasks are unrecoverable after ~6 seconds.** `status = "trashed"` is written but never
   listed — `CalendarPane.tsx:1027`, `MobileSearch.tsx:74`, `AgentRecordCards.tsx:141` all filter
   it out and no surface offers a trash view or restore. Data loss with no visible floor.

9. **RSVP is Google-only, and the agent can only decline.** `useCalendar.ts:277` hardcodes
   `google-events`; `toolDefs.ts:774` ships `decline_event` with no accept/tentative counterpart.
   An iCloud or M365 invite is read-only, and "accept that meeting" is not a thing you can say.

10. **View coverage is split across shells.** No agenda/list on desktop, no week grid on the phone
    (`CalendarPane.tsx:39` vs `MobileCalendar.tsx:64`), no year view anywhere, and no attendee
    free/busy (`freeBusy` matches nothing) — so scheduling with guests is blind.

**Just below the line:** no `.ics` import/export, M365 write-back, no event duplication
(`CalendarPane.tsx:1975-2170`), no per-event timezone, external-event writes non-queueable offline
(`lib/sync/ops.ts:32-45`), bulk actions limited to four verbs and desktop-only.

**Excluded as correct product decisions:** calendar sharing / permissions (single-player),
custom fields, task dependencies, per-task comments.
