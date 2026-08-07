/**
 * useMarketData — provides live candle data for a pair + timeframe.
 *
 * Data strategy (provider-agnostic; currently backed by Twelve Data):
 *  • Full candle fetch — on symbol/TF change, manual refresh, or candle close
 *                        (triggered via `candleCloseEpoch` from useCandleTimer)
 *  • Live price ticks  — pushed continuously over SSE (`/api/price-stream`),
 *                        which itself is fed by a server-side poll loop
 *                        against Twelve Data. No client-side polling.
 *
 * Live candle rules (matches TradingView behaviour):
 *  • close  = latest tick price
 *  • high   = max(existing high, latest price)  — only ever increases
 *  • low    = min(existing low,  latest price)  — only ever decreases
 *  • On candle close: a new candle is appended IMMEDIATELY at the correct
 *    UTC boundary so the chart transitions without waiting for the API
 *    round-trip. The API response then replaces it with real data.
 *
 * Never falls back to synthetic data for historical candles — errors surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Candle } from "@/lib/forex";
import { fetchCandles } from "@/lib/market.functions";
import { candleOpenTime } from "@/lib/timeframes";

export type FeedStatus = "connecting" | "live" | "partial" | "error";

export interface MarketData {
  candles: Candle[];
  price: number | null;
  prevClose: number | null;
  status: FeedStatus;
  error: string | null;
  isLoading: boolean;
  refresh: () => void;
  /** Wall-clock ms timestamp of the last received tick or full reload. */
  lastUpdateAt: number | null;
}

// ─── Module-level cache ──────────────────────────────────────────────────────

interface CacheEntry {
  baseCandles: Candle[];
  price: number;
  prevClose: number | null;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 30_000;

function cacheKey(symbol: string, tf: string) {
  return `${symbol}|${tf}`;
}

/**
 * Apply the live price to the last (forming) candle.
 * High only ever increases; low only ever decreases.
 * Returns the same array reference if nothing changed (avoids re-renders).
 */
function applyLivePrice(base: Candle[], price: number): Candle[] {
  if (!base.length) return base;
  const last = base[base.length - 1];
  const newHigh = Math.max(last.high, price);
  const newLow = Math.min(last.low, price);
  if (price === last.close && newHigh === last.high && newLow === last.low) {
    return base; // nothing changed
  }
  const updated: Candle = { ...last, close: price, high: newHigh, low: newLow };
  return [...base.slice(0, -1), updated];
}

/**
 * Append a brand-new forming candle at the correct UTC boundary time.
 * Called the instant the timer hits 00:00 so the chart transitions
 * without waiting for the API round-trip.
 */
function appendNewCandle(base: Candle[], timeframeId: string, openPrice: number): Candle[] {
  if (openPrice <= 0) return base;
  const newTime = candleOpenTime(timeframeId);
  const lastTime = base.length ? base[base.length - 1].time : -1;
  // Guard: don't duplicate if the last candle is already at this boundary
  if (lastTime === newTime) return base;
  const newCandle: Candle = {
    time: newTime,
    open: openPrice,
    high: openPrice,
    low: openPrice,
    close: openPrice,
  };
  return [...base, newCandle];
}

export function useMarketData(
  symbol: string,
  timeframeId: string,
  /** Increments each time a candle closes — drives automatic full reloads. */
  candleCloseEpoch: number = 0,
): MarketData {
  const initEntry = cache.get(cacheKey(symbol, timeframeId));
  const [baseCandles, setBaseCandles] = useState<Candle[]>(initEntry?.baseCandles ?? []);
  const [price, setPrice] = useState<number | null>(initEntry?.price ?? null);
  const [prevClose, setPrevClose] = useState<number | null>(initEntry?.prevClose ?? null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(initEntry?.at ?? null);

  const reqId = useRef(0);
  // Keep stable refs so the persistent SSE effect (which only re-runs on
  // symbol change) always reads the latest price/timeframe, not a stale
  // closure value.
  const priceRef = useRef<number | null>(price);
  priceRef.current = price;
  const timeframeIdRef = useRef(timeframeId);
  timeframeIdRef.current = timeframeId;

  // ── Full candle fetch (historical backfill) ────────────────────────────────
  const loadCandles = useCallback(
    async (isBackground: boolean) => {
      const id = ++reqId.current;

      try {
        const res = await fetchCandles({ data: { symbol, timeframeId } });
        if (id !== reqId.current) return; // superseded

        if (res.ok) {
          cache.set(cacheKey(symbol, timeframeId), {
            baseCandles: res.candles,
            price: res.price,
            prevClose: res.prevClose,
            at: Date.now(),
          });
          setBaseCandles(res.candles);
          setPrice((p) => p ?? res.price);
          setPrevClose(res.prevClose);
          setHistoryError(null);
          setLastUpdateAt(Date.now());
        } else if (!isBackground) {
          setHistoryError(res.error);
        }
      } catch (err) {
        if (id !== reqId.current) return;
        if (!isBackground) {
          setHistoryError(err instanceof Error ? err.message : "Network error");
        }
      }
    },
    [symbol, timeframeId],
  );

  // ── Initial / on-symbol-or-TF-change load ────────────────────────────────
  useEffect(() => {
    const warm = cache.get(cacheKey(symbol, timeframeId));
    if (warm) {
      setBaseCandles(warm.baseCandles);
      setPrice(warm.price);
      setPrevClose(warm.prevClose);
      setHistoryError(null);
      if (Date.now() - warm.at > CACHE_TTL) void loadCandles(true);
    } else {
      setBaseCandles([]);
      setHistoryError(null);
      void loadCandles(false);
    }
  }, [symbol, timeframeId, loadCandles]);

  // ── Live price stream (SSE, pushed from the server's Twelve Data poll loop) ──
  useEffect(() => {
    setStreamConnected(false);
    const es = new EventSource(`/api/price-stream?symbol=${encodeURIComponent(symbol)}`);

    es.onopen = () => setStreamConnected(true);
    es.onerror = () => setStreamConnected(false); // EventSource retries automatically

    es.onmessage = (ev) => {
      setStreamConnected(true);
      try {
        const payload = JSON.parse(ev.data) as { price: number; timestamp: number };
        if (!Number.isFinite(payload.price)) return;
        setPrice(payload.price);
        priceRef.current = payload.price;
        setLastUpdateAt(Date.now());
        // No historical backfill yet (e.g. provider plan limitation) — seed
        // the very first forming candle from this real tick so the chart
        // isn't blank while waiting for history. Still 100% real data.
        setBaseCandles((prev) =>
          prev.length === 0 ? appendNewCandle(prev, timeframeIdRef.current, payload.price) : prev,
        );
        const entry = cache.get(cacheKey(symbol, timeframeIdRef.current));
        if (entry) cache.set(cacheKey(symbol, timeframeIdRef.current), { ...entry, price: payload.price });
      } catch {
        // Ignore malformed frames
      }
    };

    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // ── Candle-close: instant new candle + background history refetch ─────────
  useEffect(() => {
    if (candleCloseEpoch === 0) return; // skip mount

    // 1. Immediately append a new candle at the correct UTC boundary so the
    //    chart transitions without a gap while the API request is in-flight.
    const openPrice = priceRef.current ?? 0;
    setBaseCandles((prev) => appendNewCandle(prev, timeframeId, openPrice));

    // 2. Refresh history in the background (fills real OHLC once available).
    void loadCandles(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candleCloseEpoch]);

  // ── Derive display candles (live price applied to forming candle) ─────────
  const candles = useMemo(
    () => (price != null ? applyLivePrice(baseCandles, price) : baseCandles),
    [baseCandles, price],
  );

  const refresh = useCallback(() => void loadCandles(false), [loadCandles]);

  const status: FeedStatus =
    !streamConnected && candles.length === 0
      ? "connecting"
      : historyError
        ? "partial" // live ticks may still be flowing even though history failed
        : streamConnected
          ? "live"
          : "connecting";

  return {
    candles,
    price,
    prevClose,
    status,
    error: historyError,
    isLoading: status === "connecting" && baseCandles.length === 0,
    refresh,
    lastUpdateAt,
  };
}
