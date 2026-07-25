# Activity Sources — actuals from the world, GitHub being one

*Design proposal · June 2026*

This sits beside [`readiness-model.md`](./readiness-model.md) (the funnel made visible) and
[`priorities-and-projects.md`](./priorities-and-projects.md) (the binding model), and reuses the
calendar-allocation machinery already in `supabase/functions/google-events/` +
`route-events`. Read [design-language.md](./design-language.md) for the visual grammar.

> **Thesis.** Some of your most significant work never becomes a task and never gets
> accounted for — you *build* it. An **activity source** is any external feed of
> *completed* work that Nuvo can pull, attribute to your hierarchy, and surface as
> **actuals** (what happened) rather than tasks (what's planned). GitHub is one source.
> The calendar was the first. You are not adding "a GitHub feature" — you are naming the
> pattern the calendar already proved.

---

## 1 · Not a new abstraction — the second instance of one you have

The calendar feed is already an activity source. Attended events are timestamped units of
*what actually happened*, routed to a domain through a mapping key
(`account_id:calendar_id → domain`), with an AI router (`route-events`) for the ambiguous
ones (see [Nuvo calendar allocation]). It just looks like "a calendar feature" because
it's the only one.

GitHub is the **second** instance. Merged PRs are timestamped units of completed work,
routed to a project, with the same AI fallback for cross-cutting repos. Two real instances
is exactly when you name the pattern — not zero (speculative), not five (too late).

```
activity source = a feed of completed work, each unit timestamped + routable
   calendar  → attended events     (source #1, shipped)
   github    → merged PRs          (source #2, this doc)
   …future   → posts · workouts · PCO service · …  (each domain wants one)
```

Every domain wants *some* actuals source — that's the proof this isn't pigeonholing.
GitHub isn't "the dev feature"; it's the source that happens to serve **First Light**, the
way a fitness source would serve Health or PCO activity would serve Faith.

## 2 · The unit, and why it's *merged PRs*

The unit must be a *thing you built*, not activity. Commit counts are noise and a
contributions graph is exactly the dashboardy stat the [Weekly Review] work cut. The
right unit for GitHub is the **merged PR**: titled, human-authored, one-per-feature.

> A merged PR titled `feat: weather + execution coach` **is** the sentence "I shipped a
> significant thing." That's a ledger of outcomes, not surveillance.

**Consequence — picking this unit picks a lightweight ship ritual.** Today the repos push
straight to `master` with no PRs, so the feed would start empty. That's not a tax; it's
the feature: opening + merging a PR (even solo, even squash-to-master) becomes the one
deliberate "this is done" gesture, and its title is the ledger entry. Commit-as-you-go
stays noise; the PR-merge is the punctuation that means *a real thing got built*.

The trade you accept: anything you don't PR stays invisible. For First Light that's fine —
if it wasn't worth a PR, it wasn't a shipped thing.

## 3 · Binding — bind at the natural altitude, let rollup carry the rest

"Connect a domain *or* initiative *or* project to a repo?" feels too specific because it
asks you to choose an altitude. Don't. **A repo ≈ a project** (the Nuvo repo *is* the Nuvo
project), so:

- **Bind repo → project.** One concrete decision, no altitude guesswork.
- A merged PR lands on that **project** as a unit.
- The project already rolls up to its **domain** through the existing hierarchy —
  First Light's Motion / faithfulness inherits the activity automatically. You never feed a
  domain directly, any more than you attach a task to a domain.
- Cross-cutting repo? The PR carries a label / `!domain`, and the AI router re-homes the
  odd ones — the same escape hatch as `route-events`.

The specific binding stops feeling specific because it's just *where the source plugs in*,
not *what the work means*.

## 4 · What "activity" looks like — normalized shape, source-aware reading

A unit normalizes to one common shape so every surface can render any source:

```
activity_unit
  id            (internal)
  external_id   (PR node id — idempotent dedup key)
  source_kind   'github' | 'calendar' | …
  title         "feat: weather + execution coach"   ← human-authored
  occurred_at   merged_at
  url           link back to the PR
  project_id    routed target (domain inherited via rollup)
  raw           jsonb (source payload, for re-interpretation later)
```

The *shape* is shared; the **reading is per-source**, driven by `source_kind`:

| source_kind | verb | unit reads as | Reflect theming |
|---|---|---|---|
| `github` | **shipped / built** | "shipped: weather widget" | "what you built" — features, grouped by app |
| `calendar` | **spent / attended** | "2h on Meridian review" | "where your hours went" |
| *future* `posts` | **published** | "published: …" | "what you put out" |

So yes — it's interpreted differently per source, but only at the *verb + render* layer; the
storage and routing are uniform. That's what lets "features I've built in **every** app"
become a single section: it's just `activity_unit where source_kind='github'` grouped by
project (= app), themed by the AI into outcome language.

## 5 · The surfaces

**Domain actuals (continuous).** Each merge drops a unit into First Light's Motion /
faithfulness — the domain visibly moves even with **zero tasks attached**, which is the
exact gap this solves. Same channel attended events already feed; GitHub is one more `kind`.

**Reflect / Weekly Review (the prize).** The week's merges get AI-themed into a short,
human ledger — *outcomes, not counts*:

> **This week in First Light you shipped** — weather widget · marquee canvas takeover ·
> execution coach.

Grouped by project (app). This is the [Weekly Review] "what actually happened" section,
finally able to account for the building that was always happening off-book. Per
[human drives, Nuvo enriches]: **GitHub is the signal; the AI is only the interpreter** that
turns merged PRs into "here's what you built."

Quiet by default — no live counter ticking up, no graph. Actuals accrue silently; Reflect is
where they're read back.

## 6 · Integration — what you actually need (and what you don't)

> **⚠️ Reasoning updated 2026-07-25 (D-024).** This section argued from "Nuvo is
> single-user." That's now imprecise: Nuvo is **single-player but multi-tenant** — many
> independent operators, each with their own account
> ([`product/overview.md`](./product/overview.md) §2.1). **The conclusion below survives
> the correction** — a per-operator fine-grained PAT is exactly the shape iCloud already
> uses (each operator pastes their own credential, stored in Vault, no app registration).
> What changes: the phrase *"the only user is you"* is wrong, "if you ever multi-user"
> should read **multi-player**, and the GitHub App option becomes the right answer only if
> we ever want org-wide install or webhooks — not merely because there's more than one
> account.

**You almost certainly do not need GitHub OAuth.** The auth choice collapses because each
operator connects their own repos with their own credential:

- **OAuth App ("Sign in with GitHub")** — the 3-legged flow. Worst fit here: most
  machinery, fewest benefits. Skip.
- **GitHub App** — webhooks, per-repo install picker, short-lived tokens. The right answer
  *if* we ever want org-wide installs or push-based freshness. (Jump straight here and skip
  OAuth App entirely.)
- **Fine-grained PAT** — ✅ each operator generates a token scoped to exactly the repos
  they want, read-only on Pull Requests, pasted into their own Nuvo settings. No callback,
  no app registration. **Same "paste a credential" shape as the iCloud app-specific
  password**, and it scales per-account without a central app registration.

Almost every other piece already exists in calendar sync — this is the known pattern wearing
a new `kind`:

| Piece | What it is | Reuse from |
|---|---|---|
| **Token storage** | PAT in Supabase Vault, RLS-protected | calendar token / Vault pattern (mind the placeholder-freeze trap in [calendar sync]) |
| **Pull** | cron edge fn polls `pulls?state=closed`, filters `merged_at > cursor` | calendar read-sync polling |
| **Routing** | merged PR → project (repo binding); domain inherited | `route-events` AI router + `calendar→domain` map shape |
| **Dedup** | one unit per PR, keyed on PR node id | event title-dedup (cleaner key here) |

Merged PRs are low-volume → **polling a few times a day (or daily) is plenty**; no webhooks
for v1. (You *can* add a single repo webhook → edge fn later without a GitHub App, but don't
bother yet.)

## 7 · Setup UX — beautiful, and easy by design

Setup reduces to **two affordances** (connect once, bind per project), but the quality is
all in the *friction* — and the only genuinely friable step is getting a token out of
GitHub. The design principle throughout: **recognize, don't make them type; validate
instantly; end on a moment of payoff, not a form.** Warm Paper rules apply (transparent
surfaces, glass for floating records, masthead heroes, hairline rows, semantic color, mono
numerics; `Modal` on desktop / `Sheet` on mobile per CLAUDE.md).

> **IA note (shipped).** Calendars and activity sources are different kinds of thing — a
> calendar is a *read-sync time source you write back to*; an activity source is a *feed of
> completed work*. So Settings splits them: a **Calendars** section and a separate
> **Integrations** section (where GitHub lives, and future Strava/PCO). Don't fold activity
> sources back into the calendar pane.

### 7.1 · Connect (global, once) — Settings → Integrations

The token is the hard part, so **guide it, don't dump them in GitHub's settings.** A single
`.glass-card` with three calm states:

**a · Invite.** `section-label` eyebrow "ACTIVITY SOURCES" → a one-line *"Bring your shipped
work into Nuvo."* → primary `--accent` button **"Connect GitHub →"**.

**b · Guided token.** Tapping it doesn't show a bare paste box — it shows a 3-step plaque +
a button that **deep-links straight to GitHub's fine-grained-PAT page with the name and
description pre-filled** (`…/settings/personal-access-tokens/new?name=Nuvo&description=…`).
The two things GitHub *won't* let us pre-fill become an exact, glanceable checklist so there
is zero guesswork:

> **1.** Open GitHub → *(button)*  **2.** Repository access → **Only select repositories**  ·
> the ones you want tracked  **3.** Permissions → **Pull requests: Read-only**

Then one paste field. (A fine-grained PAT scoped to *only select repos* means the token can
see *only* what you chose — the bind list later is naturally short, and nothing else leaks.)

**c · Validate on paste — the trust moment.** On paste, immediately `GET /user`. No "Save"
button. On success the card settles into a glass record: the **avatar + "Connected as
@philchan"** + a hairline + the repos it can see (mono count). It *worked*, visibly, in one
beat. On failure: a quiet inline `--signal` line ("That token can't read pull requests —
check step 3"), never a toast-and-lose-it.

### 7.2 · Bind (per project) — "Track activity from…"

In project settings, one row. Three states, each obeying low-data-entry:

- **Empty (nothing connected)** → a calm line *"No activity source yet"* + a
  **Connect in Settings →** link that deep-links to 7.1. The project never dead-ends.
- **Connected, unbound** → **"Track activity from…"** opens a `Sheet` (mobile) / popover
  (desktop) of the connection's repos as glass rows (name · last-pushed `mono`). Pick one.
  **Recognize, don't search:** if a repo name matches the project name, it floats to the top
  pre-highlighted with a `--slot` (proposed) tint — *"This looks like the **nuvo** repo —
  track it?"* — one tap to confirm. (Recognize-never-classify, same rule as priority
  binding.)
- **Bound** → a settled glass record row: repo name, `12 shipped · last 3d ago` (mono),
  domain-color edge inherited from the project, and a quiet unbind. Generically labeled so
  source #2 ("Track activity from… Strava / PCO / …") reuses the exact control.

### 7.3 · The payoff — end on a moment, not a form

The instant a repo binds, fire the first pull and **return a moment, not a spinner-then-
silence.** A warm `.glass-card` confirmation themed by the AI:

> **Found 14 things you've shipped here.**
> *weather widget · marquee canvas takeover · execution coach — and 11 more.*
> *They'll show up in your Weekly Review.*

That's the peak (peak-end rule): setup *ends* by proving the value, listing real titles you
recognize, and pointing at where they'll live. From then on it's silent — actuals accrue,
Reflect reads them back. No live counter, no dashboard.

Behind all three: pull → route → dedup → actuals + Reflect — the calendar pattern with a
different `kind`.

## 8 · Code shape

- **Generic seam, concrete implementation.** Name the storage `activity_source`
  (`kind`, token ref, repos) + `activity_unit` (§4) — generic — but ship exactly *one*
  concrete GitHub puller. **No** plugin interface, source registry, or config UI for
  hypothetical sources. Source #3 = a new `kind` + a new pull fn, not a migration.
- **New edge fn `github-activity/`** — mirrors `google-events/`: read the bound repos, pull
  merged PRs since cursor, upsert `activity_unit` by `external_id`, hand cross-cutting ones
  to the router. Cron-scheduled.
- **Reuse routing** — extend the `route-events` AI router to accept a `github` unit; the
  `calendar→domain` map generalizes to `source→project`.
- **Reflect surface** — the AI theming pass groups `source_kind='github'` units by project
  into the "what you built" section ([Weekly Review]).
- **Mobile-ready** — the connection + binding controls reflow to one column; Reflect already
  has a mobile path. Verify at 375px per CLAUDE.md.

## 9 · Implementation status — DEPLOYED 2026-06-29

Migration `00000000000028_activity_sources.sql` **applied to remote** (three tables + RLS +
daily poll cron, verified queryable). Edge fn `supabase/functions/github-activity` **deployed**
(`connect` / `repos` / `sync` / `theme` / `disconnect`; cron calls `sync`; uses the existing
`OPENAI_API_KEY` for `theme`). Live to use: Settings → **Integrations** → Connect GitHub, then
a project's "Track activity from…".

> Deploy gotcha for next time: the remote DB was behind by an out-of-order/duplicate migration
> `25` (`okr_alignment` shares version 25 with `hidden_events`) + an unpushed `27`. A plain
> `db push` halts on the out-of-order `25`; `--include-all` risks a duplicate-version conflict.
> Pushed `28` surgically by stashing `25_okr_alignment` + `27_default_calendar` out of the
> migrations dir, `db push`, then restoring. **The duplicate-`25` is still unresolved** — worth
> renumbering `okr_alignment` to a free version so future pushes aren't blocked.

What's wired:
- **Storage** — `00000000000028_activity_sources.sql` (three tables, RLS, daily cron).
- **Edge fn** — `github-activity/index.ts` (PAT→Vault, repo fetch, merged-PR pull via the
  search API, idempotent upsert on the PR node id, AI `theme`, cron-wide `sync`).
- **Client** — `src/lib/types.ts` (ActivitySource/Binding/Unit), `src/hooks/useActivity.ts`
  (queries + connect/disconnect/bind/unbind mutations).
- **Connect** — `src/components/GitHubConnect.tsx` in Settings → Connections (guided token,
  validate-on-connect, connected row). *Verified rendering in the dev app.*
- **Bind** — `src/components/floors/ProjectActivityBind.tsx` on the Project floor ("Track
  activity from…", name-match suggestion, empty-state → Settings, bound row + "stop tracking",
  the "found N shipped" toast).
- **Motion** — `lastActivityByProject` threaded through `buildVertical` → `standing.ts` so a
  project reads as *moving* on a merged PR even with no completed tasks. Additive; defaults to
  empty so behavior is unchanged until units exist.
- **Reflect** — `src/components/floors/WhatYouBuilt.tsx` in the Week's Plan / Review ("What you
  built", grouped by project, AI-themed, self-hides when empty).

## 10 · Build order

1. **Storage + binding** — `activity_source` / `activity_unit` tables; project ↔ repo
   binding; Settings PAT connect + the project "Track activity from…" control with its empty
   state. (client + migration)
2. **Pull** — `github-activity/` edge fn: poll merged PRs, upsert units, cursor. (edge —
   NEEDS DEPLOY)
3. **Route** — merged PR → project; AI fallback for cross-cutting repos. (edge)
4. **Surface** — domain actuals (continuous) + Reflect "what you built" theming. (client)

Every slice ships mobile-ready and is verified in the running dev app (see CLAUDE.md).

---

### Open knobs (tune against the running app)

- **PR vs richer unit** — start merged-PRs-only; revisit if too coarse/sparse (e.g. add
  releases, or an AI weekly digest of raw activity for repos you push straight to `master`).
- **Poll cadence** — daily vs a few-times-a-day; merged-PR volume is low.
- **Reflect grouping** — by project (app) vs by domain vs flat outcome list.
- **Cross-domain repos** — label/`!domain` on the PR vs always-route-by-AI.
