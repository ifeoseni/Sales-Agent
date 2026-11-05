import { UA, scrapeSite, classifySocial, normPhone, findEmails, findPhones } from './scraper.js';
import { addLead, findDuplicate, listLeads, mergeContacts, getLead, updateLead, addActivity } from './leads.js';
import { getSettings } from './settings.js';
import { cleanUrl, assertPublicUrl } from './net.js';
import { geoapifySearch } from './geoapify.js';

/* ---------- web search (no API key) ---------- */
const SKIP_DOMAINS = /(^|\.)(wikipedia|youtube|google|bing|duckduckgo|pinterest|reddit|quora|medium|glassdoor|indeed|jobberman|tripadvisor|booking|expedia|alamy|shutterstock|amazon|jumia|konga|olx|yelp|crunchbase|zoominfo|pdf|nairaland|punchng|vanguardngr|legit|thecable|premiumtimesng|businessday|blogspot|wordpress|wikihow|scribd|slideshare|issuu|github|apple|microsoft|findglocal|africabz|cybo|worldorgs|ranked)\./i;
// Blog posts, "Top 10 …" lists and category pages are not businesses.
const LISTICLE_TITLE = /\b(top|best)\s+\d+\b|\b\d+\s+(best|top)\b|\blist of\b|\bdirectory\b/i;
const ARTICLE_PATH = /\/(blog|news|article|articles|post|posts|category|tag|tags|wiki|directory|listing|listings|list|search)(\/|$)|\/20\d\d\//i;
const DIRECTORY = /(^|\.)(businesslist|yellowpages|nigeriagalleria|ngcareers|vconnect|cylex|yellow|finelib|mapquest|foursquare|tupalo|brabys|hotfrog|goafricaonline|ngex|africalistings|lagosarenaguide|hotels\.ng|nicelocal|infoisinfo|entrepreneurs\.ng|infogis|top-rated\.online)\./i;

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

// Search engines guess your country from the server's IP; pin it to the market being searched.
const REGIONS = {
  234: { ddg: 'ng-en', iso: 'NG', tld: '.ng' },
  233: { ddg: 'gh-en', iso: 'GH', tld: '.gh' },
  254: { ddg: 'ke-en', iso: 'KE', tld: '.ke' },
  27: { ddg: 'za-en', iso: 'ZA', tld: '.za' },
  44: { ddg: 'uk-en', iso: 'GB', tld: '.uk' },
  1: { ddg: 'us-en', iso: 'US', tld: '' },
};

/** Thrown when a search engine refuses automated queries, so the UI can say so instead of showing "0 results". */
class SearchBlocked extends Error {}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BROWSER_HEADERS = {
  'user-agent': BROWSER_UA,
  'content-type': 'application/x-www-form-urlencoded',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'max-age=0',
  'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

/** DuckDuckGo Lite search: lightweight, fast, rarely throttled by rate limits. */
async function ddgLiteSearch(q, region) {
  try {
    const r = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'origin': 'https://lite.duckduckgo.com',
        'referer': 'https://lite.duckduckgo.com/',
      },
      body: new URLSearchParams({ q, ...(region ? { kl: region.ddg } : {}) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return [];
    const html = await r.text();
    const linkMatches = [...html.matchAll(/<a\b[^>]*href=['"]([^'"]+)['"][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>|<a\b[^>]*class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi)];
    const snippetMatches = [...html.matchAll(/<td\b[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi)];
    const out = [];
    for (let i = 0; i < linkMatches.length; i++) {
      let href = linkMatches[i][1] || linkMatches[i][3];
      const uddg = href ? href.match(/[?&]uddg=([^&]+)/) : null;
      if (uddg) href = decodeURIComponent(uddg[1]);
      const title = strip(linkMatches[i][2] || linkMatches[i][4] || '');
      const snippet = snippetMatches[i] ? strip(snippetMatches[i][1]) : '';
      if (href && !href.includes('duckduckgo.com/')) {
        out.push({ url: href, title, snippet });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function ddgSearch(q, region) {
  const r = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      ...BROWSER_HEADERS,
      'origin': 'https://html.duckduckgo.com',
      'referer': 'https://html.duckduckgo.com/',
    },
    body: new URLSearchParams({ q, ...(region ? { kl: region.ddg } : {}) }),
    signal: AbortSignal.timeout(15000),
  });
  const html = await r.text();
  const out = [];
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => strip(m[1]));
  let i = 0;
  for (const m of html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    let href = m[1].replace(/&amp;/g, '&');
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith('//')) href = 'https:' + href;
    out.push({ url: href, title: strip(m[2]), snippet: snippets[i++] || '' });
  }
  if (!out.length && (r.status === 202 || /anomaly|unusual traffic|captcha/i.test(html))) throw new SearchBlocked('DuckDuckGo');
  return out;
}

/** Your own SearXNG instance (free, self-hosted metasearch). Needs `formats: [html, json]` enabled in its settings. */
async function searxSearch(base, q, region) {
  const u = new URL('/search', base);
  u.search = new URLSearchParams({ q, format: 'json', language: region ? region.ddg : 'en', safesearch: '0' }).toString();
  const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`SearXNG answered HTTP ${r.status} (is the json format enabled?)`);
  const j = await r.json();
  return (j.results || []).filter((x) => x.url).map((x) => ({ url: x.url, title: strip(x.title || ''), snippet: strip(x.content || '') }));
}

/**
 * Multi-layer web search: SearXNG -> DuckDuckGo Lite -> DuckDuckGo HTML.
 * Highly resilient against bot detection and rate limits.
 */
export async function webSearch(q, cc, searxUrl = getSettings().search.searxngUrl) {
  const region = REGIONS[cc];
  const problems = [];
  if (searxUrl) {
    try {
      const r = await searxSearch(searxUrl, q, region);
      if (r.length) return r;
    } catch (e) { problems.push('SearXNG: ' + e.message); }
  }
  try {
    const lite = await ddgLiteSearch(q, region);
    if (lite.length) return lite;
  } catch (e) {
    problems.push('DuckDuckGo Lite: ' + e.message);
  }
  try {
    return await ddgSearch(q, region);
  } catch (e) {
    problems.push(e instanceof SearchBlocked ? 'DuckDuckGo is limiting automated searches right now' : 'DuckDuckGo: ' + e.message);
  }
  throw new Error(problems.join('; '));
}

/* ---------- relevance: keep only businesses about the right thing, in the right place ---------- */
const STOP = new Set(['the', 'and', 'for', 'near', 'best', 'top', 'company', 'companies', 'service', 'services', 'ltd', 'limited', 'with', 'around']);
const tokens = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
const stem = (t) => { const s = t.replace(/(ing|ers|er|es|s|ed)$/, ''); return s.length >= 3 ? s : t; };

export function isRelevant(c, query, location, cc) {
  const hay = [c.name, c.description, c.snippet, c.website].join(' ').toLowerCase();
  const q = tokens(query);
  const topic = !q.length || q.some((t) => hay.includes(stem(t)));
  const loc = tokens(location.split(',').slice(0, 2).join(' '));
  const host = c.website ? new URL(c.website).hostname : '';
  const tld = REGIONS[cc]?.tld;
  const place = !loc.length || loc.some((t) => hay.includes(t)) || (c.phones || []).some((p) => p.startsWith('+' + cc)) || (tld && host.endsWith(tld));
  return topic && place;
}

/* ---------- OpenStreetMap ---------- */
const OSM_HEADERS = { 'user-agent': 'CodeTechLeadBot/1.0 (https://codetechcl.com)', accept: '*/*' }; // Overpass rejects browser-style UAs
// The main Overpass instance is often busy; try mirrors before giving up.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const OSM_TAGS = [
  [/hotel|lodge|guest ?house|resort|hospitality/, ['tourism=hotel', 'tourism=guest_house', 'tourism=hostel']],
  [/school|academy|nursery|kindergarten/, ['amenity=school', 'amenity=kindergarten']],
  [/college|university|polytechnic/, ['amenity=college', 'amenity=university']],
  [/restaurant|eatery|food/, ['amenity=restaurant', 'amenity=fast_food']],
  [/cafe|coffee/, ['amenity=cafe']],
  [/game|gaming|arcade|playstation|snooker|entertainment|cyber/, ['leisure=amusement_arcade', 'leisure=adult_gaming_centre', 'amenity=internet_cafe', 'shop=video_games', 'leisure=sports_centre']],
  // Keep this after "gaming" so "gaming lounge" is not searched as a bar.
  [/bar|lounge|club|nightclub/, ['amenity=bar', 'amenity=nightclub', 'amenity=pub']],
  [/hospital|clinic|medical/, ['amenity=hospital', 'amenity=clinic', 'amenity=doctors']],
  [/pharmacy/, ['amenity=pharmacy']],
  [/bank|microfinance/, ['amenity=bank']],
  [/gym|fitness/, ['leisure=fitness_centre']],
  [/event|venue|hall|conference|wedding/, ['amenity=events_venue', 'amenity=conference_centre', 'amenity=community_centre']],
  [/church|ministry|mosque/, ['amenity=place_of_worship']],
  [/logistics|transport|haulage|courier/, ['office=logistics', 'office=courier', 'amenity=post_office']],
  [/staffing|recruit|employment/, ['office=employment_agency']],
  [/hr |human resource/, ['office=consulting', 'office=employment_agency', 'office=company']],
  [/consult|company|firm|office|software|tech|business/, ['office=company', 'office=it', 'office=consulting', 'office=coworking']],
  [/shop|store|retail|supermarket|mall/, ['shop=supermarket', 'shop=convenience', 'shop=mall']],
];
const CONTACT_FILTER = '[~"^(phone|contact:phone|website|contact:website|email|contact:email)$"~"."]';

async function geocode(location) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(location)}`, {
    headers: OSM_HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (!j[0]) throw new Error(`Could not find "${location}" on the map`);
  const [s, n, w, e] = j[0].boundingbox.map(Number);
  return { bbox: `${s},${w},${n},${e}`, name: j[0].display_name };
}

export async function osmSearch(keyword, location, limit = 60) {
  const { bbox } = await geocode(location);
  const kw = keyword.toLowerCase();
  const tags = OSM_TAGS.filter(([re]) => re.test(kw)).flatMap(([, t]) => t);
  const parts = tags.length
    ? tags.map((t) => { const [k, v] = t.split('='); return `nwr["${k}"="${v}"]["name"]${CONTACT_FILTER}(${bbox});`; })
    : [`nwr["name"~"${kw.replace(/["\\]/g, '')}",i]${CONTACT_FILTER}(${bbox});`];
  const q = `[out:json][timeout:40];(${parts.join('')});out center tags ${limit};`;
  let body = null;
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { ...OSM_HEADERS, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: q }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!r.ok) { lastError = new Error(`OpenStreetMap busy (HTTP ${r.status})`); continue; }
      body = await r.json();
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!body) {
    const reason = /HTTP \d+/.test(lastError?.message || '') ? lastError.message : 'all public map servers are busy';
    throw new Error(`${reason}; try again in a minute or narrow the area`);
  }
  const cc = getSettings().lead.defaultCountryCode;
  return (body.elements || []).map((el) => {
    const t = el.tags || {};
    const phones = [t.phone, t['contact:phone'], t['contact:mobile'], t.mobile]
      .filter(Boolean)
      .flatMap((p) => p.split(/[;,]/))
      .map((p) => normPhone(p, cc))
      .filter(Boolean);
    const socials = {};
    for (const k of ['facebook', 'instagram', 'twitter', 'linkedin', 'tiktok', 'youtube', 'telegram']) {
      const v = t[`contact:${k}`] || t[k];
      if (!v) continue;
      const c = classifySocial(/^https?:/i.test(v) ? v : `https://${k}.com/${v.replace(/^@/, '')}`);
      if (c) socials[c.name] = c.url;
    }
    const website = cleanUrl(t.website || t['contact:website'] || '');
    return {
      name: t.name,
      website,
      emails: findEmails([t.email, t['contact:email']].filter(Boolean).join(' ')),
      phones: [...new Set(phones)],
      socials,
      address: [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(' '),
      source: 'openstreetmap',
    };
  });
}

/* ---------- orchestration ---------- */
async function pool(items, n, fn, ctl) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length && !ctl?.cancelled) await fn(queue.shift());
    }),
  );
}

/** "Welcome to Acme | Best hotel in Lagos" -> "Acme" */
const cleanName = (t) =>
  String(t || '')
    .replace(/^(welcome to|home)\s*[-|:]?\s*/i, '')
    .split(/\s[|\-–—:•·]\s/)[0]
    .trim()
    .slice(0, 80);

function candidateFromSearch(r) {
  let u;
  try { u = new URL(r.url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (SKIP_DOMAINS.test(host + '.') || DIRECTORY.test(host + '.')) return null;
  const soc = classifySocial(r.url);
  if (!soc && (LISTICLE_TITLE.test(r.title) || ARTICLE_PATH.test(u.pathname))) return null;
  const name = cleanName(r.title) || host;
  if (soc) return { name, website: '', socials: { [soc.name]: soc.url }, description: r.snippet, source: 'web-search' };
  return { name, website: u.origin, description: r.snippet, snippet: r.snippet, socials: {}, source: 'web-search' };
}

/**
 * Finds businesses matching `query` in `location`, reads their public contact
 * details and saves them as leads. Reports progress via onProgress(text).
 */
export async function findLeads({ query, location, sources = ['web', 'osm'], limit = 20, product = '' }, onProgress = () => {}, ctl = {}) {
  const s = getSettings();
  const cc = s.lead.defaultCountryCode;
  const found = [];
  const warnings = [];

  if (sources.includes('osm')) {
    onProgress('Searching OpenStreetMap listings…');
    try {
      const r = await osmSearch(query, location, limit * 3);
      found.push(...r);
      onProgress(`OpenStreetMap: ${r.length} listings found`);
      if (!r.length) warnings.push('OpenStreetMap has little data for this business type or area. Web search covers more, so keep it ticked.');
    } catch (e) { warnings.push('OpenStreetMap: ' + e.message); }
  }

  if (sources.includes('geoapify')) {
    if (!s.geoapify.apiKey) {
      warnings.push('Geoapify: no API key saved. Add one in Settings, or untick Geoapify.');
    } else {
      onProgress('Searching Geoapify places…');
      try {
        const r = await geoapifySearch({ query, location, limit, apiKey: s.geoapify.apiKey, cc, onProgress });
        found.push(...r.candidates);
        onProgress(`Geoapify: ${r.candidates.length} places found (about ${r.credits} free-plan credits)`);
        if (!r.candidates.length) warnings.push('Geoapify found no matching places for this wording and area. Try broader words, or use OpenStreetMap and web search.');
        if (r.failed) warnings.push(`Geoapify: ${r.failed} place detail request(s) failed; other results were kept.`);
      } catch (e) { warnings.push('Geoapify: ' + e.message); }
    }
  }

  if (sources.includes('web')) {
    onProgress('Searching the web…');
    const queries = [`${query} in ${location}`, `${query} ${location} contact phone email`, `${query} ${location} official website`];
    let n = 0;
    let failure = '';
    for (const q of queries) {
      if (ctl.cancelled) break;
      try {
        const r = await webSearch(q, cc);
        for (const x of r) { const c = candidateFromSearch(x); if (c) { found.push(c); n++; } }
      } catch (e) {
        failure = e.message;
        break; // blocked: stop hammering the engine
      }
      await new Promise((r) => setTimeout(r, 1200)); // be polite between queries
    }
    if (failure) {
      warnings.push(`Web search was blocked: ${failure}. These free engines throttle automated searches (usually for 10 to 60 minutes). Meanwhile use OpenStreetMap, paste a list of websites below, or connect your own SearXNG in Settings.`);
    } else if (!n) {
      warnings.push('Web search found no usable businesses for this wording. Try different words or a nearby area.');
    }
    onProgress(`Web search: ${n} candidate businesses`);
  }

  // De-duplicate within this batch and against saved leads.
  const seen = [];
  const fresh = [];
  let alreadySaved = 0;
  for (const c of found) {
    if (!c.name) continue;
    c.website = cleanUrl(c.website);
    const key = c.website ? new URL(c.website).hostname.replace(/^www\./, '') : c.name.toLowerCase();
    if (seen.includes(key) || findDuplicate(c)) { alreadySaved++; continue; }
    seen.push(key);
    fresh.push({ ...c, industry: query, location, product });
  }
  const batch = fresh.slice(0, limit * 2);
  onProgress(`Reading ${batch.length} listings for contact details…`);

  const added = [];
  let done = 0;
  let irrelevant = 0;
  let noDetails = 0;
  let duplicates = 0;
  await pool(batch, 4, async (c) => {
    if (c.website) {
      const site = await scrapeSite(c.website, { cc }).catch(() => null);
      if (site) {
        c.emails = [...new Set([...(c.emails || []), ...site.emails])];
        c.phones = [...new Set([...(c.phones || []), ...site.phones])];
        c.socials = { ...site.socials, ...(c.socials || {}) };
        if (site.description) c.description = site.description;
        if (site.title && c.source === 'web-search') c.name = cleanName(site.title) || c.name;
      }
    }
    done++;
    if (done % 3 === 0) onProgress(`Read ${done}/${batch.length} listings…`);

    let direct = (c.emails?.length || 0) + (c.phones?.length || 0) + Object.keys(c.socials || {}).length;
    const isMapListing = c.source === 'geoapify' || c.source === 'openstreetmap';

    // If it's a map listing with NO direct contact details and NO website, run a fast online lookup
    // to discover phone numbers, Instagram, and website right during discovery!
    if (isMapListing && !direct && !c.website && !ctl.cancelled) {
      try {
        const lookupQuery = `"${c.name}" ${location || c.location || ''} phone contact`;
        const res = await ddgLiteSearch(lookupQuery, REGIONS[cc]);
        for (const r of res.slice(0, 5)) {
          const text = `${r.title} ${r.snippet} ${r.url}`;
          findPhones(text, cc).forEach((p) => { c.phones = c.phones || []; if (!c.phones.includes(p)) c.phones.push(p); });
          findEmails(text).forEach((e) => { c.emails = c.emails || []; if (!c.emails.includes(e)) c.emails.push(e); });
          const soc = classifySocial(r.url);
          if (soc) { c.socials = c.socials || {}; if (!c.socials[soc.name]) c.socials[soc.name] = soc.url; }
          if (!c.website) {
            try {
              const u = new URL(r.url);
              if (!SKIP_DOMAINS.test(u.hostname) && !DIRECTORY.test(u.hostname) && !soc) c.website = r.url;
            } catch {}
          }
          if (!c.website) {
            for (const m of text.matchAll(/\b(?:https?:\/\/|www\.)[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>'",;)]*)?/gi)) {
              let uStr = m[0];
              if (uStr.startsWith('www.')) uStr = 'https://' + uStr;
              try {
                const u = new URL(uStr);
                if (!SKIP_DOMAINS.test(u.hostname) && !DIRECTORY.test(u.hostname) && !classifySocial(uStr)) {
                  c.website = uStr;
                  break;
                }
              } catch {}
            }
          }
        }
        if (!c.website && c.socials) {
          c.website = c.socials.instagram || c.socials.facebook || c.socials.linkedin || '';
        }
        if (!c.sourceUrl) {
          c.sourceUrl = c.address
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.name + ' ' + c.address)}`
            : `https://www.google.com/search?q=${encodeURIComponent(c.name + ' ' + (c.location || location || ''))}`;
        }
        direct = (c.emails?.length || 0) + (c.phones?.length || 0) + Object.keys(c.socials || {}).length;
      } catch {}
    }

    // A map place with a name and a website/address is still a useful lead: many
    // businesses publish a phone or email only on their own contact form. Web
    // results stay strict because they are much noisier.
    const usable = isMapListing ? !!(c.website || c.address || direct) : direct > 0;

    // Map listings are already inside the searched area; web results must prove they fit.
    const fits = c.source !== 'web-search' || isRelevant(c, query, location, cc);
    if (!fits) { irrelevant++; return; }
    if (!usable) { noDetails++; return; }
    if (added.length >= limit) return;
    if (!direct) c.tags = [...new Set([...(c.tags || []), 'needs contact'])];
    const { lead, created } = addLead(c);
    if (created) added.push(lead); else duplicates++;
  }, ctl);

  const skipped = [];
  if (irrelevant) skipped.push(`${irrelevant} did not match "${query}" in ${location}`);
  if (noDetails) skipped.push(`${noDetails} had no website, address or contact details`);
  if (alreadySaved + duplicates) skipped.push(`${alreadySaved + duplicates} were duplicates or already saved`);
  if (skipped.length) onProgress(`Skipped: ${skipped.join('; ')}`);
  if (ctl.cancelled) warnings.push('Stopped early. Leads found so far were saved.');
  return { leads: added, warnings, scanned: batch.length };
}

/**
 * The dependable path: you supply website addresses (from Google, Maps, Instagram bios, directories,
 * a customer list...) and the agent reads the contacts each business publishes.
 */
export async function leadsFromUrls(urls, { industry = '', location = '', product = '' } = {}, onProgress = () => {}, ctl = {}) {
  const cc = getSettings().lead.defaultCountryCode;
  const seen = new Set();
  const sites = [];
  const socialLeads = [];
  for (const raw of urls) {
    const website = cleanUrl(String(raw).trim().split(/\s+/)[0]);
    if (!website) continue;
    const soc = classifySocial(website);
    if (soc) {
      if (!seen.has(soc.url)) {
        seen.add(soc.url);
        socialLeads.push(soc);
      }
      continue;
    }
    const origin = new URL(website).origin;
    if (!seen.has(origin)) { seen.add(origin); sites.push(origin); }
  }
  const added = [];
  const warnings = [];
  const skipped = { duplicate: 0, unreachable: 0, blocked: 0, noContact: 0 };

  // 1. Process direct social profile URLs (Instagram, LinkedIn, Twitter/X, TikTok, Facebook)
  for (const soc of socialLeads) {
    if (ctl.cancelled) break;
    if (findDuplicate({ website: soc.url })) { skipped.duplicate++; continue; }
    let rawHandle = '';
    try {
      const u = new URL(soc.url);
      rawHandle = u.pathname.replace(/^\/|\/$/g, '').split('/').pop() || '';
    } catch {}
    const handle = rawHandle.replace(/^@/, '');
    const cleanHandle = handle.replace(/[-_.]+/g, ' ').trim();
    const displayName = cleanHandle
      ? cleanHandle.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : `${soc.name.toUpperCase()} Profile`;

    const { lead, created } = addLead({
      name: displayName + (handle ? ` (@${handle})` : ''),
      website: soc.url,
      socials: { [soc.name]: soc.url },
      emails: [],
      phones: [],
      industry,
      location,
      product,
      source: 'social-import',
      tags: ['social-lead', soc.name],
      notes: `Imported from ${soc.name} profile (${soc.url})`,
    });
    if (created) added.push(lead);
    else skipped.duplicate++;
  }

  onProgress(`Reading ${sites.length} websites…`);
  let done = 0;
  await pool(sites.slice(0, 100), 4, async (origin) => {
    done++;
    if (done % 3 === 0) onProgress(`Read ${done}/${Math.min(sites.length, 100)} websites…`);
    if (findDuplicate({ website: origin })) { skipped.duplicate++; return; }
    const site = await scrapeSite(origin, { cc }).catch(() => null);
    if (!site) { skipped.unreachable++; return; }
    if (site.blocked) { skipped.blocked++; return; }
    if (!site.emails.length && !site.phones.length && !Object.keys(site.socials).length) { skipped.noContact++; return; }
    const { lead, created } = addLead({
      name: cleanName(site.title) || new URL(origin).hostname.replace(/^www\./, ''),
      website: origin, description: site.description, emails: site.emails, phones: site.phones, socials: site.socials,
      industry, location, product, source: 'website-list',
    });
    if (created) added.push(lead); else skipped.duplicate++;
  }, ctl);
  if (sites.length > 100) warnings.push('Only the first 100 websites were read; paste the rest in another batch.');
  const bits = Object.entries(skipped).filter(([, v]) => v).map(([k, v]) => `${v} ${{ duplicate: 'already saved', unreachable: 'unreachable', blocked: 'asked robots not to read them', noContact: 'had no public contact details' }[k]}`);
  if (bits.length) onProgress('Skipped: ' + bits.join(', '));
  if (ctl.cancelled) warnings.push('Stopped early. Leads found so far were saved.');
  return { leads: added, warnings, scanned: sites.length };
}

/**
 * Online Contact Hunter Agent:
 * Takes a lead, checks if it already has contact details (to avoid wasting credits/resources).
 * If missing contacts (or forced), searches online, parses snippets for phone numbers and emails,
 * identifies social profiles (Instagram, LinkedIn, etc.), and scrapes candidate websites.
 */
export async function enrichLeadOnline(leadId, { force = false } = {}) {
  const lead = getLead(leadId);
  if (!lead) throw new Error('Lead not found');

  const hasPhone = (lead.phones || []).length > 0;
  const hasEmail = (lead.emails || []).length > 0;
  const hasSocial = Object.keys(lead.socials || {}).length > 0;
  if (!force && (hasPhone || hasEmail || hasSocial)) {
    return { lead, skipped: true, reason: 'Lead already has contact information on file' };
  }

  const cc = getSettings().lead.defaultCountryCode || '234';
  const location = lead.location || getSettings().lead.defaultLocation || '';
  const cleanLoc = (location || '').replace(/,\s*[a-z]+$/i, '').trim();
  // Explee leads arrive with a company domain but no email/phone. People leads
  // never get a website set (it would make colleagues merge into one lead).
  const isPerson = lead.source === 'explee-people';
  const orgDomain = String(lead.companyDomain || '').trim();
  const searchQueries = [
    ...(orgDomain ? [isPerson ? `"${lead.name}" ${orgDomain} email phone` : `${orgDomain} contact email phone`] : []),
    `${lead.name} ${cleanLoc || location}`,
    `${lead.name} ${cleanLoc || location} contact phone email`,
    `${lead.name} ${cleanLoc || location} instagram`,
    `"${lead.name}" ${cleanLoc || location} official website`,
  ];

  const phones = new Set(lead.phones || []);
  const emails = new Set(lead.emails || []);
  const socials = { ...(lead.socials || {}) };
  let candidateWebsite = lead.website || '';
  let candidateAddress = lead.address || '';
  let candidateSourceUrl = lead.sourceUrl || '';
  let siteTech = [];

  // Free first step: read the company's own site (contact/about pages).
  if (orgDomain) {
    try {
      const site = await scrapeSite(`https://${orgDomain}`, { cc, maxPages: 3 });
      if (site && !site.blocked) {
        site.phones.forEach((p) => phones.add(p));
        site.emails.forEach((e) => emails.add(e));
        if (Array.isArray(site.tech)) siteTech = site.tech;
        for (const [k, v] of Object.entries(site.socials || {})) if (!socials[k]) socials[k] = v;
        if (!isPerson && !candidateWebsite) candidateWebsite = `https://${orgDomain}`;
      }
    } catch {}
  }
  const haveContact = () => phones.size > 0 || emails.size > 0;

  for (const q of (orgDomain && haveContact() ? [] : searchQueries)) {
    let results = [];
    try {
      results = await webSearch(q, cc);
    } catch {
      continue;
    }

    for (const r of results) {
      const text = `${r.title} ${r.snippet} ${r.url}`;
      const beforePhonesCount = phones.size;
      findPhones(text, cc).forEach((p) => phones.add(p));
      findEmails(text).forEach((e) => emails.add(e));

      // If this result supplied new phone numbers, record this result's URL as source link
      if (phones.size > beforePhonesCount && !candidateSourceUrl && r.url) {
        candidateSourceUrl = r.url;
      }

      const soc = classifySocial(r.url);
      if (soc && !socials[soc.name]) {
        socials[soc.name] = soc.url;
      }

      if (!candidateAddress) {
        const addrM = text.match(/\bAddress:\s*([^.\n\r]{10,140})/i) ||
                      text.match(/\b(\d+[\s\w.,-]+(?:Street|Road|Rd|Way|Close|Avenue|Ave|Drive|Crescent|Boulevard|Blvd|Island|Lagos)[^.\n\r]{0,80})/i);
        if (addrM) candidateAddress = addrM[1].trim();
      }

      if (!candidateSourceUrl && r.url) {
        candidateSourceUrl = r.url;
      }

      if (!candidateWebsite) {
        try {
          const u = new URL(r.url);
          if (!SKIP_DOMAINS.test(u.hostname) && !DIRECTORY.test(u.hostname) && !soc) {
            candidateWebsite = r.url;
          }
        } catch {}
      }

      if (!candidateWebsite) {
        for (const m of text.matchAll(/\b(?:https?:\/\/|www\.)[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>'",;)]*)?/gi)) {
          let uStr = m[0];
          if (uStr.startsWith('www.')) uStr = 'https://' + uStr;
          try {
            const u = new URL(uStr);
            if (!SKIP_DOMAINS.test(u.hostname) && !DIRECTORY.test(u.hostname) && !classifySocial(uStr)) {
              candidateWebsite = uStr;
              break;
            }
          } catch {}
        }
      }
    }

    if (phones.size > 0 && (candidateWebsite || Object.keys(socials).length > 0)) {
      break;
    }
  }

  const targetSite = isPerson && orgDomain ? '' : (candidateWebsite || lead.website);
  if (targetSite) {
    try {
      const site = await scrapeSite(targetSite, { cc, maxPages: 2 });
      if (site) {
        site.phones.forEach((p) => phones.add(p));
        site.emails.forEach((e) => emails.add(e));
        if (Array.isArray(site.tech)) siteTech = site.tech;
        for (const [k, v] of Object.entries(site.socials || {})) {
          if (!socials[k]) socials[k] = v;
        }
      }
    } catch {}
  }

  if (!candidateWebsite && !lead.website) {
    candidateWebsite = socials.instagram || socials.facebook || socials.linkedin || '';
  }

  const phonesList = [...phones];
  const emailsList = [...emails];
  const socialsObj = socials;

  const foundNew = phonesList.length > (lead.phones?.length || 0) ||
                   emailsList.length > (lead.emails?.length || 0) ||
                   Object.keys(socialsObj).length > Object.keys(lead.socials || {}).length ||
                   (candidateWebsite && !lead.website && !isPerson) ||
                   (candidateAddress && !lead.address) ||
                   (siteTech.length > 0 && !(lead.tech || []).length);

  if (foundNew) {
    const patch = {
      phones: phonesList,
      emails: emailsList,
      socials: socialsObj,
    };
    if (candidateWebsite && !lead.website && !isPerson) patch.website = candidateWebsite;
    if (candidateAddress && !lead.address) patch.address = candidateAddress;
    if (candidateSourceUrl && !lead.sourceUrl) patch.sourceUrl = candidateSourceUrl;
    if (siteTech.length) patch.tech = [...new Set([...(lead.tech || []), ...siteTech])];
    if (!patch.sourceUrl && !lead.sourceUrl) {
      patch.sourceUrl = (patch.address || lead.address)
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.name + ' ' + (patch.address || lead.address))}`
        : `https://www.google.com/search?q=${encodeURIComponent(lead.name + ' ' + (lead.location || ''))}`;
    }
    if (phonesList.length || emailsList.length || Object.keys(socialsObj).length || candidateWebsite) {
      patch.tags = (lead.tags || []).filter((t) => t !== 'needs contact');
    }

    const updated = updateLead(leadId, patch);
    const summary = [
      phonesList.length ? `Phones: ${phonesList.join(', ')}` : null,
      emailsList.length ? `Emails: ${emailsList.join(', ')}` : null,
      Object.keys(socialsObj).length ? `Socials: ${Object.keys(socialsObj).join(', ')}` : null,
      candidateWebsite ? `Website: ${candidateWebsite}` : null,
      candidateAddress && !lead.address ? `Address: ${candidateAddress}` : null,
    ].filter(Boolean).join(' | ');

    addActivity(leadId, { type: 'enrich', text: `Online Agent discovered contacts: ${summary}` });
    return { lead: updated, updated: true, newContacts: patch };
  }

  return { lead, updated: false, reason: 'No new contact details found online' };
}

/** Re-scrapes an existing lead's website for missing contacts, with automatic online hunter fallback. */
export async function enrichLead(lead) {
  if (!lead.website) {
    const r = await enrichLeadOnline(lead.id, { force: true });
    return r.lead;
  }
  await assertPublicUrl(lead.website);
  let site;
  try {
    site = await scrapeSite(lead.website, { cc: getSettings().lead.defaultCountryCode });
  } catch {
    site = null;
  }
  if (site && !site.blocked) {
    const updated = mergeContacts(lead.id, site);
    if (updated.phones?.length || updated.emails?.length) {
      return updated;
    }
  }
  const r = await enrichLeadOnline(lead.id, { force: true });
  return r.lead || lead;
}

export { listLeads };
