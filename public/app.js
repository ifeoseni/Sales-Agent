const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUSES = ['new', 'contacted', 'replied', 'qualified', 'demo', 'proposal', 'won', 'lost', 'do-not-contact'];
const STATUS_LABELS = {
  new: 'New', contacted: 'Contacted', replied: 'Replied', qualified: 'Qualified', demo: 'Demo',
  proposal: 'Proposal', won: 'Won', lost: 'Lost', 'do-not-contact': 'Do not contact',
};
const PIPELINE_STAGES = ['new', 'contacted', 'replied', 'qualified', 'demo', 'proposal', 'won', 'lost'];
const OPEN_STATUSES = ['new', 'contacted', 'replied', 'qualified', 'demo', 'proposal'];
const PRIORITIES = ['low', 'normal', 'high'];
const PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High' };
const PAGE_SIZE = 40;
const safeHref = (u) => {
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) ? esc(x.href) : '#';
  } catch { return '#'; }
};

let leads = [];
let products = [];
let settings = {};
let dash = null;
let foundLeads = [];
let currentTab = 'today';
let currentLeadId = null;
let drawerTab = 'overview';
let mergeSourceId = null;
let draftCache = null;
let lastPagedIds = [];
let page = 1;
let selected = new Set();
let cmdIndex = 0;
let globalTimer = null;
const filters = { q: '', status: '', contact: '', priority: '', tag: '', sort: 'recent' };

async function api(path, method = 'GET', body, opts = {}) {
  const r = await fetch('/api' + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...opts,
  });
  if (r.status === 401 && path !== '/login') { showLogin(); throw new Error('Please sign in'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}

/* ---------- format helpers ---------- */
const money = (n, compact = false) => {
  const code = (settings?.crm?.currency || 'NGN').toUpperCase();
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: code, maximumFractionDigits: compact ? 1 : 0,
      notation: compact ? 'compact' : 'standard', compactDisplay: 'short',
    }).format(v);
  } catch {
    return `${code} ${Math.round(v).toLocaleString()}`;
  }
};
const count = (n) => Number(n || 0).toLocaleString();
const plural = (n, one, many = one + 's') => `${count(n)} ${Number(n) === 1 ? one : many}`;
const pct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;
const stageLabel = (s) => STATUS_LABELS[s] || s || '—';
const stageClass = (s) => `stage-${String(s || 'new').replace(/[^a-z-]/g, '')}`;
const priorityLabel = (p) => PRIORITY_LABELS[p] || 'Normal';
const localKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDaysKey = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + Number(n || 0));
  return localKey(d);
};
const dateShort = (v) => {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? v + 'T12:00:00' : v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
};
const dateTime = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const relative = (v) => {
  if (!v) return '—';
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return dateShort(v);
};
const dueLabel = (due) => {
  if (!due) return '';
  const today = localKey();
  if (due < today) {
    const days = Math.max(1, Math.round((new Date(today + 'T12:00:00') - new Date(due + 'T12:00:00')) / 86_400_000));
    return `${days}d overdue`;
  }
  if (due === today) return 'Today';
  if (due === addDaysKey(1)) return 'Tomorrow';
  return dateShort(due);
};
const dueClass = (due) => (due && due < localKey() ? 'overdue' : due === localKey() ? 'today' : '');
const nextFollowUp = (l) => {
  const open = (l.tasks || []).filter((t) => !t.done && t.due).sort((a, b) => a.due.localeCompare(b.due));
  return open[0]?.due || null;
};
const openTasks = (l) => (l.tasks || []).filter((t) => !t.done);
const leadById = (id) => leads.find((l) => l.id === id);
const leadSearchText = (l) => JSON.stringify([
  l.name, l.industry, l.location, l.address, l.emails, l.phones, l.tags, l.notes, l.owner,
  l.source, l.product, l.socials, (l.activities || []).map((a) => a.text),
]).toLowerCase();
const domainOf = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
};
const splitTags = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const activityIcon = (type) => ({
  created: 'i-spark', status: 'i-trend', note: 'i-chat', contact: 'i-phone', task: 'i-check',
  draft: 'i-mail', enrich: 'i-refresh', merge: 'i-merge', import: 'i-users',
}[type] || 'i-spark');

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4200);
}

function applyLead(updated) {
  if (!updated?.id) return;
  const i = leads.findIndex((l) => l.id === updated.id);
  if (i >= 0) leads[i] = updated;
  else leads.unshift(updated);
  const fi = foundLeads.findIndex((l) => l.id === updated.id);
  if (fi >= 0) foundLeads[fi] = updated;
}

/* ---------- login / boot ---------- */
function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#pw')?.focus();
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/login', 'POST', { password: $('#pw').value });
    $('#pw').value = '';
    $('#loginErr').textContent = '';
    $('#login').hidden = true;
    boot();
  } catch (err) { $('#loginErr').textContent = err.message; }
});
$('#logout').addEventListener('click', async () => {
  await api('/logout', 'POST', {}).catch(() => {});
  location.reload();
});

async function boot() {
  try {
    [settings, products, leads, dash] = await Promise.all([api('/settings'), api('/products'), api('/leads'), api('/dashboard')]);
  } catch {
    showLogin();
    return;
  }
  $('#login').hidden = true;
  $('#app').hidden = false;
  fillSelectOptions();
  fillSettings();
  renderProducts();
  suggestQueries();
  renderSidebar();
  renderToday();
  renderLeads();
  renderPipeline();
  $('#floc').value ||= settings.lead.defaultLocation;
  syncGeoSource();
  if (!$('#chatlog').children.length) addMsg('bot', 'Hi! Ask me about our software, or pretend to be a customer to test me.');
  const hash = location.hash.replace('#', '');
  if (['today', 'pipeline', 'leads', 'finder', 'chat', 'products', 'settings'].includes(hash)) selectTab(hash);
}

/* ---------- navigation ---------- */
const PAGE_TITLES = {
  today: ['Workspace', 'Today'],
  pipeline: ['Revenue motion', 'Pipeline'],
  leads: ['Lead database', 'Leads'],
  finder: ['Prospecting', 'Find leads'],
  chat: ['Conversation preview', 'Sales chat'],
  products: ['Offer catalog', 'Products'],
  settings: ['Workspace', 'Settings'],
};
function selectTab(target, focus = false) {
  const btn = typeof target === 'string' ? $(`#tabs [data-tab="${target}"]`) : target;
  if (!btn) return;
  const key = btn.dataset.tab;
  currentTab = key;
  for (const t of $$('#tabs [data-tab]')) {
    t.setAttribute('aria-selected', String(t === btn));
    t.tabIndex = t === btn ? 0 : -1;
  }
  for (const s of $$('main > section')) s.hidden = s.id !== 'tab-' + key;
  const [eyebrow, title] = PAGE_TITLES[key] || ['Workspace', 'Today'];
  $('#pageEyebrow').textContent = eyebrow;
  $('#pageTitle').textContent = title;
  if (focus) btn.focus();
  closeSidebar();
  if (key === 'today') { renderToday(); refreshDashboard(); }
  if (key === 'pipeline') renderPipeline();
  if (key === 'leads') renderLeads();
  if (key === 'settings') fillSettings();
  if (key === 'finder') $('#fq').focus();
  if (key === 'chat') $('#chatIn').focus();
}
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) selectTab(b);
});
$('#tabs').addEventListener('keydown', (e) => {
  const tabs = $$('#tabs [data-tab]');
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const next = { ArrowDown: i + 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  selectTab(tabs[(next + tabs.length) % tabs.length], true);
});
function openSidebar() { $('#app').classList.add('nav-open'); $('#sidebarScrim').hidden = false; }
function closeSidebar() { $('#app').classList.remove('nav-open'); $('#sidebarScrim').hidden = true; }
$('#menuBtn').addEventListener('click', openSidebar);
$('#sidebarScrim').addEventListener('click', closeSidebar);

/* ---------- theme ---------- */
function applyTheme() {
  let stored = null;
  try { stored = localStorage.getItem('ct-theme'); } catch { /* ignore */ }
  if (stored) document.documentElement.dataset.theme = stored;
  else delete document.documentElement.dataset.theme;
  updateThemeIcon();
}
function updateThemeIcon() {
  const use = $('#themeToggle use');
  if (!use) return;
  const dark = document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  use.setAttribute('href', dark ? '#i-sun' : '#i-moon');
}
function toggleTheme() {
  const current = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('ct-theme', next); } catch { /* ignore */ }
  updateThemeIcon();
}
$('#themeToggle').addEventListener('click', toggleTheme);

/* ---------- sidebar / refresh ---------- */
function renderSidebar() {
  $('#leadCount').textContent = leads.length;
  const target = Number(settings?.crm?.monthlyTarget) || 0;
  const won = Number(dash?.kpis?.wonThisMonthValue) || 0;
  const progress = target ? Math.min(100, Math.round((won / target) * 100)) : 0;
  $('#sideGoal').innerHTML = `
    <div class="eyebrow">This month</div>
    <strong>${money(won, true)}</strong>
    <div class="goal-bar"><div class="goal-fill" style="width:${progress}%"></div></div>
    <p>${target ? `${progress}% of ${money(target, true)} target` : 'Set a monthly target in Settings'}</p>`;
}
async function refreshDashboard() {
  try { dash = await api('/dashboard'); } catch { return; }
  renderSidebar();
  if (currentTab === 'today') renderToday();
  if (currentTab === 'pipeline') renderPipeline();
}
async function refreshAll() {
  try {
    const [ls, d] = await Promise.all([api('/leads'), api('/dashboard')]);
    leads = ls;
    dash = d;
  } catch { return; }
  renderSidebar();
  renderLeads();
  renderPipeline();
  if (currentTab === 'today') renderToday();
}
async function afterLeadChange(updated, drawer = false) {
  applyLead(updated);
  renderLeads();
  renderPipeline();
  if (drawer && $('#dlg').open && currentLeadId === updated.id) renderDrawer();
  renderSidebar();
  refreshDashboard();
}

/* ---------- dashboard ---------- */
function taskRowMarkup(t, showLead = true) {
  const cls = dueClass(t.due);
  return `<div class="task-row" data-open-lead="${esc(t.leadId)}">
    <button class="task-check" data-task-toggle data-lead="${esc(t.leadId)}" data-task="${esc(t.id)}" data-done="0" aria-label="Complete ${esc(t.title)}"><svg class="ico"><use href="#i-check"/></svg></button>
    <div class="task-main"><strong>${esc(t.title)}</strong><span class="task-meta">${showLead ? esc(t.leadName || '') + ' · ' : ''}${esc(stageLabel(t.leadStatus))}${t.priority === 'high' ? ' · high priority' : ''}</span></div>
    <span class="due-pill ${cls}">${esc(dueLabel(t.due) || 'No date')}</span>
  </div>`;
}
function activityMarkup(a) {
  return `<button class="activity-item" data-open-lead="${esc(a.leadId)}">
    <span class="activity-icon ${esc(a.type)}"><svg class="ico"><use href="#${activityIcon(a.type)}"/></svg></span>
    <span class="activity-body"><p><strong>${esc(a.leadName || 'Lead')}</strong> · ${esc(a.text)}</p><span class="activity-time">${esc(relative(a.at))} · ${esc(stageLabel(a.leadStatus))}</span></span>
  </button>`;
}
function renderToday() {
  if (!dash) {
    $('#todayContent').innerHTML = '<div class="panel"><div class="empty-state"><strong>Loading your desk…</strong><span>One moment while we bring the numbers together.</span></div></div>';
    return;
  }
  const d = dash;
  const today = new Date();
  const hour = today.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const due = d.tasks.due || [];
  const upcoming = d.tasks.upcoming || [];
  const overdue = d.kpis.overdue || 0;
  const openPipeline = d.pipeline.filter((p) => OPEN_STATUSES.includes(p.status));
  const maxStage = Math.max(...openPipeline.map((p) => p.value), 1);
  const weeklyMax = Math.max(...d.weekly.map((w) => Math.max(w.created, w.won)), 1);
  const target = Number(settings?.crm?.monthlyTarget) || 0;
  const wonMonth = Number(d.kpis.wonThisMonthValue) || 0;
  const targetProgress = target ? Math.min(100, Math.round((wonMonth / target) * 100)) : 0;
  const headline = overdue
    ? `${overdue} follow-up${overdue === 1 ? '' : 's'} slipped`
    : due.length
      ? `${due.length} follow-up${due.length === 1 ? '' : 's'} due today`
      : 'A clear desk. Pick the next move.';
  const subline = overdue
    ? `Tidy the overdue list first, then keep ${money(d.kpis.openValue, true)} of open pipeline moving.`
    : due.length
      ? `You have ${money(d.kpis.openValue, true)} in open pipeline across ${plural(d.totals.open, 'deal')}.`
      : `Your pipeline holds ${money(d.kpis.openValue, true)} across ${plural(d.totals.open, 'open deal')}. Add a follow-up to keep the rhythm.`;
  const dueList = due.length
    ? due.slice(0, 8).map((t) => taskRowMarkup(t, true)).join('')
    : '<div class="notice">Nothing due today. Open a lead and add a follow-up so tomorrow has a next step.</div>';
  const upcomingList = upcoming.length
    ? `<div class="section-title" style="margin-top:16px"><h3 style="font-size:16px">Next 7 days</h3><span class="small">${upcoming.length} scheduled</span></div>${upcoming.slice(0, 4).map((t) => taskRowMarkup(t, true)).join('')}`
    : '';
  const activity = (d.recent || []).slice(0, 7).map(activityMarkup).join('') || '<div class="notice">Activity will appear here as the team works the pipeline.</div>';
  const sources = (d.sources || []).slice(0, 6).map((s) => {
    const max = Math.max(...d.sources.map((x) => x.count), 1);
    return `<div class="source-row"><div class="source-top"><span>${esc(s.source)}</span><span>${s.count} · ${s.won} won</span></div><div class="source-bar"><i style="width:${Math.max(3, (s.count / max) * 100)}%"></i></div></div>`;
  }).join('');
  const glance = openPipeline.map((p) => `<div class="glance-row">
      <span class="glance-label">${esc(stageLabel(p.status))}</span>
      <div class="glance-bar"><div class="glance-fill" style="width:${Math.max(p.value ? 2 : 0, (p.value / maxStage) * 100)}%"></div></div>
      <span class="glance-value"><strong>${p.count}</strong> · ${money(p.value, true)}</span>
    </div>`).join('');
  const bars = d.weekly.map((w) => `<span class="mini-bar" data-label="${esc(w.label)}: ${w.created} new, ${w.won} won" title="${esc(w.label)}: ${w.created} new, ${w.won} won">
      <i style="height:${Math.max(3, (w.created / weeklyMax) * 100)}%"></i>
      <i class="won" style="height:${Math.max(w.won ? 3 : 0, (w.won / weeklyMax) * 100)}%"></i>
    </span>`).join('');

  $('#todayContent').innerHTML = `
    <section class="today-hero">
      <div class="hero-copy">
        <div class="eyebrow">${greeting}, team · ${esc(today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</div>
        <h2>${esc(headline)}</h2>
        <p>${esc(subline)}</p>
        <div class="hero-meta">
          <span class="chip">${plural(d.totals.open, 'open deal')}</span>
          <span class="chip gold">${money(d.kpis.weightedValue, true)} weighted forecast</span>
          ${d.kpis.stale ? `<span class="chip red">${d.kpis.stale} gone quiet</span>` : '<span class="chip">Everything touched recently</span>'}
        </div>
      </div>
      <div class="hero-actions">
        <button class="btn" data-today-action="tasks"><svg class="ico"><use href="#i-clock"/></svg> Review follow-ups</button>
        <button class="btn ghost" data-today-action="pipeline"><svg class="ico"><use href="#i-pipeline"/></svg> Open pipeline</button>
      </div>
    </section>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-top"><span>Open pipeline</span><svg class="ico"><use href="#i-trend"/></svg></div>
        <div class="kpi-value">${money(d.kpis.openValue, true)}</div>
        <div class="kpi-foot"><strong>${count(d.totals.open)}</strong> open · ${money(d.kpis.weightedValue, true)} weighted</div>
      </div>
      <div class="kpi-card gold">
        <div class="kpi-top"><span>Won this month</span><svg class="ico"><use href="#i-target"/></svg></div>
        <div class="kpi-value">${money(wonMonth, true)}</div>
        <div class="kpi-foot"><strong>${count(d.kpis.wonThisMonth)}</strong> ${d.kpis.wonThisMonth === 1 ? 'deal' : 'deals'} · ${pct(d.kpis.winRate)} win rate</div>
      </div>
      <div class="kpi-card blue">
        <div class="kpi-top"><span>Follow-ups due</span><svg class="ico"><use href="#i-clock"/></svg></div>
        <div class="kpi-value">${count(due.length)}</div>
        <div class="kpi-foot"><strong>${count(overdue)}</strong> overdue · ${count(upcoming.length)} upcoming</div>
      </div>
      <div class="kpi-card ${d.kpis.responseRate < .25 ? 'red' : ''}">
        <div class="kpi-top"><span>Response rate</span><svg class="ico"><use href="#i-spark"/></svg></div>
        <div class="kpi-value">${pct(d.kpis.responseRate)}</div>
        <div class="kpi-foot"><strong>${count(d.kpis.newThisMonth)}</strong> new ${d.kpis.newThisMonth === 1 ? 'lead' : 'leads'} this month</div>
      </div>
    </div>

    <div class="today-grid">
      <div class="stack">
        <section class="panel">
          <div class="section-title"><div><h3>Pipeline at a glance</h3><span class="small">Open deals only · stage value</span></div><button class="btn ghost sm" data-today-action="pipeline">View board <svg class="ico"><use href="#i-arrow"/></svg></button></div>
          <div class="glance">${glance || '<div class="notice">No open deals yet. Add a lead or run a search to get started.</div>'}</div>
          <div class="mini-bars" aria-label="New leads and wins over the last 8 weeks">${bars}</div>
          <div class="legend"><span><i></i>New leads</span><span><i class="gold"></i>Won</span></div>
        </section>

        <section class="panel" id="todayTasks">
          <div class="section-title"><div><h3>Follow-ups</h3><span class="small">${due.length ? `${due.length} due or overdue` : 'Nothing due right now'}</span></div><button class="btn ghost sm" data-today-action="leads">All leads <svg class="ico"><use href="#i-arrow"/></svg></button></div>
          <div class="task-list">${dueList}</div>
          ${upcomingList}
        </section>
      </div>

      <div class="stack">
        <section class="panel">
          <div class="section-title"><div><h3>Month target</h3><span class="small">Won revenue</span></div></div>
          <div class="target-card">
            <div class="ring" style="--p:${targetProgress}"><div class="ring-inner"><strong>${target ? targetProgress + '%' : '—'}</strong><span>of target</span></div></div>
            <div class="target-copy"><h3>${target ? money(wonMonth, true) : 'No target yet'}</h3><strong>${target ? `of ${money(target, true)}` : 'Set a goal to track the month'}</strong><p>${target ? `${Math.max(0, target - wonMonth) ? money(Math.max(0, target - wonMonth), true) + ' still to close' : 'Target reached. Keep going.'}` : 'A target gives the team a finish line.'}</p><button class="btn ghost sm" data-today-action="settings">Edit goal</button></div>
          </div>
        </section>

        <section class="panel">
          <div class="section-title"><div><h3>Recent activity</h3><span class="small">The latest moves</span></div></div>
          <div class="activity-list">${activity}</div>
        </section>

        <section class="panel">
          <div class="section-title"><div><h3>Lead sources</h3><span class="small">Where the pipeline comes from</span></div></div>
          <div class="source-list">${sources || '<div class="notice">Add leads to see source performance.</div>'}</div>
        </section>
      </div>
    </div>`;
}
$('#todayContent').addEventListener('click', (e) => {
  const action = e.target.closest('[data-today-action]')?.dataset.todayAction;
  if (action === 'tasks') { $('#todayTasks')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (action === 'pipeline') return selectTab('pipeline');
  if (action === 'leads') return selectTab('leads');
  if (action === 'settings') return selectTab('settings');
  const task = e.target.closest('[data-task-toggle]');
  if (task) { e.stopPropagation(); return toggleTask(task.dataset.lead, task.dataset.task, false); }
  const item = e.target.closest('[data-open-lead]');
  if (item?.dataset.openLead) openLead(item.dataset.openLead);
});

/* ---------- shared lead table ---------- */
function stageSelect(l, attr = 'data-stage') {
  return `<select class="stage-select ${stageClass(l.status)}" ${attr} aria-label="Stage for ${esc(l.name)}">${STATUSES.map((s) => `<option value="${s}" ${s === l.status ? 'selected' : ''}>${esc(stageLabel(s))}</option>`).join('')}</select>`;
}
function contactMini(l) {
  const e = l.emails?.[0];
  const p = l.phones?.[0];
  return `<div class="contact-mini">
    ${e ? `<a href="mailto:${esc(e)}">${esc(e)}</a>` : ''}
    ${p ? `<a href="tel:${esc(p)}">${esc(p)}</a>` : ''}
    ${l.website ? `<a href="${safeHref(l.website)}" target="_blank" rel="noopener noreferrer">${esc(domainOf(l.website))}</a>` : ''}
    ${!e && !p && !l.website ? '<span class="none">No contact yet</span>' : ''}
  </div>`;
}
function leadRow(l, bulk = true) {
  const tags = (l.tags || []).slice(0, 4).map((t) => `<span class="chip">${esc(t)}</span>`).join('');
  const nf = nextFollowUp(l);
  return `<tr data-id="${esc(l.id)}" class="${selected.has(l.id) ? 'selected' : ''}">
    ${bulk ? `<td class="cell-check"><input type="checkbox" data-check value="${esc(l.id)}" ${selected.has(l.id) ? 'checked' : ''} aria-label="Select ${esc(l.name)}"></td>` : ''}
    <td class="row-business">
      <span class="lead-name">${esc(l.name)}</span>
      <span class="lead-sub"><i class="priority-dot ${esc(l.priority || 'normal')}" title="${esc(priorityLabel(l.priority))} priority"></i>${esc([l.industry, l.location].filter(Boolean).join(' · ') || 'No industry or location')}${l.source && l.source !== 'manual' ? ` <span class="chip">${esc(l.source.split(':')[0])}</span>` : ''}</span>
      ${tags ? `<div class="lead-tags">${tags}</div>` : ''}
    </td>
    <td class="row-stage">${stageSelect(l)}</td>
    <td class="row-value"><span class="cell-strong">${l.value ? money(l.value) : '<span class="faint">—</span>'}</span></td>
    <td class="row-contact">${contactMini(l)}</td>
    <td class="row-follow">${nf ? `<span class="due-pill ${dueClass(nf)}">${esc(dueLabel(nf))}</span>` : '<span class="faint small">—</span>'}</td>
    <td class="row-activity"><span class="cell-muted" title="${esc(dateTime(l.lastActivityAt))}">${esc(relative(l.lastActivityAt))}</span></td>
    <td class="row-actions-cell"><div class="row-actions"><button class="icon-btn" data-act="open" title="Open lead" aria-label="Open ${esc(l.name)}"><svg class="ico"><use href="#i-chevron"/></svg></button><button class="icon-btn" data-act="task" title="Add a task" aria-label="Add task for ${esc(l.name)}"><svg class="ico"><use href="#i-clock"/></svg></button></div></td>
  </tr>`;
}
function leadTable(list, { bulk = true } = {}) {
  if (!list.length) {
    return `<div class="empty-state"><strong>No leads match this view</strong><span>Try clearing a filter, or add a new lead to get started.</span></div>`;
  }
  return `<table class="tbl ${bulk ? 'bulk' : ''}">
    <thead><tr>
      ${bulk ? '<th class="cell-check"><input id="checkAll" type="checkbox" aria-label="Select all visible leads"></th>' : ''}
      <th>Business</th><th>Stage</th><th>Value</th><th>Contact</th><th>Follow-up</th><th>Last activity</th><th></th>
    </tr></thead>
    <tbody>${list.map((l) => leadRow(l, bulk)).join('')}</tbody>
  </table>`;
}

/* ---------- leads view ---------- */
function fillSelectOptions() {
  $('#lstatus').innerHTML = '<option value="">All stages</option>' + STATUSES.map((s) => `<option value="${s}">${esc(stageLabel(s))}</option>`).join('');
  $('#bulkstage').innerHTML = '<option value="">Move to stage…</option>' + STATUSES.map((s) => `<option value="${s}">${esc(stageLabel(s))}</option>`).join('');
}
function readFilters() {
  filters.q = $('#lsearch').value.trim().toLowerCase();
  filters.status = $('#lstatus').value;
  filters.contact = $('#lcontact').value;
  filters.priority = $('#lpriority').value;
  filters.tag = $('#ltag').value;
  filters.sort = $('#lsort').value;
}
function filteredLeads() {
  const q = filters.q;
  const list = leads.filter((l) => {
    if (filters.status && l.status !== filters.status) return false;
    if (filters.priority && l.priority !== filters.priority) return false;
    if (filters.tag && !(l.tags || []).includes(filters.tag)) return false;
    if (filters.contact === 'email' && !l.emails?.length) return false;
    if (filters.contact === 'phone' && !l.phones?.length) return false;
    if (filters.contact === 'none' && (l.emails?.length || l.phones?.length)) return false;
    if (q && !leadSearchText(l).includes(q)) return false;
    return true;
  });
  const sorters = {
    recent: (a, b) => String(b.lastActivityAt || '').localeCompare(String(a.lastActivityAt || '')),
    created: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
    value: (a, b) => (b.value || 0) - (a.value || 0),
    followup: (a, b) => {
      const aa = nextFollowUp(a) || '9999-12-31';
      const bb = nextFollowUp(b) || '9999-12-31';
      return aa.localeCompare(bb);
    },
    score: (a, b) => (b.score || 0) - (a.score || 0),
  };
  return list.sort(sorters[filters.sort] || sorters.recent);
}
function renderLeads() {
  const tag = $('#ltag').value;
  const tags = [...new Set(leads.flatMap((l) => l.tags || []))].sort();
  $('#ltag').innerHTML = '<option value="">Any tag</option>' + tags.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  $('#ltag').value = tags.includes(tag) ? tag : '';
  filters.tag = $('#ltag').value;

  const list = filteredLeads();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (page > pages) page = pages;
  const start = (page - 1) * PAGE_SIZE;
  const paged = list.slice(start, start + PAGE_SIZE);
  lastPagedIds = paged.map((l) => l.id);

  $('#leadCount').textContent = leads.length;
  const withEmail = leads.filter((l) => l.emails?.length).length;
  const withPhone = leads.filter((l) => l.phones?.length).length;
  const inConversation = leads.filter((l) => ['contacted', 'replied', 'qualified', 'demo', 'proposal'].includes(l.status)).length;
  const won = leads.filter((l) => l.status === 'won').length;
  $('#stats').innerHTML = [
    [leads.length, 'Total leads'], [withEmail, 'With email'], [withPhone, 'With phone'],
    [leads.filter((l) => l.source?.startsWith('inbound')).length, 'From chat'], [inConversation, 'In conversation'], [won, 'Won'],
  ].map(([n, label]) => `<div class="stat"><strong>${count(n)}</strong><span>${esc(label)}</span></div>`).join('');

  $('#ltable').innerHTML = leadTable(paged, { bulk: true });
  const checkAll = $('#checkAll');
  if (checkAll) checkAll.checked = paged.length > 0 && paged.every((l) => selected.has(l.id));
  $('#lpager').innerHTML = list.length
    ? `<span>Showing ${start + 1}–${Math.min(start + PAGE_SIZE, list.length)} of ${list.length}</span><div class="pager-actions"><button class="btn ghost sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${page} of ${pages}</span><button class="btn ghost sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next</button></div>`
    : '<span>No matches</span>';
  updateBulkbar();
}
function updateBulkbar() {
  const bar = $('#bulkbar');
  bar.hidden = selected.size === 0;
  $('#bulkCount').textContent = selected.size;
}
function resetFilters() {
  filters.q = '';
  filters.status = '';
  filters.contact = '';
  filters.priority = '';
  filters.tag = '';
  filters.sort = 'recent';
  $('#lsearch').value = '';
  $('#globalSearch').value = '';
  $('#lstatus').value = '';
  $('#lcontact').value = '';
  $('#lpriority').value = '';
  $('#ltag').value = '';
  $('#lsort').value = 'recent';
  page = 1;
  selected.clear();
  renderLeads();
}
for (const id of ['#lsearch', '#lstatus', '#lcontact', '#lpriority', '#ltag', '#lsort']) {
  $(id).addEventListener('input', () => { readFilters(); page = 1; selected.clear(); renderLeads(); });
  $(id).addEventListener('change', () => { readFilters(); page = 1; selected.clear(); renderLeads(); });
}
$('#lclear').addEventListener('click', resetFilters);
$('#lpager').addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]');
  if (!b || b.disabled) return;
  const n = Number(b.dataset.page);
  if (n < 1) return;
  page = n;
  renderLeads();
  $('#tab-leads').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#ltable').addEventListener('click', onLeadTableClick);
$('#ltable').addEventListener('change', onLeadTableChange);
$('#fresults').addEventListener('click', onLeadTableClick);
$('#fresults').addEventListener('change', onLeadTableChange);
function onLeadTableClick(e) {
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.closest('[data-act="open"]')) return openLead(id);
  if (e.target.closest('[data-act="task"]')) return openLead(id, 'tasks');
  if (e.target.closest('input, select, button, a')) return;
  openLead(id);
}
function onLeadTableChange(e) {
  if (e.target.id === 'checkAll') {
    for (const lid of lastPagedIds) {
      if (e.target.checked) selected.add(lid); else selected.delete(lid);
    }
    renderLeads();
    return;
  }
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.matches('[data-stage]')) return changeStage(id, e.target.value);
  if (e.target.matches('[data-check]')) {
    if (e.target.checked) selected.add(id); else selected.delete(id);
    row.classList.toggle('selected', e.target.checked);
    const all = lastPagedIds.length && lastPagedIds.every((x) => selected.has(x));
    const checkAll = $('#checkAll');
    if (checkAll) checkAll.checked = !!all;
    updateBulkbar();
  }
}

/* ---------- bulk ---------- */
async function runBulk(payload) {
  try {
    const r = await api('/leads/bulk', 'POST', { ids: [...selected], ...payload });
    toast(`${r.updated ?? 0} updated${r.deleted ? `, ${r.deleted} deleted` : ''}`);
    selected.clear();
    await refreshAll();
  } catch (err) { toast(err.message, 'error'); }
}
$('#bulkstage').addEventListener('change', (e) => {
  if (!e.target.value) return;
  const status = e.target.value;
  e.target.value = '';
  runBulk({ action: 'status', status });
});
$('#bulkpriority').addEventListener('change', (e) => {
  if (!e.target.value) return;
  const priority = e.target.value;
  e.target.value = '';
  runBulk({ action: 'priority', priority });
});
$('#bulkownergo').addEventListener('click', () => {
  const owner = $('#bulkowner').value.trim();
  if (!owner) return $('#bulkowner').focus();
  $('#bulkowner').value = '';
  runBulk({ action: 'owner', owner });
});
$('#bulktaggo').addEventListener('click', () => {
  const tag = $('#bulktag').value.trim();
  if (!tag) return $('#bulktag').focus();
  $('#bulktag').value = '';
  runBulk({ action: 'tag', tags: [tag] });
});
$('#bulktaskgo').addEventListener('click', () => {
  const title = $('#bulktask').value.trim();
  if (!title) return $('#bulktask').focus();
  $('#bulktask').value = '';
  runBulk({ action: 'task', task: { title, due: addDaysKey(settings?.crm?.followUpDays || 3) } });
});
$('#bulkdelete').addEventListener('click', () => {
  if (!selected.size || !confirm(`Delete ${selected.size} selected lead${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
  runBulk({ action: 'delete' });
});
$('#bulkclear').addEventListener('click', () => { selected.clear(); renderLeads(); });

/* ---------- pipeline ---------- */
function renderPipelineStats() {
  const d = dash;
  const openValue = d?.kpis?.openValue ?? leads.filter((l) => OPEN_STATUSES.includes(l.status)).reduce((n, l) => n + (l.value || 0), 0);
  const weighted = d?.kpis?.weightedValue ?? 0;
  const won = leads.filter((l) => l.status === 'won').length;
  const lost = leads.filter((l) => l.status === 'lost').length;
  const winRate = won + lost ? won / (won + lost) : 0;
  const avg = won ? leads.filter((l) => l.status === 'won').reduce((n, l) => n + (l.value || 0), 0) / won : 0;
  $('#pipelineStats').innerHTML = [
    [money(openValue, true), 'Open pipeline'],
    [money(weighted, true), 'Weighted forecast'],
    [pct(winRate), 'Win rate'],
    [money(avg, true), 'Average won deal'],
  ].map(([v, label]) => `<div class="pstat"><span>${esc(label)}</span><strong>${esc(v)}</strong></div>`).join('');
}
function renderPipeline() {
  const q = ($('#psearch')?.value || '').trim().toLowerCase();
  const owner = $('#powner')?.value || '';
  const owners = [...new Set(leads.map((l) => l.owner).filter(Boolean))].sort();
  const cur = $('#powner').value;
  $('#powner').innerHTML = '<option value="">Everyone</option>' + owners.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  $('#powner').value = owners.includes(cur) ? cur : '';
  const list = leads.filter((l) => {
    if (owner && l.owner !== owner) return false;
    if (q && !leadSearchText(l).includes(q)) return false;
    return true;
  });
  const total = list.filter((l) => OPEN_STATUSES.includes(l.status)).reduce((n, l) => n + (l.value || 0), 0);
  $('#pipelineHint').textContent = `${list.length} shown · ${money(total, true)} open`;
  renderPipelineStats();
  $('#pipelineBoard').innerHTML = PIPELINE_STAGES.map((status) => {
    const group = list.filter((l) => l.status === status);
    const value = group.reduce((n, l) => n + (l.value || 0), 0);
    return `<section class="pipe-col stage-${status}" data-stage-col="${status}">
      <div class="pipe-head"><span class="pipe-dot" style="background:var(--stage)"></span><span class="pipe-title">${esc(stageLabel(status))}</span><span class="pipe-count">${group.length}</span></div>
      <div class="pipe-value">${value ? money(value, true) : 'No value yet'}</div>
      <div class="deal-list">${group.map(dealCard).join('') || '<div class="pipe-empty">Drop a lead here</div>'}</div>
    </section>`;
  }).join('');
}
function dealCard(l) {
  const nf = nextFollowUp(l);
  const tags = (l.tags || []).slice(0, 3).map((t) => `<span class="deal-tag">${esc(t)}</span>`).join('');
  return `<article class="deal-card" draggable="true" data-id="${esc(l.id)}">
    <div class="deal-top"><span class="chip">${esc(l.source === 'manual' ? 'manual' : l.source.split(':')[0])}</span><span class="deal-score"><i></i>${esc(l.score ?? 0)}</span></div>
    <div class="deal-name">${esc(l.name)}</div>
    <div class="deal-meta">${esc([l.industry, l.location].filter(Boolean).join(' · ') || 'No details yet')}</div>
    <div class="deal-foot"><span class="deal-value">${l.value ? money(l.value) : '<span class="faint">No value</span>'}</span>${nf ? `<span class="deal-due ${dueClass(nf)}">${esc(dueLabel(nf))}</span>` : ''}</div>
    ${tags ? `<div class="deal-tags">${tags}</div>` : ''}
    <select class="stage-select ${stageClass(l.status)}" data-stage aria-label="Move ${esc(l.name)}">${STATUSES.map((s) => `<option value="${s}" ${s === l.status ? 'selected' : ''}>${esc(stageLabel(s))}</option>`).join('')}</select>
  </article>`;
}
$('#psearch').addEventListener('input', renderPipeline);
$('#powner').addEventListener('change', renderPipeline);
$('#pipelineAdd').addEventListener('click', openAddLead);
$('#pipelineFollow').addEventListener('click', () => { selectTab('today'); setTimeout(() => $('#todayTasks')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); });
$('#pipelineBoard').addEventListener('click', (e) => {
  const card = e.target.closest('.deal-card');
  if (!card || e.target.closest('select,button,a')) return;
  openLead(card.dataset.id);
});
$('#pipelineBoard').addEventListener('change', (e) => {
  if (!e.target.matches('[data-stage]')) return;
  const card = e.target.closest('.deal-card');
  if (card) changeStage(card.dataset.id, e.target.value);
});
$('#pipelineBoard').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.deal-card');
  if (!card) return;
  e.dataTransfer.setData('text/plain', card.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
  card.classList.add('dragging');
});
$('#pipelineBoard').addEventListener('dragend', (e) => e.target.closest('.deal-card')?.classList.remove('dragging'));
$('#pipelineBoard').addEventListener('dragover', (e) => {
  const col = e.target.closest('[data-stage-col]');
  if (!col) return;
  e.preventDefault();
  for (const c of $$('#pipelineBoard .pipe-col')) c.classList.toggle('drag-over', c === col);
});
$('#pipelineBoard').addEventListener('dragleave', (e) => {
  if (!e.target.closest('[data-stage-col]')) return;
  e.target.closest('[data-stage-col]')?.classList.remove('drag-over');
});
$('#pipelineBoard').addEventListener('drop', (e) => {
  const col = e.target.closest('[data-stage-col]');
  if (!col) return;
  e.preventDefault();
  const id = e.dataTransfer.getData('text/plain');
  for (const c of $$('#pipelineBoard .pipe-col')) c.classList.remove('drag-over');
  if (id) changeStage(id, col.dataset.stageCol);
});

/* ---------- finder ---------- */
function suggestQueries() {
  const qs = products.flatMap((p) => (p.searchQueries || []).map((q) => ({ q, p: p.name })));
  $('#qs').innerHTML = qs.map((x) => `<option value="${esc(x.q)}">`).join('');
  $('#fsuggest').innerHTML = qs.length ? 'Ideas: ' + qs.slice(0, 10).map((x) => `<a href="#" data-q="${esc(x.q)}" title="Target for ${esc(x.p)}">${esc(x.q)}</a>`).join(' · ') : '';
}
$('#fsuggest').addEventListener('click', (e) => { const a = e.target.closest('[data-q]'); if (a) { e.preventDefault(); $('#fq').value = a.dataset.q; } });
// A saved key means the extra place search works: turn it on by default so the
// first search is not limited to the two free sources. Remember an explicit opt-out.
const GEO_PREF = 'ct.geoapify';
function syncGeoSource() {
  const hasKey = !!settings.geoapify?.apiKey;
  const box = $('#sgeo');
  let pref = null;
  try { pref = localStorage.getItem(GEO_PREF); } catch { /* storage blocked */ }
  box.disabled = !hasKey;
  box.checked = hasKey && (pref === null ? true : pref === 'on');
  $('#sgeoNote').textContent = hasKey
    ? (box.checked ? 'On because a key is saved. Untick to skip it.' : 'Unticked. Tick to include Geoapify places.')
    : 'Add a free Geoapify key in Settings to include places.';
}
$('#sgeo').addEventListener('change', () => {
  try { localStorage.setItem(GEO_PREF, $('#sgeo').checked ? 'on' : 'off'); } catch { /* storage blocked */ }
  syncGeoSource();
});
let currentJob = null;
$('#fstop').addEventListener('click', async () => {
  if (currentJob) { $('#fstop').disabled = true; await api(`/jobs/${currentJob}/cancel`, 'POST', {}).catch(() => {}); }
});
$('#fgo').addEventListener('click', (e) => {
  const query = $('#fq').value.trim();
  if (!query) return $('#fq').focus();
  const sources = [$('#sweb').checked && 'web', $('#sosm').checked && 'osm', $('#sgeo').checked && 'geoapify'].filter(Boolean);
  if (!sources.length) { $('#fprog').innerHTML = '<span class="err">Tick at least one source</span>'; return; }
  runJob([e.target, $('#ugo')], () => api('/leads/find', 'POST', { query, location: $('#floc').value, limit: +$('#flim').value, sources }));
});
$('#ugo').addEventListener('click', (e) => {
  const urls = $('#urls').value.trim();
  if (!urls) return $('#urls').focus();
  runJob([e.target, $('#fgo')], () => api('/leads/from-urls', 'POST', { urls, industry: $('#fq').value.trim(), location: $('#floc').value }));
});
async function runJob(buttons, start) {
  for (const b of buttons) b.disabled = true;
  $('#fstop').hidden = false; $('#fstop').disabled = false;
  $('#fresults').innerHTML = '';
  $('#fprog').textContent = 'Starting…';
  try {
    const { jobId } = await start();
    currentJob = jobId;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const j = await api('/jobs/' + jobId);
      $('#fprog').innerHTML = j.progress.map(esc).join('<br>');
      $('#fprog').scrollTop = 1e6;
      if (j.status === 'running') continue;
      if (j.status === 'error') throw new Error(j.error);
      foundLeads = j.leads;
      $('#fprog').innerHTML += `<br><strong>Done: ${j.leads.length} new leads saved.</strong>${j.leads.length ? '' : ' <span class="muted">See the notes above for why nothing was usable.</span>'}` + j.warnings.map((w) => `<br><span class="err">${esc(w)}</span>`).join('');
      renderFinderResults();
      await refreshAll();
      break;
    }
  } catch (err) { $('#fprog').innerHTML = `<span class="err">${esc(err.message)}</span>`; }
  currentJob = null;
  $('#fstop').hidden = true;
  for (const b of buttons) b.disabled = false;
}
function renderFinderResults() {
  $('#fresults').innerHTML = `<div class="panel">${foundLeads.length ? leadTable(foundLeads, { bulk: false }) : '<div class="empty-state"><strong>No new leads found</strong><span>Try different words or a nearby area, or paste a list of websites for the most reliable results.</span></div>'}</div>`;
}

/* ---------- drawer / lead workspace ---------- */
const dlg = $('#dlg');
const mergeDlg = $('#mergeDlg');
dlg.addEventListener('close', () => {
  if (dlg.open) return; // a close event can arrive after the same dialog was reopened (add lead → drawer)
  currentLeadId = null;
  draftCache = null;
});
mergeDlg.addEventListener('close', () => { if (!mergeDlg.open) mergeSourceId = null; });

function openLead(idOrLead, tab = 'overview') {
  const lead = typeof idOrLead === 'string' ? leadById(idOrLead) : idOrLead;
  if (!lead) return;
  if (currentLeadId !== lead.id) draftCache = null;
  currentLeadId = lead.id;
  drawerTab = tab;
  dlg.className = 'drawer-dialog';
  if (!dlg.open) dlg.showModal();
  renderDrawer();
}
function renderDrawer() {
  const lead = leadById(currentLeadId);
  if (!lead) return dlg.close();
  const open = openTasks(lead).sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')));
  const done = (lead.tasks || []).filter((t) => t.done).slice(-8).reverse();
  const acts = lead.activities || [];
  const tabs = [['overview', 'Overview', ''], ['activity', 'Activity', acts.length], ['tasks', 'Tasks', openTasks(lead).length], ['message', 'Message', '']];
  const pane = drawerTab === 'activity' ? activityPane(lead)
    : drawerTab === 'tasks' ? tasksPane(lead, open, done)
      : drawerTab === 'message' ? messagePane(lead)
        : overviewPane(lead);
  $('#dlgBody').innerHTML = `
    <div class="drawer-head">
      <div>
        <div class="eyebrow">Lead workspace</div>
        <h2>${esc(lead.name)}</h2>
        <div class="lead-sub">${esc([lead.industry, lead.location].filter(Boolean).join(' · ') || 'No industry or location')} <span class="stage-pill ${stageClass(lead.status)}">${esc(stageLabel(lead.status))}</span> <span class="chip">${esc(lead.source)}</span></div>
      </div>
      <button class="icon-btn" id="dclose" aria-label="Close lead"><svg class="ico"><use href="#i-close"/></svg></button>
    </div>
    <div class="drawer-actions">
      <select class="stage-select ${stageClass(lead.status)}" data-drawer-stage aria-label="Move lead stage">${STATUSES.map((s) => `<option value="${s}" ${s === lead.status ? 'selected' : ''}>${esc(stageLabel(s))}</option>`).join('')}</select>
      ${lead.emails?.[0] ? `<a class="btn ghost sm" href="mailto:${esc(lead.emails[0])}"><svg class="ico"><use href="#i-mail"/></svg> Email</a>` : ''}
      ${lead.phones?.[0] ? `<a class="btn ghost sm" href="https://wa.me/${esc(lead.phones[0].replace(/\D/g, ''))}" target="_blank" rel="noopener"><svg class="ico"><use href="#i-phone"/></svg> WhatsApp</a>` : ''}
      ${lead.website ? `<a class="btn ghost sm" href="${safeHref(lead.website)}" target="_blank" rel="noopener"><svg class="ico"><use href="#i-globe"/></svg> Website</a>` : ''}
      <button class="btn ghost sm" id="dmerge"><svg class="ico"><use href="#i-merge"/></svg> Merge</button>
    </div>
    <div class="drawer-tabs" role="tablist">
      ${tabs.map(([key, label, n]) => `<button class="drawer-tab" role="tab" data-dtab="${key}" aria-selected="${drawerTab === key}">${label}${n ? `<span class="chip">${n}</span>` : ''}</button>`).join('')}
    </div>
    <div class="drawer-body">${pane}</div>`;
  bindDrawer();
}
function overviewPane(lead) {
  const productOpts = products.map((p) => `<option value="${esc(p.id)}" ${p.id === lead.product ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const socials = Object.entries(lead.socials || {}).map(([k, v]) => `<a href="${safeHref(v)}" target="_blank" rel="noopener noreferrer"><svg class="ico"><use href="#i-globe"/></svg> ${esc(k)}</a>`).join('');
  return `<div class="drawer-pane">
    <div class="contact-lines">
      ${lead.emails?.length ? lead.emails.map((e) => `<a href="mailto:${esc(e)}"><svg class="ico"><use href="#i-mail"/></svg> ${esc(e)}</a>`).join('') : ''}
      ${lead.phones?.length ? lead.phones.map((p) => `<a href="tel:${esc(p)}"><svg class="ico"><use href="#i-phone"/></svg> ${esc(p)}</a>`).join('') : ''}
      ${lead.website ? `<a href="${safeHref(lead.website)}" target="_blank" rel="noopener noreferrer"><svg class="ico"><use href="#i-globe"/></svg> ${esc(domainOf(lead.website))}</a>` : ''}
      ${socials}
      ${!lead.emails?.length && !lead.phones?.length ? '<span class="muted">No email or phone on file yet. Refresh the website to look again.</span>' : ''}
    </div>
    <div class="field-grid">
      <div><label for="df-name">Business name</label><input id="df-name" data-field="name" value="${esc(lead.name)}"></div>
      <div><label for="df-website">Website</label><input id="df-website" data-field="website" value="${esc(lead.website)}"></div>
      <div><label for="df-industry">Industry</label><input id="df-industry" data-field="industry" value="${esc(lead.industry)}"></div>
      <div><label for="df-location">Location</label><input id="df-location" data-field="location" value="${esc(lead.location)}"></div>
      <div><label for="df-value">Deal value</label><input id="df-value" data-field="value" type="number" min="0" step="1000" value="${Number(lead.value) || 0}"></div>
      <div><label for="df-priority">Priority</label><select id="df-priority" data-field="priority">${PRIORITIES.map((p) => `<option value="${p}" ${p === (lead.priority || 'normal') ? 'selected' : ''}>${esc(priorityLabel(p))}</option>`).join('')}</select></div>
      <div><label for="df-owner">Owner</label><input id="df-owner" data-field="owner" value="${esc(lead.owner)}" placeholder="Who is working this?"></div>
      <div><label for="df-product">Offer</label><select id="df-product" data-field="product"><option value="">No product</option>${productOpts}</select></div>
      <div class="full"><label for="df-tags">Tags (comma separated)</label><input id="df-tags" data-field="tags" value="${esc((lead.tags || []).join(', '))}" placeholder="vip, inbound, lagos"></div>
      <div class="full"><label for="df-notes">Notes</label><textarea id="df-notes" data-field="notes" placeholder="What did you learn? What is the next step?">${esc(lead.notes)}</textarea></div>
      <div class="full"><label for="df-description">Company description</label><textarea id="df-description" data-field="description" placeholder="A short description from the website…">${esc(lead.description)}</textarea></div>
    </div>
    <div class="info-grid">
      <div class="info-row"><span>Source</span><strong>${esc(lead.source)}</strong></div>
      <div class="info-row"><span>Created</span><strong>${esc(dateTime(lead.createdAt))}</strong></div>
      <div class="info-row"><span>Last contacted</span><strong>${esc(lead.lastContacted ? dateTime(lead.lastContacted) : 'Never')}</strong></div>
      <div class="info-row"><span>Next follow-up</span><strong>${esc(nextFollowUp(lead) ? dueLabel(nextFollowUp(lead)) : 'None scheduled')}</strong></div>
      <div class="info-row"><span>Contact score</span><strong>${esc(lead.score ?? 0)} / 9</strong></div>
      <div class="info-row"><span>Last activity</span><strong>${esc(relative(lead.lastActivityAt))}</strong></div>
    </div>
    <div class="drawer-footer">
      <button class="btn" id="dsave"><svg class="ico"><use href="#i-check"/></svg> Save details</button>
      <button class="btn ghost" id="drefresh"><svg class="ico"><use href="#i-refresh"/></svg> Refresh contacts</button>
      <button class="btn ghost" id="dmerge2"><svg class="ico"><use href="#i-merge"/></svg> Merge duplicate</button>
      <button class="btn danger" id="ddelete"><svg class="ico"><use href="#i-trash"/></svg> Delete</button>
    </div>
    ${lead.transcript ? `<details style="margin-top:16px"><summary class="small">Chat transcript</summary><pre class="small" style="margin-top:8px">${esc(lead.transcript)}</pre></details>` : ''}
  </div>`;
}
function activityPane(lead) {
  const acts = lead.activities || [];
  return `<div class="drawer-pane">
    <div class="note-composer"><textarea id="dnote" placeholder="Log a note, a call summary, or the next step…"></textarea><button class="btn" id="daddnote"><svg class="ico"><use href="#i-plus"/></svg> Log note</button></div>
    <div class="timeline">${acts.length ? acts.map((a) => `<div class="timeline-item"><span class="timeline-dot ${esc(a.type)}"><svg class="ico"><use href="#${activityIcon(a.type)}"/></svg></span><div class="timeline-body"><p>${esc(a.text)}</p><time>${esc(dateTime(a.at))} · ${esc(relative(a.at))}</time></div></div>`).join('') : '<div class="notice">No activity yet. Log a note or complete a task to start the story.</div>'}</div>
  </div>`;
}
function tasksPane(lead, open, done) {
  const defaultDue = addDaysKey(settings?.crm?.followUpDays || 3);
  return `<div class="drawer-pane">
    <div class="task-editor">
      <input id="dtasktitle" placeholder="What needs to happen next?" maxlength="200">
      <div class="row">
        <input id="dtaskdue" type="date" value="${defaultDue}" aria-label="Task due date">
        <select id="dtaskpriority" aria-label="Task priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select>
        <button class="btn sm" id="dtaskadd"><svg class="ico"><use href="#i-plus"/></svg> Add task</button>
      </div>
    </div>
    <div class="section-title"><div><h3>Open tasks</h3><span class="small">${open.length} to do</span></div></div>
    ${open.length ? open.map((t) => taskLine(t, lead.id, false)).join('') : '<div class="notice">No open tasks. Add the next step so this lead does not go quiet.</div>'}
    ${done.length ? `<div class="section-title" style="margin-top:18px"><div><h3>Recently done</h3><span class="small">${done.length} completed</span></div></div>${done.map((t) => taskLine(t, lead.id, true)).join('')}` : ''}
  </div>`;
}
function taskLine(t, leadId, done) {
  return `<div class="task-line ${done ? 'done' : ''}">
    <button class="task-check ${done ? 'done' : ''}" data-task-toggle data-lead="${esc(leadId)}" data-task="${esc(t.id)}" data-done="${done ? '1' : '0'}" aria-label="${done ? 'Reopen' : 'Complete'} ${esc(t.title)}"><svg class="ico"><use href="#i-check"/></svg></button>
    <div><span class="task-title">${esc(t.title)}</span><span class="task-sub">${t.due ? esc(dueLabel(t.due)) : 'No date'}${t.priority === 'high' ? ' · high priority' : ''}${done ? ' · completed' : ''}</span></div>
    ${done ? '<span class="chip green">Done</span>' : `<span class="due-pill ${dueClass(t.due)}">${esc(dueLabel(t.due) || 'No date')}</span>`}
    <button class="icon-btn" data-task-delete data-lead="${esc(leadId)}" data-task="${esc(t.id)}" title="Remove task" aria-label="Remove ${esc(t.title)}"><svg class="ico"><use href="#i-trash"/></svg></button>
  </div>`;
}
function messagePane(lead) {
  const prods = products.map((p) => `<option value="${esc(p.id)}" ${p.id === lead.product ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const cache = draftCache && draftCache.leadId === lead.id ? draftCache : null;
  return `<div class="drawer-pane">
    <div class="message-box">
      <div class="grid2">
        <div><label for="dprod">Offer</label><select id="dprod">${prods || '<option value="">No products yet</option>'}</select></div>
        <div><label for="dch">Channel</label><select id="dch"><option value="email" ${cache?.ch === 'email' || !cache ? 'selected' : ''}>Email</option><option value="whatsapp" ${cache?.ch === 'whatsapp' ? 'selected' : ''}>WhatsApp</option><option value="dm" ${cache?.ch === 'dm' ? 'selected' : ''}>Social DM</option></select></div>
      </div>
      <div class="row"><button class="btn" id="dgo"><svg class="ico"><use href="#i-spark"/></svg> Write first message</button><span class="muted small">The draft is a starting point. Review it before sending.</span></div>
      <p id="derr" class="err small" role="alert"></p>
      <div id="dout" ${cache ? '' : 'hidden'}>
        <div id="dsubwrap" ${cache?.ch !== 'email' && cache ? 'hidden' : ''}><label for="dsub">Subject</label><input id="dsub" value="${esc(cache?.subject || '')}"></div>
        <label for="dbody" style="margin-top:8px">Message (edit freely)</label>
        <textarea id="dbody">${esc(cache?.body || '')}</textarea>
        <div class="message-actions" id="dlinks"></div>
        <p class="fineprint">Only contact businesses with a genuine reason, and stop if they ask you to. Nothing is sent automatically.</p>
      </div>
      ${!lead.emails?.length && !lead.phones?.length ? '<div class="notice">Add an email or phone before sending. You can still copy the draft.</div>' : ''}
    </div>
  </div>`;
}
function bindDrawer() {
  const id = currentLeadId;
  const lead = leadById(id);
  if (!lead) return;
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
  on('#dclose', 'click', () => dlg.close());
  for (const b of $$('[data-dtab]')) b.addEventListener('click', () => { drawerTab = b.dataset.dtab; renderDrawer(); });
  on('[data-drawer-stage]', 'change', (e) => changeStage(id, e.target.value));
  on('#dsave', 'click', () => saveDrawer(id));
  on('#drefresh', 'click', () => enrichLead(id));
  on('#dmerge', 'click', () => openMerge(id));
  on('#dmerge2', 'click', () => openMerge(id));
  on('#ddelete', 'click', () => deleteLead(id));
  on('#daddnote', 'click', () => addNote(id));
  on('#dtaskadd', 'click', () => addTask(id));
  for (const b of $$('[data-task-toggle]', $('#dlgBody'))) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTask(b.dataset.lead, b.dataset.task, b.dataset.done === '1');
    });
  }
  for (const b of $$('[data-task-delete]', $('#dlgBody'))) {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Remove this task?')) return;
      try {
        const updated = await api(`/leads/${b.dataset.lead}/tasks/${b.dataset.task}`, 'DELETE');
        applyLead(updated); renderDrawer(); renderLeads(); renderPipeline(); refreshDashboard();
        toast('Task removed');
      } catch (err) { toast(err.message, 'error'); }
    });
  }
  on('#dgo', 'click', () => generateDraft(id));
  on('#dch', 'change', () => {
    draftCache = null;
    const out = $('#dout'); if (out) out.hidden = true;
  });
  if (draftCache && draftCache.leadId === id) {
    const ch = draftCache.ch;
    const sub = $('#dsubwrap'); if (sub) sub.hidden = ch !== 'email';
    renderMessageLinks(lead, ch);
  }
}
async function saveDrawer(id) {
  const field = (name) => $(`[data-field="${name}"]`)?.value;
  const patch = {
    name: field('name'), website: field('website'), industry: field('industry'), location: field('location'),
    value: field('value'), priority: field('priority'), owner: field('owner'), product: field('product'),
    tags: splitTags(field('tags')), notes: field('notes'), description: field('description'),
  };
  try {
    const updated = await api(`/leads/${id}`, 'PATCH', patch);
    applyLead(updated);
    toast('Lead details saved');
    renderDrawer();
    renderLeads();
    renderPipeline();
    refreshDashboard();
  } catch (err) { toast(err.message, 'error'); }
}
async function changeStage(id, status) {
  const lead = leadById(id);
  if (!lead || lead.status === status) return;
  try {
    const updated = await api(`/leads/${id}`, 'PATCH', { status });
    applyLead(updated);
    toast(`${updated.name} moved to ${stageLabel(status)}`);
    renderLeads();
    renderPipeline();
    if (currentTab === 'finder') renderFinderResults();
    if ($('#dlg').open && currentLeadId === id) renderDrawer();
    refreshDashboard();
  } catch (err) { toast(err.message, 'error'); }
}
async function toggleTask(leadId, taskId, done) {
  try {
    const updated = await api(`/leads/${leadId}/tasks/${taskId}`, 'PATCH', { done: !done });
    applyLead(updated);
    toast(done ? 'Task reopened' : 'Task completed');
    renderToday();
    renderLeads();
    renderPipeline();
    if ($('#dlg').open && currentLeadId === leadId) renderDrawer();
    refreshDashboard();
  } catch (err) { toast(err.message, 'error'); }
}
async function addTask(id) {
  const title = $('#dtasktitle')?.value.trim();
  if (!title) return $('#dtasktitle')?.focus();
  try {
    const updated = await api(`/leads/${id}/tasks`, 'POST', {
      title,
      due: $('#dtaskdue')?.value || null,
      priority: $('#dtaskpriority')?.value || 'normal',
    });
    applyLead(updated);
    toast('Follow-up added');
    renderDrawer();
    renderLeads();
    renderPipeline();
    refreshDashboard();
  } catch (err) { toast(err.message, 'error'); }
}
async function addNote(id) {
  const text = $('#dnote')?.value.trim();
  if (!text) return $('#dnote')?.focus();
  try {
    const updated = await api(`/leads/${id}/activity`, 'POST', { text });
    applyLead(updated);
    toast('Note logged');
    renderDrawer();
    renderLeads();
    refreshDashboard();
  } catch (err) { toast(err.message, 'error'); }
}
async function enrichLead(id) {
  const btn = $('#drefresh');
  if (btn) btn.disabled = true;
  try {
    const updated = await api(`/leads/${id}/enrich`, 'POST', {});
    applyLead(updated);
    toast('Contact details refreshed');
    renderDrawer();
    renderLeads();
    refreshDashboard();
  } catch (err) { toast(err.message, 'error'); }
  if (btn) btn.disabled = false;
}
async function deleteLead(id) {
  const lead = leadById(id);
  if (!lead || !confirm(`Delete ${lead.name}? This cannot be undone.`)) return;
  try {
    await api(`/leads/${id}`, 'DELETE');
    leads = leads.filter((l) => l.id !== id);
    selected.delete(id);
    dlg.close();
    toast('Lead deleted');
    await refreshAll();
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------- drafting ---------- */
async function generateDraft(id) {
  const lead = leadById(id);
  if (!lead) return;
  const btn = $('#dgo');
  const err = $('#derr');
  if (btn) btn.disabled = true;
  if (err) err.textContent = '';
  try {
    const ch = $('#dch').value;
    const d = await api(`/leads/${id}/draft`, 'POST', { product: $('#dprod').value, channel: ch });
    draftCache = { leadId: id, ch, subject: d.subject || '', body: d.body || '' };
    renderDrawer();
    toast('Draft ready — review before sending', 'gold');
  } catch (e) {
    if (err) err.textContent = e.message;
    else toast(e.message, 'error');
    if (btn) btn.disabled = false;
  }
}
function renderMessageLinks(lead, ch) {
  const box = $('#dlinks');
  if (!box) return;
  const body = () => $('#dbody')?.value || '';
  const subject = () => $('#dsub')?.value || '';
  let html = '';
  if (ch === 'email' && lead.emails?.[0]) html += '<button class="btn sm" id="lmail">Open in email app</button>';
  if (ch === 'whatsapp' && lead.phones?.[0]) html += '<button class="btn sm" id="lwa">Open in WhatsApp</button>';
  if (ch === 'dm') html += Object.entries(lead.socials || {}).filter(([k]) => k !== 'whatsapp').map(([k, v]) => `<a class="btn ghost sm" href="${safeHref(v)}" target="_blank" rel="noopener noreferrer">Open ${esc(k)}</a>`).join('');
  html += '<button class="btn ghost sm" id="lcopy">Copy text</button><button class="btn ghost sm" id="lmark">Mark contacted</button>';
  box.innerHTML = html;
  $('#lmail')?.addEventListener('click', () => {
    location.href = `mailto:${lead.emails[0]}?subject=${encodeURIComponent(subject())}&body=${encodeURIComponent(body())}`;
  });
  $('#lwa')?.addEventListener('click', () => {
    window.open(`https://wa.me/${lead.phones[0].replace(/\D/g, '')}?text=${encodeURIComponent(body())}`, '_blank', 'noopener');
  });
  $('#lcopy')?.addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText((ch === 'email' && subject() ? subject() + '\n\n' : '') + body());
      e.target.textContent = 'Copied';
    } catch { toast('Could not copy. Select the text and copy manually.', 'error'); }
  });
  $('#lmark')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const updated = await api(`/leads/${lead.id}`, 'PATCH', {
        status: lead.status === 'new' ? 'contacted' : lead.status,
        lastContacted: new Date().toISOString(),
      });
      applyLead(updated);
      toast('Marked as contacted');
      renderDrawer();
      renderLeads();
      renderPipeline();
      refreshDashboard();
    } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
  });
}

/* ---------- add lead ---------- */
function openAddLead() {
  dlg.className = 'modal-dialog';
  if (!dlg.open) dlg.showModal();
  $('#dlgBody').innerHTML = `<div class="form-head">
    <div class="eyebrow">New record</div>
    <h2>Add a lead</h2>
    <p class="muted small">Capture what you know now. You can enrich the contact details later.</p>
  </div>
  <div class="field-grid" style="margin-top:18px">
    <div class="full"><label for="an">Business name</label><input id="an" placeholder="e.g. Pixel Games Lounge"></div>
    <div><label for="aw">Website</label><input id="aw" placeholder="https://…"></div>
    <div><label for="ae">Email</label><input id="ae" type="email" placeholder="hello@…"></div>
    <div><label for="ap">Phone</label><input id="ap" placeholder="+234…"></div>
    <div><label for="ai">Industry</label><input id="ai" placeholder="Gaming lounge"></div>
    <div><label for="al">Location</label><input id="al" placeholder="Lagos, Nigeria"></div>
    <div><label for="aval">Deal value</label><input id="aval" type="number" min="0" step="1000" placeholder="0"></div>
    <div><label for="apri">Priority</label><select id="apri"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></div>
    <div><label for="atag">Tags</label><input id="atag" placeholder="vip, warm, referral"></div>
    <div><label for="astatus">Starting stage</label><select id="astatus">${STATUSES.map((s) => `<option value="${s}">${esc(stageLabel(s))}</option>`).join('')}</select></div>
    <div class="full"><label for="anotes">Notes</label><textarea id="anotes" placeholder="Why is this a good fit?"></textarea></div>
  </div>
  <p class="err small" id="aerr" role="alert"></p>
  <div class="drawer-footer"><button class="btn" id="asave"><svg class="ico"><use href="#i-check"/></svg> Save lead</button><button class="btn ghost" id="acancel">Cancel</button></div>`;
  $('#acancel').addEventListener('click', () => dlg.close());
  $('#asave').addEventListener('click', async () => {
    const name = $('#an').value.trim();
    if (!name) return $('#an').focus();
    try {
      const r = await api('/leads', 'POST', {
        name,
        website: $('#aw').value.trim(),
        emails: $('#ae').value.trim() ? [$('#ae').value.trim()] : [],
        phones: $('#ap').value.trim() ? [$('#ap').value.trim()] : [],
        industry: $('#ai').value.trim(),
        location: $('#al').value.trim(),
        value: $('#aval').value,
        priority: $('#apri').value,
        tags: splitTags($('#atag').value),
        status: $('#astatus').value,
        notes: $('#anotes').value.trim(),
      });
      dlg.close();
      await refreshAll();
      toast(r.created ? 'Lead added to the pipeline' : 'That lead already existed — opened it', r.created ? '' : 'gold');
      openLead(r.lead.id);
    } catch (err) { $('#aerr').textContent = err.message; }
  });
  $('#an').focus();
}

/* ---------- merge ---------- */
function openMerge(sourceId) {
  const source = leadById(sourceId);
  if (!source) return;
  mergeSourceId = sourceId;
  if (!mergeDlg.open) mergeDlg.showModal();
  $('#mergeBody').innerHTML = `<div class="form-head"><div class="eyebrow">Duplicate cleanup</div><h2>Merge “${esc(source.name)}”</h2><p class="muted small">Choose the lead to keep. Contacts, tags, tasks, value and history from this lead will move into the one you keep.</p></div>
    <div class="merge-warning" style="margin-top:14px">This removes “${esc(source.name)}” after the merge. It cannot be undone.</div>
    <label for="mergeSearch" style="margin-top:14px">Find the lead to keep</label>
    <input id="mergeSearch" placeholder="Search by name, email or domain…">
    <div class="merge-list" id="mergeList"></div>
    <div class="drawer-footer"><button class="btn ghost" id="mergeCancel">Cancel</button></div>`;
  const renderList = () => {
    const q = ($('#mergeSearch')?.value || '').toLowerCase();
    const options = leads.filter((l) => l.id !== sourceId && (!q || leadSearchText(l).includes(q))).slice(0, 30);
    $('#mergeList').innerHTML = options.length
      ? options.map((l) => `<button class="merge-option" data-merge-target="${esc(l.id)}"><span><strong>${esc(l.name)}</strong><span>${esc([l.emails?.[0], l.location].filter(Boolean).join(' · ') || l.source)}</span></span><span class="stage-pill ${stageClass(l.status)}">${esc(stageLabel(l.status))}</span></button>`).join('')
      : '<div class="notice">No other leads match. Try a different search.</div>';
    for (const b of $$('[data-merge-target]')) b.addEventListener('click', () => doMerge(sourceId, b.dataset.mergeTarget));
  };
  $('#mergeSearch').addEventListener('input', renderList);
  $('#mergeCancel').addEventListener('click', () => mergeDlg.close());
  renderList();
}
async function doMerge(sourceId, targetId) {
  const target = leadById(targetId);
  if (!target || !confirm(`Keep “${target.name}” and merge “${leadById(sourceId)?.name}” into it?`)) return;
  try {
    const merged = await api(`/leads/${sourceId}/merge`, 'POST', { targetId });
    leads = leads.filter((l) => l.id !== sourceId);
    applyLead(merged);
    mergeDlg.close();
    toast(`Merged into ${merged.name}`);
    await refreshAll();
    openLead(merged.id);
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------- chat ---------- */
const sid = 'dash' + Math.random().toString(36).slice(2, 10);
function addMsg(who, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + who;
  d.textContent = text;
  $('#chatlog').append(d);
  $('#chatlog').scrollTop = 1e6;
  return d;
}
function addTyping() {
  const d = document.createElement('div');
  d.className = 'msg bot typing';
  d.setAttribute('aria-label', 'The agent is typing');
  d.innerHTML = '<span></span><span></span><span></span>';
  $('#chatlog').append(d);
  $('#chatlog').scrollTop = 1e6;
  return d;
}
$('#chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = $('#chatIn').value.trim();
  if (!t || $('#chatSend').disabled) return;
  $('#chatIn').value = '';
  addMsg('user', t);
  $('#chatInfo').textContent = '';
  $('#chatSend').disabled = true;
  const typing = addTyping();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const r = await api('/chat', 'POST', { sessionId: sid, message: t }, { signal: ctrl.signal });
    typing.remove();
    addMsg('bot', r.reply);
    $('#chatInfo').textContent = 'Answered by ' + r.provider;
  } catch (err) {
    typing.remove();
    if (err.name === 'AbortError') {
      addMsg('bot', '⚠ No answer after 60 seconds. The AI engine may be busy — try again, or test your key in Settings → AI.');
    } else {
      addMsg('bot', '⚠ ' + err.message);
    }
    $('#chatIn').value = t; // keep the message so retrying is one click
  } finally {
    clearTimeout(timer);
    $('#chatSend').disabled = false;
    $('#chatIn').focus();
  }
});
$('#chatReset').addEventListener('click', async () => {
  await api('/chat', 'POST', { sessionId: sid, reset: true }).catch(() => {});
  $('#chatlog').innerHTML = '';
  $('#chatInfo').textContent = '';
  addMsg('bot', 'New conversation. How can I help?');
});

/* ---------- products ---------- */
const lines = (a) => (a || []).join('\n');
function renderProducts() {
  $('#plist').innerHTML = products.map((p, i) => `<div class="product-card" data-i="${i}">
    <div class="section-title"><div><div class="eyebrow">Offer ${i + 1}</div><h3>${esc(p.name || 'Untitled product')}</h3></div><button class="btn danger sm" data-del="${i}"><svg class="ico"><use href="#i-trash"/></svg> Remove</button></div>
    <div class="grid2">
      <div><label>Name</label><input data-k="name" value="${esc(p.name)}"></div>
      <div><label>Type</label><select data-k="type"><option ${p.type === 'product' ? 'selected' : ''}>product</option><option ${p.type === 'service' ? 'selected' : ''}>service</option></select></div>
      <div><label>Status (active / in development / hidden)</label><input data-k="status" value="${esc(p.status)}"></div>
      <div><label>Price (optional)</label><input data-k="price" value="${esc(p.price)}" placeholder="e.g. from ₦50,000 / month"></div>
      <div class="full"><label>One-line pitch</label><input data-k="tagline" value="${esc(p.tagline)}"></div>
      <div class="full"><label>Description</label><textarea data-k="description">${esc(p.description)}</textarea></div>
      <div><label>Features (one per line)</label><textarea data-k="features">${esc(lines(p.features))}</textarea></div>
      <div><label>Ideal customers (one per line)</label><textarea data-k="idealCustomers">${esc(lines(p.idealCustomers))}</textarea></div>
      <div><label>Lead-search keywords (one per line)</label><textarea data-k="searchQueries">${esc(lines(p.searchQueries))}</textarea></div>
      <div><label>Demo link</label><input data-k="demoUrl" value="${esc(p.demoUrl)}"></div>
    </div>
  </div>`).join('');
}
function collectProducts() {
  return $$('#plist .product-card').map((card) => {
    const o = {};
    for (const el of $$('[data-k]', card)) {
      const k = el.dataset.k;
      o[k] = ['features', 'idealCustomers', 'searchQueries'].includes(k) ? el.value.split('\n').map((s) => s.trim()).filter(Boolean) : el.value.trim();
    }
    return o;
  });
}
$('#padd').addEventListener('click', () => {
  products = collectProducts();
  products.push({ name: 'New product', type: 'product', status: 'active', features: [], idealCustomers: [], searchQueries: [] });
  renderProducts();
});
$('#plist').addEventListener('click', (e) => {
  const i = e.target.closest('[data-del]')?.dataset.del;
  if (i === undefined) return;
  products = collectProducts(); products.splice(+i, 1); renderProducts();
});
$('#psave').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    products = await api('/products', 'PUT', collectProducts());
    renderProducts(); suggestQueries();
    toast('Products saved');
  } catch (err) { toast(err.message, 'error'); }
  e.target.disabled = false;
});

/* ---------- settings ---------- */
async function loadOllama() {
  const models = await api('/ollama/models').catch(() => []);
  const cur = settings.providers.ollama.model;
  const all = [...new Set([cur, ...models].filter(Boolean))];
  $('#omodel').innerHTML = all.length ? all.map((m) => `<option ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('') : '<option value="">(no models found; run: ollama pull llama3.2)</option>';
}
function fillSettings() {
  const s = settings;
  if (!s.company) return;
  $('#scur').value = s.crm?.currency || 'NGN';
  $('#starget').value = s.crm?.monthlyTarget || 0;
  $('#sfollow').value = s.crm?.followUpDays || 3;
  $('#sprov').value = s.provider; $('#sfail').checked = s.failover;
  $('#gkey').value = s.providers.gemini.apiKey; $('#gmodel').value = s.providers.gemini.model; $('#gfall').value = s.providers.gemini.fallbackModel;
  $('#qkey').value = s.providers.groq.apiKey; $('#qmodel').value = s.providers.groq.model;
  $('#ohost').value = s.providers.ollama.host; loadOllama();
  $('#cname').value = s.company.name; $('#cweb').value = s.company.website; $('#cemail').value = s.company.email;
  $('#cphone').value = s.company.phone; $('#cwa').value = s.company.whatsapp; $('#csig').value = s.company.signature;
  $('#ccc').value = s.lead.defaultCountryCode; $('#cloc').value = s.lead.defaultLocation;
  $('#ttoken').value = s.telegram.token;
  $('#sxurl').value = s.search.searxngUrl;
  $('#geokey').value = s.geoapify?.apiKey || '';
  $('#wsnip').value = `<script src="${location.origin}/widget.js" defer></script>`;
  $('#envpw').hidden = !s.passwordFromEnv;
  $('#pwform').hidden = !!s.passwordFromEnv;
}
$('#wsnip').addEventListener('click', (e) => e.target.select());
function collectSettings() {
  const o = {
    provider: $('#sprov').value, failover: $('#sfail').checked,
    crm: { currency: $('#scur').value.trim() || 'NGN', monthlyTarget: +$('#starget').value || 0, followUpDays: +$('#sfollow').value || 3 },
    providers: {
      gemini: { apiKey: $('#gkey').value, model: $('#gmodel').value.trim(), fallbackModel: $('#gfall').value.trim() },
      groq: { apiKey: $('#qkey').value, model: $('#qmodel').value.trim() },
      ollama: { host: $('#ohost').value.trim(), model: $('#omodel').value },
    },
    company: { name: $('#cname').value, website: $('#cweb').value, email: $('#cemail').value, phone: $('#cphone').value, whatsapp: $('#cwa').value, signature: $('#csig').value },
    lead: { defaultCountryCode: $('#ccc').value.replace(/\D/g, '') || '234', defaultLocation: $('#cloc').value },
    telegram: { token: $('#ttoken').value },
    search: { searxngUrl: $('#sxurl').value.trim() },
    geoapify: { apiKey: $('#geokey').value.trim() },
  };
  if ($('#apw').value) { o.newPassword = $('#apw').value; o.currentPassword = $('#cpw').value; }
  return o;
}
$('#ssave').addEventListener('click', async () => {
  try {
    settings = await api('/settings', 'PUT', collectSettings());
    $('#apw').value = ''; $('#cpw').value = '';
    syncGeoSource();
    $('#sstat').textContent = 'Saved ✓'; $('#sstat').className = 'small ok';
    renderSidebar(); renderToday();
    toast('Settings saved');
  } catch (err) { $('#sstat').textContent = err.message; $('#sstat').className = 'small err'; }
});
$('#tab-settings').addEventListener('click', async (e) => {
  const p = e.target.dataset.test;
  if (!p) return;
  const out = $('#t-' + p);
  out.textContent = 'testing…'; out.className = 'small muted';
  try {
    settings = await api('/settings', 'PUT', collectSettings());
    syncGeoSource();
    const r = await api('/provider/test', 'POST', { provider: p });
    out.textContent = r.ok ? 'Working ✓' : r.error.slice(0, 160);
    out.className = 'small ' + (r.ok ? 'ok' : 'err');
  } catch (err) { out.textContent = err.message; out.className = 'small err'; }
});
$('#geotest').addEventListener('click', async (e) => {
  const out = $('#t-geoapify');
  e.target.disabled = true;
  out.textContent = 'testing…'; out.className = 'small muted';
  try {
    settings = await api('/settings', 'PUT', collectSettings());
    const r = await api('/geoapify/test', 'POST', {});
    out.textContent = r.ok ? `Working ✓${r.sample ? ' (e.g. ' + r.sample + ')' : ''} — 1 credit used` : r.error.slice(0, 200);
    out.className = 'small ' + (r.ok ? 'ok' : 'err');
  } catch (err) { out.textContent = err.message; out.className = 'small err'; }
  e.target.disabled = false;
});

/* ---------- global search / command palette ---------- */
const COMMANDS = [
  { label: 'Today', detail: 'See the day at a glance', tab: 'today', icon: 'i-sun' },
  { label: 'Pipeline', detail: 'Work the kanban board', tab: 'pipeline', icon: 'i-pipeline' },
  { label: 'Leads', detail: 'Search the lead database', tab: 'leads', icon: 'i-users' },
  { label: 'Find leads', detail: 'Prospect new businesses', tab: 'finder', icon: 'i-search' },
  { label: 'Sales chat', detail: 'Test the agent', tab: 'chat', icon: 'i-chat' },
  { label: 'Products', detail: 'Edit the offer catalog', tab: 'products', icon: 'i-box' },
  { label: 'Settings', detail: 'AI, goals and widget', tab: 'settings', icon: 'i-sliders' },
  { label: 'Add a lead', detail: 'Create a new record', action: 'add', icon: 'i-plus' },
  { label: 'Export leads', detail: 'Download the CSV', action: 'export', icon: 'i-arrow' },
];
function openCommand() {
  $('#command').hidden = false;
  $('#cmdInput').value = '';
  cmdIndex = 0;
  renderCommands();
  $('#cmdInput').focus();
}
function closeCommand() { $('#command').hidden = true; }
function renderCommands() {
  const q = $('#cmdInput').value.trim().toLowerCase();
  const matchedLeads = q ? leads.filter((l) => leadSearchText(l).includes(q)).slice(0, 7) : [];
  const matchedCommands = COMMANDS.filter((c) => !q || `${c.label} ${c.detail}`.toLowerCase().includes(q));
  const rows = [];
  if (matchedLeads.length) rows.push('<div class="cmd-group">Leads</div>');
  for (const l of matchedLeads) rows.push(`<button class="cmd-item" data-lead="${esc(l.id)}"><svg class="ico"><use href="#i-users"/></svg><span><strong>${esc(l.name)}</strong><span>${esc([stageLabel(l.status), l.emails?.[0], l.location].filter(Boolean).join(' · '))}</span></span><svg class="ico cmd-arrow"><use href="#i-chevron"/></svg></button>`);
  if (matchedCommands.length) rows.push('<div class="cmd-group">Go to / actions</div>');
  for (const c of matchedCommands) rows.push(`<button class="cmd-item" data-cmd-tab="${c.tab || ''}" data-cmd-action="${c.action || ''}"><svg class="ico"><use href="#${c.icon}"/></svg><span><strong>${esc(c.label)}</strong><span>${esc(c.detail)}</span></span><svg class="ico cmd-arrow"><use href="#i-chevron"/></svg></button>`);
  $('#cmdList').innerHTML = rows.join('') || '<div class="cmd-group">No matches</div>';
  cmdIndex = 0;
  const first = $('#cmdList .cmd-item'); if (first) first.classList.add('active');
  for (const b of $$('#cmdList .cmd-item')) b.addEventListener('click', () => {
    if (b.dataset.lead) { closeCommand(); openLead(b.dataset.lead); return; }
    if (b.dataset.cmdTab) { closeCommand(); selectTab(b.dataset.cmdTab); return; }
    if (b.dataset.cmdAction === 'add') { closeCommand(); openAddLead(); }
    if (b.dataset.cmdAction === 'export') { closeCommand(); location.href = '/api/leads/export.csv'; }
  });
}
$('#cmdInput').addEventListener('input', renderCommands);
$('#cmdInput').addEventListener('keydown', (e) => {
  const items = $$('#cmdList .cmd-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    cmdIndex = (cmdIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((x, i) => x.classList.toggle('active', i === cmdIndex));
    items[cmdIndex].scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Enter') { e.preventDefault(); items[cmdIndex].click(); }
  if (e.key === 'Escape') closeCommand();
});
$('#command').addEventListener('click', (e) => { if (e.target === $('#command')) closeCommand(); });
$('#globalSearch').addEventListener('input', (e) => {
  clearTimeout(globalTimer);
  const q = e.target.value.trim();
  globalTimer = setTimeout(() => {
    if (!q) { filters.q = ''; $('#lsearch').value = ''; renderLeads(); return; }
    if (currentTab !== 'leads') selectTab('leads');
    $('#lsearch').value = q;
    filters.q = q.toLowerCase();
    page = 1;
    selected.clear();
    renderLeads();
  }, 140);
});
$('#globalSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.target.value = ''; filters.q = ''; $('#lsearch').value = ''; renderLeads(); }
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (dlg.open) return;
    if ($('#command').hidden) openCommand(); else closeCommand();
  }
  if (e.key === 'Escape' && !$('#command').hidden) closeCommand();
});
$('#quickAdd').addEventListener('click', openAddLead);
$('#ladd').addEventListener('click', openAddLead);
$('#limport').addEventListener('click', () => $('#lfile').click());
$('#lfile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const r = await api('/leads/import', 'POST', { csv: await f.text() });
    toast(`Imported ${r.added} leads${r.skipped ? `, ${r.skipped} duplicates skipped` : ''}`);
    e.target.value = '';
    await refreshAll();
  } catch (err) { toast(err.message, 'error'); }
});

/* ---------- start ---------- */
applyTheme();
boot();
