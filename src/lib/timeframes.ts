/**
 * Timeframe model — client-safe (imported by both browser and server code).
 *
 * A timeframe has a canonical id built from a count + unit:
 *   unit:  m = minute, h = hour, d = day, w = week, mo = month
 *   id:    `${n}${unit}`   e.g. "1m", "15m", "4h", "1d", "1w", "1mo"
 *
 * This model is provider-agnostic.  Every timeframe is built from the
 * finest native resolution the active provider offers; non-native
 * intervals are aggregated client/server-side so all timeframes share the
 * same underlying feed regardless of vendor.
 */

export type TfUnit = "m" | "h" | "d" | "w" | "mo";

export interface Timeframe {
  id: string;
  label: string;
  unit: TfUnit;
  count: number;
  seconds: number;
}

const UNIT_SECONDS: Record<TfUnit, number> = {
  m: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
  mo: 2_592_000,
};

function unitLabel(n: number, unit: TfUnit): string {
  switch (unit) {
    case "m":
      return `${n}m`;
    case "h":
      return `${n}H`;
    case "d":
      return `${n}D`;
    case "w":
      return `${n}W`;
    case "mo":
      return `${n}MN`;
  }
}

/** Parse free-form user input ("2h", "45M", "1MN", "3 days") into a Timeframe. */
export function parseTimeframe(raw: string): Timeframe | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;

  let m: RegExpMatchArray | null;
  let unit: TfUnit;

  if ((m = s.match(/^(\d+)(mo|mn|mon|month|months)$/))) unit = "mo";
  else if ((m = s.match(/^(\d+)(w|wk|week|weeks)$/))) unit = "w";
  else if ((m = s.match(/^(\d+)(d|day|days)$/))) unit = "d";
  else if ((m = s.match(/^(\d+)(h|hr|hour|hours)$/))) unit = "h";
  else if ((m = s.match(/^(\d+)(m|min|mins|minute|minutes)$/))) unit = "m";
  else return null;

  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0 || n > 999) return null;

  const seconds = n * UNIT_SECONDS[unit];
  return { id: `${n}${unit}`, label: unitLabel(n, unit), unit, count: n, seconds };
}

/** Canonical ids of the default timeframe bar. */
export const DEFAULT_TIMEFRAME_IDS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1mo"];

/** Suggested quick-pick custom intervals shown in the picker. */
export const QUICK_TIMEFRAME_IDS = [
  "2m",
  "3m",
  "10m",
  "20m",
  "45m",
  "2h",
  "3h",
  "8h",
  "12h",
  "2d",
  "3d",
];

export function getTimeframe(id: string): Timeframe {
  return parseTimeframe(id) ?? parseTimeframe("15m")!;
}

// ─── Twelve Data resolution mapping ──────────────────────────────────────────
// This is the ONLY place that knows about Twelve Data's specific interval
// codes. Swapping providers means adding a sibling `<vendor>Plan()` function
// here (or in the vendor's own adapter) — nothing else in the app changes.

export interface TwelveDataPlan {
  /** Twelve Data interval code, e.g. "1min" "15min" "1h" "4h" "1day" "1week" "1month". */
  interval: string;
  /** Aggregation bucket in seconds — 0 means use the native interval as-is. */
  aggregateSeconds: number;
  /** How many native-resolution bars to request from the REST endpoint. */
  outputsize: number;
}

const TWELVEDATA_NATIVE: Record<string, string> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "45m": "45min",
  "1h": "1h",
  "2h": "2h",
  "4h": "4h",
  "1d": "1day",
  "1w": "1week",
  "1mo": "1month",
};

const NATIVE_SECONDS: Record<string, number> = {
  "1min": 60,
  "5min": 300,
  "15min": 900,
  "30min": 1_800,
  "45min": 2_700,
  "1h": 3_600,
  "2h": 7_200,
  "4h": 14_400,
  "1day": 86_400,
  "1week": 604_800,
  "1month": 2_592_000,
};

const TARGET_BARS = 1000;
const MAX_OUTPUTSIZE = 5000; // Twelve Data's REST cap

/**
 * Return the Twelve Data fetch plan for a timeframe id.
 * Non-native intervals aggregate from the finest suitable native interval
 * Twelve Data supports for that unit.
 */
export function twelveDataPlan(id: string): TwelveDataPlan {
  const tf = getTimeframe(id);
  const native = TWELVEDATA_NATIVE[tf.id];

  if (native) {
    const outputsize = Math.min(MAX_OUTPUTSIZE, TARGET_BARS);
    return { interval: native, aggregateSeconds: 0, outputsize };
  }

  let interval = "1min";
  if (tf.unit === "h") interval = "1h";
  else if (tf.unit === "d" || tf.unit === "w" || tf.unit === "mo") interval = "1day";

  const nativeSeconds = NATIVE_SECONDS[interval];
  const outputsize = Math.min(
    MAX_OUTPUTSIZE,
    Math.max(1, Math.ceil((TARGET_BARS * tf.seconds) / nativeSeconds)),
  );
  return { interval, aggregateSeconds: tf.seconds, outputsize };
}

// ─── Candle close countdown ──────────────────────────────────────────────────

/**
 * Compute the number of seconds until the current candle of the given
 * timeframe closes, based on UTC-aligned candle boundaries.
 */
export function candleSecondsLeft(timeframeId: string): number {
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const tf = getTimeframe(timeframeId);

  if (tf.unit === "mo") {
    const d = new Date(now);
    const nextClose = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + tf.count, 1);
    return Math.max(0, Math.floor((nextClose - now) / 1000));
  }

  if (tf.unit === "w") {
    // Forex week candles close at Monday 00:00 UTC
    const d = new Date(now);
    const dow = d.getUTCDay(); // 0=Sun … 6=Sat
    const daysUntilMon = (8 - dow) % 7 || 7;
    const nextClose = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysUntilMon);
    return Math.max(0, Math.floor((nextClose - now) / 1000));
  }

  // For d/h/m: align candle boundaries to UTC epoch multiples
  const periodSecs = tf.unit === "d" ? tf.count * 86_400 : tf.seconds;
  const nextClose = (Math.floor(nowSec / periodSecs) + 1) * periodSecs;
  return Math.max(0, nextClose - nowSec);
}

/**
 * Compute the UTC open timestamp (seconds) of the CURRENT candle for a
 * given timeframe.  This is the boundary where the new candle begins.
 */
export function candleOpenTime(timeframeId: string): number {
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const tf = getTimeframe(timeframeId);

  if (tf.unit === "mo") {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  }

  if (tf.unit === "w") {
    // Forex week candles open Monday 00:00 UTC
    const d = new Date(now);
    const dow = d.getUTCDay(); // 0=Sun … 6=Sat
    const daysFromMon = (dow + 6) % 7; // 0 on Mon, 6 on Sun
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysFromMon) / 1000;
  }

  const periodSecs = tf.unit === "d" ? tf.count * 86_400 : tf.seconds;
  return Math.floor(nowSec / periodSecs) * periodSecs;
}

/** Format a seconds value as a human-readable countdown string. */
export function formatCountdown(totalSeconds: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (totalSeconds >= 86_400) {
    const d = Math.floor(totalSeconds / 86_400);
    const h = Math.floor((totalSeconds % 86_400) / 3_600);
    const m = Math.floor((totalSeconds % 3_600) / 60);
    const s = totalSeconds % 60;
    return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  if (totalSeconds >= 3_600) {
    const h = Math.floor(totalSeconds / 3_600);
    const m = Math.floor((totalSeconds % 3_600) / 60);
    const s = totalSeconds % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${pad(m)}:${pad(s)}`;
}
