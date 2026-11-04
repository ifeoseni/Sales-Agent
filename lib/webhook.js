import crypto from 'node:crypto';
import { getSettings } from './settings.js';
import { bus } from './events.js';
import { assertPublicUrl } from './net.js';

const UA = 'CodeTech-Sales-Agent/1.0 (+https://codetechcl.com)';

/** Formats a lead into a clean webhook payload. */
export function formatLeadPayload(event, lead, extra = {}) {
  return {
    event,
    timestamp: new Date().toISOString(),
    lead: {
      id: lead.id,
      name: lead.name,
      website: lead.website || '',
      industry: lead.industry || '',
      location: lead.location || '',
      address: lead.address || '',
      sourceUrl: lead.sourceUrl || '',
      emails: lead.emails || [],
      phones: lead.phones || [],
      socials: lead.socials || {},
      status: lead.status,
      priority: lead.priority || 'normal',
      value: lead.value || 0,
      score: lead.score || 0,
      tags: lead.tags || [],
      owner: lead.owner || '',
      product: lead.product || '',
      tech: lead.tech || [],
      createdAt: lead.createdAt,
    },
    ...extra,
  };
}

/** Sends a POST webhook payload to the configured URL. */
export async function dispatchWebhook(event, lead, extra = {}) {
  const cfg = getSettings().webhook;
  if (!cfg || !cfg.enabled || !cfg.url) return { sent: false, reason: 'Webhook disabled or no URL' };

  if (event === 'lead:created' && !cfg.onCreated) return { sent: false, reason: 'onCreated disabled' };
  if (event === 'lead:won' && !cfg.onWon) return { sent: false, reason: 'onWon disabled' };
  if (event === 'lead:qualified' && !cfg.onQualified) return { sent: false, reason: 'onQualified disabled' };

  const payload = formatLeadPayload(event, lead, extra);
  const rawBody = JSON.stringify(payload);

  const headers = {
    'content-type': 'application/json',
    'user-agent': UA,
    'x-codetech-event': event,
    'x-codetech-delivery': crypto.randomUUID(),
  };

  if (cfg.secret) {
    const sig = crypto.createHmac('sha256', cfg.secret).update(rawBody).digest('hex');
    headers['x-codetech-signature'] = `sha256=${sig}`;
  }

  try {
    await assertPublicUrl(cfg.url);
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(10000),
    });
    return { sent: true, status: res.status, ok: res.ok };
  } catch (err) {
    return { sent: false, error: err.message };
  }
}

/** Test endpoint: sends a ping payload to a custom or configured webhook URL. */
export async function testWebhook(customUrl, secret) {
  const url = customUrl || getSettings().webhook?.url;
  if (!url) throw new Error('Enter a webhook URL first');
  await assertPublicUrl(url);

  const testPayload = {
    event: 'test:ping',
    timestamp: new Date().toISOString(),
    message: 'Hello from Code Tech Sales Agent! Webhook connection verified successfully.',
    sampleLead: {
      name: 'Harbour Point Event Centre',
      location: 'Lagos, Nigeria',
      status: 'won',
      value: 2500000,
    },
  };
  const rawBody = JSON.stringify(testPayload);
  const headers = {
    'content-type': 'application/json',
    'user-agent': UA,
    'x-codetech-event': 'test:ping',
  };
  const sec = secret || getSettings().webhook?.secret;
  if (sec) {
    headers['x-codetech-signature'] = `sha256=${crypto.createHmac('sha256', sec).update(rawBody).digest('hex')}`;
  }

  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: rawBody,
    signal: AbortSignal.timeout(12000),
  });
  const duration = Date.now() - start;
  return { status: res.status, ok: res.ok, durationMs: duration };
}

// Wire up event listeners
bus.on('lead:created', (lead) => {
  dispatchWebhook('lead:created', lead).catch(() => {});
});

bus.on('lead:won', (lead) => {
  dispatchWebhook('lead:won', lead).catch(() => {});
});

bus.on('lead:stage', ({ lead, from, to }) => {
  if (to === 'qualified') {
    dispatchWebhook('lead:qualified', lead, { previousStage: from }).catch(() => {});
  }
});
