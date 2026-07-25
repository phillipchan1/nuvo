# Product principles — the doctrine

**Status:** canonical (2026-07-25) · **this is the audit standard.**

Each principle has a **rule**, a **why**, and a **violated when** — the last one is what
makes it testable. During an [audit](./audit.md), walk this list and try to find one real
violation of each. If you can't find any, either the app is in good shape or you're not
looking hard enough (assume the latter first).

Changing a principle is a big deal. Log it in [`decisions.md`](./decisions.md).

---

### 1 · One row of truth — a scheduled task *is* a time block

**Why.** Every cheap thing downstream — rollover, the mirror calendar, capacity math, the
Review's evidence — is cheap *because* there's one entity. A second entity for "events made
from tasks" would double every sync path and quietly break the arithmetic.
**Violated when** a feature needs its own shadow copy of a task, or a screen shows a block
that isn't a `tasks` row.

### 2 · The Week is the only gate

**Why.** The gate is what makes commitment mean something. If work can reach a day without
passing through a week you committed to, the Sunday number is a lie.
**Violated when** a surface writes `do_date` on something with no `sprint_id`, or a
"quick add to today" bypasses the week. *(Legitimate exception: same-day reactive capture —
but it should be visible as a deviation, not invisible.)*

### 3 · Nuvo proposes; you promote

**Why.** The product exists to build judgment, informed — not to replace it. The moment the
assistant moves work toward the calendar on its own, the user stops being the hero of the
story ([`brandscript.md`](./brandscript.md) §9, the Hero test).
**Violated when** anything AI-generated appears anywhere except a quiet pool, or an
"accept" step is removed for convenience.

### 4 · The app reports; you decide

**Why.** Nuvo is a steward's instrument, not a coach. It never commands, never shames,
never auto-acts. Readiness is a *thermometer*.
**Violated when** copy uses imperatives at the user ("You need to groom 4 projects"),
red-alert styling appears for a non-urgent state, or a count of undone things is presented
as debt.

### 5 · Capture is free text; forms are the fallback

**Why.** The cost of entry determines whether the funnel has anything in it. Free text (and
dictation) is the front door: `call David tomorrow 9am 30m #church !high`.
**Violated when** a new object can *only* be created through a form, or an input isn't a
plain `<input>` (breaking iOS dictation), or a required field blocks a capture.

### 6 · Evidence over vibes

**Why.** The one thing Nuvo has that self-report doesn't: completed blocks. Calibration,
the Review, pace, and the Find all stand on measured deltas.
**Violated when** a number is estimated where it could be measured, a narration says
something the data doesn't support, or a Find is manufactured because the slot exists.
*Corollary: when there's no history, say so — never guess.*

### 7 · Useful on day one, with an empty backlog

**Why.** The strongest switching anxiety is "another system I'll abandon" ([`personas.md`](./personas.md) §6).
Any feature that only works once everything is groomed is a feature that never turns on.
**Multi-tenant raises the stakes:** the builder's account is never empty, so day-one
breakage is invisible to the only person who tests. Pair this with Principle 16.
**Violated when** a surface is empty, broken, or misleading without clean data — and
doesn't degrade to something honest and useful.

### 8 · Every surface answers exactly one question

**Why.** The vertical has five altitudes; confusion is the default failure mode. A screen
that answers three questions answers none.
**Violated when** you can't state a surface's question in one sentence, or two surfaces
claim the same question.

### 9 · Quiet by default

**Why.** The identity is *steward*, not *optimizer*. No streaks, no badges, no
notification theater, no gamified debt. Signal is reserved for **now** (`--signal`).
**Violated when** something animates, colors, or notifies for engagement rather than
information.

### 10 · Don't add a pool, a name, or a place without paying for it

**Why.** The funnel's power is its small vocabulary: four pools, five altitudes, a handful
of ceremonies. Each addition taxes every future feature and every explanation.
**Violated when** a proposal introduces a fifth pool, a new noun that overlaps an existing
one, or a sixth navigation destination. *The bar: a new abstraction needs a **second
instance** to justify it — the way [activity sources](../activity-sources.md) earned its
name only because the calendar had already proved the pattern.*

### 11 · Human language, one name per thing

**Why.** Code drift is fine (`big_rocks` → "Priorities") *if it's written down.* Undocumented
drift is how a team ends up with three names for one object.
**Violated when** a user-facing name has no [`glossary.md`](./glossary.md) entry, or two
surfaces call the same thing different things.

### 12 · Single-player by design, multi-tenant by deployment

**Why.** No assignees, no permissions, no consensus objects — *inside a funnel*. That's the
constraint that lets every altitude stay sharp, and none of the arithmetic (pace, demand ÷
capacity, calibration) survives a task whose progress depends on someone else's update.
**Serving many independent accounts is orthogonal and fine** — see
[`overview.md`](./overview.md) §2.1. Don't defend "single-user" when you mean
"single-player"; the first is a deployment detail, the second is the product.
**Violated when** a design assumes someone else will update state, a field exists only to
communicate to another person, or an argument against a feature rests on "we're
single-user" when the real objection is shared objects (or when there is no objection at
all).

### 13 · Mobile-ready by default

**Why.** The week doesn't wait for a laptop. Same components, two shells.
**Violated when** any of the [root `CLAUDE.md`](../../CLAUDE.md) golden-rule checks fail:
horizontal scroll at 375px, tap targets under 44px, hover-only affordances, or a
cursor-anchored popover on a phone.

### 14 · Warm Paper — dissolve, don't frame

**Why.** One continuous sheet of paper, written on with an editorial hand; the things you
touch lift toward you. The full grammar is [`design-language.md`](../design-language.md).
**Violated when** an opaque `bg-*` paints over `.atmosphere`, a hero isn't Fraunces, a flat
focus ring replaces the lift, or a raw hex appears instead of a token.

### 15 · Protect the boring core

**Why.** TanStack Query + Supabase Realtime invalidation, a static SPA, no router, no server
runtime. Boring on purpose — it's what makes two shells from one bundle possible.
**Violated when** a feature needs a server runtime, a router, or a new state library.

### 16 · Every account is a stranger's

**Why.** The product is built by one of its users, which is a superpower for taste and a
trap for defaults. Anything that works *because the builder knows their own life* — their
domains, their timezone, their working hours, their calendar provider, their vocabulary —
silently fails for everyone else, and fails **invisibly**, because the person who'd notice
never signs up.
**Violated when** a default encodes one operator's life as the model (the four seeded
domains — fixed in D-026; a hardcoded timezone and assumed working hours — **still open**,
Q-07); a surface needs knowledge that only exists in the builder's head; a flow assumes
existing data, a connected calendar, or a prior week; or copy addresses the reader as
though they already know the system's nouns.
**The test:** *would this be true and usable in a brand-new account belonging to someone
you've never met?* If you can't answer, you haven't tried it — make a fresh account and
find out. (This is the "stranger pass" in [`audit.md`](./audit.md).)

Ask, in order:

1. **Which principle does this strengthen?** (If none — is it just a convenience? Say so.)
2. **Which principle does it strain?** (Most good ideas strain one. Name it.)
3. **Is the strain worth it, and what's the mitigation?**
4. **Log it.** A knowingly-accepted strain goes in [`decisions.md`](./decisions.md) so the
   next person doesn't "fix" it by accident.

The failure mode isn't violating a principle — it's violating one **without noticing.**
