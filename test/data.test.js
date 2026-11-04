import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-data-'));
delete process.env.ADMIN_PASSWORD;
delete process.env.GEOAPIFY_API_KEY;
const S = await import('../lib/settings.js');
const L = await import('../lib/leads.js');
const { allow, blocked, record } = await import('../lib/ratelimit.js');

test('settings accept only known keys of the right type', () => {
  const out = S.updateSettings({
    provider: 'groq',
    evil: 'x',
    failover: 'yes', // wrong type: ignored
    company: { name: '  Acme  ', rogue: 1 },
    lead: { defaultCountryCode: '+44 (0)' },
    passwordHash: 'hacked',
    sessionSecret: 'hacked',
    telegram: { adminChatIds: [1] },
    providers: { ollama: { host: 'javascript:alert(1)' } },
    __proto__: { polluted: true },
  });
  assert.equal(out.provider, 'groq');
  assert.equal(out.failover, true);
  assert.equal(out.company.name, 'Acme');
  assert.equal(out.lead.defaultCountryCode, '440');
  assert.equal('evil' in out, false);
  assert.equal('rogue' in out.company, false);
  assert.deepEqual(out.telegram.adminChatIds, []);
  assert.equal(out.providers.ollama.host, 'http://127.0.0.1:11434');
  assert.equal(({}).polluted, undefined);
  assert.equal(out.passwordHash, undefined);
  assert.equal(out.sessionSecret, undefined);
});

test('secrets are masked and a masked value never overwrites the real one', () => {
  S.updateSettings({ providers: { gemini: { apiKey: 'real-key' } } });
  assert.equal(S.publicSettings().providers.gemini.apiKey, '********');
  S.updateSettings({ providers: { gemini: { apiKey: '********' } } });
  assert.equal(S.getSettings().providers.gemini.apiKey, 'real-key');
  S.updateSettings({ geoapify: { apiKey: 'real-geoapify-key' } });
  assert.equal(S.publicSettings().geoapify.apiKey, '********');
  S.updateSettings({ geoapify: { apiKey: '********' } });
  assert.equal(S.getSettings().geoapify.apiKey, 'real-geoapify-key');
});

test('passwords are hashed, verified, and tokens die when the password changes', () => {
  S.setPassword('correct horse battery');
  const stored = fs.readFileSync(path.join(process.env.DATA_DIR, 'settings.json'), 'utf8');
  assert.ok(!stored.includes('correct horse battery'));
  assert.match(JSON.parse(stored).passwordHash, /^s1\$/);
  assert.equal(S.verifyPassword('correct horse battery'), true);
  assert.equal(S.verifyPassword('wrong'), false);
  assert.throws(() => S.setPassword('short'));
  const t = S.issueToken();
  assert.equal(S.checkToken(t), true);
  assert.equal(S.checkToken(t.slice(0, -2) + 'xx'), false);
  assert.equal(S.checkToken('1.abc'), false);
  assert.equal(S.checkToken(`${Date.now() - 1}.${t.split('.')[1]}`), false);
  S.setPassword('another good password');
  assert.equal(S.checkToken(t), false);
});

test('leads are validated and sanitised on the way in', () => {
  S.updateSettings({ lead: { defaultCountryCode: '234' } });
  const { lead } = L.addLead({
    name: '  Acme\u0000 Games ',
    website: 'javascript:alert(1)',
    emails: ['GOOD@Acme.com', 'not-an-email', '<script>@x.com'],
    phones: ['0803 123 4567', 'abc'],
    socials: { facebook: 'javascript:alert(1)', instagram: 'https://instagram.com/acme', bogus: 'https://x.com/a' },
    notes: 'hi',
  });
  assert.equal(lead.name, 'Acme Games');
  assert.equal(lead.website, '');
  assert.deepEqual(lead.emails, ['good@acme.com']);
  assert.deepEqual(lead.phones, ['+2348031234567']);
  assert.deepEqual(lead.socials, { instagram: 'https://instagram.com/acme' });
  const upd = L.updateLead(lead.id, { status: 'hacked', emails: 'oops', socials: { twitter: 'data:text/html,x' } });
  assert.equal(upd.status, 'new');
  assert.deepEqual(upd.emails, []);
  assert.deepEqual(upd.socials, {});
});

test('duplicates are detected by domain, email, phone and name', () => {
  const a = L.addLead({ name: 'Dup Co', website: 'https://www.dup.com', emails: ['a@dup.com'] });
  assert.equal(a.created, true);
  assert.equal(L.addLead({ name: 'Other', website: 'https://dup.com/contact' }).created, false);
  assert.equal(L.addLead({ name: 'Other', emails: ['A@dup.com'] }).created, false);
  assert.equal(L.addLead({ name: 'dup co!' }).created, false);
});

test('CSV export neutralises spreadsheet formulas but keeps phone numbers readable', () => {
  L.addLead({ name: '=HYPERLINK("http://evil","x")', phones: ['+2347011112222'], emails: ['f@formula.com'] });
  const csv = L.toCsv();
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"",""x"")"`));
  assert.ok(csv.includes('"+2347011112222"'));
});

test('CSV import round-trips and skips duplicates', () => {
  const r = L.importCsv('name,email,phone,website\r\n"Imp, Ltd",imp@imp.ng,08031112222,imp.ng\r\n"Imp, Ltd",imp@imp.ng,,\r\n');
  assert.deepEqual(r, { added: 1, skipped: 1 });
});

test('rate limiter blocks after the limit and login guard records failures only', () => {
  for (let i = 0; i < 3; i++) assert.equal(allow('k', 3, 60_000), true);
  assert.equal(allow('k', 3, 60_000), false);
  for (let i = 0; i < 2; i++) record('bad');
  assert.equal(blocked('bad', 2, 60_000), true);
  assert.equal(blocked('good', 2, 60_000), false);
});
