import { getTimeframe, type Timeframe } from "./timeframes";
import type { Candle } from "./forex";

const NATIVE_INTERVALS = new Set([
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M",
]);

export interface FuturesIntervalPlan {
  id: string;
  binanceInterval: string;
  aggregateSeconds: number;
  seconds: number;
  isNative: boolean;
}

export function futuresIntervalPlan(id: string): FuturesIntervalPlan {
  const tf = getTimeframe(id);
  const nativeId = tf.unit === "mo" && tf.count === 1 ? "1M" : tf.id;
  if (NATIVE_INTERVALS.has(nativeId)) {
    return { id: tf.id, binanceInterval: nativeId, aggregateSeconds: 0, seconds: tf.seconds, isNative: true };
  }

  let binanceInterval = "1m";
  if (tf.unit === "h") binanceInterval = "1h";
  else if (tf.unit === "d") binanceInterval = "1d";
  else if (tf.unit === "w") binanceInterval = "1w";
  else if (tf.unit === "mo") binanceInterval = "1M";

  return {
    id: tf.id,
    binanceInterval,
    aggregateSeconds: tf.seconds,
    seconds: tf.seconds,
    isNative: false,
  };
}

export function aggregateFuturesCandles(candles: Candle[], plan: FuturesIntervalPlan): Candle[] {
  if (!plan.aggregateSeconds || candles.length === 0) return candles;
  const buckets = new Map<number, Candle>();
  for (const candle of candles) {
    const bucket = Math.floor(candle.time / plan.aggregateSeconds) * plan.aggregateSeconds;
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, { ...candle, time: bucket });
      continue;
    }
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

export function timeframeLabel(id: string): string {
  return getTimeframe(id).label;
}

export function timeframeSixMonthCutoff(now = Date.now()): number {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - 6);
  return Math.floor(date.getTime() / 1000);
}

export function nativeBatchLimit(plan: FuturesIntervalPlan): number {
  if (!plan.aggregateSeconds) return 1500;
  const native = getTimeframe(plan.binanceInterval === "1M" ? "1mo" : plan.binanceInterval);
  return Math.min(1500, Math.max(100, Math.ceil((500 * plan.seconds) / native.seconds)));
}