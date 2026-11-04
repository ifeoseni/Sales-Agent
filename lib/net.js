import dns from 'node:dns/promises';
import net from 'node:net';

/* Outbound-request safety: the crawler reads URLs that come from the open web,
   so it must never be tricked into calling localhost or the cloud's internal network (SSRF). */

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x)) return true;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  return true;
}

export async function assertPublicUrl(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs are allowed');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('Non-standard ports are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Blocked non-public address');
    return u;
  }
  if (host === 'localhost' || /\.(localhost|local|internal|lan)$/i.test(host)) throw new Error('Blocked non-public host');
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('Blocked non-public address');
  return u;
}

/** fetch() that re-checks every redirect hop against assertPublicUrl. Returns { res, url }. */
export async function safeFetch(url, opts = {}, maxRedirects = 4) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...opts, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).href;
      await res.body?.cancel();
      continue;
    }
    return { res, url: current };
  }
  throw new Error('Too many redirects');
}

/** Returns a normalised http(s) URL, or '' when the value is not a safe web address. */
export function cleanUrl(value) {
  let s = String(value || '').trim();
  if (!s || s.length > 500) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/\//, '');
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href.replace(/\/$/, '') : '';
  } catch {
    return '';
  }
}
