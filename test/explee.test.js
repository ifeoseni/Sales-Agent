import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpleeClient, ExpleeError, MAX_PAGE_SIZE } from '../lib/explee.js';
import {
  buildDedupeIndex,
  companyKeys,
  companyToLead,
  discoverCompanies,
  discoverPeople,
  personKeys,
  personToLead,
} from '../lib/explee-discovery.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let clock = new Date('2026-11-05T10:00:00Z');

function makeClient({ cfg = {}, fetchImpl, state = null } = {}) {
  return createExpleeClient({
    persist: false,
    apiKey: () => 'test-key',
    now: () => clock,
    loadState: () => state,
    settings: () => ({
      explee: {
        apiKey: 'test-key',
        lifetimeCreditBudget: 3000,
        budgetMonths: 60,
        paceEnabled: false,
        balanceFloor: 100,
        freeRequestsPerDay: 50,
        freeRequestsPerMinute: 10,
        pageSize: 10,
        defaultCountries: '',
        ...cfg,
      },
    }),
    fetchImpl: fetchImpl || (async () => json({ people: [], companies: [], meta: { credits_charged: 0 } })),
  });
}

const peopleResponse = (people) => json({ success: true, people, meta: { credits_charged: 0, total: people.length } });
const emptyPeople = () => peopleResponse([]);

test('pages never exceed the free-results zone', async () => {
  const bodies = [];
  const client = makeClient({
    fetchImpl: async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return emptyPeople();
    },
  });

  await client.searchPeople({ jobTitles: ['Founder'], companyDefinition: 'event planners', pageSize: 500, geo: 'ng' });
  await client.searchCompanies({ definition: 'event venues', pageSize: 999 });

  assert.equal(bodies[0].page_size, MAX_PAGE_SIZE);
  assert.equal(bodies[1].page_size, MAX_PAGE_SIZE);
  // The API rejects a string here: geo must be a list of ISO codes.
  assert.deepEqual(bodies[0].people_filters.geo, ['NG']);
});

test('multi-country discovery sends a list of ISO codes, and no filter when blank', async () => {
  const bodies = [];
  const client = makeClient({
    fetchImpl: async (url, init) => {
      bodies.push({ path: String(url), body: JSON.parse(init.body) });
      return json({ people: [], companies: [], meta: { credits_charged: 0 } });
    },
  });

  await discoverPeople(client, {
    jobTitles: ['Founder'],
    companyDefinition: 'event planners',
    countries: 'ng, gh, KE',
  });
  await discoverCompanies(client, { definition: 'event venues', countries: ['US', 'GB'] });
  await discoverCompanies(client, { definition: 'event venues' });

  assert.deepEqual(bodies[0].body.people_filters.geo, ['NG', 'GH', 'KE']);
  assert.deepEqual(bodies[1].body.filters.geo_include, ['US', 'GB']);
  assert.equal(Object.hasOwn(bodies[2].body.filters, 'geo_include'), false, 'blank country means worldwide');
});

test('the free daily allowance is enforced before any request is sent', async () => {
  let calls = 0;
  const client = makeClient({
    cfg: { freeRequestsPerDay: 2, freeRequestsPerMinute: 100 },
    fetchImpl: async () => { calls += 1; return emptyPeople(); },
  });

  clock = new Date('2026-11-05T10:00:00Z');
  await client.searchPeople({ jobTitles: ['Founder'], companyDefinition: 'x' });
  await client.searchPeople({ jobTitles: ['Founder'], companyDefinition: 'x' });

  await assert.rejects(
    () => client.searchPeople({ jobTitles: ['Founder'], companyDefinition: 'x' }),
    (e) => e instanceof ExpleeError && e.code === 'free_zone_day' && e.status === 429,
  );
  assert.equal(calls, 2, 'the blocked call must not reach Explee');
});

test('the free per-minute pace is enforced', async () => {
  const client = makeClient({ cfg: { freeRequestsPerDay: 100, freeRequestsPerMinute: 2 } });
  clock = new Date('2026-11-05T10:00:00Z');

  await client.searchPeople({ jobTitles: ['Founder'], companyDefinition: 'x' });
  await client.searchPeople({ jobTitles: ['Founder'], companyDefinition: 'x' });

  await assert.rejects(
    () => client.searchPeople({ jobTitles: ['Founder'], companyDefinition: 'x' }),
    (e) => e.code === 'free_zone_minute',
  );

  // A new minute gives the allowance back.
  clock = new Date('2026-11-05T10:01:01Z');
  await client.searchPeople({ jobTitles: ['Founder'], companyDefinition: 'x' });
});

test('free counters survive a restart because they are persisted', async () => {
  let saved = null;
  const first = createExpleeClient({
    persist: true,
    apiKey: () => 'test-key',
    now: () => new Date('2026-11-05T10:00:00Z'),
    loadState: () => null,
    saveState: (s) => { saved = structuredClone(s); },
    settings: () => ({
      explee: {
        lifetimeCreditBudget: 3000, budgetMonths: 60, paceEnabled: false,
        freeRequestsPerDay: 1, freeRequestsPerMinute: 10, pageSize: 10, balanceFloor: 0,
      },
    }),
    fetchImpl: async () => emptyPeople(),
  });
  await first.searchPeople({ jobTitles: ['Founder'], companyDefinition: 'x' });
  assert.equal(saved.freeDayCount, 1);

  const second = makeClient({
    cfg: { freeRequestsPerDay: 1 },
    state: saved,
    fetchImpl: async () => { throw new Error('must not be called'); },
  });
  await assert.rejects(() => second.searchPeople({ jobTitles: ['Founder'], companyDefinition: 'x' }), (e) => e.code === 'free_zone_day');
});

test('paid enrichment is refused when the lifetime budget is 0', async () => {
  let calls = 0;
  const client = makeClient({ cfg: { lifetimeCreditBudget: 0 }, fetchImpl: async () => { calls += 1; return json({}); } });

  await assert.rejects(
    () => client.enrichEmail({ firstName: 'Jane', lastName: 'Doe', companyDomain: 'acme.com' }),
    (e) => e.code === 'paid_disabled' && e.status === 402,
  );
  assert.equal(calls, 0, 'no paid request may leave the app');
});

test('the lifetime ceiling stops spend even when pace is off', async () => {
  const client = makeClient({
    cfg: { lifetimeCreditBudget: 120, paceEnabled: false },
    state: { creditsUsed: 119 },
    fetchImpl: async () => { throw new Error('must not be called'); },
  });
  await assert.rejects(
    () => client.enrichEmail({ firstName: 'Jane', lastName: 'Doe', companyDomain: 'acme.com' }),
    (e) => e.code === 'lifetime_cap',
  );
});

test('the pace guard spends only what the five-year plan has earned', async () => {
  const spend = makeClient({
    cfg: { lifetimeCreditBudget: 3000, budgetMonths: 60, paceEnabled: true },
    state: { creditsUsed: 49 },
    fetchImpl: async (url) => (String(url).endsWith('/billing/balance') ? json({ remain: 3000 }) : json({})),
  });
  clock = new Date('2026-11-05T10:00:00Z');

  // 3000/60 = 50 credits are available immediately; 49 are already used.
  await assert.rejects(
    () => spend.enrichEmail({ firstName: 'Jane', lastName: 'Doe', companyDomain: 'acme.com' }),
    (e) => e.code === 'pace_limit' && /unlocks around/.test(e.message),
  );

  // A month later the allowance has grown by another 50 credits.
  clock = new Date('2026-12-06T10:00:00Z');
  const ok = await spend.budget();
  assert.ok(ok.availableNow > 50, `expected more allowance, got ${ok.availableNow}`);
});

test('the balance floor blocks a paid call the budget would allow', async () => {
  const client = makeClient({
    cfg: { lifetimeCreditBudget: 3000, paceEnabled: false, balanceFloor: 4000 },
    fetchImpl: async (url) => (String(url).endsWith('/billing/balance') ? json({ remain: 3000 }) : json({})),
  });
  await assert.rejects(
    () => client.enrichEmail({ firstName: 'Jane', lastName: 'Doe', companyDomain: 'acme.com' }),
    (e) => e.code === 'balance_floor',
  );
});

test('paid spend is recorded against the lifetime ledger', async () => {
  const client = makeClient({
    cfg: { lifetimeCreditBudget: 3000, paceEnabled: false },
    fetchImpl: async (url) => (String(url).endsWith('/billing/balance')
      ? json({ remain: 3000 })
      : json({ email: 'jane@acme.com', email_status: 'valid', meta: { credits_charged: 1.5, remaining_balance: 2998.5 } })),
  });
  const out = await client.enrichEmail({ firstName: 'Jane', lastName: 'Doe', companyDomain: 'acme.com' });
  assert.equal(out.email, 'jane@acme.com');
  const budget = await client.budget();
  assert.equal(budget.used, 1.5);
  assert.equal(budget.remaining, 2998.5);
});

test('phone enrichment needs a LinkedIn URL and has its own 15-credit guard', async () => {
  const client = makeClient({
    cfg: { lifetimeCreditBudget: 3000, paceEnabled: false },
    fetchImpl: async (url) => (String(url).endsWith('/billing/balance')
      ? json({ remain: 3000 })
      : json({ phone: '+14255551234', meta: { credits_charged: 15, remaining_balance: 2985 } })),
  });

  await assert.rejects(() => client.enrichPhone({}), (e) => e.code === 'invalid_input');

  const out = await client.enrichPhone({ linkedinUrl: 'https://linkedin.com/in/jane' });
  assert.equal(out.phone, '+14255551234');
  assert.equal(out.estimated_cost, 15);
});

test('search never sends exclude_lists, because that disables the free zone', async () => {
  const bodies = [];
  const client = makeClient({
    fetchImpl: async (url, init) => { bodies.push(JSON.parse(init.body)); return emptyPeople(); },
  });
  await client.searchPeople({ jobTitles: ['Founder'], companyDefinition: 'event planners' });
  assert.equal(Object.hasOwn(bodies[0], 'exclude_lists'), false);
});

test('people search results are deduped against the CRM and across runs', async () => {
  const person = {
    first_name: 'Jane',
    last_name: 'Doe',
    title: 'Founder',
    linkedin_url: 'https://www.linkedin.com/in/janedoe/',
    company_domain: 'acme.com',
    company_name: 'Acme Events',
  };

  let calls = 0;
  const client = makeClient({
    cfg: { freeRequestsPerDay: 100 },
    fetchImpl: async () => { calls += 1; return peopleResponse([person]); },
  });

  // 1. A lead already in the CRM, matched by LinkedIn.
  const existing = [{ name: 'Jane Doe', website: '', emails: [], socials: { linkedin: 'https://linkedin.com/in/janedoe' } }];
  const first = await discoverPeople(client, {
    jobTitles: ['Founder'],
    companyDefinition: 'event planners',
    maxPages: 1,
    existing,
  });
  assert.equal(first.stats.new, 0);
  assert.equal(first.stats.duplicates, 1);

  // 2. Same person, empty CRM: accepted once.
  const second = await discoverPeople(client, { jobTitles: ['Founder'], companyDefinition: 'event planners', maxPages: 1, existing: [] });
  assert.equal(second.stats.new, 1);
  assert.equal(calls, 2);

  // 3. After saving, the same person is never offered again.
  const keys = second.items[0].keys;
  client.remember('people', keys);
  const third = await discoverPeople(client, { jobTitles: ['Founder'], companyDefinition: 'event planners', maxPages: 1, existing: [] });
  assert.equal(third.stats.new, 0);
  assert.equal(third.stats.duplicates, 1);
});

test('two people at the same company stay two leads', async () => {
  const people = [
    { first_name: 'Jane', last_name: 'Doe', linkedin_url: 'https://linkedin.com/in/jane', company_domain: 'acme.com' },
    { first_name: 'John', last_name: 'Roe', linkedin_url: 'https://linkedin.com/in/john', company_domain: 'acme.com' },
  ];
  const client = makeClient({ fetchImpl: async () => peopleResponse(people) });

  const out = await discoverPeople(client, { jobTitles: ['Founder'], companyDefinition: 'event planners', maxPages: 1, existing: [] });
  assert.equal(out.stats.new, 2);
  // Blank website keeps addLead() from merging colleagues into one company lead.
  assert.equal(out.items[0].lead.website, '');
  assert.equal(out.items[1].lead.website, '');
  assert.notDeepEqual(out.items[0].keys, out.items[1].keys);
});

test('company discovery dedupes by domain', async () => {
  const companies = [
    { company_name: 'Acme Events', domain: 'acme.com', company_url: 'https://acme.com' },
    { company_name: 'Acme Events Ltd', domain: 'https://www.acme.com/about', company_url: 'https://acme.com' },
    { company_name: 'Other Co', domain: 'other.co' },
  ];
  const client = makeClient({
    fetchImpl: async () => json({ success: true, companies, meta: { credits_charged: 0 } }),
  });

  const existing = [{ name: 'Existing', website: 'https://acme.com', emails: [], socials: {} }];
  const out = await discoverCompanies(client, { definition: 'event venues', maxPages: 1, existing });
  assert.equal(out.stats.new, 1);
  assert.equal(out.stats.duplicates, 2);
  assert.equal(out.items[0].lead.name, 'Other Co');
});

test('lead mapping keeps the person link and never invents an email', () => {
  const lead = personToLead({
    first_name: 'Jane',
    last_name: 'Doe',
    title: 'Head of Events',
    linkedin_url: 'https://linkedin.com/in/janedoe',
    company_name: 'Acme Events',
    company_domain: 'acme.com',
    company_emails: ['hello@acme.com'],
  });
  assert.equal(lead.name, 'Jane Doe');
  assert.equal(lead.website, '');
  assert.equal(lead.emails, undefined);
  assert.equal(lead.companyDomain, 'acme.com');
  assert.equal(lead.jobTitle, 'Head of Events');
  assert.equal(lead.socials.linkedin, 'https://linkedin.com/in/janedoe');
  assert.ok(lead.tags.includes('explee'));
  assert.match(lead.notes, /Acme Events/);
  assert.equal(personToLead({ first_name: 'A', last_name: 'B', geo: 'NG' }).location, 'Nigeria');

  const company = companyToLead({ company_name: 'Acme', domain: 'acme.com' });
  assert.equal(company.website, 'https://acme.com/');
  assert.equal(company.companyDomain, 'acme.com');
  assert.equal(company.name, 'Acme');
});

test('keys normalise domains and LinkedIn URLs', () => {
  assert.equal(personKeys({ linkedin_url: 'https://www.linkedin.com/in/JaneDoe/?x=1' })[0], 'li:linkedin.com/in/janedoe');
  assert.deepEqual(companyKeys({ domain: 'https://www.Acme.com/path' }), ['dm:acme.com']);
  const index = buildDedupeIndex([{ name: 'Jane', website: 'https://acme.com', emails: ['JANE@acme.com'], socials: {} }]);
  assert.ok(index.has('dm:acme.com'));
  assert.ok(index.has('em:jane@acme.com'));
});

/* ---------------- review round: mapping, cursors, caches, safety ---------------- */

test('company rows use the real API field names and keep free emails and phones', () => {
  const lead = companyToLead({
    domain: 'acme.com',
    name: 'Acme Events',
    url: 'https://www.acme.com',
    size: 40,
    industry: 'Events',
    description: 'We plan events',
    geo: 'NG',
    geo_city: 'Lagos',
    emails: ['Hello@Acme.com', 'bad', 'hello@acme.com'],
    phones: ['+2348012345678'],
    social_instagram_urls: ['https://instagram.com/acme'],
  });
  assert.equal(lead.name, 'Acme Events');
  assert.deepEqual(lead.emails, ['hello@acme.com']);
  assert.deepEqual(lead.phones, ['+2348012345678']);
  assert.equal(lead.socials.instagram, 'https://instagram.com/acme');
  assert.match(lead.location, /Lagos/);
  assert.equal(lead.industry, 'Events');
});

test('dedupe index recognises person leads by name at their employer', () => {
  const index = buildDedupeIndex([{ name: 'Jane Doe', website: '', companyDomain: 'acme.com', emails: [], socials: {} }]);
  assert.ok(index.has('nm:janedoe@acme.com'));
});

test('page 2 is never requested: searches walk free filter slices and resume', async () => {
  const bodies = [];
  const client = makeClient({
    cfg: { freeRequestsPerDay: 100 },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      const n = bodies.length;
      return peopleResponse(Array.from({ length: 10 }, (_, i) => ({
        first_name: 'S' + n, last_name: String(i), linkedin_url: 'https://linkedin.com/in/s' + n + '-' + i, company_domain: 's' + n + '.com',
      })));
    },
  });
  const args = { jobTitles: ['Founder'], companyDefinition: 'x', limit: 100, maxPages: 2 };
  const a = await discoverPeople(client, args);
  assert.equal(a.items.length, 20);
  assert.ok(bodies.every((b) => b.page === 1 && b.page_size === 10), 'only free page 1');
  assert.equal(bodies[0].company_filters.size, undefined, 'first slice is unfiltered');
  assert.deepEqual(bodies[1].company_filters.size, { min: 1, max: 10 });
  client.setCursor(a.cursor.key, a.cursor.page);
  await discoverPeople(client, { ...args, maxPages: 1 });
  assert.deepEqual(bodies[2].company_filters.size, { min: 11, max: 50 }, 'resumes at the next slice');
});

test('an empty unfiltered search stops after one free request', async () => {
  let calls = 0;
  const client = makeClient({ fetchImpl: async () => { calls += 1; return emptyPeople(); } });
  const out = await discoverPeople(client, { jobTitles: ['Founder'], companyDefinition: 'x', maxPages: 5 });
  assert.equal(calls, 1);
  assert.equal(out.items.length, 0);
});

test('a mid-run failure keeps what earlier pages found', async () => {
  let n = 0;
  const client = makeClient({
    cfg: { freeRequestsPerDay: 100 },
    fetchImpl: async () => {
      n += 1;
      if (n === 2) return json({ detail: 'slow down' }, 429);
      return peopleResponse(Array.from({ length: 10 }, (_, i) => ({ first_name: 'A', last_name: String(i), linkedin_url: `https://linkedin.com/in/a${i}`, company_domain: 'a.com' })));
    },
  });
  const out = await discoverPeople(client, { jobTitles: ['Founder'], companyDefinition: 'x', limit: 50 });
  assert.equal(out.items.length, 10);
  assert.match(out.stats.warning, /rate limit/i);
});

test('a "free" request that reports a charge stops paging', async () => {
  let n = 0;
  const client = makeClient({
    cfg: { freeRequestsPerDay: 100 },
    fetchImpl: async () => {
      n += 1;
      return json({ people: Array.from({ length: 10 }, (_, i) => ({ first_name: 'B', last_name: String(i), linkedin_url: `https://linkedin.com/in/b${i}`, company_domain: 'b.com' })), meta: { credits_charged: 5 } });
    },
  });
  const out = await discoverPeople(client, { jobTitles: ['Founder'], companyDefinition: 'x', limit: 50 });
  assert.equal(n, 1);
  assert.match(out.stats.warning, /expected to be free/);
});

test('an enrichment that already found an email is never paid for twice', async () => {
  let calls = 0;
  const client = makeClient({
    fetchImpl: async (url) => {
      if (url.endsWith('/billing/balance')) return json({ remain: 3000 });
      calls += 1;
      return json({ email: 'jane@acme.com', email_status: 'valid', meta: { credits_charged: 1.5, remaining_balance: 2998.5 } });
    },
  });
  const a = await client.enrichEmail({ firstName: 'Jane', lastName: 'Doe', companyDomain: 'https://www.acme.com/about' });
  const b = await client.enrichEmail({ firstName: 'jane', lastName: 'doe', companyDomain: 'acme.com' });
  assert.equal(calls, 1);
  assert.equal(b.cached, true);
  assert.equal(b.estimated_cost, 0);
  assert.equal(a.email, b.email);
  assert.equal(client.budget().used, 1.5);
});

test('concurrent paid calls cannot both slip past the budget', async () => {
  let calls = 0;
  const client = makeClient({
    cfg: { lifetimeCreditBudget: 2 },
    fetchImpl: async (url) => {
      if (url.endsWith('/billing/balance')) return json({ remain: 3000 });
      calls += 1;
      return json({ email: `p${calls}@acme.com`, meta: { credits_charged: 1.5 } });
    },
  });
  const results = await Promise.allSettled([
    client.enrichEmail({ firstName: 'A', lastName: 'One', companyDomain: 'acme.com' }),
    client.enrichEmail({ firstName: 'B', lastName: 'Two', companyDomain: 'acme.com' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'lifetime_cap');
});
