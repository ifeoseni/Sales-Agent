/**
 * First-run guidance: a live "Get started" checklist (shown on Today) and the
 * full Guide tab. Everything here is derived from the data the app already has,
 * so steps tick themselves off as the user works.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const hasAi = (s) => {
  const p = s?.providers || {};
  return !!(p.gemini?.apiKey || p.groq?.apiKey || p.ollama?.model);
};

/** The seven steps, each with a live "done" check and a button that jumps to the right place. */
export function guideSteps({ leads = [], products = [], settings = {} } = {}) {
  const withContact = leads.filter((l) => (l.emails || []).length || (l.phones || []).length);
  const contacted = leads.filter((l) => l.status && l.status !== 'new');
  const withTask = leads.filter((l) => (l.tasks || []).some((t) => !t.done));
  return [
    {
      id: 'ai',
      title: 'Connect the AI',
      why: 'It writes your messages and answers chat. Free keys from Google Gemini or Groq work fine.',
      done: hasAi(settings),
      go: 'settings',
      cta: 'Open Settings',
      hint: 'Settings → Active provider → paste a key → Save.',
    },
    {
      id: 'company',
      title: 'Tell it who you are',
      why: 'Your company name, email and signature go into every draft.',
      done: !!(settings.company?.name && settings.company?.email),
      go: 'settings',
      cta: 'Add company details',
      hint: 'Settings → Company → name, email, phone, signature.',
    },
    {
      id: 'product',
      title: 'Describe what you sell',
      why: 'Drafts and the sales chat use your products, prices and pitch, so keep them specific.',
      done: products.length > 0,
      go: 'products',
      cta: 'Open Products',
      hint: 'One product is enough to start. Add who it is for and the main benefit.',
    },
    {
      id: 'find',
      title: 'Find your first leads',
      why: 'Use Find leads. Explee searches are free; you preview results before anything is saved.',
      done: leads.length > 0,
      go: 'finder',
      cta: 'Find leads',
      hint: 'Find leads → Explee → describe the companies → Preview → Save.',
    },
    {
      id: 'contact',
      title: 'Get an email or phone for them',
      why: 'The agent looks on the company’s own website first, which costs nothing.',
      done: withContact.length > 0,
      go: 'leads',
      cta: 'Open Leads',
      hint: 'Leads → click “Find online” on a lead, or tick several and press “Find contacts online”.',
    },
    {
      id: 'message',
      title: 'Draft and send your first message',
      why: 'The AI drafts it; you read it, send it yourself, then mark the lead Contacted.',
      done: contacted.length > 0,
      go: 'leads',
      cta: 'Pick a lead',
      hint: 'Open a lead → Message tab → choose email / WhatsApp / DM → edit → copy → send from your own account.',
    },
    {
      id: 'followup',
      title: 'Set a follow-up',
      why: 'Most deals need two or three touches. A dated task puts the lead on your Today list.',
      done: withTask.length > 0,
      go: 'leads',
      cta: 'Add a follow-up',
      hint: 'Open a lead → Tasks tab → add a task with a due date.',
    },
  ];
}

export function gettingStartedHtml(ctx, { dismissed = false } = {}) {
  const steps = guideSteps(ctx);
  const done = steps.filter((s) => s.done).length;
  if (dismissed || done === steps.length) {
    // Existing users: a quiet entry point instead of nothing.
    return `<div class="guide-slim" id="guideSlim"><span>${done === steps.length ? 'Setup complete.' : 'Need a refresher?'} The guide covers finding leads, the Explee budget and troubleshooting.</span><button class="btn ghost sm" data-guide-go="guide">Open the guide</button></div>`;
  }
  const next = steps.find((s) => !s.done);
  const pct = Math.round((done / steps.length) * 100);
  return `<div class="panel guide-card" id="guideCard">
    <div class="panel-head">
      <div>
        <p class="eyebrow">Get started · ${done} of ${steps.length} done</p>
        <h3>${done === 0 ? 'Welcome. Here is the fastest way to your first customer conversation.' : 'Next: ' + esc(next.title)}</h3>
        <p class="muted small">${esc(next.why)}</p>
      </div>
      <div class="panel-actions">
        <button class="btn" data-guide-go="${esc(next.go)}">${esc(next.cta)}</button>
        <button class="btn ghost sm" data-guide-go="guide">Full guide</button>
        <button class="btn ghost sm" id="guideDismiss" title="Hide this card. The Guide tab keeps it.">Hide</button>
      </div>
    </div>
    <div class="guide-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    <ol class="guide-mini">${steps.map((s) => `<li class="${s.done ? 'is-done' : s === next ? 'is-next' : ''}">${esc(s.title)}</li>`).join('')}</ol>
  </div>`;
}

const FAQ = [
  ['I cannot sign in',
    'The first-run password is printed in the terminal window that started the app. To set a new one, stop the app and run <code>npm run reset-password</code>.'],
  ['Explee says my balance is too low (402)',
    'Explee needs a positive credit balance even for free searches. Top up on explee.com, then press Refresh in the Explee panel.'],
  ['“Free search allowance spent”',
    'The free plan allows 50 searches a day and 10 a minute. The counter resets at midnight UTC. Nothing was sent to Explee when you saw this message, so nothing was charged.'],
  ['Search shows “No new matches”',
    'Everything Explee returned is already in your CRM, or the description was too narrow. Run it again: each run moves on to a different slice of results. Or change the words, the country, or the job titles.'],
  ['A lead has no email or phone',
    'That is normal for people found on Explee. Click <strong>Find online</strong> on the lead. The agent reads the company website first, then searches the web. It is free. Use Explee’s paid lookup only for leads that matter.'],
  ['Should I use the paid email / phone lookup?',
    'Only when the free agent found nothing and the lead is worth it. A work email costs about 1.5 credits and a phone about 15, and you are charged only when something is found. A contact already found is never charged twice.'],
  ['The AI does not answer or drafts look generic',
    'Check Settings → Active provider has a key saved. For better drafts, add specifics to the product (who it is for, the main result, a price).'],
  ['I saved a lead by mistake',
    'Open it and delete it. An Explee lead you delete will not be offered again, because the app remembers it.'],
];

export function guideHtml(ctx, { budget } = {}) {
  const steps = guideSteps(ctx);
  const done = steps.filter((s) => s.done).length;
  const stepRows = steps.map((s, i) => `<li class="guide-step ${s.done ? 'is-done' : ''}">
      <span class="guide-num" aria-hidden="true">${s.done ? '✓' : i + 1}</span>
      <div class="guide-step-body">
        <strong>${esc(s.title)}</strong>
        <p class="muted small">${esc(s.why)}</p>
        <p class="small guide-where">${esc(s.hint)}</p>
      </div>
      <button class="btn ${s.done ? 'ghost' : ''} sm" data-guide-go="${esc(s.go)}">${s.done ? 'Open' : esc(s.cta)}</button>
    </li>`).join('');

  const credits = budget
    ? `<p class="small muted">Right now: <strong>${esc(budget.used)}</strong> of <strong>${esc(budget.total)}</strong> credits used, <strong>${esc(budget.availableNow)}</strong> available this month.</p>`
    : '';

  return `
  <div class="page-intro">
    <div>
      <p class="eyebrow">Guide</p>
      <h2>Your first week, step by step</h2>
      <p class="muted">This desk helps you find potential customers, reach them with a good message, and follow up until they answer. You do the sending; the AI and the agents do the busywork.</p>
    </div>
    <div class="page-actions"><span class="chip gold">${done} of ${steps.length} steps done</span><button class="btn ghost sm" id="guideRestart" title="Show the Get started card on Today again">Show checklist on Today</button></div>
  </div>

  <div class="panel">
    <div class="panel-head"><div><h3>1 · Get set up</h3><p class="muted small">${done === steps.length ? 'Everything is done. Keep this page as a reference, or revisit any step.' : 'Ticks itself off as you go. About 15 minutes.'} Already using the app? Skim the sections below for anything new.</p></div></div>
    <ol class="guide-steps">${stepRows}</ol>
  </div>

  <div class="panel">
    <div class="panel-head"><div><h3>2 · The daily routine</h3><p class="muted small">Once you are set up, this takes 20 to 30 minutes.</p></div></div>
    <ol class="guide-flow">
      <li><strong>Today</strong><span>Clear what is due or overdue first.</span></li>
      <li><strong>Find leads</strong><span>Add 10 to 20 new, relevant people or companies.</span></li>
      <li><strong>Leads</strong><span>Get contacts, check the email, read the lead.</span></li>
      <li><strong>Draft</strong><span>Let the AI write it, edit it, send it yourself.</span></li>
      <li><strong>Log</strong><span>Mark Contacted and set the next follow-up.</span></li>
    </ol>
  </div>

  <div class="panel">
    <div class="panel-head"><div><h3>3 · Which way of finding leads?</h3></div></div>
    <div class="table-wrap"><table class="tbl guide-table">
      <thead><tr><th>Use this</th><th>When</th><th>Cost</th></tr></thead>
      <tbody>
        <tr><td><strong>Explee · People</strong></td><td>You know the job title you want to reach (Founder, Events Manager) at companies of a certain kind, anywhere in the world.</td><td>Free</td></tr>
        <tr><td><strong>Explee · Companies</strong></td><td>You want businesses first and decide who to contact later. Often arrives with a public email or phone.</td><td>Free</td></tr>
        <tr><td><strong>Business type + city</strong></td><td>Local shops, venues and services. Searches the web and OpenStreetMap.</td><td>Free</td></tr>
        <tr><td><strong>Paste websites</strong></td><td>You already have a list. Most reliable way to get contact details.</td><td>Free</td></tr>
      </tbody>
    </table></div>
  </div>

  <div class="panel">
    <div class="panel-head"><div><h3>4 · Explee and the $30</h3><p class="muted small">Plain language. You will not be surprised by a charge.</p></div></div>
    <div class="guide-cols">
      <div>
        <h4>Free</h4>
        <ul class="guide-list">
          <li>Searching. Each search returns up to 10 results, and the app splits big searches into slices so you still get many new leads.</li>
          <li>Preview. Nothing is saved until you press Save.</li>
          <li>Duplicate removal. People and companies already in the CRM, or saved before, are filtered out.</li>
          <li>The contact agent (website and web search).</li>
          <li>Limit: 50 searches a day on the free plan.</li>
        </ul>
      </div>
      <div>
        <h4>Costs credits (only when found)</h4>
        <ul class="guide-list">
          <li>Work email: about 1.5 credits (basic) or 5 (premium).</li>
          <li>Phone number: about 15 credits (basic) or 30 (premium).</li>
          <li>$30 is 3,000 credits, released at about 50 a month so it lasts five years. A phone lookup is a treat, not a habit.</li>
          <li>The app never goes past the ceiling, and a found contact is never charged twice.</li>
        </ul>
      </div>
    </div>
    ${credits}
    <p class="small muted">This app never sends email or messages through Explee. It only gathers data.</p>
  </div>

  <div class="panel">
    <div class="panel-head"><div><h3>5 · Where things are</h3></div></div>
    <div class="guide-map">
      <button data-guide-go="today"><strong>Today</strong><span>Due tasks, overdue follow-ups, targets.</span></button>
      <button data-guide-go="pipeline"><strong>Pipeline</strong><span>Drag leads between stages, track value.</span></button>
      <button data-guide-go="leads"><strong>Leads</strong><span>The database. Filter, bulk actions, open a lead to draft or follow up.</span></button>
      <button data-guide-go="finder"><strong>Find leads</strong><span>Explee, local search, paste-a-list.</span></button>
      <button data-guide-go="chat"><strong>Sales chat</strong><span>Try the AI as if you were a customer.</span></button>
      <button data-guide-go="products"><strong>Products</strong><span>What you sell. Drives every draft.</span></button>
      <button data-guide-go="settings"><strong>Settings</strong><span>AI keys, company, Explee budget, website chat widget.</span></button>
    </div>
    <p class="small muted">Shortcut: press <kbd>Ctrl</kbd> <kbd>K</kbd> anywhere to jump to a page or find a lead.</p>
  </div>

  <div class="panel">
    <div class="panel-head"><div><h3>6 · Sending well</h3></div></div>
    <ul class="guide-list">
      <li>Keep it short. Say why you chose them in the first line (the draft uses what we know about the lead).</li>
      <li>Ask one easy question. Do not send a brochure.</li>
      <li>Send from your own email or WhatsApp. Space follow-ups a few days apart, and stop after about three.</li>
      <li>If someone says no or asks you to stop, mark the lead <strong>Do not contact</strong>.</li>
      <li>Verify an email before sending (open the lead and press Verify MX). Bounces hurt your sending reputation.</li>
    </ul>
  </div>

  <div class="panel">
    <div class="panel-head"><div><h3>7 · If something looks wrong</h3></div></div>
    <div class="guide-faq">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join('')}</div>
  </div>`;
}
