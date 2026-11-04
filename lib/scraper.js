// Reads PUBLIC business contact details from a company's own website.
// Polite by design: honours robots.txt, identifies itself, reads at most 3 pages.

import { safeFetch } from './net.js';
import { detectTechStack } from './enrich.js';

export const UA ='Mozilla/5.0 (compatible; CodeTechLeadBot/1.0; +https://codetechcl.com)';

/* ---------- robots.txt ---------- */
const robotsCache = new Map();
const ROBOTS_CACHE_MAX = 500;
let robotsCacheCleanup = 0;

function parseRobots(text) {
  let applies = false;
  let inRules = false;
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.replace(/#.*/, '').trim().match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === 'user-agent') {
      if (inRules) { applies = false; inRules = false; }
      if (v === '*' || /codetech/i.test(v)) applies = true;
    } else {
      inRules = true;
      if (applies && k === 'disallow' && v) {
        const re = v.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        out.push(new RegExp('^' + re));
      }
    }
  }
  return out;
}

export async function robotsAllows(url) {
  const u = new URL(url);
  let rules = robotsCache.get(u.origin);
  if (!rules) {
    rules = [];
    try {
      const { res: r } = await safeFetch(u.origin + '/robots.txt', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(6000) });
      if (r.ok) rules = parseRobots((await r.text()).slice(0, 200_000));
    } catch { /* no robots.txt reachable: allow */ }
    robotsCache.set(u.origin, rules);
    if (robotsCache.size > ROBOTS_CACHE_MAX) {
      const iter = robotsCache.keys().next();
      if (iter.value) robotsCache.delete(iter.value);
    }
  }
  const p = u.pathname + u.search;
  return !rules.some((re) => re.test(p));
}

/* ---------- fetching ---------- */
export async function fetchHtml(url, { timeout = 12000, maxChars = 1_500_000 } = {}) {
  try {
    const { res: r, url: finalUrl } = await safeFetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en' },
      signal: AbortSignal.timeout(timeout),
    });
    if (!r.ok) return null;
    if (!/html|xml/i.test(r.headers.get('content-type') || '')) return null;
    return { html: (await r.text()).slice(0, maxChars), url: finalUrl };
  } catch {
    return null;
  }
}

/* ---------- helpers ---------- */
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

export function toText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeCfEmail(hex) {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/* ---------- emails ---------- */
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ico)$|@(example|domain|email|yourdomain|yourcompany|sentry|wixpress|test)\.|^(your|name|user|email|username)@|sentry|noreply|no-reply|donotreply/i;

export function findEmails(text) {
  const cleaned = text
    .replace(/\s*[[(]\s*at\s*[\])]\s*/gi, '@')
    .replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, '.');
  const out = new Set();
  for (const m of cleaned.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase().replace(/^[.-]+|[.-]+$/g, '');
    if (e.length <= 80 && !BAD_EMAIL.test(e)) out.add(e);
  }
  return [...out];
}

/* ---------- phones ---------- */
/** Normalise to E.164-ish "+<digits>". `strict` is for free text; tel:/wa.me links can be lenient. */
export function normPhone(raw, cc = '234', strict = false) {
  const s = String(raw).trim().replace(/\(0\)/g, ''); // "+234 (0) 803…" trunk-zero notation
  let d = s.replace(/\D/g, '');
  const intl = s.startsWith('+') || s.startsWith('00');
  if (s.startsWith('00')) d = d.slice(2);
  if (!intl) {
    if (d.startsWith('0') && d.length >= 10 && d.length <= 11) d = cc + d.slice(1);
    else if (!strict && d.length >= 9 && d.length <= 10 && !d.startsWith(cc)) d = cc + d;
    else if (!d.startsWith(cc)) return null;
  }
  if (d.length < 10 || d.length > 15) return null;
  if (d.startsWith('234') && d.length !== 13) return null; // Nigerian numbers are 234 + 10 digits
  return '+' + d;
}

const PHONE_TEXT_RE = /(\+\s?\d[\d\s().-]{8,21}\d|(?<![\d.\-/])0[\d\s().-]{9,14}\d|(?<!\d)234\d{10}(?!\d))/g;

export function findPhones(text, cc = '234') {
  const out = new Set();
  for (const m of text.matchAll(PHONE_TEXT_RE)) {
    const p = normPhone(m[0], cc, true);
    if (p) out.add(p);
  }
  return [...out];
}

/* ---------- social links ---------- */
const SOCIAL_HOSTS = [
  ['facebook', /^(?:www\.|m\.|web\.)?facebook\.com$/],
  ['instagram', /^(?:www\.)?instagram\.com$/],
  ['linkedin', /^(?:[a-z]{2,3}\.)?linkedin\.com$/],
  ['twitter', /^(?:www\.|mobile\.)?(?:twitter|x)\.com$/],
  ['tiktok', /^(?:www\.)?tiktok\.com$/],
  ['youtube', /^(?:www\.|m\.)?youtube\.com$/],
  ['telegram', /^(?:t|telegram)\.me$/],
  ['whatsapp', /^(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|web\.whatsapp\.com)$/],
];
const SOCIAL_JUNK = /\/(sharer|share|intent|plugins|dialog|login|signup|tr|home|policies|legal|help|hashtag|watch|embed|about\/?$)/i;
const SOCIAL_PATH_OK = {
  linkedin: /^\/(company|in|school)\//i,
  youtube: /^\/(@|channel\/|c\/|user\/)/i,
  tiktok: /^\/@/,
};

export function classifySocial(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  for (const [name, re] of SOCIAL_HOSTS) {
    if (!re.test(u.hostname)) continue;
    if (name === 'whatsapp') return { name, url: u.href };
    if (u.pathname.length < 3 || SOCIAL_JUNK.test(u.pathname)) return null;
    if (SOCIAL_PATH_OK[name] && !SOCIAL_PATH_OK[name].test(u.pathname)) return null;
    return { name, url: u.origin + u.pathname.replace(/\/$/, '') };
  }
  return null;
}

/* ---------- main extraction ---------- */
export function extractContacts(html, baseUrl, cc = '234') {
  const emails = new Set();
  const phones = new Set();
  const socials = {};
  const links = [];

  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) emails.add(decodeCfEmail(m[1]).toLowerCase());

  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(m[1]).trim();
    if (/^mailto:/i.test(href)) {
      let raw = href.slice(7).split('?')[0];
      try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
      findEmails(raw).forEach((e) => emails.add(e));
    } else if (/^tel:/i.test(href)) {
      const p = normPhone(decodeURIComponent(href.slice(4)), cc);
      if (p) phones.add(p);
    } else {
      let abs;
      try { abs = new URL(href, baseUrl).href; } catch { continue; }
      const soc = classifySocial(abs);
      if (soc) {
        if (!socials[soc.name]) socials[soc.name] = soc.url;
        if (soc.name === 'whatsapp') {
          const num = abs.match(/wa\.me\/(\d{8,15})|[?&]phone=(\d{8,15})/);
          const p = num && normPhone('+' + (num[1] || num[2]), cc);
          if (p) phones.add(p);
        }
      } else {
        links.push({ href: abs, label: toText(m[2]).slice(0, 60) });
      }
    }
  }

  const text = toText(html);
  findEmails(text).forEach((e) => emails.add(e));
  findPhones(text, cc).forEach((p) => phones.add(p));

  const meta = (re) => (html.match(re)?.[1] || '').trim();
  const title =
    decodeEntities(meta(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)) ||
    decodeEntities(meta(/<title[^>]*>([\s\S]*?)<\/title>/i)).replace(/\s+/g, ' ');
  const description = decodeEntities(
    meta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) ||
      meta(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)/i),
  );

  return { emails: [...emails], phones: [...phones], socials, links, title, description };
}

/* ---------- whole-site scrape ---------- */
export async function scrapeSite(url, { cc = '234', maxPages = 3 } = {}) {
  let origin;
  try { origin = new URL(url).origin; } catch { return null; }
  if (!(await robotsAllows(origin + '/'))) return { blocked: true, emails: [], phones: [], socials: {}, title: '', description: '' };

  const home = await fetchHtml(origin);
  if (!home) return null;
  const res = extractContacts(home.html, home.url, cc);
  res.tech = detectTechStack(home.html);

  const host = new URL(home.url).hostname.replace(/^www\./, '');
  const sameSite = res.links.filter((l) => {
    try { return new URL(l.href).hostname.replace(/^www\./, '') === host; } catch { return false; }
  });
  const rank = (l) => (/contact|reach|get-in-touch/i.test(l.href + ' ' + l.label) ? 0 : /about|support/i.test(l.href + ' ' + l.label) ? 1 : 9);
  const next = [...new Set(sameSite.filter((l) => rank(l) < 9).sort((a, b) => rank(a) - rank(b)).map((l) => l.href.split('#')[0]))]
    .filter((h) => h !== home.url && h !== origin + '/')
    .slice(0, maxPages - 1);
  if (!next.length) next.push(origin + '/contact', origin + '/contact-us');

  let fetched = 1;
  for (const page of next) {
    if (fetched >= maxPages) break;
    if (!(await robotsAllows(page))) continue;
    const p = await fetchHtml(page);
    if (!p) continue;
    fetched++;
    const r = extractContacts(p.html, p.url, cc);
    res.emails.push(...r.emails);
    res.phones.push(...r.phones);
    for (const [k, v] of Object.entries(r.socials)) res.socials[k] ||= v;
  }

  // Prefer addresses on the company's own domain.
  const uniq = [...new Set(res.emails)];
  uniq.sort((a, b) => Number(b.endsWith('@' + host) || b.endsWith('.' + host)) - Number(a.endsWith('@' + host) || a.endsWith('.' + host)));
  res.emails = uniq.slice(0, 5);
  res.phones = [...new Set(res.phones)].slice(0, 5);
  delete res.links;
  return res;
}
