/**
 * Twelve Data market-data adapter — SERVER-ONLY.
 *
 * This is the single file that knows how to talk to Twelve Data. To switch
 * vendors in the future: write a sibling adapter (same exported shape:
 * `resolveSymbol`, `fetchHistory`) and point `market.functions.ts` /
 * `price-stream.server.ts` at it. Nothing else in the app imports Twelve
 * Data directly, and the API key is only ever read here.
 *
 * Historical OHLC candles use the `/time_series` REST endpoint, which is
 * available on Twelve Data's free tier (rate-limited). Live price ticks
 * (see twelvedata-stream.server.ts) are delivered by polling the `/price`
 * endpoint — Twelve Data's WebSocket push feed is a Pro-plan feature, so
 * polling is what actually works on a free-tier key.
 */
import type { Candle } from "../forex";
import { aggregateCandles } from "../candle-utils";
import { twelveDataPlan } from "../timeframes";

const BASE_URL = "https://api.twelvedata.com";
const MAX_CANDLES = 1500;

export function twelveDataApiKey(): string {
  // Accept either naming so an existing deployment secret keeps working.
  const key = process.env.TWELVEDATA_API_KEY ?? process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("TWELVEDATA_API_KEY is not set");
  return key;
}


/** Twelve Data uses the app's own display symbol format ("EUR/USD") natively — no remapping needed. */
export function resolveSymbol(pairSymbol: string): string {
  return pairSymbol;
}

interface TwelveDataErrorBody {
  code?: number;
  message?: string;
  status?: string;
}

interface TwelveDataSeriesValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

interface TwelveDataSeriesResponse extends TwelveDataErrorBody {
  values?: TwelveDataSeriesValue[];
}

export interface MarketSeries {
  candles: Candle[];
  price: number;
  prevClose: number | null;
}

/** Parse a Twelve Data `datetime` string ("2024-01-02 15:04:00" or "2024-01-02") as UTC seconds. */
function parseUtcSeconds(datetime: string): number {
  const [datePart, timePart] = datetime.split(" ");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi, s] = (timePart ?? "00:00:00").split(":").map(Number);
  return Math.floor(Date.UTC(y, mo - 1, d, h ?? 0, mi ?? 0, s ?? 0) / 1000);
}

function friendlyError(body: TwelveDataErrorBody, res: Response): string {
  if (body.code === 401 || res.status === 401) {
    return "Twelve Data rejected the API key (401 Unauthorized). Double-check the key value.";
  }
  if (body.code === 429 || res.status === 429) {
    return "Twelve Data rate limit reached — the free tier allows a limited number of requests per minute/day. Try again shortly.";
  }
  if (body.code === 403 || res.status === 403) {
    return "This data is not available on the current Twelve Data plan.";
  }
  return body.message || `Twelve Data HTTP ${res.status}`;
}

/**
 * Fetch a full OHLC history for a pair + timeframe from Twelve Data.
 * Throws on network / API / plan-access failure — never returns synthetic data.
 */
export async function fetchHistory(pairSymbol: string, timeframeId: string): Promise<MarketSeries> {
  const symbol = resolveSymbol(pairSymbol);
  const plan = twelveDataPlan(timeframeId);

  const url =
    `${BASE_URL}/time_series` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${plan.interval}` +
    `&outputsize=${plan.outputsize}` +
    `&timezone=UTC` +
    `&order=ASC` +
    `&apikey=${twelveDataApiKey()}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  const json = (await res.json()) as TwelveDataSeriesResponse;

  if (!res.ok || json.status === "error") {
    throw new Error(friendlyError(json, res));
  }

  if (!json.values || json.values.length === 0) {
    throw new Error("No data returned for this instrument");
  }

  const rawCandles: Candle[] = [];
  for (const v of json.values) {
    const o = Number(v.open);
    const h = Number(v.high);
    const l = Number(v.low);
    const c = Number(v.close);
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c))
      continue;
    if (h < l) continue;
    rawCandles.push({ time: parseUtcSeconds(v.datetime), open: o, high: h, low: l, close: c });
  }
  rawCandles.sort((a, b) => a.time - b.time);

  if (rawCandles.length === 0) {
    throw new Error("No valid candles in feed response");
  }

  let candles = aggregateCandles(rawCandles, plan.aggregateSeconds);
  if (candles.length > MAX_CANDLES) {
    candles = candles.slice(candles.length - MAX_CANDLES);
  }

  const price = candles[candles.length - 1].close;

  const todayUtcMidnight = Math.floor(Date.now() / 86_400_000) * 86_400;
  let prevClose: number | null = null;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].time < todayUtcMidnight) {
      prevClose = candles[i].close;
      break;
    }
  }

  return { candles, price, prevClose };
}

/** Fetch the latest real-time price for a symbol from the `/price` endpoint. */
export async function fetchLatestPrice(pairSymbol: string): Promise<number> {
  const symbol = resolveSymbol(pairSymbol);
  const url = `${BASE_URL}/price?symbol=${encodeURIComponent(symbol)}&apikey=${twelveDataApiKey()}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as TwelveDataErrorBody & { price?: string };

  if (!res.ok || json.status === "error") {
    throw new Error(friendlyError(json, res));
  }
  const price = Number(json.price);
  if (!Number.isFinite(price)) throw new Error("Invalid price in feed response");
  return price;
}
