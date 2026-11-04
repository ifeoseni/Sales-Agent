import { getSettings } from './settings.js';

let cachedRates = null;
let lastFetch = 0;
const CACHE_MS = 6 * 3600_000; // 6 hours

const SYMBOLS = {
  NGN: '₦',
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'CA$',
  AUD: 'AU$',
};

/**
 * Returns latest FX rates relative to USD from Frankfurter API (free, open source).
 * NGN rate is sourced from Settings (default 1 USD = 1,600 NGN).
 */
export async function getRates() {
  const now = Date.now();
  if (cachedRates && now - lastFetch < CACHE_MS) {
    return cachedRates;
  }

  const usdNgn = getSettings().crm?.usdRate || 1600;
  const fallback = {
    base: 'USD',
    date: new Date().toISOString().slice(0, 10),
    rates: {
      USD: 1,
      EUR: 0.92,
      GBP: 0.77,
      CAD: 1.38,
      AUD: 1.52,
      NGN: usdNgn,
    },
  };

  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      cachedRates = {
        base: 'USD',
        date: data.date || fallback.date,
        rates: {
          USD: 1,
          ...data.rates,
          NGN: usdNgn,
        },
      };
      lastFetch = now;
      return cachedRates;
    }
  } catch {}

  cachedRates = fallback;
  lastFetch = now;
  return cachedRates;
}

/**
 * Converts an amount from source currency to target currency.
 */
export async function convertCurrency(amount, from = 'NGN', to = 'USD') {
  if (from === to || !amount) return amount;
  const rates = (await getRates()).rates;
  const rateFrom = rates[from] || 1;
  const rateTo = rates[to] || 1;
  // Convert from -> USD -> to
  const inUsd = amount / rateFrom;
  return Math.round(inUsd * rateTo * 100) / 100;
}

export { SYMBOLS };
