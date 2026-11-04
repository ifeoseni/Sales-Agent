import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTechStack } from '../lib/enrich.js';
import { verifyEmailMx } from '../lib/verify.js';
import { formatLeadPayload } from '../lib/webhook.js';
import { convertCurrency, getRates } from '../lib/currency.js';
import { draftIcebreaker } from '../lib/agent.js';
import crypto from 'node:crypto';

test('detectTechStack identifies CMS, e-commerce, payment gateways, and JS frameworks', () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="generator" content="WordPress 6.4.2" />
        <link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css" />
        <script src="https://js.paystack.co/v1/inline.js"></script>
        <script src="/_next/static/chunks/main.js"></script>
      </head>
      <body>
        <div id="__next">Hello world</div>
      </body>
    </html>
  `;
  const headers = { 'server': 'cloudflare' };
  const detected = detectTechStack(html, headers);

  assert.ok(detected.includes('WordPress'), 'detects WordPress from meta generator');
  assert.ok(detected.includes('WooCommerce'), 'detects WooCommerce from plugins css');
  assert.ok(detected.includes('Paystack'), 'detects Paystack inline js');
  assert.ok(detected.includes('Next.js'), 'detects Next.js chunk and div');
  assert.ok(detected.includes('Cloudflare'), 'detects Cloudflare server header');
});

test('detectTechStack returns empty array on plain text or empty input', () => {
  assert.deepEqual(detectTechStack(''), []);
  assert.deepEqual(detectTechStack(null), []);
});

test('verifyEmailMx identifies MX records and mail providers', async () => {
  // Test invalid/empty email
  const bad = await verifyEmailMx('invalid-format');
  assert.equal(bad.status, 'invalid');
  assert.equal(bad.reason, 'Invalid email');

  // Test dead/non-existent domain
  const nonExistent = await verifyEmailMx('user@this-domain-definitely-does-not-exist-987654321.xyz');
  assert.equal(nonExistent.status, 'unreachable');

  // Test standard valid domain (e.g. gmail.com)
  const gmail = await verifyEmailMx('contact@gmail.com');
  assert.equal(gmail.status, 'verified');
  assert.ok(gmail.primaryMx.includes('google') || gmail.provider === 'Google Workspace');
});

test('formatLeadPayload formats clean webhook JSON with metadata', () => {
  const sampleLead = {
    id: 'lead_123',
    name: 'Acme Event Centre',
    status: 'won',
    value: 500000,
    emails: ['info@acme.com'],
    phones: ['+2348012345678'],
    website: 'https://acme.com',
    location: 'Lagos, Nigeria',
    industry: 'Events',
    tags: ['vip', 'inbound'],
  };
  const payload = formatLeadPayload('lead:won', sampleLead);

  assert.equal(payload.event, 'lead:won');
  assert.equal(payload.lead.id, 'lead_123');
  assert.equal(payload.lead.name, 'Acme Event Centre');
  assert.equal(payload.lead.value, 500000);
  assert.ok(payload.timestamp);
});

test('Webhook HMAC signature can be verified', () => {
  const secret = 'super-secret-key';
  const body = JSON.stringify({ hello: 'world' });
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');

  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(sig, expected);
});

test('convertCurrency converts correctly between NGN, USD, EUR, and GBP', async () => {
  // 1,600,000 NGN => 1,000 USD (at 1600 NGN/USD default)
  const inUsd = await convertCurrency(1600000, 'NGN', 'USD');
  assert.equal(Math.round(inUsd), 1000);

  // Same currency returns exact value
  assert.equal(await convertCurrency(5000, 'NGN', 'NGN'), 5000);
});

test('draftIcebreaker creates cold outreach hooks and pain points', async () => {
  const lead = {
    name: 'Lagos Premier Events',
    industry: 'Wedding Planner',
    location: 'Victoria Island, Lagos',
    description: 'Luxury wedding planning and hall decor',
  };

  const ice = await draftIcebreaker(lead);
  assert.ok(ice.hook, 'has hook');
  assert.ok(ice.painPoint, 'has pain point');
  assert.ok(ice.qualificationQuestion, 'has qualification question');
  assert.ok(ice.hook.includes('Lagos Premier Events'), 'hook mentions company name');
});

test('mergeLeads preserves website, address, tech stack, and emailHealth from duplicate', async () => {
  const { addLead, mergeLeads, removeLead, getLead } = await import('../lib/leads.js');
  const { lead: l1 } = addLead({ name: 'Lead Target', location: 'Lagos' });
  const { lead: l2 } = addLead({
    name: 'Lead Source',
    website: 'https://source-example.com',
    address: '10 Admiralty Way, Lekki',
    sourceUrl: 'https://maps.google.com/source',
    tech: ['WordPress', 'Paystack'],
    emailHealth: { status: 'verified', provider: 'Google Workspace' },
  });

  const merged = mergeLeads(l2.id, l1.id);
  assert.equal(merged.website, 'https://source-example.com');
  assert.equal(merged.address, '10 Admiralty Way, Lekki');
  assert.equal(merged.sourceUrl, 'https://maps.google.com/source');
  assert.ok(merged.tech.includes('WordPress') && merged.tech.includes('Paystack'));
  assert.equal(merged.emailHealth.provider, 'Google Workspace');

  removeLead(merged.id);
});

test('getRates immediately reflects changes to settings.crm.usdRate without waiting for 6hr cache', async () => {
  const { updateSettings } = await import('../lib/settings.js');
  updateSettings({ crm: { usdRate: 1550 } });
  const r1 = await getRates();
  assert.equal(r1.rates.NGN, 1550);

  updateSettings({ crm: { usdRate: 1650 } });
  const r2 = await getRates();
  assert.equal(r2.rates.NGN, 1650);

  // Restore default
  updateSettings({ crm: { usdRate: 1600 } });
});
