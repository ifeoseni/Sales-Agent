import crypto from 'node:crypto';
import { load, save } from './store.js';

const DEFAULTS = {
  provider: 'gemini',
  failover: true,
  passwordHash: '',
  sessionSecret: '',
  providers: {
    gemini: { apiKey: '', model: 'gemini-flash-latest', fallbackModel: 'gemini-flash-lite-latest' },
    groq: { apiKey: '', model: 'llama-3.3-70b-versatile' },
    ollama: { host: 'http://127.0.0.1:11434', model: '' },
  },
  telegram: { token: '', adminChatIds: [] },
  company: {
    name: 'Code Tech Consulting Limited',
    website: 'https://codetechcl.com',
    email: '',
    phone: '',
    whatsapp: '',
    signature: 'The Code Tech team',
  },
  lead: { defaultCountryCode: '234', defaultLocation: 'Lagos, Nigeria' },
  widget: { dailyCap: 300 },
  search: { searxngUrl: '' }, // optional: your own SearXNG instance, e.g. http://localhost:8080
  geoapify: { apiKey: '' }, // optional, free-plan place search (requires OSM/Geoapify attribution)
  crm: {
    currency: 'NGN',
    monthlyTarget: 0,
    followUpDays: 3,
  },
};

const PROVIDER_NAMES = ['gemini', 'groq', 'ollama'];
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Merges `over` into `base`, accepting only known keys of the right type (blocks prototype pollution and junk). */
function merge(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const k of Object.keys(base)) {
    if (!Object.hasOwn(over, k)) continue;
    const b = base[k], o = over[k];
    if (isObj(b)) out[k] = merge(b, o);
    else if (Array.isArray(b)) { if (Array.isArray(o)) out[k] = o; }
    else if (typeof b === 'boolean') { if (typeof o === 'boolean') out[k] = o; }
    else if (typeof b === 'number') { if (Number.isFinite(o)) out[k] = o; }
    else if (typeof o === 'string') out[k] = o.trim().slice(0, 2000);
  }
  return out;
}

/* ---------- passwords (scrypt) ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `s1$${salt.toString('base64')}$${crypto.scryptSync(pw, salt, 32).toString('base64')}`;
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

let current = merge(DEFAULTS, load('settings', {}));

// Migrate a plain-text password written by an earlier build.
const raw = load('settings', {});
if (raw.adminPassword && !current.passwordHash) {
  current.passwordHash = hashPassword(raw.adminPassword);
  save('settings', current);
}
if (!current.sessionSecret) {
  current.sessionSecret = crypto.randomBytes(32).toString('hex');
  save('settings', current);
}
if (!current.passwordHash && !process.env.ADMIN_PASSWORD) {
  const pw = crypto.randomBytes(9).toString('base64url');
  current.passwordHash = hashPassword(pw);
  save('settings', current);
  console.log(`\n  First run. Your dashboard password is: ${pw}\n  Write it down: it is stored hashed and cannot be shown again.\n  You can change it in Settings.\n`);
}

export const passwordFromEnv = () => !!process.env.ADMIN_PASSWORD;

export function verifyPassword(pw) {
  pw = String(pw ?? '');
  if (process.env.ADMIN_PASSWORD) return crypto.timingSafeEqual(sha(pw), sha(process.env.ADMIN_PASSWORD));
  const [v, salt, hash] = current.passwordHash.split('$');
  if (v !== 's1' || !salt) return false;
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 32);
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'base64'));
}

export function setPassword(pw) {
  if (process.env.ADMIN_PASSWORD) throw new Error('The password is set by the ADMIN_PASSWORD environment variable; change it there.');
  if (String(pw).length < 8) throw new Error('Password must be at least 8 characters');
  current.passwordHash = hashPassword(pw);
  save('settings', current);
}

/* ---------- stateless signed session tokens (survive restarts; die when the password changes) ---------- */
const sigKey = () =>
  crypto.createHmac('sha256', process.env.SESSION_SECRET || current.sessionSecret).update(process.env.ADMIN_PASSWORD || current.passwordHash).digest();

export function issueToken(days = 7) {
  const exp = Date.now() + days * 864e5;
  return `${exp}.${crypto.createHmac('sha256', sigKey()).update(String(exp)).digest('base64url')}`;
}

export function checkToken(token) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || !(+exp > Date.now())) return false;
  const good = crypto.createHmac('sha256', sigKey()).update(exp).digest();
  const got = Buffer.from(sig, 'base64url');
  return got.length === good.length && crypto.timingSafeEqual(got, good);
}

/* ---------- accessors ---------- */
// Environment variables override stored values, handy for hosting.
export function getSettings() {
  const s = structuredClone(current);
  if (process.env.GEMINI_API_KEY) s.providers.gemini.apiKey = process.env.GEMINI_API_KEY;
  if (process.env.GROQ_API_KEY) s.providers.groq.apiKey = process.env.GROQ_API_KEY;
  if (process.env.GEOAPIFY_API_KEY) s.geoapify.apiKey = process.env.GEOAPIFY_API_KEY;
  if (process.env.TELEGRAM_BOT_TOKEN) s.telegram.token = process.env.TELEGRAM_BOT_TOKEN;
  return s;
}

const SECRETS = [['providers', 'gemini', 'apiKey'], ['providers', 'groq', 'apiKey'], ['telegram', 'token'], ['geoapify', 'apiKey']];

export function publicSettings() {
  const s = getSettings();
  delete s.passwordHash;
  delete s.sessionSecret;
  for (const p of SECRETS) {
    const parent = p.slice(0, -1).reduce((o, k) => o[k], s);
    const key = p[p.length - 1];
    parent[key] = parent[key] ? '********' : '';
  }
  s.passwordFromEnv = passwordFromEnv();
  return s;
}

export function updateSettings(patch, { internal = false } = {}) {
  patch = structuredClone(isObj(patch) ? patch : {});
  delete patch.passwordHash;
  delete patch.sessionSecret;
  if (!internal && isObj(patch.telegram)) delete patch.telegram.adminChatIds;
  // A masked value means "unchanged".
  for (const p of SECRETS) {
    const parent = p.slice(0, -1).reduce((o, k) => (isObj(o) ? o[k] : undefined), patch);
    if (isObj(parent) && parent[p[p.length - 1]] === '********') delete parent[p[p.length - 1]];
  }
  if (patch.provider !== undefined && !PROVIDER_NAMES.includes(patch.provider)) delete patch.provider;
  const ollamaHost = patch.providers?.ollama?.host;
  if (typeof ollamaHost === 'string' && ollamaHost && !/^https?:\/\/[^\s]+$/i.test(ollamaHost)) delete patch.providers.ollama.host;
  const sx = patch.search?.searxngUrl;
  if (typeof sx === 'string' && sx && !/^https?:\/\/[^\s]+$/i.test(sx)) delete patch.search.searxngUrl;
  const cc = patch.lead?.defaultCountryCode;
  if (typeof cc === 'string') patch.lead.defaultCountryCode = cc.replace(/\D/g, '').slice(0, 4) || '234';
  const cap = patch.widget?.dailyCap;
  if (cap !== undefined) patch.widget.dailyCap = Math.min(Math.max(Math.trunc(+cap) || 0, 0), 100000);
  const currency = patch.crm?.currency;
  if (currency !== undefined) patch.crm.currency = String(currency).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'NGN';
  const target = patch.crm?.monthlyTarget;
  if (target !== undefined) patch.crm.monthlyTarget = Math.min(Math.max(Number(target) || 0, 0), 1e12);
  const followUp = patch.crm?.followUpDays;
  if (followUp !== undefined) {
    const n = Math.trunc(Number(followUp));
    patch.crm.followUpDays = Number.isFinite(n) ? Math.min(Math.max(n, 1), 30) : 3;
  }
  current = merge(current, patch);
  save('settings', current);
  return publicSettings();
}
