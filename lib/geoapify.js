import { cleanUrl } from './net.js';
import { normPhone, findEmails, classifySocial } from './scraper.js';

/* Geoapify Places + Place Details (free plan: 3,000 credits/day, no card).
   Docs: https://apidocs.geoapify.com/docs/places/
         https://apidocs.geoapify.com/docs/place-details/
   The docs explicitly allow caching/storing results with no limits.
   Free-plan use requires attribution: © OpenStreetMap contributors and
   "Powered by Geoapify" (shown in the dashboard). The API key stays on the
   server; it is never sent to the browser. */

const GEOCODE_URL = 'https://api.geoapify.com/v1/geocode/search';
const PLACES_URL = 'https://api.geoapify.com/v2/places';
const DETAILS_URL = 'https://api.geoapify.com/v2/place-details';
const TIMEOUT = 25_000;
const UA = 'CodeTechLeadBot/1.0 (https://codetechcl.com)';

/* Geoapify requires a category. These ordered rules turn the words a sales
   person types into the closest categories; the first match wins, so
   "gaming lounge" is an arcade — not a bar. */
const CATEGORY_RULES = [
  [/gaming|game ?(center|centre|lounge)|arcade|playstation|snooker|cyber|internet cafe|e-?sports/, [
    'entertainment.amusement_arcade',
    'commercial.hobby.games',
    'commercial.video_and_music',
  ]],
  [/hotel|lodge|guest ?house|resort|hospitality/, [
    'accommodation.hotel', 'accommodation.guest_house', 'accommodation.hostel', 'accommodation.motel', 'accommodation.apartment',
  ]],
  [/college|university|polytechnic/, ['education.college', 'education.university']],
  [/school|academy|nursery|kindergarten|learning|tutor/, [
    'education.school', 'childcare.kindergarten', 'education.language_school', 'education.music_school', 'office.educational_institution',
  ]],
  [/restaurant|eatery|food|buka/, ['catering.restaurant', 'catering.fast_food', 'catering.food_court']],
  [/cafe|coffee/, ['catering.cafe', 'catering.cafe.coffee_shop', 'catering.cafe.coffee']],
  // Keep this after "gaming" and "internet cafe": "lounge" alone is a bar.
  [/bar|pub|nightclub|club|lounge/, ['catering.bar', 'catering.pub', 'entertainment.culture']],
  [/hospital|clinic|medical|doctor|dental|dentist/, ['healthcare.hospital', 'healthcare.clinic_or_praxis', 'healthcare.dentist']],
  [/pharmacy|chemist/, ['healthcare.pharmacy']],
  [/bank|microfinance|financial|finance/, [
    'service.financial.bank', 'service.financial.money_lender', 'service.financial.money_transfer', 'office.financial',
  ]],
  [/gym|fitness|spa|wellness/, [
    'sport.fitness', 'sport.fitness.gym', 'sport.fitness.fitness_centre', 'leisure.spa', 'activity.sport_club',
  ]],
  [/event|venue|hall|conference|wedding|planner/, [
    'activity.events_venue', 'tourism.sights.conference_centre', 'activity.community_center',
  ]],
  [/church|ministry|mosque|worship/, ['religion.place_of_worship']],
  [/logistics|transport|haulage|courier|delivery/, ['office.logistics', 'service.post.office', 'service.post']],
  [/staffing|recruit|employment/, ['office.employment_agency']],
  [/hr |human resource/, ['office.consulting', 'office.employment_agency', 'office.company']],
  [/coach|mentor/, ['office.consulting', 'office.company', 'sport.fitness', 'sport.fitness.fitness_centre']],
  [/consult|company|firm|office|software|tech|business|\bit\b/, [
    'office', 'office.company', 'office.it', 'office.consulting', 'office.coworking',
  ]],
  [/shop|store|retail|supermarket|mall/, ['commercial.supermarket', 'commercial.convenience', 'commercial.shopping_mall']],
];

/** Geoapify categories for a sales keyword, or null when we have no safe match. */
export function categoriesForQuery(query) {
  const kw = String(query || '').toLowerCase();
  const rule = CATEGORY_RULES.find(([re]) => re.test(kw));
  return rule ? rule[1].slice() : null;
}

/** The free plan allows 5 requests/second; keep a little headroom. */
let nextRequestAt = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(now, nextRequestAt) + 220;
  if (wait) await sleep(wait);
}

async function geoapifyGet(base, params, apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('No Geoapify API key configured (add one in Settings)');

  await throttle();
  const url = new URL(base);
  url.search = new URLSearchParams({ ...params, apiKey: key }).toString();

  let res;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new Error('Geoapify timed out; try a smaller area');
    throw new Error('Could not reach Geoapify');
  }

  const raw = await res.text();
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* plain-text errors happen too */ }
  if (!res.ok) {
    const detail = String(body.message || body.error?.message || body.error || raw.slice(0, 160)).replaceAll(key, '[key]');
    if (res.status === 401 || res.status === 403) throw new Error('Geoapify rejected the API key; check it in Settings');
    if (res.status === 429) throw new Error('Geoapify free-plan rate limit reached; wait a moment or use OpenStreetMap');
    if (res.status === 400 || res.status === 422) throw new Error('Geoapify could not use that request: ' + detail);
    throw new Error(`Geoapify answered HTTP ${res.status}${detail ? ': ' + detail : ''}`);
  }
  return body;
}

async function geocodeLocation(location, apiKey) {
  const text = String(location || '').trim();
  if (!text) throw new Error('Enter a city or area');
  const body = await geoapifyGet(GEOCODE_URL, { text, format: 'json', limit: '1', lang: 'en' }, apiKey);
  const r = body.results?.[0];
  const lon = Number(r?.lon);
  const lat = Number(r?.lat);
  const hasCoords = Number.isFinite(lon) && Number.isFinite(lat);
  if (!r || (!r.place_id && !hasCoords)) throw new Error(`Could not find "${text}" on the map`);
  return {
    placeId: r.place_id || '',
    lon: hasCoords ? lon : null,
    lat: hasCoords ? lat : null,
    name: String(r.formatted || r.address_line1 || text).slice(0, 160),
  };
}

async function placesFor(categories, area, limit, apiKey) {
  const params = {
    categories: categories.join(','),
    limit: String(Math.min(Math.max(limit, 1), 500)),
    lang: 'en',
  };
  if (area.placeId) params.filter = 'place:' + area.placeId;
  else params.filter = `circle:${area.lon},${area.lat},25000`;
  if (Number.isFinite(area.lon) && Number.isFinite(area.lat)) params.bias = `proximity:${area.lon},${area.lat}`;

  const body = await geoapifyGet(PLACES_URL, params, apiKey);
  return Array.isArray(body.features) ? body.features : [];
}

async function detailsFor(id, apiKey) {
  const body = await geoapifyGet(DETAILS_URL, { id, features: 'details', lang: 'en' }, apiKey);
  const feature = Array.isArray(body.features) ? body.features[0] : body;
  return feature?.properties || feature || null;
}

const flatten = (v) => (Array.isArray(v) ? v.flatMap(flatten) : v && typeof v === 'object' ? Object.values(v).flatMap(flatten) : [v]);
const SOCIAL_KEYS = ['facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'youtube', 'telegram', 'whatsapp'];

/** Maps one Place Details properties object to the lead shape used by the app. */
export function detailsToCandidate(p, fallback = null, cc = '234') {
  if (!p || typeof p !== 'object') return null;
  const name = String(p.name || p.address_line1 || fallback?.name || '').trim().slice(0, 200);
  if (!name) return null;

  const phoneParts = [
    p.contact?.phone,
    p.contact?.phone_other,
    p.contact?.phone_international,
    p.phone,
    p.phone_other,
  ].flatMap(flatten);
  const phones = [...new Set(phoneParts
    .filter(Boolean)
    .flatMap((v) => String(v).split(/[;,]/))
    .map((v) => normPhone(v, cc))
    .filter(Boolean))].slice(0, 10);

  const emails = findEmails([p.contact?.email, ...(flatten(p.contact?.email_other))].filter(Boolean).join(' ')).slice(0, 10);

  const socials = {};
  for (const k of SOCIAL_KEYS) {
    for (const raw of flatten([p.contact?.[k], p.contact?.[`${k}_other`], p[k]]).filter(Boolean)) {
      const value = String(raw).trim();
      const url = /^https?:\/\//i.test(value) ? value : `https://${k}.com/${value.replace(/^@/, '')}`;
      const social = classifySocial(url);
      if (social) socials[social.name] = social.url;
    }
  }

  const websites = [p.website, p.website_other, p.brand_details?.website, p.operator_details?.website].flatMap(flatten);
  const website = websites.map((u) => cleanUrl(u)).find(Boolean) || '';

  const address = String(
    p.formatted || [p.address_line1, p.address_line2, p.city, p.state, p.country].filter(Boolean).join(', ') || fallback?.formatted || '',
  ).trim().slice(0, 300);

  return {
    name,
    website,
    emails,
    phones,
    socials,
    address,
    description: String(p.description || p.details?.description || '').trim().slice(0, 1000),
    source: 'geoapify',
  };
}

async function mapLimit(items, n, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift());
    }),
  );
}

/**
 * Search Geoapify for places, then read each place's public contact details.
 * Returns candidates plus an estimate of the credits used (free plan: 3,000/day).
 */
export async function geoapifySearch({ query, location, limit = 20, apiKey, cc = '234', onProgress = () => {} }) {
  const categories = categoriesForQuery(query);
  if (!categories) {
    throw new Error('Geoapify has no category for that business type yet; use OpenStreetMap, web search, or paste a list of websites');
  }

  const area = await geocodeLocation(location, apiKey);
  const want = Math.min(Math.max(Math.trunc(limit) || 20, 1), 60);
  const features = await placesFor(categories, area, Math.min(want * 2, 100), apiKey);
  const byId = new Map(features.map((f) => [f?.properties?.place_id, f?.properties]).filter(([id]) => id));
  const ids = [...byId.keys()].slice(0, want * 2);

  let credits = 1 + Math.max(1, Math.ceil(features.length / 20));
  let failed = 0;
  let done = 0;
  const candidates = [];

  await mapLimit(ids, 3, async (id) => {
    try {
      const p = await detailsFor(id, apiKey);
      credits++;
      const c = detailsToCandidate(p, byId.get(id), cc);
      if (c) candidates.push(c);
    } catch {
      failed++;
    }
    done++;
    if (done % 5 === 0) onProgress(`Geoapify: read ${done}/${ids.length} places…`);
  });

  return { candidates, credits, failed, area: area.name };
}

/** Test a key with one small Geocoding API request (1 credit on the free plan). */
export async function geoapifyTest(apiKey) {
  const area = await geocodeLocation('Lagos, Nigeria', apiKey);
  return { sample: area.name, credits: 1 };
}
