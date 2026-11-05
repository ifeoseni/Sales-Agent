# Explee API — integration notes for Event Owner App

Reference for wiring [Event Owner App](https://eventownerapp.com) into the Explee API.
Everything below was verified against the live API and the official schema on 2026-11-05.

> **This integration is discovery-only.** It generates leads and enriches contacts on demand.
> It never starts Explee campaigns or sends outreach. The operator-facing guide is
> [`explee-user-guide.md`](explee-user-guide.md); this file is the technical reference.
> The project's six campaigns remain in `review`, autopilot is off and the project daily
> budget is `$0`.

**Official docs**

| Resource | URL |
|---|---|
| Interactive reference | https://api.explee.com/public/api/docs |
| OpenAPI schema (machine-readable) | https://api.explee.com/public/api/openapi.json |
| LLM quick guide | https://api.explee.com/public/api/llms.txt |
| API keys | https://explee.com/app-auto-gtm/api-keys |
| Billing / top-up | https://explee.com/app-auto-gtm/billing |

**Account as checked on 2026-11-05**

- Organization: `daniel@codetechcl.com's Organization`
- Plan: `free`
- Balance: **3,000 credits = $30.00**
- Rate limits: 10,000 req/hour, 150 concurrent, heavy-read concurrency 4
- Free-zone limits (free plan): **50 requests/day, 10/minute**

```
Base URL : https://api.explee.com
Header   : X-API-Key: <your key>
Paths    : /public/api/v1/...
```

---

## 1. What is actually free (read this before designing anything)

The "first 100 results free" figure is **not** what the API documentation says. The
OpenAPI schema for both search endpoints is explicit: **the first 10 results per
request are free**, then per-result credits apply. The free *allowance* is capped by
plan at 50 free-including requests/day on the free tier, so the practical ceiling is
roughly **500 company or people results per day** — not 100.

| Capability | Cost | Notes |
|---|---|---|
| `POST /search/nl-to-filters` | **Free** | Parses natural language into search filters. No credits. |
| `POST /search/companies` | **First 10 free**, then 0.5 cr/company (+0.1 per criterion) | Free zone needs a positive balance |
| `POST /search/people` | **First 10 free**, then 1.0 cr/person (+0.1 per criterion) | Free zone needs a positive balance |
| `POST /search/companies-by-domains` | 0.5 cr per company found | 0 for domains not found |
| `POST /enrich/email` | **1.5 cr basic / 5 cr premium**, per email *found* | Not free. Not found = 0 |
| `POST /enrich/phone` | **15 cr basic / 30 cr premium**, per phone *found* | Not free. Not found = 0 |
| `POST /find-and-enrich` | Search free, **1.5 cr per email found** | Async, max 500 per call |
| Outreach (campaigns, inbox, budgets, analytics) | **Free to call** | Reading/controlling is free |
| Outreach sending | **$0.04 per email sent** | Replies are free |
| Campaign import from your own list | **Free** | Sending still billed per email |
| Attachments, replies, notes, webhooks | Free | |

### The hard consequence

**A person's email address is never free at scale.** `search/people` returns
`first_name`, `last_name`, `title`, `linkedin_url`, `company_domain`,
`company_name`, … but **no personal email field** (only `company_emails`, which is a
generic company inbox, not the person). Turning a discovered person into a usable
contact means one of:

1. **`enrich/email`** — 1.5 credits (~$0.015) per email found. Accurate, but it is spend.
2. **They submit it to you** — the Event Owner App signup/RSVP form is the cheapest possible source.
3. **They reply to outreach** — the inbox then exposes the lead's `email` for free.
4. **Import a list you already own** — free, and you already have event hosts, planners and vendors.

So the zero-spend design is: **use Explee for discovery + outreach, never for bulk
enrichment.** Keep enrichment as an explicit, per-lead manual action with a visible
credit cost, capped by a server-side budget guard.

---

## 2. Endpoint map

### Outreach — `/public/api/v1/autogtm/...`

```
GET    /projects                                  list projects (id, domain, budget, status)
POST   /projects                                  create a project
GET    /projects/{id}                             one project
GET    /projects/{id}/analytics                   project totals + per-campaign breakdown
GET    /campaigns?project_id=                     list campaigns
POST   /campaigns                                 create campaign (Explee finds the leads; free)
POST   /campaigns/import                          create campaign from your own leads (free)
GET    /campaigns/import/{task_id}                import progress / result
GET    /campaigns/{id}                            full campaign definition
PATCH  /campaigns/{id}                            edit targeting / copy brief
GET    /campaigns/{id}/analytics?period=          today | 7d | 30d | all
POST   /campaigns/{id}/start | /stop              send control (start needs autopilot OFF)
POST   /campaigns/{id}/approve                    approve a review-stage lead list
PATCH  /campaigns/{id}/budget                     per-campaign daily budget (1–300 USD)
PATCH  /projects/{id}/budget                      project daily budget (0 pauses everything)
GET    /projects/{id}/autopilot                   autopilot settings
PATCH  /projects/{id}/autopilot                   {"autopilot_enabled": false}
GET    /projects/{id}/inbox?tab=need_reply        project inbox
GET    /campaigns/{id}/inbox/{person_id}          thread + enriched lead + can_reply
POST   /campaigns/{id}/inbox/{person_id}/reply    {"body_text": "..."}
GET    /hot-leads                                 every hot lead, enriched (email, phone)
GET    /billing | /billing/usage | /billing/activity
POST   /suppress-list/people | /suppress-list/companies
```

Ids chain top-down: project → campaign → inbox/analytics/budget.

### Search — `/public/api/v1/search/...`

```
POST /companies              structured definition -> companies (+ AI criteria scoring)
POST /companies-by-domains   up to 1000 domains -> 1 best profile each
POST /people                 job titles + company filters -> people (no personal email)
POST /people-by-domains      domains + job titles -> people per company
POST /nl-to-filters          plain English -> filters (free)
```

### Enrichment — `/public/api/v1/enrich/...`

```
POST /email              {first_name, last_name, company_domain, preset}
POST /email/batch        up to 100 contacts, async task_id
GET  /email/batch/{id}
POST /phone              {linkedin_url | email, preset}
POST /find-and-enrich    search + enrich in one async job (max 500)
GET  /find-and-enrich/{id}
```

### Utility

```
GET  /me                 key owner, plan, balance, rate limits
GET  /billing/balance    {"remain": 3000}
GET  /tasks              list async tasks
POST /feedback           freeform feedback, free
```

---

## 3. Zero-spend integration plan for Event Owner App

### 3.1 Suggested split of responsibilities

| Need | Use |
|---|---|
| Event hosts, planners, venues, churches as *leads* | `search/companies` + `search/people` (free zone) |
| Their email | **App-side form** first, `enrich/email` only on user action |
| Their phone | **Never automatically** — 15 credits each; user-triggered only |
| Sending the pitch | **not used** — this integration is discovery-only; outreach stays off |
| Warm inbound | `projects/{id}/inbox` + `hot-leads` |

### 3.2 Client and spend guard — already in this repo

`lib/explee.js` is the client. It is dependency-free and exports a factory so it
can be tested without the network:

- `createExpleeClient()` — auth from `EXPLEE_API_KEY` or Settings → Explee
- `status()` — plan, balance, free-zone usage, lifetime budget and pace
- `searchCompanies()` / `searchPeople()` — **always `page_size ≤ 10`**, accept a
  list of country codes, and count each call against the persisted free allowance
  *before* it is sent
- `nlToFilters()` — free, never counted
- `enrichEmail()` — 1.5 / 5 credits, charged by Explee only when an email is found
- `enrichPhone()` — 15 / 30 credits, needs a LinkedIn URL, charged only when found
- `budget()` — lifetime used, remaining, allowance unlocked, runway
- `remember()` / `hasSeen()` — the persisted no-repeat memory

The budget model is a **lifetime ceiling**, not a monthly cap:

| Concept | Default | Meaning |
|---|---|---|
| `lifetimeCreditBudget` | 3,000 | Hard lifetime ceiling in credits ($30). 0 disables paid calls. |
| `budgetMonths` | 60 | Months the ceiling must last (five years). |
| `paceEnabled` | true | Unlock the ceiling linearly instead of spending it at once. |
| starter allowance | `total / months` | 50 credits available immediately, so the first lookup is not blocked. |
| `balanceFloor` | 100 | Never let a paid call take the Explee account below this. |

Four independent brakes protect the balance:

| Brake | Setting | Effect |
|---|---|---|
| Lifetime ceiling | `lifetimeCreditBudget` (3000) | `402 lifetime_cap` once 3,000 credits are spent |
| Five-year pace | `budgetMonths` (60), `paceEnabled` | `402 pace_limit` when a call exceeds the allowance earned so far |
| Balance floor | `balanceFloor` (100) | paid call refused if it would drop below the floor |
| Free-zone limits | `freeRequestsPerDay` (50), `freeRequestsPerMinute` (10) | `429 free_zone_day` / `free_zone_minute`; nothing is sent |

Search failures that would cost money are refused *before* the HTTP request, so a
blocked call is free. All counters — including the lifetime spend, budget start
date and no-repeat memory — live in `data/explee-state.json`, so restarting the
app cannot reset them.

`.env`:

```ini
EXPLEE_API_KEY=sk_explee_...
EXPLEE_LIFETIME_CREDIT_BUDGET=3000   # 3,000 credits = $30 lifetime; 0 disables paid lookups
EXPLEE_BUDGET_MONTHS=60              # must last 60 months (five years)
EXPLEE_DEFAULT_COUNTRIES=            # optional ISO-2 default; blank = worldwide
```

The dashboard's **Settings → Explee** panel edits the same values. When
`EXPLEE_LIFETIME_CREDIT_BUDGET` or `EXPLEE_BUDGET_MONTHS` is present in `.env`,
those two inputs are read-only because the environment wins on every load.

### 3.3 Free discovery, deduped — `POST /api/explee/discover`

`lib/explee-discovery.js` pages the search 10 results at a time and drops anyone
already in the CRM, duplicated inside the batch, or saved by an earlier run.
`countries` accepts an array or a comma-separated string of ISO-2 codes; omit it
or send `""` to search worldwide.

```bash
# Preview only: nothing is written, nothing is remembered
curl -X POST http://localhost:3000/api/explee/discover \
  -H 'content-type: application/json' \
  -d '{"kind":"people","jobTitles":["Founder","Event Planner"],"definition":"event planning companies","countries":"US, GB, AE","limit":20}'

# Same search, written to the CRM and remembered
curl -X POST http://localhost:3000/api/explee/discover \
  -H 'content-type: application/json' \
  -d '{"kind":"people","jobTitles":["Founder"],"definition":"event venues","countries":"","limit":20,"save":true}'
```

Response:

```json
{
  "kind": "people",
  "items": [{ "kind": "people", "keys": ["li:linkedin.com/in/jane"], "lead": { "name": "Jane Doe" } }],
  "stats": { "pages": 2, "fetched": 20, "duplicates": 7, "skipped": 0, "new": 13 },
  "saved": 13,
  "duplicatesAtSave": 0
}
```

Company discovery is the same route with `"kind":"companies"` and `"definition"`.
The dashboard uses a two-step flow: `save:false` for the preview, then
`POST /api/explee/save` with the selected items. That lets the operator uncheck
anyone before anything is written.

**Why not Explee's own dedup lists?** Passing `exclude_lists` to a search
*disables the free-results zone* — the API documentation says so explicitly. On a
$0 plan that would turn every search into paid usage. So dedup is local:

| Key | Built from | Stops |
|---|---|---|
| `li:` | LinkedIn profile URL (normalised) | the same person under a different title |
| `em:` | email address | the same person from a different source |
| `nm:` | normalised name + company domain | the same person without a LinkedIn |
| `dm:` | company domain | the same company twice |

Sources: every CRM lead (`website`, `emails`, `socials.linkedin`, name+domain) and
`data/explee-state.json` (survives lead deletion).

People are saved with a **blank website** on purpose: `addLead()` merges on
website domain, which would otherwise collapse every colleague at one company into
a single lead.

### 3.4 Paid step, on demand — `POST /api/explee/enrich` and `/enrich-phone`

```bash
curl -X POST http://localhost:3000/api/explee/enrich \
  -H 'content-type: application/json' \
  -d '{"firstName":"Jane","lastName":"Doe","companyDomain":"acme.com","preset":"basic"}'

curl -X POST http://localhost:3000/api/explee/enrich-phone \
  -H 'content-type: application/json' \
  -d '{"linkedinUrl":"https://linkedin.com/in/janedoe","preset":"basic_new"}'
```

`preset` is `basic`/`premium` for email (1.5 / 5 credits) and
`basic_new`/`premium` for phone (15 / 30 credits). Both are charged only when the
provider finds a contact; a miss returns no email/phone and costs 0.

If the lifetime budget is 0, the call is refused before it leaves the app:

```json
{ "error": "Paid Explee actions are off (lifetime credit budget is 0). ...", "code": "paid_disabled" }
```

Otherwise the app checks the **lifetime ceiling**, the **five-year pace** and the
**balance floor** first. A blocked call never reaches Explee and costs nothing.
The dashboard exposes both lookups in the lead drawer as explicit per-lead
buttons with the credit cost on the label — never as a bulk action.

### 3.5 Status — `GET /api/explee/status`

```json
{
  "configured": true,
  "plan": "free",
  "balance": 3000,
  "paidEnabled": true,
  "budget": {
    "total": 3000,
    "used": 0,
    "remaining": 3000,
    "usedThisMonth": 0,
    "months": 60,
    "startedAt": null,
    "elapsedDays": 0,
    "monthlyPace": 50,
    "dailyPace": 1.644,
    "allowance": 50,
    "availableNow": 50,
    "paceEnabled": true,
    "runwayMonths": 60
  },
  "creditsUsedThisMonth": 0,
  "balanceFloor": 100,
  "pageSize": 10,
  "freeZone": { "usedToday": 0, "limitToday": 50, "usedThisMinute": 0, "limitMinute": 10 },
  "countries": [],
  "saved": { "people": 0, "companies": 0 },
  "organization": "daniel@codetechcl.com's Organization",
  "docs": "https://api.explee.com/public/api/docs"
}
```

`budget.startedAt` is set on the first paid attempt, not at install time, so an
idle period does not accidentally hand back allowance that was never earned.
`runwayMonths` is the number of months the remaining credits would last at the
planned pace.

`/healthz` also reports `explee: true|false`, so an uptime check catches a missing
key.

### 3.6 If you ever add outreach (not enabled here)

The highest-value, zero-cost path would be importing your own Event Owner App
users, because you already have hosts, planners and vendors. **This is reference
only** — the current integration does not call it, the campaigns stay in `review`,
autopilot is off and the project budget is `$0`. Turn none of this on without an
explicit decision to start outreach.

```js
const { task_id } = await expleePost("/campaigns/import", {
  project_id: 62991,
  name: "Event Owner App — existing hosts Nov 2026",
  instructions:
    "Introduce Event Owner App as the all-in-one tool for invitations, gifts, " +
    "check-ins and seating. One flat fee per event, not a subscription. " +
    "Ask for a 15-minute walkthrough.",
  followup_instructions:
    "Short nudge with one concrete benefit (guest check-in or gift tracking). No pressure.",
  language: "en-GB",
  leads: [
    {
      email: "jane@example.com",
      first_name: "Jane",
      last_name: "Doe",
      company_domain: "example.com",
      job_title: "Event Planner",
      linkedin_url: "https://linkedin.com/in/janedoe",
      client_ref: "eoa_user_1042",
    },
  ],
});
// poll GET /campaigns/import/{task_id} until meta.status === "completed"
```

Per-lead mandatory fields: `email`, `first_name`, `last_name`, `company_domain`,
`job_title`. Missing any → the lead is skipped, never a request error.

### 3.7 Reading replies for free

```js
const inbox = await expleeGet(`/projects/62991/inbox?tab=need_reply`);
// each row: person_id, campaign_id, email (only after they reply), latest_intent

const thread = await expleeGet(`/campaigns/${campaign_id}/inbox/${person_id}`);
if (thread.can_reply) {
  await expleePost(`/campaigns/${campaign_id}/inbox/${person_id}/reply`, {
    body_text: "Thanks for getting back to me — would Tuesday at 10:00 work?",
  });
}
```

Poll `GET /projects/{id}/inbox/changes` with `since` then `cursor` for incremental
sync instead of re-listing.

### 3.8 Hot leads → Event Owner App CRM

`GET /hot-leads?since=<ISO8601>` returns an enriched contact including `email`,
`phone`, `job_title`, `company_name`, `linkedin_url`, `why_hot` and `became_hot_at`.
This is the cheapest phone/email source in the whole API, because the lead supplied
it by replying. Poll it on a schedule and upsert into the Event Owner App CRM.

---

## 4. Cost arithmetic for a $30 lifetime budget

At the current $30 balance:

| Action | Credits | How many before $30 runs out |
|---|---|---|
| Company search, per 10-result request | 0 (free zone) | 50 requests/day cap, not credits |
| People search, per 10-result request | 0 (free zone) | 50 requests/day cap, not credits |
| Basic email enrichment | 1.5 | ~2,000 emails |
| Premium email enrichment | 5 | ~600 emails |
| Basic phone enrichment | 15 | ~200 phones |
| Premium phone enrichment | 30 | ~100 phones |
| Outreach email sent (not used here) | 4 | ~750 sends |

Free-zone requests are also bounded by **50/day** and **10/minute** on the free
plan, so the sustainable free rate is up to ~500 discovery results/day — more than
enough for Event Owner App's early pipeline.

### The five-year pace

3,000 credits ÷ 60 months = **50 credits per month**, about **1.64 per day**.

- 50 credits are available immediately so the first lookup works.
- The rest unlocks linearly; unused allowance carries forward.
- The lifetime ceiling (3,000) is enforced even when pacing is off.
- The balance floor (100) protects the account and keeps free searches alive.

**Do not let autopilot spend the balance silently.** Outreach sending is $0.04 per
email and is not part of the credit-free allowance. That path is deliberately off.

---

## 5. Gotchas worth encoding in the integration

- **Positive balance is mandatory.** 0 credits → `402` even for free results.
- **Budget is lifetime, not monthly.** `creditsUsed` accumulates forever; the only
  reset is a deliberate change in Settings/`.env`. Do not treat `usedThisMonth` as
  a cap.
- **Free zone is per request, not per month.** 10 results/request; paginating with a
  big `page_size` bills the whole page once the day's free quota is gone.
- **`search/people` has no personal email.** Only `company_emails`. Plan for enrichment
  or inbound capture.
- **`people_filters.geo` must be an array**, even for one country. A string returns a
  `422`.
- **Phone enrichment needs `linkedin_url`.** Email is optional. Basic is 15 credits,
  premium 30; a miss costs 0.
- **Enrichment is charged only when found.** Not-found is genuinely 0 credits, so a
  miss does not drain the balance.
- **Phone results are E.164.** `cleanPhones()` preserves a leading `+`, so non-Nigerian
  numbers survive even though the CRM default country code is `234`.
- **Outreach `start` returns `409` while autopilot is ON.** Turn it off first:
  `PATCH /projects/{id}/autopilot {"autopilot_enabled": false}`.
- **`PATCH /projects/{id}/budget {"daily_budget_usd": 0}` pauses all sending** — the
  clean emergency brake.
- **Targeting edits re-aim a campaign** and drop uncontacted leads; the new search
  starts ~5 minutes after the *last* change. Editing copy briefs does not.
- **Replies are limited to 3 per inbound message**; recipient, subject and threading
  are filled in automatically.
- **A contact's email stays hidden until they reply**; `person_id` is the stable handle.
- **Errors:** `404` for any unknown id, `402` for credit floor, `409` for mode
  conflicts, `422` for unknown fields (never a silent no-op), `429` with `Retry-After`.
- **`Idempotency-Key` header** on campaign create and import makes retries safe for 24h.
- Use **suppress lists** to keep existing customers and live deals out of outreach —
  it also cancels in-flight sequences at send time.

---

## 6. What is wired in today

| File | Role |
|---|---|
| `lib/explee.js` | client, free-zone ledger, lifetime budget/pace guard, enrichment, no-repeat memory |
| `lib/explee-discovery.js` | multi-country search paging, local dedupe, CRM lead mapping, save |
| `server.js` | routes: `/api/explee/status`, `/filters`, `/discover`, `/save`, `/enrich`, `/enrich-phone` |
| `lib/settings.js` | `explee` settings block + env overrides + secret masking |
| `lib/leads.js` | `companyDomain` and `jobTitle` fields used by enrichment |
| `public/index.html`, `public/app.js`, `public/style.css` | premium Explee panel and per-lead enrichment buttons |
| `test/explee.test.js` | 17 tests: free zone, multi-country, lifetime ceiling, pace, floor, phone, dedupe, mapping |
| `docs/explee-user-guide.md` | non-technical operator guide |
| `docs/explee-campaign-audit.md` | audit of the six outreach campaigns |

```bash
npm test                       # 89 tests, incl. the 17 Explee tests
curl http://localhost:3000/api/explee/status
```

Defaults are deliberately strict: `lifetimeCreditBudget = 3000`,
`budgetMonths = 60`, pacing on, `pageSize = 10`, 50 free requests/day, 10/minute,
balance floor 100. Discovery cannot spend; enrichment must be a deliberate
per-lead click.

## 7. What is already done

1. ✅ `GET /api/explee/status` is surfaced in the Find leads panel (spend, pace,
   free-zone left, lifetime runway).
2. ✅ The dashboard has a two-step **Preview → Save** flow over
   `/api/explee/discover` and `/api/explee/save`.
3. ✅ Email and phone enrichment are explicit per-lead buttons with the credit
   cost on the label; there is no bulk action.
4. ✅ Multi-country search (ISO list, worldwide by default) and global leads are
   supported; nothing assumes Nigeria.
5. ✅ Local dedupe across the CRM, the current batch and a persisted memory.
6. ⬜ If outreach is ever approved: create the suppress lists first, turn
   autopilot off, then start one campaign at a time with a small daily budget.

---

## Review round (2026-11-05): what changed

- **Field mapping fixed.** Company search rows use bare names (`name`, `url`, `size`, `industry`, `emails`, `phones`, `social_*_urls`). The mapper was reading `company_*` names, so free emails/phones were dropped. They now flow into the lead.
- **Dedupe.** `findDuplicate` also matches LinkedIn URLs; the discovery index matches person leads by name at their employer (`companyDomain`); a saved lead is remembered even if later deleted.
- **Resumable paging.** Each query keeps a saved cursor, so repeating a search reaches new people instead of re-reading page 1. The cursor advances only when you save.
- **Partial results survive** a mid-run 429/network error; a "free" request that reports a charge stops paging.
- **Paid safety.** Paid calls run one at a time; a found email/phone is cached and never paid for twice (misses are retried after 7 days); enrichment is skipped when the lead already has that contact.
- **Free agent fallback.** After saving, leads with no email and no phone go to the contact agent, which reads the company's own domain first, then falls back to web search. People leads never get a website set, so colleagues cannot merge into one lead.

### Live test, 2026-11-05: only page 1 is free

Measured against the real API (companies, `page_size` 10, Nigeria):

| Request | Credits charged |
|---|---|
| page 1 | 0 |
| **page 2** | **5** (10 companies x 0.5) |
| page 1 with a `size` filter | 0 |
| page 1 with `size` + `founded` filters | 0 |
| people search page 1 with a company `size` filter | 0 |

So the free zone is the first 10 results **of each query**, not each page. Discovery therefore never
requests page 2. It walks 26 filter slices (unfiltered, 5 company-size bands, 5 sizes x 4 founding eras),
page 1 of each, resuming at the next slice after every saved search. Up to about 260 free results per
definition and country; slices overlap, which the local dedupe absorbs.

A sample run of 3 company slices + 2 people slices returned 50 rows (32 new) for 0 credits; 14 of 20 new
companies came with a public email and 15 with a phone.
