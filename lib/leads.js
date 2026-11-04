import { load, save, uid } from './store.js';
import { cleanUrl } from './net.js';
import { normPhone } from './scraper.js';
import { getSettings } from './settings.js';
import { bus } from './events.js';

export const STATUSES = ['new', 'contacted', 'replied', 'qualified', 'demo', 'proposal', 'won', 'lost', 'do-not-contact'];
export const OPEN_STATUSES = ['new', 'contacted', 'replied', 'qualified', 'demo', 'proposal'];
export const PRIORITIES = ['low', 'normal', 'high'];
export const STATUS_LABELS = {
  new: 'New',
  contacted: 'Contacted',
  replied: 'Replied',
  qualified: 'Qualified',
  demo: 'Demo',
  proposal: 'Proposal',
  won: 'Won',
  lost: 'Lost',
  'do-not-contact': 'Do not contact',
};
const STAGE_PROBABILITY = {
  new: 0.05,
  contacted: 0.1,
  replied: 0.2,
  qualified: 0.35,
  demo: 0.5,
  proposal: 0.7,
  won: 1,
  lost: 0,
  'do-not-contact': 0,
};
const SOCIAL_KEYS = ['facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'youtube', 'telegram', 'whatsapp'];
const EMAIL_OK = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;
const MAX_ACTIVITIES = 120;
const MAX_TASKS = 50;
const DAY = 864e5;

/* ---------- validation: nothing malformed or unsafe is ever stored ---------- */
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

function cleanEmails(list) {
  return [...new Set([].concat(list || []).map((e) => text(e, 120).toLowerCase()).filter((e) => EMAIL_OK.test(e)))].slice(0, 10);
}

function cleanPhones(list) {
  const cc = getSettings().lead.defaultCountryCode;
  return [
    ...new Set(
      [].concat(list || [])
        .map((p) => text(p, 30))
        .map((p) => normPhone(p, cc) || (/^[\d+()\s.-]{7,20}$/.test(p) ? p : null))
        .filter(Boolean),
    ),
  ].slice(0, 10);
}

function cleanSocials(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const k of SOCIAL_KEYS) {
    const v = k === 'whatsapp' && /^\+?\d[\d\s-]{7,16}$/.test(String(obj[k] || '')) ? `https://wa.me/${String(obj[k]).replace(/\D/g, '')}` : cleanUrl(obj[k]);
    if (v) out[k] = v;
  }
  return out;
}

function cleanTags(list) {
  const items = Array.isArray(list) ? list : String(list || '').split(/[,;]/);
  return [...new Set(items
    .map((t) => String(t).trim().replace(/^#/, '').toLowerCase().slice(0, 30))
    .filter((t) => t && /^[a-z0-9][a-z0-9 _-]*$/.test(t)))]
    .slice(0, 12);
}

const cleanMoney = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n * 100) / 100, 0), 1e12) : 0;
};
const cleanPriority = (v) => (PRIORITIES.includes(v) ? v : 'normal');
const cleanIso = (v) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const cleanDue = (v) => {
  const iso = cleanIso(v);
  return iso ? iso.slice(0, 10) : null;
};
const localKey = (d = new Date()) => {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

function normalizeActivity(a) {
  if (!a || typeof a !== 'object') return null;
  const at = cleanIso(a.at) || new Date().toISOString();
  const type = text(a.type || 'activity', 24) || 'activity';
  const body = text(a.text, 500);
  if (!body) return null;
  const meta = a.meta && typeof a.meta === 'object' && !Array.isArray(a.meta) ? a.meta : undefined;
  return { id: text(a.id, 40) || uid(), type, text: body, at, ...(meta ? { meta } : {}) };
}

function normalizeTask(t) {
  if (!t || typeof t !== 'object') return null;
  const title = text(t.title, 200);
  if (!title) return null;
  return {
    id: text(t.id, 40) || uid(),
    title,
    due: cleanDue(t.due),
    priority: cleanPriority(t.priority),
    done: !!t.done,
    createdAt: cleanIso(t.createdAt) || new Date().toISOString(),
    completedAt: t.done ? cleanIso(t.completedAt) || new Date().toISOString() : null,
  };
}

function normalizeLead(l) {
  if (!l || typeof l !== 'object') return null;
  const createdAt = cleanIso(l.createdAt) || new Date().toISOString();
  const status = STATUSES.includes(l.status) ? l.status : 'new';
  return {
    id: text(l.id, 40) || uid(),
    name: text(l.name, 200) || 'Unknown',
    website: cleanUrl(l.website),
    industry: text(l.industry, 100),
    location: text(l.location, 150),
    address: text(l.address, 250),
    sourceUrl: cleanUrl(l.sourceUrl),
    tech: Array.isArray(l.tech) ? l.tech.slice(0, 10).map((t) => text(t, 50)).filter(Boolean) : [],
    emailHealth: l.emailHealth && typeof l.emailHealth === 'object' ? l.emailHealth : undefined,
    description: text(l.description, 600),
    emails: cleanEmails(l.emails),
    phones: cleanPhones(l.phones),
    socials: cleanSocials(l.socials),
    source: text(l.source, 40) || 'manual',
    product: text(l.product, 60),
    status,
    notes: text(l.notes, 5000),
    transcript: l.transcript ? text(l.transcript, 8000) : undefined,
    tags: cleanTags(l.tags),
    value: cleanMoney(l.value),
    priority: cleanPriority(l.priority),
    owner: text(l.owner, 80),
    tasks: (Array.isArray(l.tasks) ? l.tasks : []).map(normalizeTask).filter(Boolean).slice(0, MAX_TASKS),
    activities: (Array.isArray(l.activities) ? l.activities : []).map(normalizeActivity).filter(Boolean).slice(0, MAX_ACTIVITIES),
    createdAt,
    updatedAt: cleanIso(l.updatedAt) || createdAt,
    lastContacted: cleanIso(l.lastContacted),
    lastActivityAt: cleanIso(l.lastActivityAt) || cleanIso(l.updatedAt) || createdAt,
    stageChangedAt: cleanIso(l.stageChangedAt) || createdAt,
    wonAt: cleanIso(l.wonAt),
  };
}

let leads = load('leads', []).map(normalizeLead).filter(Boolean);
const persist = () => save('leads', leads);

/* ---------- scoring / helpers ---------- */
export function nextFollowUp(l) {
  const open = (l.tasks || []).filter((t) => !t.done && t.due).sort((a, b) => a.due.localeCompare(b.due));
  return open[0]?.due || null;
}

export function scoreLead(l) {
  let s = 0;
  if (l.emails?.length) s += 3;
  if (l.phones?.length) s += 2;
  if (l.website) s += 1;
  s += Math.min(Object.keys(l.socials || {}).length, 3);
  return s;
}

const domainOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
};
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pushActivity = (l, activity) => {
  const a = normalizeActivity(activity);
  if (!a) return;
  l.activities = [a, ...(l.activities || [])].slice(0, MAX_ACTIVITIES);
  l.lastActivityAt = a.at;
};

/* ---------- reads ---------- */
export const listLeads = () => leads;
export const getLead = (id) => leads.find((l) => l.id === id);

export function findDuplicate(c) {
  const d = domainOf(c.website);
  return leads.find(
    (l) =>
      (d && domainOf(l.website) === d) ||
      (c.emails || []).some((e) => l.emails?.includes(String(e).toLowerCase())) ||
      (c.phones || []).some((p) => l.phones?.includes(p)) ||
      (c.name && l.name && norm(l.name) === norm(c.name) && (!c.location || !l.location || norm(l.location) === norm(c.location))),
  );
}

/* ---------- writes ---------- */
export function addLead(c) {
  const now = new Date().toISOString();
  const clean = {
    name: text(c.name, 200) || 'Unknown',
    website: cleanUrl(c.website),
    industry: text(c.industry, 100),
    location: text(c.location, 150),
    address: text(c.address, 250),
    sourceUrl: cleanUrl(c.sourceUrl),
    tech: Array.isArray(c.tech) ? c.tech.slice(0, 10).map((t) => text(t, 50)).filter(Boolean) : [],
    emailHealth: c.emailHealth && typeof c.emailHealth === 'object' ? c.emailHealth : undefined,
    description: text(c.description, 600),
    emails: cleanEmails(c.emails),
    phones: cleanPhones(c.phones),
    socials: cleanSocials(c.socials),
  };
  const dup = findDuplicate(clean);
  if (dup) return { lead: dup, created: false };

  const status = STATUSES.includes(c.status) ? c.status : 'new';
  const source = text(c.source || 'manual', 40);
  const lead = {
    id: uid(),
    ...clean,
    source,
    product: text(c.product, 60),
    status,
    notes: text(c.notes, 5000),
    transcript: c.transcript ? text(c.transcript, 8000) : undefined,
    tags: cleanTags(c.tags),
    value: cleanMoney(c.value),
    priority: cleanPriority(c.priority),
    owner: text(c.owner, 80),
    tasks: [],
    activities: [],
    createdAt: now,
    updatedAt: now,
    lastContacted: cleanIso(c.lastContacted) || (status !== 'new' ? now : null),
    lastActivityAt: now,
    stageChangedAt: now,
    wonAt: status === 'won' ? now : null,
  };
  lead.score = scoreLead(lead);
  pushActivity(lead, { type: 'created', text: `Lead created from ${source}` });
  if (status !== 'new') pushActivity(lead, { type: 'status', text: `Started at ${STATUS_LABELS[status]}` });
  leads.unshift(lead);
  persist();
  bus.emit('lead:created', lead);
  if (status === 'won') bus.emit('lead:won', lead);
  return { lead, created: true };
}

export function updateLead(id, patch) {
  const l = getLead(id);
  if (!l || !patch || typeof patch !== 'object') return null;
  const before = {
    status: l.status,
    notes: l.notes,
    lastContacted: l.lastContacted,
    emails: JSON.stringify(l.emails),
    phones: JSON.stringify(l.phones),
    socials: JSON.stringify(l.socials),
  };
  const set = {
    name: (v) => text(v, 200) || l.name,
    website: cleanUrl,
    industry: (v) => text(v, 100),
    location: (v) => text(v, 150),
    address: (v) => text(v, 250),
    sourceUrl: cleanUrl,
    tech: (v) => (Array.isArray(v) ? v.slice(0, 10).map((t) => text(t, 50)).filter(Boolean) : l.tech || []),
    emailHealth: (v) => (v && typeof v === 'object' ? v : l.emailHealth),
    description: (v) => text(v, 600),
    emails: cleanEmails,
    phones: cleanPhones,
    socials: cleanSocials,
    product: (v) => text(v, 60),
    notes: (v) => text(v, 5000),
    transcript: (v) => text(v, 8000),
    status: (v) => (STATUSES.includes(v) ? v : l.status),
    lastContacted: (v) => cleanIso(v),
    tags: cleanTags,
    value: cleanMoney,
    priority: cleanPriority,
    owner: (v) => text(v, 80),
  };
  for (const k of Object.keys(set)) if (Object.hasOwn(patch, k)) l[k] = set[k](patch[k]);

  const now = new Date().toISOString();
  if (l.status === 'contacted' && !l.lastContacted) l.lastContacted = now;
  if (l.status !== before.status) {
    l.stageChangedAt = now;
    l.wonAt = l.status === 'won' ? now : null;
    pushActivity(l, { type: 'status', text: `Stage changed from ${STATUS_LABELS[before.status]} to ${STATUS_LABELS[l.status]}`, meta: { from: before.status, to: l.status } });
    bus.emit('lead:stage', { lead: l, from: before.status, to: l.status });
    if (l.status === 'won') bus.emit('lead:won', l);
  } else if (patch.lastContacted !== undefined && l.lastContacted !== before.lastContacted) {
    pushActivity(l, { type: 'contact', text: 'Marked as contacted' });
  }
  if (l.notes !== before.notes && l.notes) pushActivity(l, { type: 'note', text: 'Notes updated' });
  if (JSON.stringify(l.emails) !== before.emails || JSON.stringify(l.phones) !== before.phones || JSON.stringify(l.socials) !== before.socials) {
    pushActivity(l, { type: 'contact', text: 'Contact details updated' });
  }

  l.updatedAt = now;
  l.score = scoreLead(l);
  persist();
  return l;
}

export function addActivity(id, activity) {
  const l = getLead(id);
  if (!l) return null;
  pushActivity(l, activity);
  l.updatedAt = new Date().toISOString();
  persist();
  return l;
}

export function addTask(id, task = {}) {
  const l = getLead(id);
  if (!l) return null;
  const t = normalizeTask({ ...task, id: uid(), createdAt: new Date().toISOString() });
  if (!t) return null;
  l.tasks = [...(l.tasks || []), t].slice(-MAX_TASKS);
  pushActivity(l, { type: 'task', text: `Task added: ${t.title}` });
  l.updatedAt = new Date().toISOString();
  persist();
  return l;
}

export function updateTask(id, taskId, patch = {}) {
  const l = getLead(id);
  if (!l) return null;
  const t = (l.tasks || []).find((x) => x.id === taskId);
  if (!t) return null;
  if (patch.title !== undefined) t.title = text(patch.title, 200) || t.title;
  if (patch.due !== undefined) t.due = cleanDue(patch.due);
  if (patch.priority !== undefined) t.priority = cleanPriority(patch.priority);
  if (patch.done !== undefined) {
    const done = !!patch.done;
    if (done !== t.done) {
      t.done = done;
      t.completedAt = done ? new Date().toISOString() : null;
      pushActivity(l, { type: 'task', text: done ? `Task completed: ${t.title}` : `Task reopened: ${t.title}` });
    }
  }
  l.updatedAt = new Date().toISOString();
  persist();
  return l;
}

export function removeTask(id, taskId) {
  const l = getLead(id);
  if (!l) return null;
  const t = (l.tasks || []).find((x) => x.id === taskId);
  if (!t) return null;
  l.tasks = l.tasks.filter((x) => x.id !== taskId);
  pushActivity(l, { type: 'task', text: `Task removed: ${t.title}` });
  l.updatedAt = new Date().toISOString();
  persist();
  return l;
}

export function mergeContacts(id, found) {
  const l = getLead(id);
  if (!l) return null;
  l.emails = cleanEmails([...(l.emails || []), ...(found.emails || [])]);
  l.phones = cleanPhones([...(l.phones || []), ...(found.phones || [])]);
  l.socials = { ...cleanSocials(found.socials), ...(l.socials || {}) };
  if (!l.description && found.description) l.description = text(found.description, 600);
  if (found.tech?.length) l.tech = [...new Set([...(l.tech || []), ...found.tech])].slice(0, 8);
  l.updatedAt = new Date().toISOString();
  l.score = scoreLead(l);
  pushActivity(l, { type: 'enrich', text: 'Contact details refreshed from the website' });
  persist();
  return l;
}

export function removeLead(id) {
  const n = leads.length;
  leads = leads.filter((l) => l.id !== id);
  if (leads.length !== n) persist();
  return leads.length !== n;
}

export function mergeLeads(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return null;
  const source = getLead(sourceId);
  const target = getLead(targetId);
  if (!source || !target) return null;
  target.emails = cleanEmails([...(target.emails || []), ...(source.emails || [])]);
  target.phones = cleanPhones([...(target.phones || []), ...(source.phones || [])]);
  target.socials = { ...(source.socials || {}), ...(target.socials || {}) };
  target.website ||= source.website || '';
  target.address ||= source.address || '';
  target.sourceUrl ||= source.sourceUrl || '';
  target.tech = [...new Set([...(target.tech || []), ...(source.tech || [])])].slice(0, 10);
  target.emailHealth ||= source.emailHealth;
  target.tags = cleanTags([...(target.tags || []), ...(source.tags || [])]);
  target.value = Math.max(target.value || 0, source.value || 0);
  target.owner ||= source.owner || '';
  target.notes = [target.notes, source.notes && `Merged from ${source.name}: ${source.notes}`].filter(Boolean).join('\n\n').slice(0, 5000);
  target.tasks = [...(target.tasks || []), ...(source.tasks || [])].slice(-MAX_TASKS);
  const now = new Date().toISOString();
  pushActivity(target, { type: 'merge', text: `Merged duplicate ${source.name}` });
  target.activities = [...(source.activities || []), ...(target.activities || [])]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, MAX_ACTIVITIES);
  target.updatedAt = now;
  target.score = scoreLead(target);
  leads = leads.filter((l) => l.id !== sourceId);
  persist();
  return target;
}

/* ---------- bulk operations ---------- */
export function bulkUpdate(ids, action, payload = {}) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, 500);
  if (action === 'delete') {
    const n = leads.length;
    leads = leads.filter((l) => !unique.includes(l.id));
    if (leads.length !== n) persist();
    return { updated: 0, deleted: n - leads.length };
  }
  let updated = 0;
  for (const id of unique) {
    const l = getLead(id);
    if (!l) continue;
    if (action === 'status' && STATUSES.includes(payload.status)) updateLead(id, { status: payload.status });
    else if (action === 'priority' && PRIORITIES.includes(payload.priority)) updateLead(id, { priority: payload.priority });
    else if (action === 'owner') updateLead(id, { owner: payload.owner || '' });
    else if (action === 'value') updateLead(id, { value: payload.value });
    else if (action === 'tag') updateLead(id, { tags: [...(l.tags || []), ...(payload.tags || [])] });
    else if (action === 'task' && payload.task) addTask(id, payload.task);
    else continue;
    updated++;
  }
  return { updated, deleted: 0 };
}

/* ---------- stats + dashboard ---------- */
export function stats() {
  const by = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const l of leads) by[l.status] = (by[l.status] || 0) + 1;
  const open = leads.filter((l) => OPEN_STATUSES.includes(l.status));
  const won = leads.filter((l) => l.status === 'won');
  return {
    total: leads.length,
    withEmail: leads.filter((l) => l.emails.length).length,
    withPhone: leads.filter((l) => l.phones.length).length,
    inbound: leads.filter((l) => l.source.startsWith('inbound')).length,
    byStatus: by,
    openValue: open.reduce((n, l) => n + (l.value || 0), 0),
    wonValue: won.reduce((n, l) => n + (l.value || 0), 0),
  };
}

export function dashboard() {
  const now = new Date();
  const today = localKey(now);
  const weekEnd = localKey(new Date(now.getTime() + 7 * DAY));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const openLeads = leads.filter((l) => OPEN_STATUSES.includes(l.status));
  const won = leads.filter((l) => l.status === 'won');
  const lost = leads.filter((l) => l.status === 'lost');
  const wonMonth = won.filter((l) => l.wonAt && l.wonAt >= monthStart);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const l of leads) byStatus[l.status] = (byStatus[l.status] || 0) + 1;

  const pipeline = STATUSES.map((status) => {
    const group = leads.filter((l) => l.status === status);
    const value = group.reduce((n, l) => n + (l.value || 0), 0);
    return { status, count: group.length, value, weighted: Math.round(value * STAGE_PROBABILITY[status]) };
  });

  const openTasks = leads.flatMap((l) =>
    (l.tasks || [])
      .filter((t) => !t.done)
      .map((t) => ({ ...t, leadId: l.id, leadName: l.name, leadStatus: l.status, leadPriority: l.priority, leadValue: l.value || 0 })),
  );
  const dueTasks = openTasks
    .filter((t) => t.due && t.due <= today)
    .sort((a, b) => a.due.localeCompare(b.due) || (a.priority === 'high' ? -1 : 1));
  const overdue = dueTasks.filter((t) => t.due < today);
  const upcoming = openTasks
    .filter((t) => t.due && t.due > today && t.due <= weekEnd)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 12);

  const recent = leads
    .flatMap((l) => (l.activities || []).map((a) => ({ ...a, leadId: l.id, leadName: l.name, leadStatus: l.status })))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 20);

  const sourceMap = new Map();
  for (const l of leads) {
    const key = String(l.source || 'manual').split(':')[0] || 'manual';
    const row = sourceMap.get(key) || { source: key, count: 0, won: 0, value: 0 };
    row.count++;
    if (l.status === 'won') { row.won++; row.value += l.value || 0; }
    sourceMap.set(key, row);
  }
  const sources = [...sourceMap.values()].sort((a, b) => b.count - a.count).slice(0, 8);

  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start.getTime() + 7 * DAY);
    weeks.push({
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      start: start.toISOString(),
      end: end.toISOString(),
      created: 0,
      won: 0,
      value: 0,
    });
  }
  for (const l of leads) {
    const created = Date.parse(l.createdAt);
    const wonAt = Date.parse(l.wonAt || '');
    for (const w of weeks) {
      if (created >= Date.parse(w.start) && created < Date.parse(w.end)) w.created++;
      if (Number.isFinite(wonAt) && wonAt >= Date.parse(w.start) && wonAt < Date.parse(w.end)) { w.won++; w.value += l.value || 0; }
    }
  }

  const contacted = leads.filter((l) => l.status !== 'new' || l.lastContacted).length;
  const responded = leads.filter((l) => ['replied', 'qualified', 'demo', 'proposal', 'won'].includes(l.status)).length;
  const stale = openLeads.filter((l) => Date.parse(l.lastActivityAt || l.updatedAt) < now.getTime() - 7 * DAY);
  const openValue = openLeads.reduce((n, l) => n + (l.value || 0), 0);
  const weightedValue = pipeline.filter((p) => OPEN_STATUSES.includes(p.status)).reduce((n, p) => n + p.weighted, 0);
  const wonValue = won.reduce((n, l) => n + (l.value || 0), 0);

  return {
    generatedAt: now.toISOString(),
    totals: {
      leads: leads.length,
      open: openLeads.length,
      won: won.length,
      lost: lost.length,
      inbound: leads.filter((l) => l.source.startsWith('inbound')).length,
      withEmail: leads.filter((l) => l.emails.length).length,
      withPhone: leads.filter((l) => l.phones.length).length,
    },
    kpis: {
      openValue,
      weightedValue,
      wonValue,
      wonThisMonth: wonMonth.length,
      wonThisMonthValue: wonMonth.reduce((n, l) => n + (l.value || 0), 0),
      newThisMonth: leads.filter((l) => l.createdAt >= monthStart).length,
      avgDeal: won.length ? Math.round(wonValue / won.length) : 0,
      winRate: won.length + lost.length ? won.length / (won.length + lost.length) : 0,
      responseRate: contacted ? responded / contacted : 0,
      tasksDue: dueTasks.length,
      overdue: overdue.length,
      stale: stale.length,
    },
    pipeline,
    byStatus,
    tasks: { due: dueTasks, overdue, upcoming, open: openTasks.length },
    recent,
    sources,
    weekly: weeks,
  };
}

/* ---------- CSV ---------- */
// Cells starting with = + - @ are executable formulas in Excel; prefix them so exported data can't run code.
const esc = (v) => {
  let s = String(v ?? '');
  const phoneLike = /^\+[\d\s().;-]+$/.test(s); // keep "+234…" numbers readable
  if (!phoneLike && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

export function toCsv() {
  const head = ['name', 'website', 'industry', 'location', 'address', 'sourceUrl', 'emails', 'phones', 'facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'youtube', 'telegram', 'whatsapp', 'status', 'priority', 'value', 'tags', 'owner', 'nextFollowUp', 'score', 'source', 'product', 'notes', 'lastContacted', 'createdAt'];
  const rows = leads.map((l) =>
    [
      l.name, l.website, l.industry, l.location, l.address, l.sourceUrl || '', l.emails.join('; '), l.phones.join('; '),
      l.socials.facebook, l.socials.instagram, l.socials.linkedin, l.socials.twitter, l.socials.tiktok,
      l.socials.youtube, l.socials.telegram, l.socials.whatsapp, l.status, l.priority, l.value,
      (l.tags || []).join('; '), l.owner, nextFollowUp(l), l.score, l.source, l.product, l.notes,
      l.lastContacted, l.createdAt,
    ].map(esc).join(','),
  );
  return '\uFEFF' + [head.join(','), ...rows].join('\r\n');
}

export function toVcf(list = leads) {
  const cards = [];
  for (const l of list) {
    if (!l.phones?.length && !l.emails?.length) continue;
    const name = (l.name || 'Lead').replace(/[;\n\r]/g, ' ').trim();
    const lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${name}`,
      `ORG:${name}`,
    ];
    if (l.industry) lines.push(`TITLE:${l.industry.replace(/[;\n\r]/g, ' ').trim()}`);
    for (const p of l.phones || []) {
      lines.push(`TEL;TYPE=CELL,VOICE:${p.replace(/\s+/g, '')}`);
    }
    for (const e of l.emails || []) {
      lines.push(`EMAIL;TYPE=WORK,INTERNET:${e.trim()}`);
    }
    if (l.website) lines.push(`URL:${l.website}`);
    if (l.address || l.location) lines.push(`ADR;TYPE=WORK:;;${(l.address || l.location).replace(/[;\n\r]/g, ' ').trim()};;;;`);
    const note = [
      l.product ? `Product: ${l.product}` : null,
      l.status ? `Stage: ${STATUS_LABELS[l.status] || l.status}` : null,
      l.score ? `Score: ${l.score}` : null,
      l.notes ? `Notes: ${l.notes.slice(0, 200)}` : null,
    ].filter(Boolean).join(' | ');
    if (note) lines.push(`NOTE:${note.replace(/[\n\r]/g, ' ')}`);
    lines.push('END:VCARD');
    cards.push(lines.join('\r\n'));
  }
  return cards.join('\r\n\r\n');
}

export function parseCsv(input) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (q) {
      if (c === '"' && input[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

export function importCsv(input) {
  const rows = parseCsv(input.replace(/^\uFEFF/, ''));
  if (rows.length < 2) return { added: 0, skipped: 0 };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (r, k) => (r[head.indexOf(k)] || '').trim();
  let added = 0, skipped = 0;
  for (const r of rows.slice(1, 5001)) {
    const name = col(r, 'name');
    if (!name) continue;
    const socials = {};
    for (const k of SOCIAL_KEYS) if (col(r, k)) socials[k] = col(r, k);
    const split = (s) => s.split(/[;|]/).map((x) => x.trim()).filter(Boolean);
    const { created } = addLead({
      name,
      website: col(r, 'website'),
      industry: col(r, 'industry'),
      location: col(r, 'location'),
      address: col(r, 'address'),
      emails: split(col(r, 'emails') || col(r, 'email')),
      phones: split(col(r, 'phones') || col(r, 'phone')),
      socials,
      notes: col(r, 'notes'),
      status: col(r, 'status'),
      priority: col(r, 'priority'),
      value: col(r, 'value'),
      tags: split(col(r, 'tags')),
      owner: col(r, 'owner'),
      product: col(r, 'product'),
      source: 'csv-import',
    });
    created ? added++ : skipped++;
  }
  return { added, skipped };
}

export { listLeads as allLeads };
