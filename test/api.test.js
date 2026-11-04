// End-to-end: boots the real server, with a mock "Ollama" standing in for the AI.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-api-'));
const PORT = 3200 + Math.floor(Math.random() * 600);
const BASE = `http://127.0.0.1:${PORT}`;

let mock, mockPort, proc, password;
let lastMockMessages = [];

function startMock() {
  return new Promise((resolve) => {
    mock = http.createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        const j = JSON.parse(b || '{}');
        lastMockMessages = j.messages || [];
        const last = lastMockMessages.at(-1)?.content || '';
        if (last.includes('FAILME')) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"error":"boom"}'); }
        const out = j.format === 'json'
          ? JSON.stringify({ subject: 'Hello', body: 'Draft body. Not relevant? Just reply "stop" and I won\'t contact you again.' })
          : `MOCK:${last.slice(0, 30)}`;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: { content: out } }));
      });
    }).listen(0, '127.0.0.1', () => { mockPort = mock.address().port; resolve(); });
  });
}

function startServer(env = {}) {
  return new Promise((resolve, reject) => {
    proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dataDir, PORT, HOST: '127.0.0.1', GEOAPIFY_API_KEY: '', ...env } });
    let out = '';
    const timer = setTimeout(() => reject(new Error('server did not start: ' + out)), 10000);
    proc.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/dashboard password is: (\S+)/);
      if (m) password = m[1];
      if (out.includes('running at')) { clearTimeout(timer); resolve(); }
    });
    proc.stderr.on('data', (d) => (out += d));
  });
}
const stopServer = () => new Promise((r) => { proc.once('exit', r); proc.kill(); });

async function call(method, url, { body, cookie, headers = {} } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

let cookie;

before(async () => { await startMock(); await startServer(); });
after(async () => { await stopServer(); mock.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('health, security headers, and locked API when logged out', async () => {
  assert.equal((await call('GET', '/healthz')).json.ok, true);
  assert.equal((await call('GET', '/api/leads')).status, 401);
  assert.equal((await call('GET', '/api/settings')).status, 401);
  const page = await call('GET', '/');
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match((await call('GET', '/embed.html')).headers.get('content-security-policy'), /frame-ancestors \*/);
  assert.equal((await call('GET', '/..%2fserver.js')).status, 404);
});

test('first-run password works, is hashed on disk, and wrong ones fail', async () => {
  assert.ok(password, 'a first-run password was printed');
  assert.equal((await call('POST', '/api/login', { body: { password: 'nope' } })).status, 401);
  const ok = await call('POST', '/api/login', { body: { password } });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  assert.match(ok.headers.get('set-cookie'), /SameSite=Strict/);
  cookie = ok.cookie;
  const stored = fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8');
  assert.ok(!stored.includes(password));
  assert.equal((await call('GET', '/api/settings', { cookie })).status, 200);
});

test('settings never expose secrets and ignore unknown keys / prototype pollution', async () => {
  const r = await call('PUT', '/api/settings', {
    cookie,
    body: JSON.parse('{"evil":1,"__proto__":{"polluted":1},"provider":"ollama","failover":false,"providers":{"gemini":{"apiKey":"secret-gemini"},"ollama":{"host":"' + `http://127.0.0.1:${mockPort}` + '","model":"mock"}},"company":{"phone":"+234 800 000 0000"}}'),
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.providers.gemini.apiKey, '********');
  assert.ok(!r.text.includes('secret-gemini'));
  assert.ok(!('passwordHash' in r.json) && !('sessionSecret' in r.json));
  assert.ok(!fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8').includes('"evil"'));
});

test('CSRF: writes from a foreign origin are rejected', async () => {
  const r = await call('PUT', '/api/products', { cookie, body: [], headers: { origin: 'http://evil.example' } });
  assert.equal(r.status, 403);
  assert.equal((await call('PUT', '/api/settings', { cookie, body: {}, headers: { origin: 'null' } })).status, 403);
});

test('sales chat answers, knows the catalog, and a failed AI call leaves no dangling message', async () => {
  const a = await call('POST', '/api/chat', { cookie, body: { sessionId: 't1', message: 'What do you sell?' } });
  assert.equal(a.status, 200);
  assert.match(a.json.reply, /^MOCK:/);
  assert.ok(lastMockMessages[0].content.includes('GameCenter'), 'system prompt carries the product catalog');
  const f = await call('POST', '/api/chat', { cookie, body: { sessionId: 't1', message: 'FAILME please' } });
  assert.equal(f.status, 502);
  await call('POST', '/api/chat', { cookie, body: { sessionId: 't1', message: 'Still there?' } });
  const roles = lastMockMessages.filter((m) => m.role !== 'system').map((m) => m.role);
  for (let i = 1; i < roles.length; i++) assert.notEqual(roles[i], roles[i - 1], 'roles alternate: ' + roles.join(','));
});

test('public widget chat captures contact details as an inbound lead', async () => {
  const sid = 'visitor-abcdef123456';
  assert.equal((await call('POST', '/api/public/chat', { body: { sessionId: 'x', message: 'hi' } })).status, 400);
  const a = await call('POST', '/api/public/chat', { body: { sessionId: sid, message: 'I run a gaming lounge in Lekki' } });
  assert.equal(a.status, 200);
  await call('POST', '/api/public/chat', { body: { sessionId: sid, message: "My name is Tunde Bello, call 0803 555 1234 or tunde@lounge.ng" } });
  const leads = (await call('GET', '/api/leads', { cookie })).json;
  const l = leads.find((x) => x.source === 'inbound:website');
  assert.ok(l, 'inbound lead exists');
  assert.equal(l.name, 'Tunde Bello');
  assert.deepEqual(l.phones, ['+2348035551234']);
  assert.deepEqual(l.emails, ['tunde@lounge.ng']);
  assert.ok(l.transcript.includes('gaming lounge'));
  assert.equal((await call('GET', '/api/stats', { cookie })).json.inbound, 1);
});

test('stored data is sanitised: javascript: links, bad emails, spoofed status', async () => {
  const add = await call('POST', '/api/leads', { cookie, body: { name: 'Evil <img src=x onerror=alert(1)> Ltd', website: 'javascript:alert(1)', emails: ['x@y.com', 'bad'], socials: { facebook: 'javascript:alert(1)' } } });
  const lead = add.json.lead;
  assert.equal(lead.website, '');
  assert.deepEqual(lead.emails, ['x@y.com']);
  assert.deepEqual(lead.socials, {});
  const patched = await call('PATCH', `/api/leads/${lead.id}`, { cookie, body: { status: 'won', website: 'data:text/html,x' } });
  assert.equal(patched.json.status, 'won');
  assert.equal(patched.json.website, '');
  assert.equal((await call('PATCH', `/api/leads/${lead.id}`, { cookie, body: { status: 'bogus' } })).json.status, 'won');
});

test('drafting works and is blocked for do-not-contact leads', async () => {
  const { lead } = (await call('POST', '/api/leads', { cookie, body: { name: 'Draft Co', emails: ['d@draft.co'] } })).json;
  const d = await call('POST', `/api/leads/${lead.id}/draft`, { cookie, body: { product: 'gamecenter', channel: 'email' } });
  assert.equal(d.status, 200);
  assert.match(d.json.body, /stop/);
  const stored = (await call('GET', '/api/leads', { cookie })).json.find((l) => l.id === lead.id);
  assert.ok(stored.activities.some((a) => a.type === 'draft' && /email/.test(a.text)), 'drafting is logged on the timeline');
  await call('PATCH', `/api/leads/${lead.id}`, { cookie, body: { status: 'do-not-contact' } });
  assert.equal((await call('POST', `/api/leads/${lead.id}/draft`, { cookie, body: {} })).status, 400);
});

test('SSRF: re-scraping a lead on an internal address is refused', async () => {
  const { lead } = (await call('POST', '/api/leads', { cookie, body: { name: 'Internal', website: `http://127.0.0.1:${mockPort}` } })).json;
  const r = await call('POST', `/api/leads/${lead.id}/enrich`, { cookie, body: {} });
  assert.ok(r.status >= 400, 'refused');
});

test('lead search input is validated', async () => {
  assert.equal((await call('POST', '/api/leads/find', { cookie, body: { query: '' } })).status, 400);
  assert.equal((await call('GET', '/api/jobs/doesnotexist', { cookie })).status, 404);
  const noKey = await call('POST', '/api/leads/find', { cookie, body: { query: 'gaming lounge', sources: ['geoapify'] } });
  assert.equal(noKey.status, 400);
  assert.match(noKey.json.error, /Geoapify API key/);
  assert.equal((await call('POST', '/api/geoapify/test', { cookie, body: {} })).status, 400);
  assert.equal((await call('POST', '/api/apollo/test', { cookie, body: {} })).status, 404);
});

test('paste-a-list-of-websites job validates input and finishes without touching internal hosts', async () => {
  assert.equal((await call('POST', '/api/leads/from-urls', { cookie, body: { urls: '' } })).status, 400);
  const start = await call('POST', '/api/leads/from-urls', { cookie, body: { urls: 'http://127.0.0.1:9/\nhttp://localhost/x' } });
  assert.equal(start.status, 200);
  let job;
  for (let i = 0; i < 40; i++) {
    job = (await call('GET', `/api/jobs/${start.json.jobId}`, { cookie })).json;
    if (job.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(job.status, 'done');
  assert.equal(job.leads.length, 0);
  assert.equal('ctl' in job, false, 'internal job control is not leaked');
});

test('CSV export is formula-safe', async () => {
  await call('POST', '/api/leads', { cookie, body: { name: '=cmd|calc' } });
  const r = await call('GET', '/api/leads/export.csv', { cookie });
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.ok(r.text.includes(`"'=cmd|calc"`));
});

test('login survives a server restart (stateless signed session)', async () => {
  await stopServer();
  await startServer();
  assert.equal((await call('GET', '/api/leads', { cookie })).status, 200);
  // Extend the expiry digit: the signature no longer matches, so the token must be refused.
  const tampered = cookie.replace(/^(ct_sid=)(\d)/, (_, p, d) => p + ((+d + 1) % 10));
  assert.notEqual(tampered, cookie);
  assert.equal((await call('GET', '/api/leads', { cookie: tampered })).status, 401);
  const forged = `ct_sid=${Date.now() + 864e6}.${'A'.repeat(43)}`;
  assert.equal((await call('GET', '/api/leads', { cookie: forged })).status, 401);
});

test('inbound data persisted across restart', async () => {
  const leads = (await call('GET', '/api/leads', { cookie })).json;
  assert.ok(leads.some((l) => l.source === 'inbound:website'));
});

test('CRM dashboard exposes pipeline, task and source aggregates', async () => {
  const r = await call('GET', '/api/dashboard', { cookie });
  assert.equal(r.status, 200);
  assert.ok(r.json.totals.leads >= 1);
  assert.equal(r.json.pipeline.length, 9);
  assert.equal(r.json.weekly.length, 8);
  assert.ok(r.json.pipeline.some((p) => p.status === 'won'));
  assert.ok(r.json.sources.some((s) => s.source === 'inbound'));
  assert.ok('weightedValue' in r.json.kpis && 'responseRate' in r.json.kpis);
  assert.ok(Array.isArray(r.json.tasks.due) && Array.isArray(r.json.recent));
});

test('CRM tasks, follow-ups and activity notes round-trip through the API', async () => {
  const created = await call('POST', '/api/leads', {
    cookie,
    body: { name: 'API Task Co', status: 'qualified', value: 120000, priority: 'high' },
  });
  assert.equal(created.status, 200);
  const id = created.json.lead.id;
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

  const added = await call('POST', `/api/leads/${id}/tasks`, { cookie, body: { title: 'Call the owner', due: tomorrow, priority: 'high' } });
  assert.equal(added.status, 200);
  assert.equal(added.json.tasks.length, 1);
  const taskId = added.json.tasks[0].id;

  const dash = await call('GET', '/api/dashboard', { cookie });
  assert.ok(dash.json.tasks.upcoming.some((t) => t.id === taskId), 'follow-up appears in the dashboard');

  const done = await call('PATCH', `/api/leads/${id}/tasks/${taskId}`, { cookie, body: { done: true } });
  assert.equal(done.status, 200);
  assert.equal(done.json.tasks[0].done, true);
  assert.ok(done.json.tasks[0].completedAt);
  assert.ok(done.json.activities.some((a) => a.type === 'task' && /Task completed/.test(a.text)));

  const note = await call('POST', `/api/leads/${id}/activity`, { cookie, body: { text: 'Left a voicemail with the manager' } });
  assert.equal(note.status, 200);
  assert.ok(note.json.activities.some((a) => a.type === 'note' && a.text === 'Left a voicemail with the manager'));

  const removed = await call('DELETE', `/api/leads/${id}/tasks/${taskId}`, { cookie });
  assert.equal(removed.status, 200);
  assert.equal(removed.json.tasks.length, 0);

  assert.equal((await call('POST', `/api/leads/${id}/tasks`, { cookie, body: {} })).status, 400);
  assert.equal((await call('POST', `/api/leads/${id}/activity`, { cookie, body: { text: '   ' } })).status, 400);
  assert.equal((await call('PATCH', `/api/leads/${id}/tasks/nope`, { cookie, body: { done: true } })).status, 404);
  assert.equal((await call('POST', '/api/leads/nope/tasks', { cookie, body: { title: 'x' } })).status, 404);
});

test('CRM bulk actions update stage, priority, owner, tags and tasks', async () => {
  const one = (await call('POST', '/api/leads', { cookie, body: { name: 'API Bulk One', value: 25000, tags: ['seed'] } })).json.lead;
  const two = (await call('POST', '/api/leads', { cookie, body: { name: 'API Bulk Two', value: 50000, tags: ['seed'] } })).json.lead;
  const ids = [one.id, two.id];
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

  const stage = await call('POST', '/api/leads/bulk', { cookie, body: { ids, action: 'status', status: 'qualified' } });
  assert.equal(stage.status, 200);
  assert.equal(stage.json.updated, 2);

  const priority = await call('POST', '/api/leads/bulk', { cookie, body: { ids, action: 'priority', priority: 'high' } });
  assert.equal(priority.json.updated, 2);
  const owner = await call('POST', '/api/leads/bulk', { cookie, body: { ids, action: 'owner', owner: 'Ada' } });
  assert.equal(owner.json.updated, 2);
  const tag = await call('POST', '/api/leads/bulk', { cookie, body: { ids, action: 'tag', tags: ['campaign'] } });
  assert.equal(tag.json.updated, 2);
  const task = await call('POST', '/api/leads/bulk', { cookie, body: { ids, action: 'task', task: { title: 'Bulk follow-up', due: tomorrow } } });
  assert.equal(task.json.updated, 2);

  const after = (await call('GET', '/api/leads', { cookie })).json;
  for (const id of ids) {
    const lead = after.find((l) => l.id === id);
    assert.equal(lead.status, 'qualified');
    assert.equal(lead.priority, 'high');
    assert.equal(lead.owner, 'Ada');
    assert.ok(lead.tags.includes('campaign'));
    assert.ok(lead.tasks.some((t) => t.title === 'Bulk follow-up'));
  }

  const deleted = await call('POST', '/api/leads/bulk', { cookie, body: { ids: [two.id], action: 'delete' } });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.json.deleted, 1);

  assert.equal((await call('POST', '/api/leads/bulk', { cookie, body: { ids: [], action: 'status', status: 'won' } })).status, 400);
  assert.equal((await call('POST', '/api/leads/bulk', { cookie, body: { ids, action: 'explode' } })).status, 400);
  assert.equal((await call('POST', '/api/leads/bulk', { cookie, body: { ids, action: 'status', status: 'bogus' } })).status, 400);
  assert.equal((await call('POST', '/api/leads/bulk', { cookie, body: { ids, action: 'priority', priority: 'urgent' } })).status, 400);
  assert.equal((await call('POST', '/api/leads/bulk', { cookie, body: { ids, action: 'task', task: { title: '' } } })).status, 400);
});

test('CRM duplicate merge keeps the chosen lead and moves the history', async () => {
  const source = (await call('POST', '/api/leads', {
    cookie,
    body: { name: 'API Merge Source', website: 'https://api-merge-source.example', emails: ['source@api-merge.example'], value: 5000, tags: ['source'] },
  })).json.lead;
  const target = (await call('POST', '/api/leads', {
    cookie,
    body: { name: 'API Merge Target', website: 'https://api-merge-target.example', emails: ['target@api-merge.example'], value: 9000, tags: ['target'] },
  })).json.lead;
  await call('POST', `/api/leads/${source.id}/tasks`, { cookie, body: { title: 'Source task' } });
  await call('POST', `/api/leads/${source.id}/activity`, { cookie, body: { text: 'Source history' } });

  assert.equal((await call('POST', `/api/leads/${source.id}/merge`, { cookie, body: {} })).status, 400);
  assert.equal((await call('POST', `/api/leads/${source.id}/merge`, { cookie, body: { targetId: 'missing' } })).status, 404);
  const merged = await call('POST', `/api/leads/${source.id}/merge`, { cookie, body: { targetId: target.id } });
  assert.equal(merged.status, 200);
  assert.deepEqual(merged.json.emails.sort(), ['source@api-merge.example', 'target@api-merge.example']);
  assert.deepEqual(merged.json.tags.sort(), ['source', 'target']);
  assert.equal(merged.json.value, 9000);
  assert.ok(merged.json.tasks.some((t) => t.title === 'Source task'));
  assert.ok(merged.json.activities.some((a) => a.type === 'merge'));
  assert.ok(merged.json.activities.some((a) => a.text === 'Source history'));

  const leads = (await call('GET', '/api/leads', { cookie })).json;
  assert.ok(!leads.some((l) => l.id === source.id), 'source lead removed');
  assert.ok(leads.some((l) => l.id === target.id), 'target lead kept');
});

test('CRM preferences are saved through settings without exposing secrets', async () => {
  const r = await call('PUT', '/api/settings', { cookie, body: { crm: { currency: 'usd', monthlyTarget: 750000, followUpDays: 5 } } });
  assert.equal(r.status, 200);
  assert.equal(r.json.crm.currency, 'USD');
  assert.equal(r.json.crm.monthlyTarget, 750000);
  assert.equal(r.json.crm.followUpDays, 5);
  const saved = (await call('GET', '/api/settings', { cookie })).json;
  assert.equal(saved.crm.currency, 'USD');
});

test('changing the password needs the current one and logs out old sessions', async () => {
  const bad = await call('PUT', '/api/settings', { cookie, body: { newPassword: 'brand new password', currentPassword: 'wrong' } });
  assert.equal(bad.status, 400);
  const short = await call('PUT', '/api/settings', { cookie, body: { newPassword: 'short', currentPassword: password } });
  assert.equal(short.status, 400);
  const ok = await call('PUT', '/api/settings', { cookie, body: { newPassword: 'brand new password', currentPassword: password } });
  assert.equal(ok.status, 200);
  const fresh = ok.cookie;
  assert.equal((await call('GET', '/api/leads', { cookie })).status, 401, 'old session revoked');
  assert.equal((await call('GET', '/api/leads', { cookie: fresh })).status, 200, 'new session works');
  assert.equal((await call('POST', '/api/login', { body: { password } })).status, 401);
  assert.equal((await call('POST', '/api/login', { body: { password: 'brand new password' } })).status, 200);
});

test('public chat is rate limited per visitor', async () => {
  const sid = 'ratelimit-abcdef12';
  const codes = [];
  for (let i = 0; i < 14; i++) codes.push((await call('POST', '/api/public/chat', { body: { sessionId: sid, message: 'hello ' + i } })).status);
  assert.ok(codes.includes(429), 'got a 429: ' + codes.join(','));
});

test('brute-force protection cannot be bypassed by spoofing X-Forwarded-For', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await call('POST', '/api/login', { body: { password: 'guess' + i }, headers: { 'x-forwarded-for': `1.2.3.${i}` } });
  assert.equal(last.status, 429);
  // even the right password is refused while locked out
  assert.equal((await call('POST', '/api/login', { body: { password: 'brand new password' }, headers: { 'x-forwarded-for': '9.9.9.9' } })).status, 429);
});
