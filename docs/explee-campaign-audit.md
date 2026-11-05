# Explee campaign audit — Event Owner App

Read-only audit of the six campaigns in project `62991` (`eventownerapp.com`), done
2026-11-05. It covers the campaign definitions, the project-level "My copy", the
generated first emails (previewed), the sender identity and the suppress lists.

**Nothing was changed by this audit.** Anything that edits targeting drops the
leads the campaign has not contacted yet, so those fixes are written as proposals.

## At a glance

| # | Campaign | Status | Leads | Targeting | Copy | Verdict |
|---|---|---|---|---|---|---|
| 374529 | Small venues | review | 84 | Good | Generic | Usable after copy fix |
| 374530 | Wedding planners | review | 0 | Good | Generic | Usable after copy fix |
| 374531 | Naming Ceremony Hosts | review | 61 | **Broken** | Generic | **Archive** — consumer audience, empty role |
| 374532 | Naming ceremony planners | review | 325 | Fair | Generic | Narrow the audience, then usable |
| 374533 | Church event teams | review | 3,544 | Broad | Fair | Best segment, needs role + copy fix |
| 374534 | Brides and couples | review | 0 | **Broken** | Generic | **Archive** — consumers are not in a B2B graph |

Project totals at audit time: 0 emails sent, 0 replies, $0 spent, 4,014 leads
collected. Autopilot is off and the project budget is $0, so none of this is
sending.

## Critical findings

### 1. The sender has no name, so every email invents a different one

`GET /projects/62991/sender-name` is empty. The generated copy then signs itself
with a random name per email. Three samples from **the same campaign**:

- "I'm **Finn** at Event Owner App … Best, **Finn Turner**"
- "I'm **Leo Brooks** at Event Owner App … Best, **Leo Brooks**"
- "I'm **Mia Bennett** at Event Owner App … Warmly, **Mia Bennett**"

A recipient who gets two touches sees two different people from the same company.
That is a deliverability and trust problem, and replies land in one inbox with no
clear owner. Fix before any send:

```http
PUT /public/api/v1/autogtm/projects/62991/sender-name
{"sender_name": "Daniel"}
```

### 2. All six copy briefs are empty

Every campaign has `instructions: ""` and `followup_instructions: ""`, and the
project My copy has `body: ""` with the default subject template
`{{sender_company}} x {{company}}`. The model writes freely from the campaign
name and offer.

The consequence is visible in the previews: **the one-time per-event pricing** —
Event Owner App's main differentiator against subscription tools — appears in
only one of three emails. Gift registry and event shop appear sporadically. There
is no proof point and no fixed call to action.

### 3. Two campaigns target consumers, which this data source cannot see

`search/people` returns **employees at companies** with a LinkedIn profile. It has
no consumers.

- **Brides and couples** targets "first-time brides in Lagos", "engaged couples in
  Abuja" — consumer descriptions, not companies. Result: **0 leads**, and it will
  stay at 0 however long it runs.
- **Naming Ceremony Hosts** targets families hosting a naming ceremony, with an
  **empty `target_role`** and consumer `example_clients` ("new parent families in
  Lagos"). Result: 61 leads, the weakest pool of the six, and most of them will be
  business people matched on weak signals rather than actual hosts.

These two are spending discovery effort on an audience the API structurally
cannot serve. Archive them, or re-point them at the businesses that serve those
audiences (planners, venues, churches) — which the other campaigns already do.

### 4. Subject lines repeat inside the same campaign

Two of three church samples use the subject **"Guest check-in"**; the third uses
"Sunday services". Generic, duplicated subjects look automated and suppress opens.
The copy needs an explicit subject instruction with a named benefit, e.g.
"Guest check-in for {{company}}'s Sunday services".

### 5. The call to action asks for permission, not a meeting

Every sample ends with "Could I send you a few short written ideas…". That is a
low-commitment CTA, but it starts a second loop (they say yes, you send ideas, you
ask again) and there is no booking link anywhere. For a self-serve, per-event
product the stronger ask is a 15-minute walkthrough or a link to the event-type
page.

### 6. Church campaign reaches pastors, not the event team

`target_role` asks for people who "coordinate church events and lead volunteer
teams". The previewed leads are senior pastors ("Farmer Majesty Ogude", "Gideon
Oloyade", "Paul Akeredolu"). The copy then talks about "your volunteers" and
"your protocol team" — plausible, but the person who chooses check-in software is
usually the admin/protocol/events lead, not the lead pastor. 3,544 leads at this
precision is a lot of noise.

### 7. Three pairs of campaigns overlap

- **Church event teams** vs **Small venues** — churches with halls are venues.
- **Wedding planners** vs **Brides and couples** — same wedding audience.
- **Naming Ceremony Hosts** vs **Naming ceremony planners** — same ceremony, two slices.

Overlap is exactly how the same person gets contacted twice. Explee does not
dedupe across campaigns on its own. This repo's new discovery path dedupes
locally (CRM + persisted memory), but these six campaigns remain independent.

### 8. Small copy and delivery settings worth fixing

| Setting | Current | Recommended | Why |
|---|---|---|---|
| `language` | `auto` | `en-GB` | Nigerian leads are English; auto can flip language on mixed profiles |
| Schedule | Mon–Fri + **Sun** | Mon–Fri | Sunday is a church's busiest day and a venue's event day |
| Follow-ups | 2 touches, 3 days | 2 touches, 3–4 days | Fine; needs a brief so the nudges are not generic |
| Copy briefs | empty | see below | Pricing and product surface are being lost |
| Suppress lists | **none** | add existing customers | Nothing stops outreach to people already using Event Owner App |

No suppress list exists for people or companies. If outreach ever runs, existing
customers and active deals are fair game. That is the first list to create.

## Suggested copy brief

Paste into the project's My copy (applies to every campaign) or per campaign via
`PATCH /autogtm/campaigns/{id}` → `instructions`.

> You are writing a short first email on behalf of Event Owner App, an all-in-one
> event planning app for hosts and planners: invitations, gifts, check-ins,
> seating and an event shop in one place.
>
> Lead with one concrete detail from the lead's own event operation. Then make the
> single most important point: **pricing is one flat fee per event, not a monthly
> subscription** — so a host pays for the event they are running, not for a tool
> they use twice a year.
>
> Choose one benefit that fits the recipient (guest check-in, seating, gift
> tracking, or the event shop) and name it. Do not list all five.
>
> Subject: 2–5 words, specific to their event, no clickbait, never repeat the same
> subject across a campaign.
>
> Call to action: offer a 15-minute walkthrough, or a link to the page for their
> event type. One ask only.
>
> 90–130 words. Plain text. British English. No emoji, no exclamation marks, no
> "I hope this finds you well". Sign off with the project sender name only.

Follow-up brief:

> One short nudge, 40–60 words, adding one new fact (the per-event fee, or the
> event shop). No guilt, no "just following up", no second pitch. Make it easy to
> say no.

## Per-campaign recommendation

| Campaign | Action |
|---|---|
| Church event teams | Keep. Change `target_role` to admin/protocol/events lead; raise `min_relevance`; fix sender name and copy before any send. |
| Wedding planners | Keep. Copy fix. Pool is still empty — it is the next useful discovery target. |
| Small venues | Keep. Add "has event/banquet space" to positive criteria; copy fix. |
| Naming ceremony planners | Keep but narrow to planners who explicitly list naming/child dedication ceremonies; remove consumer-style `example_clients`. |
| Naming Ceremony Hosts | **Archive.** Consumer audience, empty role, 61 low-quality leads. |
| Brides and couples | **Archive.** Consumers are not in the people graph; 0 leads after a full search. |

Example correction for the church campaign (this **drops uncontacted leads** and
triggers a new search, so only do it if outreach will run):

```json
PATCH /public/api/v1/autogtm/campaigns/374533
{
  "target_role": "Church administrator, events coordinator, protocol lead or operations pastor who owns guest check-in and seating",
  "negative_criteria": [
    "single small prayer group",
    "no regular public gatherings",
    "no venue or hall",
    "purely online congregation"
  ]
}
```

## What this means for the new discovery-only setup

You are not going to run outreach through Explee, so the campaigns are now only a
historical lead pool. The important conclusions carry over:

1. **Do not approve or start any of them.** Autopilot is off and the budget is $0;
   keep it that way.
2. **The two consumer segments are a dead end** for any Explee search. Find the
   businesses around those consumers instead (planners, venues, churches) — that
   is what the search endpoints can return.
3. **Dedupe has to be ours, not Explee's.** See
   `docs/explee-integration.md` §3.6 — using Explee's `exclude_lists` turns off
   the free-results zone, which would make every search paid.
4. **Set the sender name and a suppress list before anyone ever presses send**,
   even if that is months away. Both are free and take one call.
