import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, uid } from './lib/store.js';

/* ---------- request tracing for production observability ---------- */
let requestId = 0;
const log = (level, msg, meta = {}) => {
  const ts = new Date().toISOString();
  const prefix = level === 'error' ? 'ERR' : level === 'warn' ? 'WRN' : 'INF';
  const parts = [`[${ts}]`, prefix, msg];
  if (meta.id) parts.push(`rid=${meta.id}`);
  if (meta.duration) parts.push(`dur=${meta.duration}ms`);
  if (meta.status) parts.push(`status=${meta.status}`);
  if (meta.method) parts.push(`method=${meta.method}`);
  if (meta.path) parts.push(`path=${meta.path}`);
  if (meta.error) parts.push(`error=${String(meta.error).slice(0, 120)}`);
  console.log(parts.join(' '));
};

try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env file */ }

const { getSettings, publicSettings, updateSettings, verifyPassword, setPassword, issueToken, checkToken, passwordFromEnv } = await import('./lib/settings.js');
const { getProducts, setProducts } = await import('./lib/products.js');
const { chat, ollamaModels, PROVIDERS } = await import('./lib/llm.js');
const { reply, resetConversation, draftOutreach, draftIcebreaker, matchProduct, flushConversations } = await import('./lib/agent.js');
const L = await import('./lib/leads.js');
const { findLeads, enrichLead, enrichLeadOnline, leadsFromUrls } = await import('./lib/leadfinder.js');
const { geoapifyTest } = await import('./lib/geoapify.js');
const { startTelegram, stopTelegram, testChannel } = await import('./lib/telegram.js');
const { verifyEmailMx } = await import('./lib/verify.js');
const { testWebhook } = await import('./lib/webhook.js');
const { getRates } = await import('./lib/currency.js');
const { allow, blocked, record, clear, underDailyCap } = await import('./lib/ratelimit.js');
const { explee } = await import('./lib/explee.js');
const { discoverPeople, discoverCompanies, saveDiscovered } = await import('./lib/explee-discovery.js');

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
// Only trust proxy headers when the app really sits behind your own proxy/tunnel (Cloudflare, Caddy, Nginx).
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
const PUBLIC_DIR = path.join(ROOT, 'public');
// A new URL for every asset change: Cloudflare caches CSS/JS for four hours, so
// a fixed /style.css can pair new HTML with an old stylesheet (oversized logos).
const ASSET_V = (() => {
  try {
    const hash = crypto.createHash('sha1');
    for (const f of ['style.css', 'app.js', 'embed.js', 'logo.png', 'logo-mark.png', 'favicon.png', 'apple-touch-icon.png']) {
      hash.update(fs.readFileSync(path.join(PUBLIC_DIR, f)));
    }
    return hash.digest('hex').slice(0, 10);
  } catch {
    return String(Date.now());
  }
})();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'";

/* ---------- request helpers ---------- */
function clientIp(req) {
  if (TRUST_PROXY) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return String(cf).trim();
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1]; // the entry our own proxy appended; earlier ones are client-controlled
  }
  return req.socket.remoteAddress || 'unknown';
}
const isHttps = (req) => !!req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
const cookie = (req, name) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];
const authed = (req) => checkToken(cookie(req, 'ct_sid'));

function setSession(req, res) {
  res.setHeader('set-cookie', `ct_sid=${issueToken(7)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}${isHttps(req) ? '; Secure' : ''}`);
}

const SEC_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEC_HEADERS });
  res.end(JSON.stringify(data));
};

async function readJson(req, limit = 200_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Request too large'), { code: 413 });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const v = raw ? JSON.parse(raw) : {};
  if (v === null || typeof v !== 'object') throw new SyntaxError('Expected a JSON object or array');
  return v;
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, SEC_HEADERS);
    return res.end('Not found');
  }
  const ext = path.extname(file);
  const headers = { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300', ...SEC_HEADERS };
  if (ext === '.html') {
    headers['content-security-policy'] = rel === '/embed.html' ? CSP + '; frame-ancestors *' : CSP + "; frame-ancestors 'none'";
    const html = fs.readFileSync(file, 'utf8').replaceAll('__ASSET_V__', ASSET_V);
    headers['content-length'] = Buffer.byteLength(html);
    res.writeHead(200, headers);
    return res.end(html);
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

/* ---------- background lead-finder jobs ---------- */
const jobs = new Map();

function startJob(params, run = findLeads) {
  const id = uid();
  const job = { id, status: 'running', progress: ['Starting…'], leads: [], warnings: [], error: null, ctl: { cancelled: false } };
  jobs.set(id, job);
  if (jobs.size > 30) jobs.delete(jobs.keys().next().value);
  run(params, (p) => job.progress.push(p), job.ctl)
    .then((r) => { job.leads = r.leads; job.warnings = r.warnings; job.scanned = r.scanned; job.status = 'done'; })
    .catch((e) => { job.error = e.message; job.status = 'error'; });
  return job;
}
const publicJob = ({ ctl, ...j }) => j;

const str = (v, max) => String(v ?? '').trim().slice(0, max);

/** "NG, GH", ["NG","GH"] or "" (worldwide) -> ["NG","GH"]. */
const isoCountries = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,\s]+/))
  .map((c) => String(c).trim().toUpperCase())
  .filter((c) => /^[A-Z]{2}$/.test(c))
  .slice(0, 20);

/** Free fallback: Explee gives leads; the contact agent finds email/phone when Explee's result had none. */
function huntMissingContacts(leads) {
  const need = (leads || []).filter((l) => l && !(l.emails || []).length && !(l.phones || []).length);
  if (!need.length) return null;
  const job = startJob({ ids: need.map((l) => l.id) }, async ({ ids }, progress, ctl) => {
    const found = [];
    for (const id of ids) {
      if (ctl.cancelled) break;
      try {
        const r = await enrichLeadOnline(id, { force: true });
        if (r.updated) found.push(r.lead);
        progress(`${L.getLead(id)?.name || id}: ${r.updated ? 'contacts found' : 'nothing public found'}`);
      } catch (e) { progress(`${id}: ${e.message}`); }
    }
    return { leads: found, warnings: [], scanned: ids.length };
  });
  return job.id;
}

/** Maps an Explee failure to an HTTP status the dashboard can act on. */
function expleeFailure(res, e) {
  const code = e?.code || 'explee_error';
  const status = /free_zone|rate_limited/.test(code) ? 429
    : /paid_disabled|lifetime_cap|pace_limit|balance_floor|payment_required/.test(code) ? 402
      : /not_configured|invalid_input|bad_request/.test(code) ? 400
        : e?.status === 422 ? 422
          : 502;
  return json(res, status, {
    error: e?.message || 'Explee request failed',
    code,
    ...(e?.retryAfter ? { retryAfter: e.retryAfter } : {}),
  });
}

/* ---------- routes ---------- */
async function api(req, res, url) {
  const m = req.method;
  const p = url.pathname;
  const ip = clientIp(req);

  if (p === '/healthz') {
    const s = getSettings();
    const health = {
      ok: true,
      uptime: Math.floor(process.uptime()),
      version: '1.2.0',
      provider: s.provider,
      providers: { gemini: !!s.providers.gemini.apiKey, groq: !!s.providers.groq.apiKey, ollama: !!s.providers.ollama.model },
      geoapify: !!s.geoapify.apiKey,
      explee: !!s.explee.apiKey,
      leadCount: L.stats().total,
    };
    return json(res, 200, health);
  }

  // public: website chat widget
  if (p === '/api/public/chat' && m === 'POST') {
    if (!allow('pub:' + ip, 12, 60_000)) return json(res, 429, { error: 'Too many messages, please try again shortly.' });
    if (!underDailyCap(getSettings().widget.dailyCap)) return json(res, 503, { error: 'We are very busy today. Please contact us directly.' });
    const { sessionId, message } = await readJson(req, 20_000);
    if (!/^[\w-]{8,64}$/.test(sessionId || '') || typeof message !== 'string' || !message.trim()) return json(res, 400, { error: 'Bad request' });
    try {
      const r = await reply('web:' + sessionId, 'website', message.trim().slice(0, 1000));
      return json(res, 200, { reply: r.text });
    } catch (e) {
      log('error', 'public chat error', { error: e.message });
      return json(res, 503, { error: 'Our assistant is unavailable right now. Please contact us directly.' });
    }
  }
  if (p === '/api/public/reset' && m === 'POST') {
    const { sessionId } = await readJson(req, 2000);
    if (/^[\w-]{8,64}$/.test(sessionId || '')) resetConversation('web:' + sessionId);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/public/info' && m === 'GET') {
    const c = getSettings().company;
    return json(res, 200, { name: c.name, products: getProducts().filter((x) => x.status !== 'hidden').map((x) => x.name), version: '1.2.0' });
  }

  if (p === '/api/login' && m === 'POST') {
    if (blocked('login:' + ip, 8, 600_000) || blocked('login:all', 60, 3_600_000)) return json(res, 429, { error: 'Too many attempts. Wait 10 minutes.' });
    const { password } = await readJson(req, 2000);
    if (!verifyPassword(password)) {
      record('login:' + ip);
      record('login:all');
      return json(res, 401, { error: 'Wrong password' });
    }
    clear('login:' + ip);
    setSession(req, res);
    return json(res, 200, { ok: true });
  }

  // everything below needs the admin session
  if (!authed(req)) return json(res, 401, { error: 'Not logged in' });

  // CSRF: browsers always send Origin on cross-site writes; it must match this host.
  if (m !== 'GET' && req.headers.origin) {
    let ok = false;
    try { ok = new URL(req.headers.origin).host === req.headers.host; } catch { /* "null" origin */ }
    if (!ok) return json(res, 403, { error: 'Bad origin' });
  }

  if (p === '/api/logout' && m === 'POST') {
    res.setHeader('set-cookie', `ct_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/settings') {
    if (m === 'GET') return json(res, 200, publicSettings());
    if (m === 'PUT') {
      const body = await readJson(req);
      const { newPassword, currentPassword } = body;
      if (newPassword) {
        if (!verifyPassword(currentPassword)) return json(res, 400, { error: 'Current password is wrong' });
        try { setPassword(newPassword); } catch (e) { return json(res, 400, { error: e.message }); }
        setSession(req, res); // old sessions die with the old password; keep this one signed in
      }
      const out = updateSettings(body);
      startTelegram();
      return json(res, 200, out);
    }
  }

  if (p === '/api/settings/test-webhook' && m === 'POST') {
    const { url, secret } = await readJson(req, 5000);
    try {
      return json(res, 200, await testWebhook(url, secret));
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (p === '/api/rates' && m === 'GET') {
    return json(res, 200, await getRates());
  }

  if (p === '/api/stats' && m === 'GET') return json(res, 200, L.stats());
  if (p === '/api/dashboard' && m === 'GET') return json(res, 200, L.dashboard());

  if (p === '/api/products') {
    if (m === 'GET') return json(res, 200, getProducts());
    if (m === 'PUT') {
      const body = await readJson(req);
      if (!Array.isArray(body) || body.length > 50) return json(res, 400, { error: 'Expected a list of up to 50 products' });
      return json(res, 200, setProducts(body));
    }
  }

  if (p === '/api/ollama/models' && m === 'GET') {
    try { return json(res, 200, await ollamaModels(getSettings().providers.ollama.host)); }
    catch { return json(res, 200, []); }
  }

  if (p === '/api/provider/test' && m === 'POST') {
    const { provider } = await readJson(req, 2000);
    if (!PROVIDERS.includes(provider)) return json(res, 400, { error: 'Unknown provider' });
    try {
      const r = await chat({ provider, system: 'Reply with the single word: ok', messages: [{ role: 'user', content: 'ping' }], temperature: 0 });
      return json(res, 200, { ok: true, reply: r.text.slice(0, 40) });
    } catch (e) { return json(res, 200, { ok: false, error: e.message }); }
  }

  if (p === '/api/geoapify/test' && m === 'POST') {
    const key = getSettings().geoapify.apiKey;
    if (!key) return json(res, 400, { error: 'Add a Geoapify API key first' });
    try {
      const r = await geoapifyTest(key);
      return json(res, 200, { ok: true, ...r });
    } catch (e) { return json(res, 200, { ok: false, error: e.message }); }
  }

  if (p === '/api/telegram/test-channel' && m === 'POST') {
    const { channelId } = await readJson(req, 2000).catch(() => ({}));
    try {
      return json(res, 200, await testChannel(channelId));
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (p === '/api/chat' && m === 'POST') {
    const started = Date.now();
    const { sessionId, message, reset } = await readJson(req, 20_000);
    const key = 'admin:' + str(sessionId || 'default', 40);
    if (reset) { resetConversation(key); return json(res, 200, { ok: true }); }
    try {
      const r = await reply(key, 'dashboard', str(message, 1500));
      log('info', 'chat answered', { duration: Date.now() - started, provider: r.provider });
      return json(res, 200, { reply: r.text, provider: r.provider });
    } catch (e) {
      const detail = e.message;
      log('error', 'chat failed', { duration: Date.now() - started, error: detail });
      // 429/5xx/timeouts mean "busy", not "broken": give the admin a next step.
      const busy = /HTTP (429|500|502|503|504)|timed? ?out|aborted|busy|overload|high demand|UNAVAILABLE/i.test(detail);
      const error = busy
        ? 'The AI engines are busy right now. Please try again in a minute, or add a second free key in Settings → AI.'
        : detail;
      return json(res, 502, { error, detail });
    }
  }

  /* leads */
  if (p === '/api/leads' && m === 'GET') return json(res, 200, L.listLeads());
  if (p === '/api/leads' && m === 'POST') {
    const b = await readJson(req);
    if (!str(b.name, 200)) return json(res, 400, { error: 'name is required' });
    return json(res, 200, L.addLead({ ...b, source: 'manual' }));
  }
  if (p === '/api/leads/export.csv' && m === 'GET') {
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="leads.csv"', ...SEC_HEADERS });
    return res.end(L.toCsv());
  }
  if (p === '/api/leads/export.vcf' && m === 'GET') {
    res.writeHead(200, { 'content-type': 'text/vcard; charset=utf-8', 'content-disposition': 'attachment; filename="leads.vcf"', ...SEC_HEADERS });
    return res.end(L.toVcf());
  }
  if (p === '/api/leads/import' && m === 'POST') {
    const { csv } = await readJson(req, 5_000_000);
    return json(res, 200, L.importCsv(String(csv || '')));
  }
  if (p === '/api/leads/bulk' && m === 'POST') {
    const b = await readJson(req, 100_000);
    if (!Array.isArray(b.ids) || !b.ids.length) return json(res, 400, { error: 'Select at least one lead' });
    if (b.action === 'hunt') {
      const results = [];
      for (const id of b.ids.slice(0, 50)) {
        try {
          const r = await enrichLeadOnline(id, { force: !!b.force });
          results.push({ id, ...r });
        } catch (e) {
          results.push({ id, error: e.message });
        }
      }
      return json(res, 200, { results, updated: results.filter((r) => r.updated).length });
    }
    const actions = ['status', 'priority', 'owner', 'value', 'tag', 'task', 'delete'];
    if (!actions.includes(b.action)) return json(res, 400, { error: 'Unknown bulk action' });
    if (b.action === 'status' && !L.STATUSES.includes(b.status)) return json(res, 400, { error: 'Unknown stage' });
    if (b.action === 'priority' && !L.PRIORITIES.includes(b.priority)) return json(res, 400, { error: 'Unknown priority' });
    if (b.action === 'task' && !str(b.task?.title, 200)) return json(res, 400, { error: 'Task title is required' });
    return json(res, 200, L.bulkUpdate(b.ids, b.action, b));
  }
  if (p === '/api/leads/find' && m === 'POST') {
    const b = await readJson(req, 5000);
    const query = str(b.query, 80);
    const location = str(b.location || getSettings().lead.defaultLocation, 80);
    if (query.length < 2) return json(res, 400, { error: 'Enter what kind of business to look for' });
    if ([...jobs.values()].filter((j) => j.status === 'running').length >= 2) return json(res, 429, { error: 'Two searches are already running. Wait for one to finish.' });
    const sources = [].concat(b.sources || ['web', 'osm']).filter((x) => ['web', 'osm', 'geoapify'].includes(x));
    if (sources.includes('geoapify') && !getSettings().geoapify.apiKey) return json(res, 400, { error: 'Add a Geoapify API key in Settings, or untick Geoapify.' });
    const limit = Math.min(Math.max(Math.trunc(+b.limit) || 20, 1), 60);
    const job = startJob({ query, location, sources: sources.length ? sources : ['web', 'osm'], limit, product: str(b.product, 60) || matchProduct(query) });
    return json(res, 200, { jobId: job.id });
  }
  if (p === '/api/leads/from-urls' && m === 'POST') {
    const b = await readJson(req, 100_000);
    const urls = (Array.isArray(b.urls) ? b.urls : String(b.urls || '').split(/[\r\n,;]+/)).map((u) => str(u, 300)).filter(Boolean).slice(0, 300);
    if (!urls.length) return json(res, 400, { error: 'Paste at least one website address' });
    if ([...jobs.values()].filter((j) => j.status === 'running').length >= 2) return json(res, 429, { error: 'Two searches are already running. Wait for one to finish.' });
    const job = startJob({ urls, opts: { industry: str(b.industry, 80), location: str(b.location, 80), product: str(b.product, 60) } }, ({ urls: u, opts }, progress, ctl) => leadsFromUrls(u, opts, progress, ctl));
    return json(res, 200, { jobId: job.id });
  }

  /* Explee discovery: free-zone searches only, deduped against this CRM. */
  if (p === '/api/explee/status' && m === 'GET') {
    return json(res, 200, await explee.status());
  }
  if (p === '/api/explee/filters' && m === 'POST') {
    const b = await readJson(req, 5000);
    try { return json(res, 200, await explee.nlToFilters(str(b.query, 1000))); }
    catch (e) { return expleeFailure(res, e); }
  }
  if (p === '/api/explee/discover' && m === 'POST') {
    const b = await readJson(req, 20_000);
    const kind = b.kind === 'companies' ? 'companies' : 'people';
    const params = {
      limit: Math.min(Math.max(Math.trunc(+b.limit) || 20, 1), 100),
      // Each free request returns at most 10 and overlaps a little, so allow ~limit/10 + 2 requests (max 10). Asking for 50 leads uses about 7 of the 50 free daily requests; it never spends credits.
      maxPages: Math.min(Math.max(Math.trunc(+b.maxPages) || Math.ceil(Math.min(Math.max(Math.trunc(+b.limit) || 20, 1), 100) / 10) + 2, 1), 10),
      countries: isoCountries(b.countries ?? b.country ?? getSettings().explee.defaultCountries),
      minRelevance: Number.isFinite(Number(b.minRelevance)) ? Math.min(Math.max(Number(b.minRelevance), 0), 1) : undefined,
      product: str(b.product, 60),
      existing: L.listLeads(),
    };
    try {
      const out = kind === 'companies'
        ? await discoverCompanies(explee, { ...params, definition: str(b.definition, 300) })
        : await discoverPeople(explee, {
          ...params,
          jobTitles: b.jobTitles,
          companyDefinition: str(b.definition || b.companyDefinition, 300),
        });
      if (!b.save) return json(res, 200, { kind, items: out.items, stats: out.stats, cursor: out.cursor, saved: 0 });
      const saved = saveDiscovered(explee, out.items, { product: params.product, cursor: out.cursor });
      return json(res, 200, {
        kind,
        items: out.items,
        stats: out.stats,
        saved: saved.created,
        duplicatesAtSave: saved.duplicates,
        huntJobId: b.hunt === false ? null : huntMissingContacts(saved.leads),
      });
    } catch (e) { return expleeFailure(res, e); }
  }
  if (p === '/api/explee/save' && m === 'POST') {
    const b = await readJson(req, 500_000);
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 100);
    if (!items.length) return json(res, 400, { error: 'There are no leads to save' });
    const cursor = b.cursor && typeof b.cursor.key === 'string' ? { key: b.cursor.key.slice(0, 300), page: Math.trunc(+b.cursor.page) || 1 } : undefined;
    const saved = saveDiscovered(explee, items, { product: str(b.product, 60), cursor });
    return json(res, 200, { saved: saved.created, duplicates: saved.duplicates, leads: saved.leads, huntJobId: b.hunt === false ? null : huntMissingContacts(saved.leads) });
  }
  if (p === '/api/explee/enrich' && m === 'POST') {
    const b = await readJson(req, 5000);
    const known = b.leadId ? L.getLead(str(b.leadId, 40)) : null;
    if (known?.emails?.length && !b.force) return json(res, 200, { email: known.emails[0], skipped: true, reason: 'Lead already has an email — nothing was charged.', estimated_cost: 0 });
    try {
      const out = await explee.enrichEmail({
        firstName: b.firstName,
        lastName: b.lastName,
        companyDomain: b.companyDomain,
        preset: b.preset,
      });
      return json(res, 200, out);
    } catch (e) { return expleeFailure(res, e); }
  }
  if (p === '/api/explee/enrich-phone' && m === 'POST') {
    const b = await readJson(req, 5000);
    const known = b.leadId ? L.getLead(str(b.leadId, 40)) : null;
    if (known?.phones?.length && !b.force) return json(res, 200, { phone: known.phones[0], skipped: true, reason: 'Lead already has a phone — nothing was charged.', estimated_cost: 0 });
    try {
      const out = await explee.enrichPhone({
        linkedinUrl: b.linkedinUrl,
        email: b.email,
        preset: b.preset,
      });
      return json(res, 200, out);
    } catch (e) { return expleeFailure(res, e); }
  }

  const jobM = p.match(/^\/api\/jobs\/(\w+)(\/cancel)?$/);
  if (jobM) {
    const job = jobs.get(jobM[1]);
    if (!job) return json(res, 404, { error: 'Unknown job' });
    if (jobM[2] && m === 'POST') { job.ctl.cancelled = true; return json(res, 200, { ok: true }); }
    if (m === 'GET') return json(res, 200, publicJob(job));
  }

  const taskM = p.match(/^\/api\/leads\/([a-zA-Z0-9_-]+)\/tasks(?:\/([a-zA-Z0-9_-]+))?$/);
  if (taskM) {
    const [, id, taskId] = taskM;
    if (!L.getLead(id)) return json(res, 404, { error: 'Lead not found' });
    if (!taskId && m === 'POST') {
      const b = await readJson(req, 5000);
      if (!str(b.title, 200)) return json(res, 400, { error: 'Task title is required' });
      return json(res, 200, L.addTask(id, { title: b.title, due: b.due, priority: b.priority }));
    }
    if (taskId && m === 'PATCH') {
      const lead = L.updateTask(id, taskId, await readJson(req, 5000));
      return lead ? json(res, 200, lead) : json(res, 404, { error: 'Task not found' });
    }
    if (taskId && m === 'DELETE') {
      const lead = L.removeTask(id, taskId);
      return lead ? json(res, 200, lead) : json(res, 404, { error: 'Task not found' });
    }
  }

  const activityM = p.match(/^\/api\/leads\/([a-zA-Z0-9_-]+)\/activity$/);
  if (activityM && m === 'POST') {
    if (!L.getLead(activityM[1])) return json(res, 404, { error: 'Lead not found' });
    const { text } = await readJson(req, 5000);
    if (!str(text, 500)) return json(res, 400, { error: 'Write a note first' });
    return json(res, 200, L.addActivity(activityM[1], { type: 'note', text: str(text, 500) }));
  }

  const mergeM = p.match(/^\/api\/leads\/([a-zA-Z0-9_-]+)\/merge$/);
  if (mergeM && m === 'POST') {
    const { targetId } = await readJson(req, 2000);
    if (!str(targetId, 40)) return json(res, 400, { error: 'Choose the lead to keep' });
    const target = L.mergeLeads(mergeM[1], str(targetId, 40));
    return target ? json(res, 200, target) : json(res, 404, { error: 'One of the leads was not found' });
  }

  const leadM = p.match(/^\/api\/leads\/([a-zA-Z0-9_-]+)(?:\/(draft|enrich|hunt|verify-email|icebreaker))?$/);
  if (leadM) {
    const [, id, action] = leadM;
    const lead = L.getLead(id);
    if (!lead) return json(res, 404, { error: 'Lead not found' });
    if (!action && m === 'PATCH') return json(res, 200, L.updateLead(id, await readJson(req)));
    if (!action && m === 'DELETE') return json(res, 200, { ok: L.removeLead(id) });
    if (action === 'enrich' && m === 'POST') {
      try { return json(res, 200, await enrichLead(lead)); } catch (e) { return json(res, 502, { error: e.message }); }
    }
    if (action === 'hunt' && m === 'POST') {
      try { return json(res, 200, await enrichLeadOnline(id, { force: true })); } catch (e) { return json(res, 502, { error: e.message }); }
    }
    if (action === 'verify-email' && m === 'POST') {
      const email = lead.emails?.[0];
      if (!email) return json(res, 400, { error: 'This lead has no email on file to verify' });
      const health = await verifyEmailMx(email);
      const updated = L.updateLead(id, { emailHealth: health });
      L.addActivity(id, { type: 'enrich', text: `Email MX verified: ${health.provider || health.status} (${health.reason || health.primaryMx || health.status})` });
      return json(res, 200, { health, lead: updated });
    }
    if (action === 'icebreaker' && m === 'POST') {
      const b = await readJson(req, 2000).catch(() => ({}));
      try {
        const out = await draftIcebreaker(lead, b.product || lead.product);
        return json(res, 200, out);
      } catch (e) { return json(res, 502, { error: e.message }); }
    }
    if (action === 'draft' && m === 'POST') {
      if (lead.status === 'do-not-contact') return json(res, 400, { error: 'This lead is marked do-not-contact' });
      const { product, channel, step } = await readJson(req, 2000);
      const ch = ['email', 'whatsapp', 'dm'].includes(channel) ? channel : 'email';
      const st = ['cold', 'followup1', 'breakup'].includes(step) ? step : 'cold';
      try {
        const out = await draftOutreach(lead, product || lead.product, ch, st);
        L.addActivity(id, { type: 'draft', text: `Drafted ${ch} outreach (${st})` });
        return json(res, 200, out);
      } catch (e) { return json(res, 502, { error: e.message }); }
    }
  }

  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const rid = ++requestId;
  log('info', 'request', { id: rid, method: req.method, path: req.url });
  const start = Date.now();
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SEC_HEADERS); return res.end(); }
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    const bad = e instanceof SyntaxError;
    if (!bad && e.code !== 413) log('error', 'request failed', { id: rid, error: e });
    if (!res.headersSent) json(res, e.code === 413 ? 413 : bad ? 400 : 500, { error: e.code === 413 ? 'Request too large' : bad ? 'Invalid JSON' : 'Server error' });
  } finally {
    const dur = Date.now() - start;
    if (dur > 5000) log('warn', 'slow request', { id: rid, duration: dur, path: req.url });
  }
});
server.headersTimeout = 60_000;
server.requestTimeout = 90_000;
server.keepAliveTimeout = 10_000;
// Close idle keep-alive connections during shutdown so lingering sockets don't hold the process open.
let connections = new Set();
server.on('connection', (c) => { connections.add(c); c.on('close', () => connections.delete(c)); });

/* ---------- startup validation ---------- */
function validateStartup() {
  const warnings = [];
  const dataDir = process.env.DATA_DIR || path.join(ROOT, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    log('info', 'Created data directory', { path: dataDir });
  }
  if (!fs.existsSync(PUBLIC_DIR)) warnings.push('public/ directory missing: static files will 404');
  try {
    fs.accessSync(dataDir, fs.constants.W_OK);
  } catch {
    warnings.push('Data directory is not writable: data will not be saved');
  }
  if (warnings.length) warnings.forEach((w) => log('warn', 'startup: ' + w));
  return warnings;
}

server.listen(PORT, HOST, () => {
  validateStartup();
  log('info', `Agent running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${passwordFromEnv() ? ' (password from ADMIN_PASSWORD)' : ''}`);
  startTelegram();
});

function shutdown() {
  log('info', 'Shutting down…');
  stopTelegram();
  flushConversations();
  // Drain idle connections so the process can exit promptly.
  for (const c of connections) { c.end(); connections.delete(c); }
  server.close(() => {
    log('info', 'Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    log('warn', 'Forced exit after timeout');
    process.exit(0);
  }, 5000).unref();
  // Stop accepting new connections immediately.
  server.unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (e) => log('error', 'Unhandled rejection', { error: e }));
