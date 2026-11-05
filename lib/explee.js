/**
 * Explee API client with a hard spend guard.
 *
 * Two rules shape this module:
 *  1. Discovery must stay inside the free-results zone: page_size <= 10 and the
 *     plan's free-request allowance (50/day, 10/min on the free plan) is counted
 *     locally AND persisted, so a restart cannot reset the budget.
 *  2. Nothing paid happens by accident. Every paid call needs an explicit
 *     monthly credit cap above zero, an estimate that fits the cap, and a
 *     balance that stays above the configured floor.
 *
 * The client never sends `exclude_lists` by default: on this API that parameter
 * switches the free-results zone off, so deduplication is done locally in
 * lib/explee-discovery.js instead.
 */
import { load, save } from './store.js';
import { getSettings } from './settings.js';

const BASE_URL = 'https://api.explee.com/public/api/v1';
export const MAX_PAGE_SIZE = 10;
const MAX_REMEMBERED = 50_000;
const BALANCE_TTL_MS = 30_000;

export class ExpleeError extends Error {
  constructor(message, { status = 0, code = 'explee_error', body = null, retryAfter = null } = {}) {
    super(message);
    this.name = 'ExpleeError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

const number = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const clampInt = (v, fallback, min, max) => Math.min(Math.max(Math.trunc(number(v, fallback)), min), max);

function blankState() {
  return {
    version: 1,
    freeDay: '',
    freeDayCount: 0,
    freeMinute: 0,
    freeMinuteCount: 0,
    creditMonth: '',
    creditsUsed: 0,
    creditsThisMonth: 0,
    budgetStart: '',
    saved: { people: {}, companies: {} },
    cursors: {},
    enriched: { email: {}, phone: {} },
  };
}

function normalizeState(raw) {
  const base = blankState();
  if (!raw || typeof raw !== 'object') return base;
  base.freeDay = typeof raw.freeDay === 'string' ? raw.freeDay : '';
  base.freeDayCount = Math.max(0, Math.trunc(number(raw.freeDayCount, 0)));
  base.freeMinute = Math.max(0, Math.trunc(number(raw.freeMinute, 0)));
  base.freeMinuteCount = Math.max(0, Math.trunc(number(raw.freeMinuteCount, 0)));
  base.creditMonth = typeof raw.creditMonth === 'string' ? raw.creditMonth : '';
  base.creditsUsed = Math.max(0, number(raw.creditsUsed, 0));
  base.creditsThisMonth = Math.max(0, number(raw.creditsThisMonth, 0));
  base.budgetStart = typeof raw.budgetStart === 'string' ? raw.budgetStart : '';
  for (const kind of ['people', 'companies']) {
    const src = raw.saved?.[kind];
    if (src && typeof src === 'object' && !Array.isArray(src)) {
      for (const [k, ts] of Object.entries(src)) {
        if (typeof k === 'string' && k.length <= 300) base.saved[kind][k] = String(ts || '');
      }
    }
  }
  if (raw.cursors && typeof raw.cursors === 'object') {
    for (const [k, v] of Object.entries(raw.cursors)) {
      if (k.length <= 300 && Number(v) >= 1) base.cursors[k] = Math.min(Math.trunc(Number(v)), 1000);
    }
  }
  for (const kind of ['email', 'phone']) {
    const src = raw.enriched?.[kind];
    if (src && typeof src === 'object') {
      for (const [k, v] of Object.entries(src)) {
        if (k.length <= 400 && v && typeof v === 'object') base.enriched[kind][k] = { at: String(v.at || ''), value: v.value ?? null, status: v.status ?? null };
      }
    }
  }
  return base;
}

/** Trim a seen-list back to MAX_REMEMBERED, dropping the oldest entries. */
function prune(map) {
  const keys = Object.keys(map);
  if (keys.length <= MAX_REMEMBERED) return;
  keys
    .sort((a, b) => String(map[a]).localeCompare(String(map[b])))
    .slice(0, keys.length - MAX_REMEMBERED)
    .forEach((k) => delete map[k]);
}

const HTTP_CODES = {
  400: 'bad_request',
  401: 'unauthorized',
  402: 'payment_required',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'too_large',
  422: 'invalid_request',
  429: 'rate_limited',
  503: 'unavailable',
};

function apiMessage(status, body, retryAfter) {
  const detail = body?.error?.message || body?.detail || body?.message || body?.error;
  const text = typeof detail === 'string' ? detail : '';
  if (status === 402) return 'Explee says the credit balance is too low (a positive balance is required even for free results). Top up or keep this read-only.';
  if (status === 409) return text || 'Explee rejected this because another mode is active (for example autopilot owns the campaign).';
  if (status === 422) return text || 'Explee rejected one of the fields.';
  if (status === 429) return `Explee rate limit hit${retryAfter ? ` — retry in ${retryAfter}s` : ''}. Slow down.`;
  return text || `Explee returned HTTP ${status}.`;
}

export function readConfig(settings = getSettings()) {
  const c = settings?.explee || {};
  return {
    // Lifetime ceiling in credits. 0 = paid calls are disabled.
    lifetimeCreditBudget: Math.max(0, number(c.lifetimeCreditBudget, 3000)),
    // Months the ceiling must last. 60 = five years.
    budgetMonths: clampInt(c.budgetMonths, 60, 1, 600),
    paceEnabled: c.paceEnabled !== false,
    balanceFloor: Math.max(0, number(c.balanceFloor, 100)),
    freePerDay: clampInt(c.freeRequestsPerDay, 50, 1, 10000),
    freePerMinute: clampInt(c.freeRequestsPerMinute, 10, 1, 10000),
    // Hard ceiling: anything above 10 leaves the free-results zone.
    pageSize: clampInt(c.pageSize, 10, 1, MAX_PAGE_SIZE),
  };
}

export function createExpleeClient(options = {}) {
  const {
    baseUrl = BASE_URL,
    fetchImpl = (url, init) => globalThis.fetch(url, init),
    settings = () => getSettings(),
    apiKey = () => String(process.env.EXPLEE_API_KEY || settings()?.explee?.apiKey || '').trim(),
    loadState = () => load('explee-state', null),
    saveState = (s) => save('explee-state', s),
    now = () => new Date(),
    persist = true,
    timeoutMs = 60_000,
  } = options;

  let state = normalizeState(loadState());
  let balanceCache = { at: 0, value: null };
  const commit = () => { if (persist) saveState(state); };
  const today = () => now().toISOString().slice(0, 10);
  const thisMonth = () => now().toISOString().slice(0, 7);

  function consumeFreeSlot() {
    const cfg = readConfig(settings());
    const minute = Math.floor(now().getTime() / 60_000);
    const day = today();
    if (state.freeDay !== day) { state.freeDay = day; state.freeDayCount = 0; }
    if (state.freeMinute !== minute) { state.freeMinute = minute; state.freeMinuteCount = 0; }
    if (state.freeDayCount >= cfg.freePerDay) {
      throw new ExpleeError(
        `Free search allowance spent: ${cfg.freePerDay}/${cfg.freePerDay} requests today. Nothing was sent to Explee. Raise the limit or wait for tomorrow (UTC).`,
        { status: 429, code: 'free_zone_day' },
      );
    }
    if (state.freeMinuteCount >= cfg.freePerMinute) {
      throw new ExpleeError(
        `Free search pace reached: ${cfg.freePerMinute} requests this minute. Nothing was sent to Explee. Wait a minute.`,
        { status: 429, code: 'free_zone_minute' },
      );
    }
    state.freeDayCount += 1;
    state.freeMinuteCount += 1;
    commit();
  }

  function recordSpend(charged) {
    const n = number(charged, 0);
    if (!(n > 0)) return;
    if (state.creditMonth !== thisMonth()) { state.creditMonth = thisMonth(); state.creditsThisMonth = 0; }
    state.creditsThisMonth += n;
    state.creditsUsed += n;
    commit();
  }

  const DAYS_PER_MONTH = 30.4375;

  /** Lifetime budget, hard ceiling and the pace earned so far. */
  function budgetSnapshot() {
    const cfg = readConfig(settings());
    const total = cfg.lifetimeCreditBudget;
    const months = cfg.budgetMonths;
    const totalDays = months * DAYS_PER_MONTH;
    const used = state.creditsUsed;
    const startedAt = state.budgetStart || null;
    const startMs = startedAt ? Date.parse(startedAt) : NaN;
    const elapsedDays = Number.isFinite(startMs) ? Math.max(0, (now().getTime() - startMs) / 864e5) : 0;
    // One month's allowance is available immediately, then the rest unlocks at a
    // linear pace. Unused allowance carries over, so saving up buys a phone lookup.
    const starter = total > 0 ? total / months : 0;
    const earned = total > 0 ? total * Math.min(1, elapsedDays / totalDays) : 0;
    const allowance = Math.min(total, starter + earned);
    return {
      total,
      used,
      remaining: Math.max(0, total - used),
      usedThisMonth: state.creditMonth === thisMonth() ? state.creditsThisMonth : 0,
      months,
      startedAt,
      elapsedDays: Math.round(elapsedDays * 10) / 10,
      monthlyPace: total > 0 ? Math.round((total / months) * 100) / 100 : 0,
      dailyPace: total > 0 ? Math.round((total / totalDays) * 1000) / 1000 : 0,
      allowance: Math.round(allowance * 100) / 100,
      availableNow: Math.round(Math.max(0, allowance - used) * 100) / 100,
      paceEnabled: cfg.paceEnabled,
      runwayMonths: total > 0 && cfg.paceEnabled ? Math.round((Math.max(0, total - used) / (total / months)) * 10) / 10 : null,
    };
  }

  function nextUnlockAt(needed) {
    if (!state.budgetStart) return null;
    const cfg = readConfig(settings());
    if (cfg.lifetimeCreditBudget <= 0) return null;
    const total = cfg.lifetimeCreditBudget;
    const earnedNeeded = state.creditsUsed + needed - total / cfg.budgetMonths;
    if (earnedNeeded <= 0) return null;
    const days = (earnedNeeded / total) * (cfg.budgetMonths * DAYS_PER_MONTH);
    return new Date(Date.parse(state.budgetStart) + days * 864e5).toISOString();
  }

  async function assertPaidRoom(estimate) {
    const cfg = readConfig(settings());
    if (cfg.lifetimeCreditBudget <= 0) {
      throw new ExpleeError(
        'Paid Explee actions are off (lifetime credit budget is 0). Set a budget in Settings → Explee to allow enrichment.',
        { status: 402, code: 'paid_disabled' },
      );
    }
    // The clock starts at the first paid attempt, so a long idle period does not
    // hand back allowance that was never earned.
    if (!state.budgetStart) { state.budgetStart = now().toISOString(); commit(); }
    const b = budgetSnapshot();
    if (b.used + estimate > b.total) {
      throw new ExpleeError(
        `This would exceed the lifetime budget: ${b.used} of ${b.total} credits used, this call needs about ${estimate}.`,
        { status: 402, code: 'lifetime_cap' },
      );
    }
    if (b.paceEnabled && b.used + estimate > b.allowance + 1e-9) {
      const next = nextUnlockAt(estimate);
      throw new ExpleeError(
        `Pace guard: ${b.availableNow} credits available now (${b.monthlyPace} per month over ${b.months} months). This call needs about ${estimate}${next ? `; it unlocks around ${next.slice(0, 10)}` : ''}.`,
        { status: 402, code: 'pace_limit' },
      );
    }
    const bal = await balance();
    if (number(bal?.remain, 0) - estimate < cfg.balanceFloor) {
      throw new ExpleeError(
        `Balance floor would be crossed: ${bal?.remain ?? 0} credits left, this call needs about ${estimate}, floor is ${cfg.balanceFloor}.`,
        { status: 402, code: 'balance_floor' },
      );
    }
  }

  // Paid calls run one at a time so two clicks cannot both pass the budget check.
  let paidChain = Promise.resolve();
  const serialPaid = (fn) => {
    const run = paidChain.then(fn, fn);
    paidChain = run.catch(() => {});
    return run;
  };

  async function request(path, { method = 'GET', body, freeRequest = false, paidEstimate = 0 } = {}) {
    const key = apiKey();
    if (!key) {
      throw new ExpleeError('No Explee API key. Set EXPLEE_API_KEY or paste one in Settings → Explee.', {
        status: 400,
        code: 'not_configured',
      });
    }
    if (paidEstimate > 0) await assertPaidRoom(paidEstimate);
    if (freeRequest) consumeFreeSlot();

    let res;
    try {
      res = await fetchImpl(baseUrl + path, {
        method,
        headers: {
          'X-API-Key': key,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new ExpleeError(`Could not reach Explee: ${e.message}`, { code: 'network' });
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const retryAfter = number(res.headers.get('retry-after'), 0) || null;
      throw new ExpleeError(apiMessage(res.status, data, retryAfter), {
        status: res.status,
        code: HTTP_CODES[res.status] || 'http_error',
        body: data,
        retryAfter,
      });
    }

    recordSpend(data?.meta?.credits_charged);
    if (Number.isFinite(number(data?.meta?.remaining_balance, NaN))) {
      balanceCache = { at: Date.now(), value: { remain: Number(data.meta.remaining_balance) } };
    }
    return data;
  }

  async function balance({ fresh = false } = {}) {
    if (!fresh && balanceCache.value && Date.now() - balanceCache.at < BALANCE_TTL_MS) return balanceCache.value;
    const data = await request('/billing/balance');
    balanceCache = { at: Date.now(), value: data };
    return data;
  }

  /* ---------------- discovery (free zone only) ---------------- */

  function pageSize(requested) {
    // Never above 10: a single bigger page leaves the free zone and bills the whole page.
    return clampInt(requested, readConfig(settings()).pageSize, 1, MAX_PAGE_SIZE);
  }

  function searchCompanies({ definition, filters = {}, page = 1, pageSize: ps, excludeLists, allowPaid = false, minRelevance } = {}) {
    if (!String(definition || '').trim()) {
      throw new ExpleeError('A company definition is required, e.g. "event planning companies in Lagos".', { code: 'invalid_input' });
    }
    const size = pageSize(ps);
    const relevance = Number(minRelevance);
    return request('/search/companies', {
      method: 'POST',
      body: {
        filters: {
          definition: String(definition).trim(),
          ...(Number.isFinite(relevance) && relevance > 0 ? { min_relevance: Math.min(relevance, 1) } : {}),
          ...filters,
        },
        page: clampInt(page, 1, 1, 1000),
        page_size: size,
        ...(excludeLists?.length ? { exclude_lists: excludeLists.slice(0, 100) } : {}),
      },
      freeRequest: !allowPaid,
      paidEstimate: allowPaid ? 0.5 * size : 0,
    });
  }

  function searchPeople({ jobTitles, companyDefinition, companyFilters = {}, geo, page = 1, pageSize: ps, excludeLists, allowPaid = false, minRelevance } = {}) {
    const titles = (Array.isArray(jobTitles) ? jobTitles : String(jobTitles || '').split(','))
      .map((t) => String(t).trim())
      .filter(Boolean)
      .slice(0, 20);
    if (!titles.length) {
      throw new ExpleeError('At least one job title is required, e.g. "Founder" or "Event Planner".', { code: 'invalid_input' });
    }
    const definition = String(companyDefinition || '').trim();
    if (!definition) {
      throw new ExpleeError('A company definition is required to find people, e.g. "event planning companies in Lagos".', { code: 'invalid_input' });
    }
    // The API expects a list here, even for a single country.
    const geoList = (Array.isArray(geo) ? geo : String(geo || '').split(','))
      .map((g) => String(g).trim().toUpperCase())
      .filter((g) => /^[A-Z]{2}$/.test(g))
      .slice(0, 20);
    const size = pageSize(ps);
    const relevance = Number(minRelevance);
    return request('/search/people', {
      method: 'POST',
      body: {
        people_filters: {
          job_titles: titles,
          ...(Number.isFinite(relevance) && relevance > 0 ? { min_relevance: Math.min(relevance, 1) } : {}),
          ...(geoList.length ? { geo: geoList } : {}),
        },
        company_filters: { definition, ...companyFilters },
        page: clampInt(page, 1, 1, 1000),
        page_size: size,
        ...(excludeLists?.length ? { exclude_lists: excludeLists.slice(0, 100) } : {}),
      },
      freeRequest: !allowPaid,
      paidEstimate: allowPaid ? size : 0,
    });
  }

  function nlToFilters(query) {
    if (!String(query || '').trim()) throw new ExpleeError('Describe what you are looking for.', { code: 'invalid_input' });
    // Explicitly free per the API docs: no credit and no free-zone slot.
    return request('/search/nl-to-filters', { method: 'POST', body: { query: String(query).trim().slice(0, 1000) } });
  }

  /* ---------------- paid enrichment (opt-in only) ---------------- */

  // A found contact is never paid for twice. A miss costs nothing, but is
  // remembered for a week so repeated clicks do not hammer the API.
  const MISS_TTL_MS = 7 * 864e5;
  function cachedEnrichment(kind, key) {
    const e = state.enriched[kind][key];
    if (!e) return null;
    if (e.value) return e;
    return Date.now() - Date.parse(e.at) < MISS_TTL_MS ? e : null;
  }
  function storeEnrichment(kind, key, value, status) {
    state.enriched[kind][key] = { at: now().toISOString(), value, status };
    const keys = Object.keys(state.enriched[kind]);
    if (keys.length > 20_000) delete state.enriched[kind][keys[0]];
    commit();
  }

  async function enrichEmail({ firstName, lastName, companyDomain, preset = 'basic' } = {}) {
    const first = String(firstName || '').trim();
    const last = String(lastName || '').trim();
    const domain = String(companyDomain || '').trim();
    if (!first || !last || !domain) {
      throw new ExpleeError('first name, last name and company domain are all required.', { code: 'invalid_input' });
    }
    const mode = preset === 'premium' ? 'premium' : 'basic';
    const estimate = mode === 'premium' ? 5 : 1.5;
    const host = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
    const cacheKey = `${first}|${last}|${host}`.toLowerCase();
    const hit = cachedEnrichment('email', cacheKey);
    if (hit) return { email: hit.value, email_status: hit.status, cached: true, preset: mode, estimated_cost: 0, meta: { credits_charged: 0 } };
    return serialPaid(async () => {
      const again = cachedEnrichment('email', cacheKey);
      if (again) return { email: again.value, email_status: again.status, cached: true, preset: mode, estimated_cost: 0, meta: { credits_charged: 0 } };
      const data = await request('/enrich/email', {
        method: 'POST',
        body: { first_name: first, last_name: last, company_domain: domain, preset: mode },
        paidEstimate: estimate,
      });
      storeEnrichment('email', cacheKey, data?.email || null, data?.email_status || null);
      return { ...data, preset: mode, estimated_cost: data?.email ? estimate : 0 };
    });
  }

  async function enrichPhone({ linkedinUrl, email, preset = 'basic_new' } = {}) {
    const linkedin = String(linkedinUrl || '').trim();
    if (!linkedin) {
      throw new ExpleeError('A LinkedIn profile URL is required to look up a phone number.', { code: 'invalid_input' });
    }
    const mode = preset === 'premium' ? 'premium' : 'basic_new';
    const estimate = mode === 'premium' ? 30 : 15;
    const cacheKey = linkedin.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
    const hit = cachedEnrichment('phone', cacheKey);
    if (hit) return { phone: hit.value, cached: true, preset: mode, estimated_cost: 0, meta: { credits_charged: 0 } };
    return serialPaid(async () => {
      const again = cachedEnrichment('phone', cacheKey);
      if (again) return { phone: again.value, cached: true, preset: mode, estimated_cost: 0, meta: { credits_charged: 0 } };
      const data = await request('/enrich/phone', {
        method: 'POST',
        body: {
          linkedin_url: linkedin,
          ...(email ? { email: String(email).trim() } : {}),
          preset: mode,
        },
        paidEstimate: estimate,
      });
      storeEnrichment('phone', cacheKey, data?.phone || null, null);
      return { ...data, preset: mode, estimated_cost: data?.phone ? estimate : 0 };
    });
  }

  /* ---------------- Explee dedup lists (not used by default) ---------------- */
  // Note: passing these ids to a search disables the free-results zone, so the
  // default discovery path does not use them. They are here for paid plans.

  const createPeopleDedupList = ({ people = [], linkedinUrls = [], name } = {}) =>
    request('/dedup/people', { method: 'POST', body: { people, linkedin_urls: linkedinUrls, ...(name ? { name } : {}) } });

  const createCompaniesDedupList = ({ domains = [], name } = {}) =>
    request('/dedup/companies', { method: 'POST', body: { domains, ...(name ? { name } : {}) } });

  const listDedupLists = (kind = 'people') =>
    request(`/dedup/${kind === 'companies' ? 'companies' : 'people'}`);

  /* ---------------- local no-repeat memory ---------------- */

  function hasSeen(kind, keys) {
    const map = state.saved[kind] || {};
    return (Array.isArray(keys) ? keys : [keys]).some((k) => Object.hasOwn(map, k));
  }

  function remember(kind, keys) {
    const map = state.saved[kind === 'companies' ? 'companies' : 'people'];
    const at = now().toISOString();
    for (const k of (Array.isArray(keys) ? keys : [keys])) {
      if (typeof k === 'string' && k && k.length <= 300) map[k] = at;
    }
    prune(map);
    commit();
  }

  const getCursor = (key) => state.cursors[key] || 1;
  function setCursor(key, page) {
    if (typeof key !== 'string' || !key || key.length > 300) return;
    state.cursors[key] = Math.min(Math.max(Math.trunc(Number(page)) || 1, 1), 1000);
    const keys = Object.keys(state.cursors);
    if (keys.length > 2000) delete state.cursors[keys[0]];
    commit();
  }

  function savedCount(kind) {
    return Object.keys(state.saved[kind] || {}).length;
  }

  /* ---------------- status ---------------- */

  async function status() {
    const cfg = readConfig(settings());
    const minute = Math.floor(now().getTime() / 60_000);
    const budget = budgetSnapshot();
    const freeZone = {
      usedToday: state.freeDay === today() ? state.freeDayCount : 0,
      limitToday: cfg.freePerDay,
      usedThisMinute: state.freeMinute === minute ? state.freeMinuteCount : 0,
      limitMinute: cfg.freePerMinute,
    };
    const base = {
      configured: !!apiKey(),
      paidEnabled: cfg.lifetimeCreditBudget > 0,
      budget,
      creditsUsedThisMonth: budget.usedThisMonth,
      balanceFloor: cfg.balanceFloor,
      pageSize: cfg.pageSize,
      freeZone,
      countries: String(settings().explee.defaultCountries || '').split(',').map((c) => c.trim()).filter(Boolean),
      saved: { people: savedCount('people'), companies: savedCount('companies') },
      docs: 'https://api.explee.com/public/api/docs',
    };
    if (!base.configured) return { ...base, plan: null, balance: null };
    try {
      const [who, bal] = await Promise.all([request('/me'), balance({ fresh: true })]);
      return { ...base, plan: who?.plan ?? null, balance: number(bal?.remain, null), organization: who?.organization?.name ?? null };
    } catch (e) {
      return { ...base, plan: null, balance: null, warning: e.message };
    }
  }

  return {
    request,
    balance,
    status,
    searchCompanies,
    searchPeople,
    nlToFilters,
    enrichEmail,
    enrichPhone,
    createPeopleDedupList,
    createCompaniesDedupList,
    listDedupLists,
    hasSeen,
    remember,
    getCursor,
    setCursor,
    savedCount,
    pageSize,
    config: () => readConfig(settings()),
    budget: () => budgetSnapshot(),
    state: () => structuredClone(state),
  };
}

export const explee = createExpleeClient();
