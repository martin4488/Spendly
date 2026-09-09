// Currency codes and symbols
export const CURRENCIES = {
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', flag: '🇪🇺' },
  USD: { code: 'USD', symbol: '$', name: 'Dólar', flag: '🇺🇸' },
  ARS: { code: 'ARS', symbol: '$', name: 'Peso AR', flag: '🇦🇷' },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

const CACHE_KEY = 'spendly_exchange_rates';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface CachedRates {
  base: string;
  rates: Record<string, number>;
  timestamp: number;
}

// In-memory cache for instant access
let memoryCache: CachedRates | null = null;

function readStored(): CachedRates | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached: CachedRates = JSON.parse(raw);
    return cached && cached.rates ? cached : null;
  } catch {
    return null;
  }
}

function isFresh(cached: CachedRates | null): boolean {
  return !!cached && Date.now() - cached.timestamp < CACHE_TTL;
}

/**
 * Returns the stored rates only while they're fresh — but adopts them into
 * memory either way. Expired rates are still the best answer available when the
 * network is gone, and a yesterday-old rate beats no conversion at all, which
 * is what silently wrote foreign amounts as default-currency ones.
 */
function loadFromStorage(): CachedRates | null {
  const cached = readStored();
  if (!cached) return null;
  if (!memoryCache) memoryCache = cached;
  return isFresh(cached) ? cached : null;
}

function saveToStorage(data: CachedRates) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {}
}

// Fetch rates from API (uses USD as base - free tier)
async function fetchRates(): Promise<CachedRates | null> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) return null;
    const json = await res.json();
    if (json.result !== 'success') return null;

    const cached: CachedRates = {
      base: 'USD',
      rates: json.rates,
      timestamp: Date.now(),
    };
    memoryCache = cached;
    saveToStorage(cached);
    return cached;
  } catch {
    return null;
  }
}

// Pre-fetch on app load - call this once
export async function prefetchRates(): Promise<void> {
  const stored = loadFromStorage();
  if (stored) return; // Cache still valid
  await fetchRates();
}

/**
 * Guarantees a usable rate table, fetching one if the cache is cold or expired.
 *
 * `getRate` has to stay synchronous for the render path, so this is what the
 * *save* path awaits before converting. Returns false only when there is
 * nothing to convert with at all — callers must refuse the write in that case
 * rather than fall back to the unconverted amount.
 */
export async function ensureRates(): Promise<boolean> {
  if (isFresh(memoryCache)) return true;
  if (loadFromStorage()) return true;
  if (await fetchRates()) return true;
  return memoryCache !== null;
}

// Get exchange rate between two currencies (instant from cache)
export function getRate(from: CurrencyCode, to: CurrencyCode): number | null {
  if (from === to) return 1;

  // Try memory first, then storage
  if (!memoryCache) {
    loadFromStorage();
  }
  if (!memoryCache) return null;

  const rates = memoryCache.rates;

  // API base is USD
  const fromUSD = rates[from]; // how many FROM per 1 USD
  const toUSD = rates[to]; // how many TO per 1 USD

  if (!fromUSD || !toUSD) return null;

  // Convert: amount in FROM -> USD -> TO
  return toUSD / fromUSD;
}

// Convert amount between currencies (instant, no async)
export function convertCurrency(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode
): number | null {
  const rate = getRate(from, to);
  if (rate === null) return null;
  return Math.round(amount * rate * 100) / 100;
}

// Force refresh rates (e.g., pull-to-refresh)
export async function refreshRates(): Promise<boolean> {
  const result = await fetchRates();
  return result !== null;
}

// Format with currency symbol
export function formatWithCurrency(amount: number, currency: CurrencyCode): string {
  const c = CURRENCIES[currency];
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${c.symbol}${formatted}`;
}
