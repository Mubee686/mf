/**
 * Instruments and shared candle types.
 *
 * This file is provider-agnostic and client-safe — it never imports a
 * specific market-data vendor.  Provider-specific symbol resolution lives
 * in `src/lib/providers/*.server.ts`. To switch vendors, write a new
 * adapter under `src/lib/providers/` and point `market.functions.ts` /
 * `price-stream` at it — nothing here needs to change.
 *
 * There is no synthetic/simulated data anywhere in this pipeline.
 */

export interface Candle {
  time: number; // unix seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ForexPair {
  symbol: string; // display symbol, e.g. "EUR/USD" — also the provider-lookup key
  name: string;
  digits: number;
}

export const FOREX_PAIRS: ForexPair[] = [
  { symbol: "EUR/USD", name: "Euro / US Dollar", digits: 5 },
  { symbol: "GBP/USD", name: "Pound / US Dollar", digits: 5 },
  { symbol: "USD/JPY", name: "US Dollar / Yen", digits: 3 },
  { symbol: "AUD/USD", name: "Aussie / US Dollar", digits: 5 },
  { symbol: "USD/CAD", name: "US Dollar / Loonie", digits: 5 },
  { symbol: "USD/CHF", name: "US Dollar / Franc", digits: 5 },
  { symbol: "NZD/USD", name: "Kiwi / US Dollar", digits: 5 },
  { symbol: "EUR/GBP", name: "Euro / Pound", digits: 5 },
  { symbol: "EUR/JPY", name: "Euro / Yen", digits: 3 },
  { symbol: "GBP/JPY", name: "Pound / Yen", digits: 3 },
  { symbol: "XAU/USD", name: "Gold / US Dollar", digits: 2 },
];

export function getPair(symbol: string): ForexPair {
  return FOREX_PAIRS.find((p) => p.symbol === symbol) ?? FOREX_PAIRS[0];
}

export function formatPrice(value: number, digits: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
