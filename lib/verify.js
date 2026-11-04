import dns from 'node:dns/promises';

const mxCache = new Map();
const MX_CACHE_TTL = 3600_000 * 24; // 24 hours

// Use standard public DNS resolvers to avoid Windows/local-proxy port 53 refusal
const resolver = new dns.Resolver();
try {
  resolver.setServers(['1.1.1.1', '8.8.8.8', '1.0.0.1', '8.8.4.4']);
} catch {}

const PROVIDER_PATTERNS = [
  [/google(mail)?\.com|aspmx/i, 'Google Workspace'],
  [/outlook\.com|microsoft\.com|mail\.protection\.outlook/i, 'Microsoft 365'],
  [/zoho\.(com|eu|in)/i, 'Zoho Mail'],
  [/secureserver\.net/i, 'GoDaddy'],
  [/yahoodns\.net/i, 'Yahoo Business'],
  [/mailgun\.org/i, 'Mailgun'],
  [/sendgrid\.net/i, 'SendGrid'],
  [/ovh\.(net|com)/i, 'OVHcloud'],
  [/hostinger|hostgator|bluehost|cpanel/i, 'cPanel / Webmail'],
  [/yandex\.(ru|net|com)/i, 'Yandex Mail'],
  [/protonmail\.(ch|com)/i, 'ProtonMail'],
  [/icloud\.com|apple\.com/i, 'iCloud Mail'],
];

export function identifyMailProvider(mxRecords = []) {
  const allExchange = mxRecords.map((r) => r.exchange || '').join(' ');
  for (const [pattern, name] of PROVIDER_PATTERNS) {
    if (pattern.test(allExchange)) return name;
  }
  return 'Corporate Mail';
}

/**
 * Checks whether an email's domain has configured, active MX mail servers.
 * Identifies the mail provider (Google Workspace, M365, Zoho) to inform sales reps.
 */
export async function verifyEmailMx(email) {
  if (!email || typeof email !== 'string') return { valid: false, status: 'invalid', reason: 'Invalid email' };
  const parts = email.split('@');
  const domain = parts[1]?.toLowerCase().trim();
  if (!domain || !domain.includes('.')) return { valid: false, status: 'invalid', reason: 'Invalid domain' };

  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.ts < MX_CACHE_TTL) {
    return cached.result;
  }

  try {
    const records = await resolver.resolveMx(domain);
    if (!records || !records.length) {
      const res = { valid: false, status: 'unreachable', reason: 'No MX records found (will bounce)', domain };
      mxCache.set(domain, { result: res, ts: Date.now() });
      return res;
    }
    records.sort((a, b) => a.priority - b.priority);
    const provider = identifyMailProvider(records);
    const res = {
      valid: true,
      status: 'verified',
      provider,
      primaryMx: records[0].exchange,
      domain,
    };
    mxCache.set(domain, { result: res, ts: Date.now() });
    return res;
  } catch (err) {
    const isNotFound = err.code === 'ENOTFOUND' || err.code === 'ENODATA';
    const res = {
      valid: false,
      status: isNotFound ? 'unreachable' : 'unknown',
      reason: isNotFound ? 'Domain has no active mail server' : 'DNS lookup timed out',
      domain,
    };
    mxCache.set(domain, { result: res, ts: Date.now() });
    return res;
  }
}
