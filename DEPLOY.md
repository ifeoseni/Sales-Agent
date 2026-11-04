# Deploying the Code Tech Revenue Desk

This guide takes you from "runs on my PC" to "customers chat with it on codetechcl.com", for **zero or near-zero cost**, and keeps it safe and running.

> **Status of these instructions.** The application itself (server, security, lead finder, tests) is verified on Windows with Node 25. The Docker, Caddy, systemd, Cloudflare and Oracle recipes below follow each tool's standard documented usage but were **not executed** by the author (no Docker or cloud account was available). Do a test deployment, run the §9 checklist, and expect small differences as vendors change their consoles and free-tier terms. **Check each provider's current free-tier terms before relying on them.**

---

## 0. Pick your hosting

| | A. Your Windows PC + Cloudflare Tunnel | B. Free Linux VM (Oracle / Google Cloud) | C. Docker Compose on any server | D. "Free web host" (Render, Koyeb, etc.) |
|---|---|---|---|---|
| Cost | Free | Free tier, card needed to sign up | Cost of the server | Free tier |
| Stays online 24/7 | Only while the PC is on and awake | Yes | Yes | Often sleeps when idle |
| Data survives | Yes (your disk) | Yes (VM disk) | Yes (Docker volume) | **Usually no** (disk is wiped) |
| Setup effort | Low | Medium | Medium | Low |
| Best for | **Starting out, testing, small volume** | **Running it properly for free** | Teams that already use Docker | Not recommended |

**Recommendation:** start with **A** this week. Move to **B** when you want it online 24/7 without a PC.

What you need in every case:
- Node.js **22 or newer** (or Docker).
- A free AI key (Gemini and/or Groq). See USER_GUIDE §2.
- For the website chat widget: a **public HTTPS address** for the agent, e.g. `https://agent.codetechcl.com`. You need control of the DNS for `codetechcl.com` (your domain registrar or hosting panel) to create that subdomain.

---

## 1. Run it locally first (all options)

```bash
cd C:\Users\Oseni\Desktop\aiagent
node server.js
```
Open http://localhost:3000. Note the **first-run password** printed once. Then in the dashboard: Settings → add AI key → **Test** → Products → Sales chat.

Optional: copy `.env.example` to `.env` and fill it in (the file is read automatically on start). Never commit or share `.env`.

Run the tests any time: `npm test` (57 tests: security, sanitising, scraping, search, Geoapify mapping, CRM dashboard/tasks/bulk/merge, and the full API against a mock AI).

---

## 2. Option A: Windows PC + Cloudflare Tunnel (free)

Cloudflare Tunnel gives your PC a secure public HTTPS address **without opening any router ports**.

### 2.1 Keep the agent running
1. In `.env` set:
   ```
   TRUST_PROXY=1
   ADMIN_PASSWORD=choose-a-long-passphrase
   ```
   (`TRUST_PROXY=1` is required behind a tunnel: it makes the agent see each visitor's real IP, so rate limits and brute-force protection work. Never set it if the agent is exposed directly to the internet.)
2. Make it start with Windows. The folder contains `run-agent.bat` (starts the agent and writes `agent.log`). In an **Administrator PowerShell** (adjust the folder):
   ```powershell
   schtasks /Create /TN "CodeTechAgent" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "C:\Users\Oseni\Desktop\aiagent\run-agent.bat"
   schtasks /Run /TN "CodeTechAgent"
   ```
   The task runs as SYSTEM, so Node must be installed for all users (the official installer does this; check with `where node`). Because nobody sees a window, **set `ADMIN_PASSWORD` in `.env`** instead of relying on the one-time password. To stop it: `schtasks /End /TN CodeTechAgent`.
3. Stop Windows sleeping: *Settings → System → Power → Screen and sleep → Sleep: Never* (plugged in).

### 2.2 Public address, quick test (temporary)
```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```
It prints a random `https://something.trycloudflare.com`. Good for trying the widget. **The address changes every time**, so it is not for production.

### 2.3 Public address, permanent (recommended)
Requires a free Cloudflare account and your domain's DNS to be on Cloudflare (Cloudflare walks you through changing nameservers; email and website keep working if you copy your existing DNS records first).

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** (Cloudflared) → name it `codetech-agent`.
2. Copy the install command it shows for Windows (it contains a token) and run it in an Administrator PowerShell. This installs `cloudflared` as a Windows service that starts automatically.
3. Add a **Public hostname**: subdomain `agent`, domain `codetechcl.com`, service type **HTTP**, URL `localhost:3000`.
4. Open `https://agent.codetechcl.com`: you should see the dashboard login.

(Console labels change over time; follow Cloudflare's current "Create a tunnel" wizard if the names differ.)

**Important:** the tunnel is also the way into your **dashboard**. That is safe because login is protected, but for extra safety you can restrict `/` and `/api/*` (except `/api/public/*`, `/embed.html`, `/embed.js`, `/widget.js`) with *Cloudflare Access* (free for small teams). See §7.

---

## 3. Option B: Always-free Linux VM (Ubuntu) with HTTPS

Works the same on Oracle Cloud "Always Free", Google Cloud e2-micro, or any cheap VPS. Steps are for **Ubuntu 22.04/24.04**.

### 3.1 Create the VM
- Oracle Cloud: *Compute → Instances → Create* → Ubuntu image → an **Always Free-eligible** shape. You will need to verify with a card (not charged for free resources). If a region says "out of capacity", retry later or pick another shape.
- Note the VM's **public IP**.
- **Open ports 80 and 443** in the cloud firewall (Oracle: *VCN → Security List → Add Ingress Rules* for TCP 80 and 443 from `0.0.0.0/0`; Google: *VPC firewall rules*).
- **DNS:** at your domain provider add an **A record**: `agent.codetechcl.com` → the VM's public IP.

### 3.2 Prepare the server
```bash
ssh ubuntu@YOUR_IP
sudo apt update && sudo apt -y upgrade
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v          # v22.x

# On Oracle Ubuntu images, also open the OS firewall:
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo apt install -y iptables-persistent && sudo netfilter-persistent save
```

### 3.3 Install the agent
On **your PC** (PowerShell), pack the code without your local data and upload it:
```powershell
cd C:\Users\Oseni\Desktop\aiagent
tar --exclude=data --exclude=backups --exclude=.env -czf agent.tgz .
scp agent.tgz ubuntu@YOUR_IP:~
```
On the **server**:
```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin codetech || true
sudo mkdir -p /opt/codetech-agent && sudo tar -xzf ~/agent.tgz -C /opt/codetech-agent
sudo mkdir -p /opt/codetech-agent/data
sudo cp /opt/codetech-agent/.env.example /opt/codetech-agent/.env
sudo nano /opt/codetech-agent/.env        # set ADMIN_PASSWORD, GEMINI_API_KEY / GROQ_API_KEY
sudo chown -R codetech:codetech /opt/codetech-agent
sudo chmod 600 /opt/codetech-agent/.env

sudo cp /opt/codetech-agent/deploy/codetech-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now codetech-agent
sudo systemctl status codetech-agent       # should say "active (running)"
curl -s localhost:3000/healthz             # {"ok":true}
```

### 3.4 HTTPS with Caddy (automatic free certificate)
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
agent.codetechcl.com {
	encode gzip
	reverse_proxy localhost:3000
}
EOF
sudo systemctl reload caddy
```
Wait about a minute, then open `https://agent.codetechcl.com`. The service file already sets `TRUST_PROXY=1` and `HOST=127.0.0.1`, so only Caddy can reach the agent.

Optional host firewall: `sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable`.

---

## 4. Option C: Docker Compose (any server with Docker)

```bash
git clone <your private repo> codetech-agent   # or upload the folder
cd codetech-agent
cp .env.example .env
nano .env        # DOMAIN=agent.codetechcl.com, ADMIN_PASSWORD=..., AI key(s)
docker compose up -d --build
docker compose logs -f agent
```
- `docker-compose.yml` runs the agent plus **Caddy**, which gets and renews the HTTPS certificate. Point your DNS A record at the server first, and open ports 80/443.
- Data lives in the Docker volume `agent-data`. **Do not run `docker compose down -v`**: `-v` deletes the volume (your leads).
- Test without a domain: `docker build -t codetech-agent . && docker run -p 3000:3000 -v agent-data:/data -e ADMIN_PASSWORD=change-me codetech-agent`, then open http://localhost:3000.

---

## 5. Option D: Free "platform" hosts (Render, Koyeb, Railway-style)

Possible, but weak for this app:
- Free tiers usually **sleep when idle** (the first chat message waits ~30 s) and have an **ephemeral disk**: leads, chats and settings are **lost** on every redeploy or restart unless you attach a paid persistent disk.
- If you still use one: set everything through environment variables (`ADMIN_PASSWORD`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `GEOAPIFY_API_KEY`, `TELEGRAM_BOT_TOKEN`, `HOST=0.0.0.0`, `TRUST_PROXY=1`, `NODE_VERSION=22` where relevant), start command `node server.js`, health check `/healthz`, and **export leads to CSV daily**.
- Telegram long-polling keeps the service awake on some hosts and not on others; do not depend on it.

---

## 6. Put the chat widget on codetechcl.com

1. Open `https://agent.codetechcl.com` → **Settings → Website chat widget** → copy the line:
   ```html
   <script src="https://agent.codetechcl.com/widget.js" defer></script>
   ```
2. Paste it **just before `</body>`** on every page (or in a site-wide footer-scripts area):
   - **WordPress:** plugin *WPCode* or *Insert Headers and Footers* → Footer.
   - **Wix:** *Settings → Custom Code → Add code → Body – end*, all pages.
   - **Shopify:** *Online Store → Themes → Edit code → theme.liquid*, before `</body>`.
   - **Plain HTML / Next.js / React:** add it to the layout/template file.
3. Reload your site: a green chat bubble appears bottom-right.

Troubleshooting the widget:
- No bubble: open the browser console. A *Mixed Content* error means the script URL starts with `http://`; use `https://`. A *Content-Security-Policy* error means your website restricts scripts/frames: allow `https://agent.codetechcl.com` in `script-src` and `frame-src`.
- Bubble but "assistant unavailable": the AI key is missing or rate-limited (Settings → Test).
- The widget runs in an iframe from your agent's domain, so it can't read anything from your website, and your website can't read the chat.

---

## 7. Production security checklist (do all before going public)

- [ ] **Strong dashboard password** (passphrase of 4+ random words) set via `ADMIN_PASSWORD` or changed in Settings.
- [ ] **HTTPS only** (Caddy or Cloudflare). The agent marks cookies `Secure` when it sees HTTPS via `TRUST_PROXY`.
- [ ] `TRUST_PROXY=1` **only** when behind your own proxy/tunnel; `HOST=127.0.0.1` unless in Docker.
- [ ] `.env` and `data/` are **not** in any git repo or public folder (`.gitignore` covers this). `chmod 600 .env`.
- [ ] **AI keys** are free-tier keys with no billing attached (so a leak cannot cost money), and you know how to revoke them.
- [ ] **Backups** scheduled (§8) and a restore tested once.
- [ ] Optional: protect the dashboard with **Cloudflare Access** (free) or an IP allow-list so only your team can even reach the login page. Keep `/api/public/*`, `/embed.html`, `/embed.js`, `/widget.js`, `/healthz` public.
- [ ] Widget caps are sensible: public chat is limited to 12 messages/minute per visitor and a daily total (default 300, change `widget.dailyCap` in `data/settings.json` or ask your developer) to protect your free AI quota.
- [ ] You told visitors they talk to an AI and that chats are stored (the widget does this), and you have a way to delete someone's data on request.

Built-in protections you do not need to configure: scrypt-hashed password, signed HttpOnly SameSite=Strict session cookie, login lockout (8 failures per 10 minutes per IP, plus a global ceiling), CSRF origin checks, strict Content-Security-Policy, input validation on everything stored, `javascript:` links blocked, spreadsheet-formula neutralising on CSV export, SSRF guard on the crawler (refuses localhost / private / cloud-metadata addresses, re-checks redirects), robots.txt respected, prompt-injection fencing on scraped text, rate limits on all public endpoints.

---

## 8. Operating it

### Where is my data?
`data/` next to `server.js` (or `DATA_DIR`, or the `agent-data` Docker volume):
`leads.json`, `conversations.json`, `products.json`, `settings.json` (**contains your API keys; treat as secret**).

### What is in a lead now?
Each record in `leads.json` holds the business contacts, stage, deal value, priority, owner, tags, notes, tasks and activity timeline. The Today, Pipeline and analytics views are computed from that one file when the dashboard asks for `/api/dashboard`; there is no separate CRM database or background worker to maintain. Per lead, history is capped at 50 tasks and 120 activity entries, so the file stays bounded.

**Backups cover the CRM too.** `npm run backup` copies `leads.json` with tasks and activity intact. CSV export includes stage, priority, value, tags, owner and the next follow-up date, but **not** the full task list or activity history — use the JSON backup when you need a complete restore. Restoring an older `leads.json` also restores the pipeline and follow-ups as they were at that moment.

### Backups
```bash
npm run backup        # copies the .json files to backups/<timestamp>/, keeps 14
```
Schedule it:
- **Linux:** `crontab -e` → `0 2 * * * cd /opt/codetech-agent && DATA_DIR=/opt/codetech-agent/data /usr/bin/node scripts/backup.mjs >/dev/null 2>&1`
- **Windows:** `schtasks /Create /TN "CodeTechBackup" /SC DAILY /ST 02:00 /TR "cmd /c cd /d C:\Users\Oseni\Desktop\aiagent && npm run backup"`
- **Docker:** `docker run --rm -v agent-data:/data -v "$PWD/backups:/b" alpine sh -c "cp /data/*.json /b/"`

Also copy backups **off the machine** (Google Drive, another PC). And use *Leads → Export CSV* weekly. **Restore:** stop the agent, copy the `.json` files back into `data/`, start the agent.

### Updating
1. Back up.
2. Replace the code files (everything except `data/`, `backups/`, `.env`), or `git pull`.
3. Restart: Windows `schtasks /End /TN CodeTechAgent` then `/Run`; Linux `sudo systemctl restart codetech-agent`; Docker `docker compose up -d --build`.
4. Run the checklist in §9.

### Monitoring
- Health URL: `https://agent.codetechcl.com/healthz` returns `{"ok":true}`.
- Free uptime alerts: UptimeRobot or Better Stack free plan, pointing at the health URL, emailing you when it fails.
- Logs: Linux `journalctl -u codetech-agent -f`; Docker `docker compose logs -f agent`; Windows `agent.log`.

### Lost password
Stop the agent, run `npm run reset-password` (on Docker: delete `passwordHash` from `settings.json` in the volume), start the agent, read the new one-time password in the log. This also signs everyone out. If `ADMIN_PASSWORD` is set, change it in `.env` instead.

### Rotating keys
Create a new key at Google/Groq, paste in Settings (or `.env`), press **Test**, then delete the old key at the provider. If a key leaks, revoke it at the provider immediately.

### Telegram in production
The bot uses long polling, so **no webhook or open port is needed**. Run **only one copy** of the agent per bot token: two instances fight and Telegram returns "409 Conflict" (and the bot goes quiet). If you move servers, stop the old one first.

### Capacity and limits
- One small VM easily handles a small business: hundreds of chats a day.
- The real limit is the **free AI quota**. Use two engines with failover, and keep the daily cap. Geoapify's optional free search has its own 3,000 credits/day limit.
- Data is stored in JSON files: comfortable for thousands of leads plus their tasks and activity. Beyond tens of thousands, or several agent instances, move to a database (a future upgrade). The dashboard and analytics are recalculated from `leads.json` on request; a very large file will make those pages slower before it breaks anything.
- Single instance only: don't run two copies against the same `data/` folder.

### Uninstalling
Stop the service/task, delete the folder (after exporting leads), remove the DNS record/tunnel, and revoke the AI keys.

---

## 9. Post-deployment checklist

Run from any computer (replace the domain):

```bash
curl -s https://agent.codetechcl.com/healthz                  # {"ok":true}
curl -sI https://agent.codetechcl.com/ | grep -i "content-security-policy\|x-content-type"   # headers present
curl -s -o /dev/null -w "%{http_code}\n" https://agent.codetechcl.com/api/leads              # 401 (locked)
curl -s https://agent.codetechcl.com/api/public/info                                          # company + product names
```
Then by hand:
- [ ] Log in at the dashboard; **Settings → Test** shows **Working ✓** for your engine.
- [ ] **Today** loads with pipeline, target and follow-up numbers (empty is fine on a fresh install).
- [ ] Add a test lead, set a value and stage, drag it on **Pipeline**, add a task due today, and confirm it appears on **Today**. Delete the test lead afterwards.
- [ ] Set **Settings → Sales goals** currency and monthly target; the sidebar goal and Today ring use them.
- [ ] **Sales chat** replies sensibly and accurately.
- [ ] On your **website**, the bubble appears and answers; leave a test phone number and see it appear in **Leads** as `inbound:website`.
- [ ] **Find leads** → *Have a list of websites?* with 2–3 real company sites returns contacts. (This path never depends on a search engine.) A plain web search may report "blocked": that is the search engine, not a fault of your deployment.
- [ ] Telegram: `/start` answers; `/claim <password>` works; a test inbound lead sends you an alert.
- [ ] Reboot the machine: the agent comes back by itself and you are still able to log in.
- [ ] `npm run backup` runs; you can find the backup file.
- [ ] From your phone's mobile data (not your Wi-Fi), the website chat works.

---

## 11. Optional: dependable web search with your own SearXNG

The built-in web search scrapes DuckDuckGo, which temporarily blocks automated searches (the agent detects this and tells the user). **SearXNG** is a free, open-source metasearch engine you run yourself; it queries several engines for you and returns clean JSON. It is the recommended upgrade if web search matters to you. (Written from SearXNG's documented behaviour; not run by the author. Engines can still throttle it, but it spreads queries across several.)

```bash
docker run -d --name searxng --restart unless-stopped -p 127.0.0.1:8080:8080 -v searxng-config:/etc/searxng searxng/searxng
docker exec searxng sh -c "grep -n 'formats' /etc/searxng/settings.yml"     # find the search: section
```
Edit `settings.yml` in the volume so the `search:` section allows JSON:
```yaml
search:
  formats:
    - html
    - json
```
Restart (`docker restart searxng`), test `curl "http://127.0.0.1:8080/search?q=hotel+lagos&format=json" | head -c 300`, then in the dashboard: **Settings → Web search → SearXNG address** = `http://127.0.0.1:8080` (if the agent itself runs in Docker Compose, use the SearXNG container's service name instead of 127.0.0.1). **Never expose SearXNG to the internet** without protection; keep it bound to `127.0.0.1` as above.

If the JSON call returns 403, the `json` format isn't enabled yet.

---

## 12. Optional: Geoapify place search (free plan)

Geoapify provides OpenStreetMap-based place search and place details. It is **optional and free within its plan**: 3,000 credits/day, up to 5 requests/second, no card. The dashboard keeps it off unless you add a key.

1. Create a free key at [myprojects.geoapify.com](https://myprojects.geoapify.com/) (no card).
2. In the dashboard: **Settings → Geoapify places**, paste the key, press **Test key (uses 1 credit)**.
3. In **Find leads**, tick **Geoapify places**. The agent geocodes the area, searches a matching category, then reads each place's public phone, email, website and address. It only recognises its supported business categories; unusual wording gets a clear message suggesting OpenStreetMap, web search or a website list.

Credits: 1 to geocode the area, 1 per 20 listing results, and 1 per place-detail request. A typical 15-lead search uses about 30 of the 3,000 daily credits. You can also set `GEOAPIFY_API_KEY` in `.env`; it overrides the dashboard value.

**Attribution is mandatory on the free plan.** The Find leads page displays **© OpenStreetMap contributors** and **Powered by Geoapify**; do not remove it. Geoapify's docs allow caching/storing results, and the data is OSM (ODbL). Confirm Geoapify's current free-tier terms before relying on it. If you never use Geoapify, leave the field empty and the other sources behave exactly as before.

**Apollo was removed.** Apollo's current terms allow some internal business use, but they impose broad API/data restrictions and Apollo is credit-based/paid. There is no Apollo code, key, or request left in this app. If you have an old `APOLLO_API_KEY` in `.env` or an old `apollo.apiKey` in `data/settings.json`, delete it and revoke the key at Apollo.

---

## 13. Quick reference

| Variable | Purpose | Default |
|---|---|---|
| `ADMIN_PASSWORD` | Fixes the dashboard password (overrides the stored one) | one-time generated |
| `SESSION_SECRET` | Stable login-cookie secret | generated, stored in `data/` |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | Free AI keys (override Settings) | none |
| `GEOAPIFY_API_KEY` | Optional Geoapify free-plan key (overrides Settings) | none |
| `TELEGRAM_BOT_TOKEN` | Telegram bot (overrides Settings) | none |
| `PORT` | Port to listen on | `3000` |
| `HOST` | Interface to bind (`127.0.0.1` local only, `0.0.0.0` all) | `127.0.0.1` |
| `TRUST_PROXY` | `1` when behind your own proxy/tunnel | off |
| `DATA_DIR` | Where JSON data is stored | `./data` |
| `BACKUP_DIR` | Where `npm run backup` writes | `./backups` |

| Command | What it does |
|---|---|
| `npm start` | Run the agent |
| `npm test` | Run all 57 tests |
| `npm run backup` | Back up data |
| `npm run reset-password` | Clear the password; a new one prints at next start |
