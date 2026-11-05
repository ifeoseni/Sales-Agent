/**
 * Turns Explee search results into CRM leads, without ever returning the same
 * person or company twice.
 *
 * Deduplication is local on purpose. Explee's `exclude_lists` parameter disables
 * the free-results zone, which would turn every search into paid usage. Instead
 * we check three places:
 *   1. the CRM itself (domains, emails, LinkedIn URLs, name+company),
 *   2. the current result batch (two titles matching the same person),
 *   3. a persisted "already saved" memory inside the Explee client, which keeps
 *      working even after a lead is deleted from the CRM.
 */
import * as L from './leads.js';

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function normDomain(value) {
  const raw = text(value, 300).toLowerCase();
  if (!raw) return '';
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return '';
  }
}

export function normLinkedin(value) {
  const raw = text(value, 300).toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
  const m = raw.match(/linkedin\.com\/(in|company)\/([^/]+)/);
  return m ? `linkedin.com/${m[1]}/${m[2]}` : '';
}

const normName = (value) => String(value ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const normEmail = (value) => {
  const e = text(value, 200).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : '';
};

/** Every stable handle a person record can be recognised by. */
export function personKeys(person = {}) {
  const keys = [];
  const li = normLinkedin(person.linkedin_url);
  if (li) keys.push(`li:${li}`);
  const email = normEmail(person.email || person.work_email);
  if (email) keys.push(`em:${email}`);
  const name = normName(`${person.first_name || ''} ${person.last_name || ''}`);
  const domain = normDomain(person.company_domain || person.company_url);
  if (name && domain) keys.push(`nm:${name}@${domain}`);
  return keys;
}

export function companyKeys(company = {}) {
  const domain = normDomain(company.domain || company.company_domain || company.company_url || company.website);
  return domain ? [`dm:${domain}`] : [];
}

/** An index of everything already in the CRM. */
export function buildDedupeIndex(leads = []) {
  const index = new Set();
  for (const lead of leads) {
    if (!lead || typeof lead !== 'object') continue;
    const domain = normDomain(lead.website);
    if (domain) index.add(`dm:${domain}`);
    for (const email of lead.emails || []) {
      const e = normEmail(email);
      if (e) index.add(`em:${e}`);
    }
    const li = normLinkedin(lead.socials?.linkedin);
    if (li) index.add(`li:${li}`);
    const name = normName(lead.name);
    // Person leads keep their employer in companyDomain (website stays blank).
    const orgDomain = domain || normDomain(lead.companyDomain);
    if (name && orgDomain) index.add(`nm:${name}@${orgDomain}`);
  }
  return index;
}

const regionNames = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; }
})();

const country = (value) => {
  const code = text(value, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  try { return regionNames?.of(code) || code; } catch { return code; }
};

const place = (value) => {
  if (!value) return '';
  if (typeof value === 'string') {
    const s = text(value, 150);
    return /^[A-Za-z]{2}$/.test(s) ? country(s) : s;
  }
  if (typeof value === 'object') {
    return text([
      text(value.city, 80),
      text(value.subdivision, 80),
      country(value.country),
    ].filter(Boolean).join(', '), 150);
  }
  return '';
};

const companyPlace = (company = {}) => text([
  text(company.company_city, 80),
  country(company.company_geo),
].filter(Boolean).join(', '), 150);

const listText = (value) => (Array.isArray(value) ? value.filter(Boolean).join(', ') : text(value, 200));

/** A person becomes a lead with a blank website on purpose: addLead() merges on
 *  website domain, which would collapse every colleague into one company lead. */
export function personToLead(person = {}, { product = '', tags = [] } = {}) {
  const name = text([person.first_name, person.last_name].filter(Boolean).join(' '), 200) || text(person.title, 200) || 'Unknown';
  const domain = normDomain(person.company_domain || person.company_url);
  const notes = [
    person.title ? `Title: ${text(person.title, 120)}` : '',
    person.company_name ? `Company: ${text(person.company_name, 120)}${domain ? ` (${domain})` : ''}` : '',
    person.company_industry ? `Industry: ${text(person.company_industry, 120)}` : '',
    person.company_size ? `Company size: ${text(person.company_size, 60)}` : '',
    person.headline ? `Headline: ${text(person.headline, 200)}` : '',
    person.linkedin_url ? `LinkedIn: ${cleanLink(person.linkedin_url)}` : '',
    person.company_emails ? `Company inbox: ${listText(person.company_emails)}` : '',
    'Source: Explee people search (no personal email; enrich only on purpose).',
  ].filter(Boolean);
  return {
    name,
    website: '',
    companyDomain: domain,
    jobTitle: text(person.title, 120),
    industry: text(person.company_industry, 100),
    location: place(person.geo) || companyPlace(person),
    description: text(person.headline || person.summary, 600),
    socials: { linkedin: cleanLink(person.linkedin_url) },
    sourceUrl: cleanLink(person.linkedin_url),
    source: 'explee-people',
    tags: ['explee', 'people', ...tags],
    notes: notes.join('\n').slice(0, 5000),
    product,
  };
}

const firstUrl = (v) => (Array.isArray(v) ? v.map(cleanLink).find(Boolean) : cleanLink(v)) || '';

/** Company search rows use bare names (name, url, emails, phones, ...); the
 *  `company_*` spellings are kept as fallbacks for older/people-shaped rows. */
export function companyToLead(company = {}, { product = '', tags = [] } = {}) {
  const domain = normDomain(company.domain || company.company_domain || company.url || company.company_url);
  const name = text(company.name || company.company_name, 200) || domain || 'Unknown';
  const emails = [...new Set((Array.isArray(company.emails) ? company.emails : []).map(normEmail).filter(Boolean))].slice(0, 5);
  const phones = [...new Set((Array.isArray(company.phones) ? company.phones : []).map((p) => text(p, 30)).filter(Boolean))].slice(0, 5);
  const size = company.size ?? company.company_size;
  const industry = company.industry || company.company_industry;
  const founded = company.founded || company.company_founded;
  const revenue = company.revenue_annual || company.company_revenue_annual;
  const social = (arr) => firstUrl(arr);
  const socials = {
    linkedin: cleanLink(company.company_linkedin_url),
    facebook: social(company.social_facebook_urls),
    instagram: social(company.social_instagram_urls),
    twitter: social(company.social_x_urls),
    youtube: social(company.social_youtube_urls),
    tiktok: social(company.social_tiktok_urls),
  };
  for (const k of Object.keys(socials)) if (!socials[k]) delete socials[k];
  const notes = [
    domain ? `Domain: ${domain}` : '',
    size ? `Employees: ${text(size, 60)}` : '',
    industry ? `Industry: ${text(industry, 120)}` : '',
    founded ? `Founded: ${text(founded, 20)}` : '',
    revenue ? `Revenue (USD/yr): ${text(revenue, 60)}` : '',
    emails.length || phones.length ? 'Contacts came with the Explee result (free).' : 'No email/phone in Explee result — the contact agent will look for them.',
    'Source: Explee company search.',
  ].filter(Boolean);
  return {
    name,
    website: cleanLink(company.url || company.company_url) || (domain ? cleanLink(`https://${domain}`) : ''),
    companyDomain: domain,
    jobTitle: '',
    industry: text(industry, 100),
    location: place(company.geo_city ? { city: company.geo_city, subdivision: '', country: company.geo } : company.geo) || companyPlace(company),
    description: text(company.description || company.company_description, 600),
    emails,
    phones,
    socials,
    sourceUrl: cleanLink(company.company_linkedin_url) || cleanLink(company.url || company.company_url),
    source: 'explee-companies',
    tags: ['explee', 'companies', ...tags],
    notes: notes.join('\n').slice(0, 5000),
    product,
  };
}

function cleanLink(value) {
  const raw = text(value, 300);
  if (!raw) return '';
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

const titlesOf = (value) => (Array.isArray(value) ? value : String(value ?? '').split(','))
  .map((t) => text(t, 80))
  .filter(Boolean)
  .slice(0, 20);

/** Accepts "NG, GH", ["NG","GH"] or nothing (worldwide). */
const countriesOf = (value) => (Array.isArray(value) ? value : String(value ?? '').split(/[,\s]+/))
  .map((c) => text(c, 2).toUpperCase())
  .filter((c) => /^[A-Z]{2}$/.test(c))
  .slice(0, 20);

const cursorKey = (kind, parts) => [kind, ...parts.map((p) => String(p ?? '').toLowerCase().trim())].join('|').slice(0, 280);

/**
 * Live-tested 2026-11-05: only the FIRST 10 results of a query are free. Page 2
 * charged 0.5 credit per company. So we never page; we slice instead. Each
 * filter slice below is its own query whose page 1 is free, giving up to
 * SLICES.length x 10 free results per definition. Slices overlap a little, which
 * the local dedupe absorbs.
 */
const SIZES = [[1, 10], [11, 50], [51, 200], [201, 1000], [1001, 1000000]];
const ERAS = [[1900, 2009], [2010, 2017], [2018, 2021], [2022, 2030]];
export const SLICES = [
  {},
  ...SIZES.map(([min, max]) => ({ size: { min, max } })),
  ...SIZES.flatMap(([min, max]) => ERAS.map(([fmin, fmax]) => ({ size: { min, max }, founded: { min: fmin, max: fmax } }))),
];

/**
 * Walk filter slices (page 1 only, always free), resuming at the slice after the
 * last saved one. Partial results survive a mid-run error; a charge on a
 * supposedly free request stops the run.
 */
async function discover(client, { kind, fetchSlice, rowsOf, keysOf, toLead, key, limit, maxPages, size, existing, product, tags }) {
  const wanted = Math.min(Math.max(Math.trunc(Number(limit) || 20), 1), 100);
  const requests = Math.min(Math.max(Math.trunc(Number(maxPages) || 3), 1), 10);
  const index = buildDedupeIndex(existing);
  const batch = new Set();
  const items = [];
  const stats = { kind, pages: 0, fetched: 0, duplicates: 0, skipped: 0, new: 0, startSlice: 0, warning: '', exhausted: false };
  const start = ((Math.trunc(Number(client.getCursor?.(key)) || 1) - 1) % SLICES.length + SLICES.length) % SLICES.length;
  stats.startSlice = start;
  let used = 0;

  for (let k = 0; k < Math.min(requests, SLICES.length); k += 1) {
    const slice = (start + k) % SLICES.length;
    let res;
    try {
      res = await fetchSlice(SLICES[slice]);
    } catch (e) {
      if (!stats.pages) throw e;
      stats.warning = e.message;
      break;
    }
    used = k + 1;
    const rows = rowsOf(res);
    stats.pages += 1;
    stats.fetched += rows.length;

    if (Number(res?.meta?.credits_charged) > 0) {
      stats.warning = 'Explee charged ' + res.meta.credits_charged + ' credits for a request expected to be free. Searching stopped; check your plan free zone.';
      break;
    }
    if (!rows.length && slice === 0) break; // nothing matches at all: do not burn more free requests
    for (const row of rows) {
      const keys = keysOf(row);
      if (!keys.length) { stats.skipped += 1; continue; }
      if (keys.some((x) => index.has(x) || batch.has(x) || client.hasSeen(kind, [x]))) {
        stats.duplicates += 1;
        continue;
      }
      keys.forEach((x) => batch.add(x));
      items.push({ kind, keys, lead: toLead(row, { product, tags }) });
      if (items.length >= wanted) break;
    }
    if (items.length >= wanted) break;
  }

  const nextSlice = (start + Math.max(used, 1)) % SLICES.length;
  stats.exhausted = start + used >= SLICES.length;
  stats.new = items.length;
  stats.nextPage = nextSlice + 1;
  return { kind, items, stats, cursor: { key, page: nextSlice + 1 } };
}

/** Search people in free 10-result pages; returns only contacts not already known. */
export function discoverPeople(client, {
  jobTitles = [], companyDefinition = '', countries = [], limit = 20, maxPages = 5,
  pageSize, minRelevance, product = '', tags = [], existing = [],
} = {}) {
  const titles = titlesOf(jobTitles);
  const places = countriesOf(countries);
  const size = client.pageSize(pageSize);
  return discover(client, {
    kind: 'people', limit, maxPages, size, existing, product, tags,
    key: cursorKey('people', [companyDefinition, titles.slice().sort().join(','), places.join(','), minRelevance]),
    fetchSlice: (slice) => client.searchPeople({ jobTitles: titles, companyDefinition, companyFilters: slice, geo: places, minRelevance, page: 1, pageSize: size }),
    rowsOf: (res) => (Array.isArray(res?.people) ? res.people : []),
    keysOf: personKeys,
    toLead: personToLead,
  });
}

export function discoverCompanies(client, {
  definition = '', countries = [], limit = 20, maxPages = 5,
  pageSize, minRelevance, product = '', tags = [], existing = [],
} = {}) {
  const places = countriesOf(countries);
  const size = client.pageSize(pageSize);
  return discover(client, {
    kind: 'companies', limit, maxPages, size, existing, product, tags,
    key: cursorKey('companies', [definition, places.join(','), minRelevance]),
    fetchSlice: (slice) => client.searchCompanies({ definition, filters: { ...(places.length ? { geo_include: places } : {}), ...slice }, minRelevance, page: 1, pageSize: size }),
    rowsOf: (res) => (Array.isArray(res?.companies) ? res.companies : []),
    keysOf: companyKeys,
    toLead: companyToLead,
  });
}

/**
 * Save discovered contacts to the CRM. addLead() re-checks for duplicates, and
 * every accepted key is remembered so a later search never offers it again.
 */
export function saveDiscovered(client, items, { product = '', cursor } = {}) {
  let created = 0;
  let duplicates = 0;
  const leads = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.lead?.name) { duplicates += 1; continue; }
    const result = L.addLead({ ...item.lead, product: product || item.lead.product });
    if (result.created) {
      created += 1;
      leads.push(result.lead);
      if (item.keys?.length) client.remember(item.kind, item.keys);
    } else {
      duplicates += 1;
    }
  }
  // Only a saved search advances the cursor, so a discarded preview loses nothing.
  if (cursor?.key && Number(cursor.page) >= 1) client.setCursor?.(cursor.key, cursor.page);
  return { created, duplicates, leads };
}
