/**
 * Pure, provider-agnostic candle helpers shared by every market-data adapter.
 * No network calls, no provider-specific types — safe to import from
 * client, server, or a future provider adapter.
 */
import type { Candle } from "./forex";

/** Aggregate fine candles into fixed-second buckets (TradingView-style). */
export function aggregateCandles(base: Candle[], bucketSeconds: number): Candle[] {
  if (bucketSeconds <= 0) return base;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curBucket = -1;

  for (const c of base) {
    const bucket = Math.floor(c.time / bucketSeconds) * bucketSeconds;
    if (!cur || bucket !== curBucket) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close };
      curBucket = bucket;
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
    }
  }
  if (cur) out.push(cur);
  return out;
}
