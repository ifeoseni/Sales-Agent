/** Tiny in-memory limiter. Protects the free AI quota from floods (widget, Telegram, logins). */
const buckets = new Map();

export function allow(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

/** Like allow() but only records on failure, for login attempts. */
export function blocked(key, max, windowMs) {
  const now = Date.now();
  return (buckets.get(key) || []).filter((t) => now - t < windowMs).length >= max;
}
export function record(key) {
  buckets.set(key, [...(buckets.get(key) || []), Date.now()]);
}
export function clear(key) { buckets.delete(key); }

let day = { d: '', n: 0 };
/** Global daily ceiling on public AI replies (widget + Telegram customers). */
export function underDailyCap(cap) {
  const d = new Date().toISOString().slice(0, 10);
  if (day.d !== d) day = { d, n: 0 };
  return ++day.n <= cap;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (!v.some((t) => now - t < 3_600_000)) buckets.delete(k);
}, 600_000).unref();
