# Code Tech Revenue Desk

An AI sales assistant, lead finder and small-team CRM for Code Tech Consulting Limited. No **required** paid services and **no npm packages**: it needs only Node.js 22+.

| Read this | If you are |
|---|---|
| **[USER_GUIDE.md](USER_GUIDE.md)** | the sales/marketing person using it every day |
| **[DEPLOY.md](DEPLOY.md)** | the person putting it online (PC + Cloudflare Tunnel, free Linux VM, Docker) |

## What it does

- **Runs the working day.** The **Today** desk shows open pipeline, weighted forecast, won revenue against a monthly target, follow-ups due or overdue, recent activity, lead sources and an 8-week new-vs-won trend.
- **Moves deals through a real pipeline.** Nine stages from **New** to **Won**, **Lost** and **Do not contact**, with drag-and-drop kanban cards, stage values, owners, priority, deal value and live stage totals.
- **Keeps the follow-up promise.** Add dated tasks to any lead, see everything due today or in the next seven days, tick tasks done, and add notes on the lead's activity timeline.
- **Gives every lead a workspace.** Overview, Activity, Tasks and Message tabs plus one-click duplicate merge. You can edit contact details, value, priority, owner, tags and offer without leaving the lead.
- **Works the list at speed.** Search, filter by stage/contact/priority/tag, sort, paginate, select many leads and bulk-change stage, priority, owner, tags or tasks. Import and export CSV.
- **Sells for you.** A chat agent that knows your products (GameCenter, HRSolutionEventos, Goal Buddy, services), recommends the right one, and saves visitors' contact details as leads. One agent on your **website widget**, **Telegram** and the dashboard. Admins get a Telegram alert the moment a visitor leaves a number.
- **Finds direct customers.** Four routes: paste a list of websites (always works), OpenStreetMap business listings, optionally **Geoapify places** (free plan: 3,000 credits/day, no card, attribution required), and web search. It reads each business's own public website (3 pages, robots.txt honoured) for emails, phones and social links, and filters out results that are about the wrong thing or the wrong place.
- **Writes the first message** (email, WhatsApp or DM) with one-click open links. **You review and send**: no auto-spam, no WhatsApp fees.
- **Switch AI engines any time:** Google Gemini, Groq or Ollama, with automatic failover and retry on free-tier limits.

The interface has a light/dark theme, a responsive sidebar, `Ctrl+K` quick actions and keyboard-friendly dialogs. All data stays in local JSON files.

## Quick start

```bash
node server.js          # or double-click start.bat
```
Open http://localhost:3000. The one-time password is printed on first run. Then **Settings → add a free Gemini/Groq key → Test**, check **Products**, try **Sales chat**. Optional: add a free Geoapify key in **Settings → Geoapify places** for the extra place search (see [USER_GUIDE.md](USER_GUIDE.md) §2b).

```bash
npm test                # 57 tests
npm run backup          # copy data/ to backups/
npm run reset-password  # lost the password
```

## The CRM in one screen

1. **Today** tells you what needs attention: overdue and due follow-ups, open pipeline, forecast, target progress and recent activity.
2. **Pipeline** is the kanban board. Drag a card to a new stage, or use its stage menu; the value and stage totals update everywhere.
3. **Leads** is the searchable database. Select several rows for bulk stage/priority/owner/tag/task changes, or open one lead for the full workspace.
4. **Lead workspace** keeps contact details, deal value, owner, priority, tags, notes, tasks, activity history and message drafting in one drawer. Use **Merge** to fold a duplicate into the lead you want to keep.

## How it is built

```
server.js              HTTP server, auth, API, security headers
lib/agent.js           sales persona, conversation memory (90-day retention), outreach drafting
lib/llm.js             Gemini / Groq / Ollama with retry + failover
lib/leadfinder.js      OpenStreetMap, web search, SearXNG, relevance filter, paste-a-list
lib/geoapify.js        optional Geoapify place search (free plan; OpenStreetMap data)
lib/scraper.js         contact extraction, robots.txt
lib/net.js             SSRF guard + URL sanitising
lib/leads.js           validated CRM store: stages, tasks, activity, dashboard, bulk, merge, CSV
lib/settings.js        config, CRM preferences, scrypt password, signed sessions
lib/telegram.js        bot (private chats, rate limited, admin alerts)
public/                dashboard + embeddable chat widget
test/                  unit + end-to-end tests (mock AI), including CRM API coverage
```
Data lives in `data/` as JSON files (leads, chats, products, settings). A lead record now includes its stage, value, priority, owner, tags, tasks and activity timeline, so the dashboard and workspace are all derived from the same file. It never leaves your machine except the text sent to the AI engine you choose and, when you use OpenStreetMap or enable Geoapify, the search words and area sent to those map services. Nothing is sold or shared otherwise.

## Security summary

scrypt-hashed password; signed HttpOnly SameSite=Strict session cookies that die on password change; login lockout that spoofed `X-Forwarded-For` cannot bypass; CSRF origin checks; strict Content-Security-Policy; all stored data validated (no `javascript:` links, no bad emails); CSV formula neutralising; SSRF guard on the crawler incl. redirects; prompt-injection fencing of scraped text; rate limits and a daily cap on public chat; API keys (including Geoapify) masked in the API. Details and the pre-launch checklist: [DEPLOY.md §7](DEPLOY.md).

## Using lead data responsibly

Only business contact details that organisations publish themselves, or that you are licensed to use. Write for a genuine business reason, identify yourself, honour "stop" immediately (set the lead to `do-not-contact`), keep volumes small. Nigeria's NDPA (and GDPR for EU/UK contacts) apply.

**Why Apollo was removed.** Apollo's current terms allow some internal business use, but they impose broad API/data restrictions and Apollo is credit-based and paid. That is not a clear fit for this app, so there is no Apollo code, key, or request left in this repository.

**Geoapify (optional).** The free plan gives 3,000 credits/day at up to 5 requests/second, with no card, and permits commercial use within the plan. Attribution is mandatory on the free plan, so the dashboard shows **© OpenStreetMap contributors** and **Powered by Geoapify**; leave that visible. Geoapify's Places docs explicitly allow caching/storing results with no limits. Geoapify's terms and free-tier limits can change, so check the current [terms](https://www.geoapify.com/terms-and-conditions/) and [pricing](https://www.geoapify.com/pricing/) before relying on it. Lead data comes from OpenStreetMap (ODbL). This is practical guidance, not legal advice.

## Known limits (honest list)

- Free public search engines throttle automated searches; the agent detects and explains this. Paste-a-list and OpenStreetMap are unaffected, and your own SearXNG makes web search dependable.
- OpenStreetMap and Geoapify coverage in parts of Nigeria is thin.
- Local Ollama is slow without a GPU; use Gemini or Groq for real chats.
- Geoapify is optional and free within **3,000 credits/day** (a typical 15-lead search uses about 30). It only knows common business categories; when a keyword has no safe category, the search says so and suggests OpenStreetMap, web search, or a website list. Attribution is required.
- One shared dashboard password (no per-user accounts). Leads have an optional **Owner** field so the team can say who is working a deal, but it is a label, not a login.
- The CRM stores tasks and activity inside each lead, not in a separate database. JSON storage suits thousands of leads and their history, not millions. Run one instance per data folder.
- Telegram and the Docker/cloud deployment recipes are written to each tool's documentation but were not run by the author (no bot token, Docker or cloud account available).
