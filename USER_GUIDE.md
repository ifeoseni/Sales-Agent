# Code Tech Revenue Desk: User Guide

For the people who use the agent day to day. No technical knowledge needed. If you are the person who installs it on a server, read [DEPLOY.md](DEPLOY.md) instead.

---

## 1. What this gives you

| You want to… | Use this |
|---|---|
| See what needs attention today | **Today** tab |
| Move deals through stages and see the forecast | **Pipeline** tab |
| See, sort, segment and bulk-edit everyone you found | **Leads** tab |
| Keep notes, tasks and follow-up dates on a lead | Open any lead → **Lead workspace** |
| Have an assistant answer customers 24/7 on your website and Telegram | **Chat widget** + **Telegram bot** |
| Get a ready-to-send first message for any lead | **Message** tab inside a lead |
| Change what the assistant knows about your software | **Products** tab |
| Set targets, currency, follow-up days, AI engine and keys | **Settings** tab |

**The agent never sends anything to a prospect by itself.** It finds contacts and writes the message; you read it and press send. That keeps your email and WhatsApp numbers safe from spam blocks and keeps you inside the law.

Tip: press **Ctrl+K** anywhere to jump to a page or find a lead.

---

## 2. First-time setup (about 10 minutes)

### Step 1: Open the dashboard
Start the agent (double-click `start.bat` on your PC) and open **http://localhost:3000**, or the address your technical person gave you (for example `https://agent.codetechcl.com`).
The first time, the window shows a one-time password. **Write it down** – it cannot be shown again. You can change it in Settings.

### Step 2: Get a free AI key (pick one, or all)
The AI is what writes replies and messages. All of these have free plans with no card:

1. **Google Gemini** – go to aistudio.google.com/apikey, sign in with a Google account, press *Create API key*, copy it.
2. **Groq** – go to console.groq.com/keys, sign up, *Create API Key*, copy it.
3. **Ollama** (optional) – runs on your own computer, unlimited, but slow without a powerful PC.

In **Settings → AI engine**: paste the key in its box, set *Active provider*, press **Test**. You should see **Working ✓**.
Gemini also has a **Backup model** (pre-filled with a lighter one). Free quotas are counted per model, so if the main model is busy or out of quota the agent automatically tries the backup before anything else. If you use the same Gemini key in other apps, they share one quota: create a separate key for this agent (a different Google project) so your other apps can't starve it.
Tick **Failover** so that if one engine hits its free daily limit, the agent silently switches to another you have set up. Setting up two engines is the best insurance.

### Step 2b (optional): Add a free Geoapify key
Geoapify is a second place search. It is **optional** but switches on automatically once a key is saved; the free sources work without it.

1. Go to [myprojects.geoapify.com](https://myprojects.geoapify.com/), sign up (no card), and create an API key.
2. In **Settings → Geoapify places**, paste the key and press **Test key (uses 1 credit)**. You should see **Working ✓**.
3. Once the key is saved, **Geoapify places** is ticked automatically in *Find leads*. Untick it to skip that search; the choice is remembered in this browser.

The free plan includes **3,000 credits/day** (about 30 credits for a typical 15-lead search), at up to 5 requests/second. It allows commercial use within the plan, but **attribution is required**: keep the **© OpenStreetMap contributors** and **Powered by Geoapify** line visible under *Find leads*. Geoapify's terms and free limits can change, so check their current [pricing](https://www.geoapify.com/pricing/) and [terms](https://www.geoapify.com/terms-and-conditions/) if you rely on it heavily. The dashboard's **Find leads** page shows this attribution automatically.

### Step 3: Fill in your company details
**Settings → Company details**: company name, website, sales email, sales phone, WhatsApp number (digits only with country code, e.g. `2348012345678`), and a sign-off such as "Ade from Code Tech". Check **Default country calling code** (234 for Nigeria) and **Default search location**.
These appear in replies and message drafts, so a customer who wants a human knows who to call.

### Step 4: Check your products (the most important step)
Open the **Products** tab. The agent only talks about what is written here and will say "I'll check with the team" for anything else, so accuracy matters more than anything.

For each product fill in:
- **One-line pitch**: what it does for the customer, in plain words. *"Run your gaming lounge without paper and arguments over time."*
- **Description**: two or three sentences, no jargon.
- **Features**: one per line. Only real ones.
- **Ideal customers**: who should buy it. This helps the agent recommend the right product.
- **Lead-search keywords**: the kinds of businesses to look for (they appear as suggestions in *Find leads*).
- **Price**: leave empty if you quote per customer; the agent will then say "a team member will send you a quote". **Never put a price you are not prepared to honour.**
- **Status**: `active`, `in development` (the agent will say it is coming soon), or `hidden` (the agent will not mention it).

Press **Save products**.

### Step 5: Test it like a customer
Open the **Sales chat** tab and chat as a customer would: *"I run a gaming lounge in Yaba, how do I stop staff stealing time?"* Check that the answer is accurate and sounds like you. If not, fix the Products text and try again; the answers follow what you write there.

You are ready.

---

## 3. Finding customers

Open **Find leads**.

1. **Type of business**: be specific. *"gaming lounge"*, *"event planner"*, *"private secondary school"*, *"logistics company"*. Click one of the *Ideas* underneath (they come from your products).
2. **City / area**: *"Lekki, Lagos"* beats *"Nigeria"*. Smaller areas give better, more relevant results and run faster.
3. **How many**: start with 15–20.
4. Choose your sources:
   - **Web search** finds businesses that have their own website or social pages.
   - **OpenStreetMap listings** finds businesses on the public map that list a phone number. It has thin coverage in some areas, which is why the free sources run together.
   - **Geoapify places** is optional and on by default once a key is saved. It searches public OpenStreetMap-based places with your own free Geoapify key (Settings → Geoapify places). A typical search uses about 30 of the 3,000 daily credits.
5. Press **Find leads** and wait 1–3 minutes. Progress is shown live. You can press **Stop**; what was found so far is kept.

### Four ways to find leads (from most to least dependable)
1. **Paste a list of websites** (open *Have a list of websites?* under the search box). Paste addresses, one per line, from anywhere: your own Google searches, Google Maps, Instagram bios, directories, a conference attendee list. The agent visits each site and pulls out the published emails, phones and social links. **This always works** and is the best way to build a high-quality list quickly.
2. **OpenStreetMap listings.** Free public map data. Reliable, but only businesses someone mapped with a phone or website.
3. **Geoapify places (optional, free plan).** Searches the same kind of public map data through Geoapify, then reads each place's published contact details and website. It needs your own free key (Settings → Geoapify places) and is on by default once that key is saved. It is free within 3,000 credits/day; typical searches use about 30. It only recognises common business categories: if the progress box says Geoapify has no category for your wording, use OpenStreetMap or *Paste a list of websites* instead.
4. **Web search.** Convenient, but it uses free public search engines (DuckDuckGo) that **throttle automated searches**. When that happens the progress box says *"Web search was blocked"*. It is temporary (usually 10–60 minutes). Don't keep retrying: use options 1–3 meanwhile. For dependable web search, your technical person can connect your own free SearXNG (DEPLOY.md §11).

Results from web search are checked for relevance: anything that is not about your business type **and** your area (for example a London university turning up for "event planner Lagos") is skipped, and the progress box tells you how many were skipped. Map listings (OpenStreetMap/Geoapify) are already inside the area, so they are kept even if they publish no email or phone — they are saved with the tag **needs contact** instead of being thrown away.

### What you get
Each result shows the business name, any **emails**, **phone numbers**, **website** and **social links** (Facebook, Instagram, LinkedIn, X/Twitter, TikTok, YouTube, WhatsApp, Telegram) that the business has published itself. Results are saved to the **Leads** tab automatically, and duplicates are skipped. A map place with only a name, address or website is still saved (tagged **needs contact**) so you can call, visit or use **Search website again for contacts** later.

The **score** is a quick quality hint: an email is worth most, then a phone, website and social pages. Start with the highest scores.

### Getting better results
- Run **several narrow searches** rather than one broad one (*"hotel Lekki"*, *"hotel Ikeja"*, *"hotel Victoria Island"*).
- Try **different words** for the same thing (*"gaming lounge"*, *"playstation gaming centre"*, *"video game cafe"*).
- If you see *"Web search was blocked"*, the free search engine is rate-limiting you. Use *Paste a list of websites* or OpenStreetMap, and try web search again in an hour.
- A business with **no email or phone** may still have an Instagram or Facebook page; use the **Social DM** option for those.
- Press **Search website again for contacts** inside a lead if you think a website was slow the first time.

### Be realistic
This tool reads **public** information. Some businesses publish nothing, and a few websites ask robots not to read them (the agent respects that and skips them). You will always have to qualify leads yourself: open the website, see if they are really a fit.

---

## 4. Working your pipeline and leads

### Start on Today
Open **Today** first. It is the morning view of the whole desk:

- **Open pipeline** and **weighted forecast** — the value of open deals, with later stages counted more heavily than early ones.
- **Won this month** — revenue closed this month, shown against the monthly target.
- **Follow-ups due** — anything overdue or due today, then the next seven days.
- **Recent activity**, **lead sources** and an 8-week new-vs-won trend.

Click any follow-up to open its lead. Tick the circle to mark it done. The buttons at the top take you to the pipeline or the full lead list.

Set your **currency**, **monthly target** and **default follow-up days** in **Settings → Sales goals**. The target drives the ring on Today and the goal bar in the sidebar.

### The pipeline (stages)
Use the **Pipeline** tab, or the stage dropdown on any lead. The stages are:

| Stage | Meaning |
|---|---|
| **new** | Found, nobody has contacted them yet |
| **contacted** | You sent a first message |
| **replied** | They answered |
| **qualified** | They are a real fit: need, timing and decision-maker confirmed |
| **demo** | A demo or meeting is booked or done |
| **proposal** | You sent a quote or proposal |
| **won** | They bought |
| **lost** | They said no, went silent, or the timing was wrong |
| **do-not-contact** | They asked you to stop. The agent will refuse to draft messages for them. |

On the board you can **drag a card** to another column or use the stage menu on the card. Search or filter by **owner** to focus on one person's deals. The board shows the number of deals and the total value in each stage.

Add **deal value**, **priority**, **owner**, **tags** and the **offer** in the lead workspace. The board totals, weighted forecast and Today numbers update from those fields.

### The leads table
Open **Leads** for the full database. The tiles at the top are your quick health check: total leads, how many have email or phone, how many came from chat, how many are in conversation and how many you have won.

- **Search** across name, email, phone, tag, notes and activity.
- **Filter** by stage, contact type (has email / has phone / missing contact), priority or tag.
- **Sort** by recently active, newest, name, highest value, next follow-up or contact score.
- **Select several leads** with the checkboxes to move them to a stage, set priority, assign an owner, add a tag, add a task or delete them in one go.
- **Add lead** creates one by hand. **Import CSV** adds many. **Export CSV** downloads everything for Excel or Google Sheets.

CSV import recognises `name`, `website`, `industry`, `location`, `address`, `emails`, `phones`, the social columns (`facebook`, `instagram`, `linkedin`, `twitter`, `tiktok`, `youtube`, `telegram`, `whatsapp`), `status`, `priority`, `value`, `tags`, `owner`, `product` and `notes`.

The CSV export includes contact details, stage, priority, value, tags, owner, next follow-up and notes. **Tasks and the activity timeline are not in the CSV** — they are kept in the JSON data and in backups, so keep `npm run backup` running as well.

### Open a lead: the workspace
Click any row (or the arrow) to open the **lead workspace** on the right. It has four tabs:

- **Overview** — edit business name, website, industry, location, deal value, priority, owner, offer, tags, notes and description. Use **Refresh contacts** to re-read the business's website, or **Merge** to combine a duplicate.
- **Activity** — the full timeline: lead created, stage changes, tasks added/completed, notes, contact refreshes and drafted messages.
- **Tasks** — add the next step with a title, due date and priority; tick it done or delete it. The date defaults to your **Default follow-up days** setting.
- **Message** — choose the offer and channel, draft the message, edit it, then open it in email or WhatsApp, or copy it for a social DM.

**Mark as contacted** (or moving the stage to *contacted*) records the contact and keeps the follow-up rhythm visible.

### Following up
A lead without a next step goes quiet. Add a **task** every time you contact someone:

1. Open the lead and go to **Tasks**.
2. Write the next action, for example *"Call back about the demo"*, and pick a due date 3–5 days out.
3. On the due day the task appears on **Today** under **Follow-ups**, marked **Today** or **overdue**.
4. Do it, then tick it done. Add a note on **Activity** about what happened.

After two unanswered messages, move the lead to **lost** and spend your time on the next one. If someone says stop, move them to **do-not-contact** immediately.

### Merging duplicates
Open the lead you want to remove as a separate record, press **Merge**, search for the lead you want to keep, and confirm. Contacts, tags, tasks, value, notes and activity history move into the keeper; the duplicate is deleted. **This cannot be undone**, so check the name before you confirm.

### Writing the first message
Open a lead and choose the **Message** tab:

1. Choose the **Offer** (which product to pitch) and the **Channel**: *Email*, *WhatsApp* or *Social DM*.
2. Press **Write it**. In a few seconds you get a short, personalised message in your voice.
3. **Read it. Edit it.** Make sure every claim is true and it sounds like a human wrote it.
4. Send it:
   - **Open in email app** opens your email program with the address, subject and message filled in.
   - **Open in WhatsApp** opens WhatsApp with the number and message ready; press send in WhatsApp.
   - For **Social DM**, use **Copy** then the button that opens their page, and paste.
5. Press **Mark as contacted** so you remember.

### A good first message
- Short: 3–5 sentences.
- About **them**, not you: one specific problem you can solve.
- **One** clear next step: a 15-minute demo or a reply.
- Honest and polite, with a way to say no (email drafts include "Reply stop and I won't contact you again").
- **Don't** attach files, paste long feature lists, or write in capitals.

---

## 5. Customers who message you (website chat and Telegram)

### What the assistant does
It answers questions about your products and services, recommends the best fit, offers a demo or quote, and asks for the visitor's name and phone or email. If they give contact details, they appear in **Leads** automatically with source **inbound:website** or **inbound:telegram**, together with the chat transcript (open the lead and expand *Chat transcript*).

**Inbound leads are your hottest. Contact them first, quickly, ideally the same day.** If the Telegram bot is connected, you get a message the moment a new lead arrives.

### What it will not do
It will not invent prices, features, discounts or deadlines; it will not give legal, medical or financial advice; it ignores attempts to make it break its rules. It always says it is an AI if asked. When it cannot help, it gives your phone/email/WhatsApp from Settings.

### Putting the chat on your website
Your technical person does this once (see DEPLOY.md). In **Settings → Website chat widget** you will find one line of code to paste before `</body>` on your site (in WordPress: a "header and footer scripts" plugin; in Wix: *Settings → Custom code*). A green chat bubble then appears on every page.

### Telegram
1. In Telegram, message **@BotFather** → `/newbot` → follow the steps → copy the token.
2. Paste it in **Settings → Telegram bot token** and save.
3. Open your bot in Telegram and send `/claim YOUR_DASHBOARD_PASSWORD`. You are now an admin.

Admin commands:
- `/find gaming lounge in Lagos` – runs a lead search and sends the top results to your phone.
- `/provider groq` – switches the AI engine (also `gemini`, `ollama`).

Everyone else who messages the bot just gets the sales assistant (`/start`, `/products`, `/stop` to clear their chat).

### Take over a conversation
The assistant cannot hand a chat over live. Open the lead, read the transcript and contact the person yourself using the phone or email they gave.

---

## 6. A 30-minute daily routine

1. **Today, first (5 min).** Open **Today**. Clear overdue follow-ups. Anything from `inbound:` is the hottest — call or WhatsApp it first.
2. **Fresh leads (10 min).** *Find leads*: run one or two searches (a different area or business type each day), or paste a list of websites.
3. **Outreach (10 min).** Open the best 5–10 new leads, draft in the **Message** tab, edit, send, and set **Mark as contacted**. Add a task with a due date for the follow-up.
4. **Pipeline (5 min).** Open **Pipeline** and move each deal to the honest stage. Add value, priority and owner where you know them. Check the weighted forecast against your target.
5. **Friday.** Export CSV as an extra backup, confirm `npm run backup` is running, and note which sources and messages produced the **won** deals. Clean up duplicates with **Merge**.

A few **good** messages a day beat hundreds of copy-paste ones.

---

## 7. Staying legal and keeping your reputation

You are responsible for how you use contact details. In Nigeria that means the **Nigeria Data Protection Act (NDPA)**; if you contact people in the EU/UK, GDPR and similar rules apply too. In plain terms:

- **Business contacts only, for a business reason.** Prefer general addresses (`info@`, `sales@`) to a person's private number. Geoapify/OpenStreetMap data has its own terms; check Geoapify's free-plan terms and keep the required attribution visible.
- **Be transparent** about who you are and why you are writing.
- **Always honour "stop".** Set the lead to **do-not-contact** immediately. Never contact them again.
- **Send small volumes** from your own accounts. Bulk sending gets email domains and WhatsApp numbers blocked.
- **Keep data tidy.** Delete leads you no longer need (*Open → Delete lead*). Chat history older than 90 days is deleted automatically (a transcript saved on a lead stays until you delete that lead). If someone asks you to delete their data, delete the lead and tell them it is done.
- **Don't scrape personal social profiles.** The agent only gathers what a business publishes on its own website and public listings.
- The chat widget tells visitors they are talking to an AI and that messages are stored. Keep that notice.

*This is practical guidance, not legal advice. For anything formal, such as registering as a data controller with the NDPC, ask a Nigerian data-protection lawyer.*

---

## 8. Troubleshooting

| What you see | Why | What to do |
|---|---|---|
| "No AI provider is configured" | No key saved | Settings → add a Gemini or Groq key → Test |
| "All AI providers failed … 429" | Free daily/minute limit reached | Wait, or add a second engine and tick Failover |
| "… 400 / API key not valid" | Key mistyped or restricted | Create a fresh key and paste it again |
| Test shows "fetch failed" for Ollama | Ollama isn't running | Start the Ollama app, then press Test |
| Ollama answers take minutes | Computer has no powerful GPU | Use Gemini or Groq instead |
| "Web search was blocked" | The free search engine is throttling automated searches | Use *Paste a list of websites* / OpenStreetMap now; retry web search in an hour; or connect your own SearXNG |
| "Geoapify: no API key saved" | Geoapify is ticked but Settings has no key | Add a free key in Settings → Geoapify places, or untick Geoapify |
| "Geoapify rejected the API key" | Wrong, deleted or restricted key | Create a fresh key at myprojects.geoapify.com and paste it again; untick Geoapify to keep using the other sources |
| "Geoapify free-plan rate limit reached" | Daily credits or the 5 requests/second limit was hit | Wait a few minutes (or until the daily reset), or use OpenStreetMap / Paste a list |
| "Geoapify has no category for that business type yet" | The wording is too unusual for Geoapify's category list | Try more common words, or use OpenStreetMap / Paste a list |
| A deal's value or the forecast looks wrong | The lead has no deal value, is in the wrong stage, or the currency is different | Open the lead → **Overview** → set **Deal value** and **Stage**; check **Settings → Sales goals → Currency code** |
| A follow-up is missing from Today | The task has no due date, is already ticked done, or is dated more than seven days out | Open the lead → **Tasks** → set the date or untick it |
| Two records for the same business | It was found by different searches | Open the one to remove → **Merge** → choose the lead to keep |
| "Skipped N results that did not match…" | Web results were about something else or somewhere else | Normal. The filter is protecting you from junk. Try different words |
| Pasted websites show "unreachable" / "no public contact details" | Site is down, blocks robots, or publishes no contact info | Open it yourself; it may only have a contact form |
| "OpenStreetMap busy (HTTP 502/504)" | All public map servers are overloaded | The app now tries three mirrors automatically; retry in a minute or use a smaller area |
| Search finds 0 new leads | Everything found was already saved, or nothing had a usable website/address/contact | Read the "Skipped:" line in the progress box; try a different area or wording |
| Sales chat shows "Thinking…" for a long time | Gemini/Groq are busy or your key needs attention | Wait up to a minute; the app then shows the reason. Test the key in Settings → AI, or add a second free engine |
| A good business has no email | They publish none | Use phone/social; or visit their site |
| Locked out of the dashboard | Wrong password 8 times | Wait 10 minutes. If the password is lost: see "Reset password" in DEPLOY.md |
| Chat bubble missing on website | Script not pasted, or agent not reachable from the internet | Check DEPLOY.md §Website widget; open the widget address in a browser |
| "Our assistant is unavailable" in the chat | AI limit reached or no key | Check Settings → Test; add a second engine |
| Telegram bot silent | Wrong token or app not running | Re-paste token, save, check the app is running |
| Phone numbers look wrong | Wrong default country code | Settings → Default country calling code |
| Everything vanished after redeploying | Data folder wasn't persisted | Restore from a backup; see DEPLOY.md §Backups |

---

## 9. FAQ

**Is it really free?** The software is free and has no subscription, and no paid service is required. AI engines have free plans with daily limits (they change; check the provider). Search, OpenStreetMap, and the optional Geoapify free plan are free within their quotas; Geoapify needs attribution and is off unless you add a key. Hosting is free if you run it on your own PC or on a free-tier server (see DEPLOY.md). Domain names and WhatsApp's paid business API are not needed.

**Can several staff use it?** They can share one dashboard password. There are no separate accounts or roles yet, but each lead has an optional **Owner** field you can use to show who is working it.

**Where is my data?** In the `data` folder on the computer or server running the agent. A lead's contacts, stage, value, tags, tasks and activity timeline all live in `leads.json`; back that folder up regularly. Only the text of a chat or draft is sent to the AI engine you chose (Gemini/Groq). Search words and the area are sent to OpenStreetMap and/or Geoapify when you use those sources, and their place results come back. Nothing is sold or shared otherwise.

**Does it send emails or WhatsApps by itself?** No. You send them.

**Can it find phone numbers for people (not businesses)?** No, and it should not. It collects business contact details that organisations publish themselves.

**Can I change how the assistant talks?** Yes. The tone rules live in `lib/agent.js` (`salesPrompt`), and facts come from the Products tab. Ask your developer for tone changes.

**How many leads can it hold?** Thousands comfortably, including their tasks and activity. If you reach tens of thousands, ask for a database upgrade.

---

## 10. Glossary

- **Lead**: a business that might become a customer.
- **Inbound lead**: someone who contacted *you* (chat/Telegram).
- **Outbound**: you contacting them first.
- **Pipeline / stage**: where a deal sits between *new* and *won* or *lost*.
- **Weighted forecast**: open deal value adjusted by how likely each stage is to close. It is a planning hint, not a promise.
- **Owner**: the team member named on a lead. It is a label, not a separate login.
- **Task / follow-up**: a dated next action on a lead. Due tasks appear on **Today**.
- **Merge**: combine a duplicate lead into the record you keep, moving contacts, tasks and history across.
- **Provider / engine**: the AI service behind the assistant (Gemini, Groq, Ollama).
- **Failover**: automatically switching to another engine when one is unavailable.
- **Widget**: the chat bubble on your website.
- **Score**: how many contact methods a lead has (higher = easier to reach).
- **Geoapify**: an optional free-plan place search. It uses credits (3,000/day) and is off unless you add a key; keep its OpenStreetMap/Geoapify attribution visible.
- **Do-not-contact**: a lead that asked not to be messaged.
