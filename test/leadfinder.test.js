import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-leadfinder-'));
process.env.GEOAPIFY_API_KEY = 'test-key';

const realFetch = globalThis.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.pathname === '/v1/geocode/search') {
    return json({ results: [{ place_id: 'city-1', formatted: 'Lagos, Nigeria', lon: 3.394, lat: 6.455 }] });
  }
  if (u.pathname === '/v2/places') {
    return json({ features: [{ properties: { place_id: 'place-1', name: 'Glam Events', formatted: '12 Allen Avenue, Ikeja, Lagos' } }] });
  }
  if (u.pathname === '/v2/place-details') {
    return json({ features: [{ properties: { name: 'Glam Events', formatted: '12 Allen Avenue, Ikeja, Lagos' } }] });
  }
  return json({}, 404);
};

const { findLeads, leadsFromUrls } = await import('../lib/leadfinder.js');
const { listLeads } = await import('../lib/leads.js');

test('saves a map listing even when it publishes no email or phone', async () => {
  const progress = [];
  const r = await findLeads(
    { query: 'event planning company', location: 'Lagos, Nigeria', sources: ['geoapify'], limit: 5 },
    (p) => progress.push(p),
  );

  assert.equal(r.leads.length, 1, 'the place is saved instead of being discarded');
  assert.equal(r.leads[0].name, 'Glam Events');
  assert.equal(r.leads[0].source, 'geoapify');
  assert.ok(r.leads[0].tags.includes('needs contact'), 'flagged for follow-up when no direct contact is published');
  assert.ok(progress.some((p) => /places found/.test(p)));
  assert.ok(listLeads().some((l) => l.name === 'Glam Events'));
});

test('leadsFromUrls directly converts social profile URLs into leads without generic crawling', async () => {
  const r = await leadsFromUrls(['https://instagram.com/lagos_parties'], { industry: 'event planner', location: 'Lagos' });
  assert.equal(r.leads.length, 1);
  assert.equal(r.leads[0].source, 'social-import');
  assert.equal(r.leads[0].socials.instagram, 'https://instagram.com/lagos_parties');
  assert.ok(r.leads[0].tags.includes('social-lead'));
});

test('restores the real fetch', () => {
  globalThis.fetch = realFetch;
});
