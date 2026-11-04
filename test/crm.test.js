import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-crm-'));
delete process.env.ADMIN_PASSWORD;
delete process.env.GEOAPIFY_API_KEY;
const S = await import('../lib/settings.js');
const L = await import('../lib/leads.js');

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);

test('CRM preferences are validated and stored', () => {
  const out = S.updateSettings({ crm: { currency: 'usd!', monthlyTarget: 1250000, followUpDays: 99 } });
  assert.equal(out.crm.currency, 'USD');
  assert.equal(out.crm.monthlyTarget, 1250000);
  assert.equal(out.crm.followUpDays, 30);
  assert.equal(S.updateSettings({ crm: { followUpDays: 0 } }).crm.followUpDays, 1);
});

test('tasks, follow-ups and activities are recorded on a lead', () => {
  const { lead } = L.addLead({
    name: 'Task Test Studio',
    website: 'https://task-test.example',
    emails: ['hello@task-test.example'],
    tags: ['VIP', 'inbound', 'vip'],
    value: '450000',
    priority: 'high',
  });
  assert.deepEqual(lead.tags, ['vip', 'inbound']);
  assert.equal(lead.value, 450000);
  assert.equal(lead.priority, 'high');

  let updated = L.addTask(lead.id, { title: 'Call the owner', due: today(), priority: 'high' });
  assert.equal(updated.tasks.length, 1);
  assert.equal(L.nextFollowUp(updated), today());
  const taskId = updated.tasks[0].id;

  updated = L.updateTask(lead.id, taskId, { done: true });
  assert.equal(updated.tasks[0].done, true);
  assert.ok(updated.tasks[0].completedAt);
  assert.ok(updated.activities.some((a) => a.type === 'task' && a.text.includes('Task completed')));

  updated = L.addActivity(lead.id, { type: 'note', text: 'Asked for a demo next week' });
  assert.ok(updated.activities.some((a) => a.text === 'Asked for a demo next week'));

  updated = L.removeTask(lead.id, taskId);
  assert.equal(updated.tasks.length, 0);
});

test('dashboard aggregates pipeline, follow-ups, sources and recent activity', () => {
  const { lead: contacted } = L.addLead({
    name: 'Dashboard Contacted Co',
    website: 'https://dashboard-contacted.example',
    status: 'contacted',
    value: 100000,
    source: 'web-search',
  });
  L.addTask(contacted.id, { title: 'Overdue follow-up', due: yesterday() });
  L.addLead({
    name: 'Dashboard Won Co',
    website: 'https://dashboard-won.example',
    status: 'won',
    value: 500000,
    source: 'referral',
  });
  L.addTask(contacted.id, { title: 'Upcoming follow-up', due: today() });

  const d = L.dashboard();
  assert.ok(d.totals.leads >= 3);
  assert.ok(d.pipeline.find((p) => p.status === 'won').count >= 1);
  assert.ok(d.kpis.openValue >= 100000);
  assert.ok(d.kpis.wonValue >= 500000);
  assert.ok(d.tasks.due.some((t) => t.title === 'Overdue follow-up'));
  assert.ok(d.tasks.overdue.some((t) => t.title === 'Overdue follow-up'));
  assert.ok(d.recent.some((a) => a.type === 'created'));
  assert.ok(d.sources.some((s) => s.source === 'referral'));
  assert.equal(d.weekly.length, 8);
});

test('bulk actions update status and tags, then delete selected leads', () => {
  const { lead: a } = L.addLead({ name: 'Bulk Alpha', website: 'https://bulk-alpha.example' });
  const { lead: b } = L.addLead({ name: 'Bulk Beta', website: 'https://bulk-beta.example' });

  const first = L.bulkUpdate([a.id, b.id], 'status', { status: 'qualified' });
  assert.equal(first.updated, 2);
  assert.equal(L.getLead(a.id).status, 'qualified');
  assert.equal(L.getLead(b.id).status, 'qualified');

  L.bulkUpdate([a.id, b.id], 'tag', { tags: ['bulk'] });
  assert.deepEqual(L.getLead(a.id).tags, ['bulk']);
  assert.deepEqual(L.getLead(b.id).tags, ['bulk']);

  const deleted = L.bulkUpdate([b.id], 'delete');
  assert.equal(deleted.deleted, 1);
  assert.equal(L.getLead(b.id), undefined);
});

test('duplicate merge keeps one lead and combines its history', () => {
  const { lead: source } = L.addLead({
    name: 'Merge Source',
    website: 'https://merge-source.example',
    emails: ['source@merge.example'],
    value: 70000,
    tags: ['source'],
  });
  const { lead: target } = L.addLead({
    name: 'Merge Target',
    website: 'https://merge-target.example',
    emails: ['target@merge.example'],
    value: 200000,
    tags: ['target'],
  });
  L.addTask(source.id, { title: 'Source task', due: today() });
  L.addActivity(source.id, { type: 'note', text: 'Source history' });

  const merged = L.mergeLeads(source.id, target.id);
  assert.ok(merged);
  assert.equal(L.getLead(source.id), undefined);
  assert.deepEqual(merged.emails.sort(), ['source@merge.example', 'target@merge.example']);
  assert.deepEqual(merged.tags.sort(), ['source', 'target']);
  assert.equal(merged.value, 200000);
  assert.equal(merged.tasks.length, 1);
  assert.ok(merged.activities.some((a) => a.type === 'merge'));
  assert.ok(merged.activities.some((a) => a.text === 'Source history'));
});

test('toVcf generates valid vCard 3.0 format for mobile address books', () => {
  const vcf = L.toVcf();
  assert.ok(vcf.includes('BEGIN:VCARD'));
  assert.ok(vcf.includes('VERSION:3.0'));
  assert.ok(vcf.includes('END:VCARD'));
  assert.ok(vcf.includes('EMAIL;TYPE=WORK,INTERNET:'));
});
