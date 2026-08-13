/**
 * FuturesChart — full trading-terminal panel for Binance crypto futures.
 *
 * Data source: Binance Futures public API through server functions.
 * The browser never connects to Binance directly, avoiding regional and
 * bot-protection failures while keeping credentials and provider details
 * behind the application's server boundary.
 *
 * SMC overlay: identical canvas approach to TradingChart.tsx — useLayoutEffect
 * for chart init, rAF loop + subscribeVisibleLogicalRangeChange for smooth
 * redraws, same BOS/CHoCH/IDM/OB/FVG/LQ/POI drawing routines.
 *
 * Self-contained — zero Forex code imported. Adding a Forex section later
 * requires no changes here.
 */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
} from "lightweight-charts";
import { Layers, Lock, Plus, Radio, RefreshCw, Search, Timer, TrendingDown, TrendingUp, X, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

import { getMyMembership } from "@/lib/membership.functions";
import { SlowConnectionBanner } from "@/components/SlowConnectionBanner";
import { reportRequestLatency } from "@/lib/network-status";
import { useAuthSession } from "@/hooks/use-auth";
import { useCandleTimer } from "@/hooks/use-candle-timer";
import { useTimeframeBar } from "@/hooks/use-timeframes";
import type { Candle } from "@/lib/forex";
import { DEFAULT_TIMEFRAME_IDS, QUICK_TIMEFRAME_IDS, getTimeframe } from "@/lib/timeframes";
import {
  aggregateFuturesCandles,
  futuresIntervalPlan,
  nativeBatchLimit,
  timeframeHistoryCutoff,
  TARGET_STRUCTURE_BARS,
} from "@/lib/futures-timeframes";
import { cn } from "@/lib/utils";
import {
  TOOLS,
  type ToolId,
  type Zone,
  analyze,
  zonesForTools,
  detectAllBOS,
  detectVisibleIDM,
  zonesInVisibleRange,
} from "@/lib/smc";
import { getToolColor, subscribeToolColors, useToolColors } from "@/lib/tool-colors";
import { ToolColorPicker } from "@/components/ToolColorPicker";

const FREE_TOOLS = new Set<ToolId>(TOOLS.filter((t) => t.tier === "free").map((t) => t.id));
const PREMIUM_TOOLS = new Set<ToolId>(TOOLS.filter((t) => t.tier === "premium").map((t) => t.id));


// ─── constants ────────────────────────────────────────────────────────────────

/** Shown immediately; replaced once exchangeInfo loads. */
const DEFAULT_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT",
  "MATICUSDT", "LTCUSDT", "BCHUSDT", "UNIUSDT", "ATOMUSDT",
];

const LIVE_WINDOW_BARS = 110;

// ─── chart palette (matches site theme) ──────────────────────────────────────

const C = {
  bg:        "#0A1428",
  text:      "#a9b3c4",
  grid:      "rgba(43,52,68,0.55)",
  border:    "rgba(60,72,92,0.7)",
  bull:      "#26a69a",
  bear:      "#ef5350",
  crosshair: "rgba(148,163,184,0.5)",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

const toolColor = (id: Zone["tool"]): string => getToolColor(id);

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function formatLegendPrice(v: number): string {
  if (v > 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v > 1)    return v.toFixed(4);
  if (v > 0.01) return v.toFixed(6);
  return v.toFixed(8);
}

function formatLivePrice(v: number): string {
  if (v > 100) return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v > 1)   return v.toFixed(4);
  return v.toFixed(6);
}

interface SymbolPriceFormat {
  precision: number;
  minMove: number;
}

interface ExchangeSymbol {
  symbol: string;
  status: string;
  contractType: string;
  quoteAsset: string;
  pricePrecision?: number;
  filters?: Array<{
    filterType?: string;
    tickSize?: string;
  }>;
}

function decimalsFromTickSize(tickSize: string): number {
  const normalized = tickSize.toLowerCase();
  if (normalized.includes("e-")) {
    const exponent = Number(normalized.split("e-")[1]);
    return Number.isInteger(exponent) ? exponent : 0;
  }
  const fraction = normalized.split(".")[1]?.replace(/0+$/, "") ?? "";
  return fraction.length;
}

function priceFormatForSymbol(item: ExchangeSymbol): SymbolPriceFormat {
  const tickSizeText = item.filters?.find((filter) => filter.filterType === "PRICE_FILTER")?.tickSize;
  const tickSize = Number(tickSizeText);
  const precision = tickSizeText
    ? decimalsFromTickSize(tickSizeText)
    : Math.max(0, Math.min(8, item.pricePrecision ?? 2));
  return {
    precision,
    minMove: Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 10 ** -precision,
  };
}

/** Major, high-volume markets pinned to the top of the pair list. */
const MAJOR_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT",
  "ADAUSDT", "AVAXUSDT", "LINKUSDT", "TRXUSDT", "DOTUSDT", "LTCUSDT",
  "BCHUSDT", "TONUSDT", "SUIUSDT", "NEARUSDT", "APTUSDT", "ATOMUSDT",
  "ETCUSDT", "FILUSDT", "ARBUSDT", "OPUSDT", "UNIUSDT", "AAVEUSDT",
  "INJUSDT", "HBARUSDT", "XLMUSDT", "ICPUSDT", "SEIUSDT", "TIAUSDT",
];

/** How many pair rows to render at a time (windowed list for 500+ pairs). */
const PAGE_SIZE = 40;



// ─── component ────────────────────────────────────────────────────────────────

export function FuturesChart() {
  // ── DOM / chart refs ──────────────────────────────────────────────────────
  const containerRef   = useRef<HTMLDivElement>(null);
  const overlayRef     = useRef<HTMLCanvasElement>(null);
  const chartRef       = useRef<IChartApi | null>(null);
  const seriesRef      = useRef<ISeriesApi<"Candlestick"> | null>(null);

  // Stable ref to the overlay draw function (refreshed each render)
  const drawOverlay    = useRef<() => void>(() => {});

  // Mutable refs for values read inside the overlay without triggering re-renders
  const candlesRef     = useRef<Candle[]>([]);
  const zonesRef       = useRef<Zone[]>([]);
  const enabledRef     = useRef<Set<ToolId>>(new Set<ToolId>());
  const liveCloseRef   = useRef<number | null>(null);
  const bosCacheRef    = useRef<{ key: string; result: ReturnType<typeof detectAllBOS> } | null>(null);
  const idmCacheRef    = useRef<{ key: string; result: Zone[] } | null>(null);
  /** Latest forming candle pushed by the live WS feed. */
  const liveCandleRef  = useRef<Candle | null>(null);
  /** symbol|timeframe key of the last fitContent, so live refreshes don't reset the viewport. */
  const fitKeyRef      = useRef("");
  /** Authoritative owner of every async chart update. Stale requests/sockets must match this key. */
  const selectionKeyRef = useRef("BTCUSDT|1m");
  const historyRequestRef = useRef(0);
  const historyAbortRef = useRef<AbortController | null>(null);
  const foregroundLoadingRef = useRef(true);
  const olderLoadingRef = useRef(false);
  const olderAbortRef = useRef<AbortController | null>(null);
  const historyStartRef = useRef<number | null>(null);
  const reachedHistoryLimitRef = useRef(false);
  const loadOlderRef = useRef<() => void>(() => {});

  // ── state ─────────────────────────────────────────────────────────────────
  const [allSymbols,   setAllSymbols]   = useState<string[]>(DEFAULT_SYMBOLS);
  const [promotedSymbols, setPromotedSymbols] = useState<string[]>([]);
  const [query,        setQuery]        = useState("");
  const [symbol,       setSymbol]       = useState("BTCUSDT");
  const [timeframe,    setTimeframe]    = useState("1m");
  const [baseCandles,  setBaseCandles]  = useState<Candle[]>([]);
  const [liveCandle,   setLiveCandle]   = useState<Candle | null>(null);
  const [livePrice,    setLivePrice]    = useState<number | null>(null);
  // Y-coordinate (px) of the live price on the chart + right-axis width, so the
  // price/countdown badge sits exactly on the price scale (same as Forex).
  const [priceY,       setPriceY]       = useState<number | null>(null);
  const [scaleWidth,   setScaleWidth]   = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [retryKey,     setRetryKey]     = useState(0);
  const [enabledTools, setEnabledTools] = useState<Set<ToolId>>(
    () => new Set<ToolId>(FREE_TOOLS),
  );
  const [legend, setLegend] = useState<Candle | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [colorPickerTool, setColorPickerTool] = useState<ToolId | null>(null);
  const toolColors = useToolColors();
  const [timeframePickerOpen, setTimeframePickerOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [customError, setCustomError] = useState("");
  const [membershipActive, setMembershipActive] = useState(typeof window !== "undefined" && window.localStorage.getItem("smc-verify") === "1");
  const [changes, setChanges] = useState<Record<string, number>>({});
  const [pairPrices, setPairPrices] = useState<Record<string, number>>({});
  const [pairVolumes, setPairVolumes] = useState<Record<string, number>>({});
  const [symbolPriceFormats, setSymbolPriceFormats] = useState<Record<string, SymbolPriceFormat>>({});
  const [isScrolledBack, setIsScrolledBack] = useState(false);
  const isScrolledBackRef = useRef(false);
  const [isSyncingLive, setIsSyncingLive] = useState(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeframeBar = useTimeframeBar();
  const fetchKlines = useCallback(
    async (requestedSymbol: string, requestedInterval: string, limit = 500, signal?: AbortSignal, endTime?: number) => {
      const plan = futuresIntervalPlan(requestedInterval);
      const params = new URLSearchParams({
        symbol: requestedSymbol,
        interval: plan.binanceInterval,
        limit: String(limit),
      });
      if (endTime != null) params.set("endTime", String(endTime));
      const startedAt = Date.now();
      let response: Response;
      try {
        response = await fetch(`https://cgirdlkuarpzrpaybrkb.supabase.co/functions/v1/hyper-task?type=klines&${params}`, { signal });
      } finally {
        if (!signal?.aborted) reportRequestLatency(Date.now() - startedAt);
      }
      if (!response.ok) throw new Error(`Failed to load chart data (${response.status})`);
      const rows = (await response.json()) as unknown[][];
      const parsed = rows
        .map((row) => ({
          time: Math.floor(Number(row[0]) / 1000),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
        }))
        .filter((candle) =>
          [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
          candle.high >= candle.low &&
          candle.open <= candle.high && candle.open >= candle.low &&
          candle.close <= candle.high && candle.close >= candle.low,
        ) as Candle[];
      return aggregateFuturesCandles(parsed, plan);
    },
    [],
  );

  const mergeCandles = useCallback((older: Candle[], newer: Candle[]) => {
    const merged = new Map<number, Candle>();
    for (const candle of older) merged.set(candle.time, { ...candle });
    for (const candle of newer) {
      const previous = merged.get(candle.time);
      merged.set(candle.time, previous
        ? {
            time: candle.time,
            open: previous.open,
            high: Math.max(previous.high, candle.high),
            low: Math.min(previous.low, candle.low),
            close: candle.close,
          }
        : { ...candle });
    }
    return [...merged.values()].sort((a, b) => a.time - b.time);
  }, []);

  const fetchTicker = useCallback(async () => {
    const response = await fetch("https://cgirdlkuarpzrpaybrkb.supabase.co/functions/v1/hyper-task?type=ticker");
    if (!response.ok) throw new Error(`Failed to load ticker data (${response.status})`);
    const rows = (await response.json()) as { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume?: string }[];
    const nextChanges: Record<string, number> = {};
    const nextPrices: Record<string, number> = {};
    const nextVolumes: Record<string, number> = {};
    for (const row of rows) {
      const change = Number(row.priceChangePercent);
      const price = Number(row.lastPrice);
      const volume = Number(row.quoteVolume);
      if (Number.isFinite(change)) nextChanges[row.symbol] = change;
      if (Number.isFinite(price) && price > 0) nextPrices[row.symbol] = price;
      if (Number.isFinite(volume) && volume > 0) nextVolumes[row.symbol] = volume;
    }
    return { changes: nextChanges, prices: nextPrices, volumes: nextVolumes };
  }, []);


  const fetchSymbols = useCallback(async () => {
    const response = await fetch("https://cgirdlkuarpzrpaybrkb.supabase.co/functions/v1/hyper-task?type=exchange-info");
    if (!response.ok) throw new Error(`Failed to load symbols (${response.status})`);
    const data = (await response.json()) as { symbols: ExchangeSymbol[] };
    const instruments = data.symbols.filter(
      (item) => item.status === "TRADING" && item.contractType === "PERPETUAL" && item.quoteAsset === "USDT",
    );
    return {
      symbols: instruments.map((item) => item.symbol).sort(),
      priceFormats: Object.fromEntries(
        instruments.map((item) => [item.symbol, priceFormatForSymbol(item)]),
      ),
    };
  }, []);

  const updateScrolledState = useCallback(() => {
    const range = chartRef.current?.timeScale().getVisibleLogicalRange();
    const lastIndex = candlesRef.current.length - 1;
    const next = Boolean(range && lastIndex >= 0 && range.to < lastIndex - 0.25);
    if (next === isScrolledBackRef.current) return;
    isScrolledBackRef.current = next;
    setIsScrolledBack(next);
  }, []);

  const zoom = useCallback((factor: number) => {
    const scale = chartRef.current?.timeScale();
    const range = scale?.getVisibleLogicalRange();
    if (!scale || !range) return;
    const center = (range.from + range.to) / 2;
    const half = Math.max(5, ((range.to - range.from) * factor) / 2);
    scale.setVisibleLogicalRange({ from: center - half, to: center + half });
  }, []);

  const backToLive = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    setIsSyncingLive(true);
    const sync = async () => {
      const requestedKey = `${symbol}|${timeframe}`;
      try {
        const latest = await fetchKlines(symbol, timeframe, nativeBatchLimit(futuresIntervalPlan(timeframe)));
        if (selectionKeyRef.current !== requestedKey) return;
        const candle = latest[latest.length - 1];
        if (candle) {
          liveCloseRef.current = candle.close;
          seriesRef.current?.update({ ...candle, time: candle.time as UTCTimestamp });
          setLivePrice(candle.close);
        }
      } catch {
        // Existing live data remains usable if the one-shot refresh fails.
      }
      const scale = chartRef.current?.timeScale();
      const lastIndex = candlesRef.current.length - 1;
      if (scale && lastIndex >= 0) {
        scale.setVisibleLogicalRange({
          from: Math.max(0, lastIndex - LIVE_WINDOW_BARS + 1),
          to: lastIndex + 6,
        });
      }
      chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
      setIsScrolledBack(false);
      isScrolledBackRef.current = false;
      setIsSyncingLive(false);
    };
    void sync();
  }, [symbol, timeframe]);

  // ── Displayed candles = history merged with the live forming candle ───────
  const candles = useMemo<Candle[]>(() => {
    if (!liveCandle) return baseCandles;
    const last = baseCandles[baseCandles.length - 1];
    if (!last) return [liveCandle];
    if (liveCandle.time < last.time) return baseCandles;
    if (liveCandle.time === last.time) return [...baseCandles.slice(0, -1), liveCandle];
    return [...baseCandles, liveCandle];
  }, [baseCandles, liveCandle]);

  // Keep mutable refs in sync with current state/values
  candlesRef.current = candles;
  enabledRef.current = enabledTools;

  // ── Candle set used for SMC analysis ──────────────────────────────────────
  // Identity only changes when a *new candle opens* (or history reloads), so
  // the expensive SMC passes never re-run on an intra-candle price tick.
  const liveCandleTime = liveCandle?.time ?? 0;
  const analysisCandles = useMemo<Candle[]>(() => {
    const live = liveCandleRef.current;
    const last = baseCandles[baseCandles.length - 1];
    if (!live || !last) return baseCandles;
    if (live.time > last.time) return [...baseCandles, live];
    return baseCandles;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCandles, liveCandleTime]);
  const analysisCandlesRef = useRef<Candle[]>(analysisCandles);
  analysisCandlesRef.current = analysisCandles;


  // ── Membership gating: IDM + BOS free, everything else premium ────────────
  const { session } = useAuthSession();
  const _fetchMembership = useServerFn(getMyMembership);
  const fetchMembership = useCallback(_fetchMembership, []);
  useEffect(() => {
    const lock = () => {
      if (typeof window !== "undefined" && window.localStorage.getItem("smc-verify") === "1") return;
      setMembershipActive(false);
      setEnabledTools((prev) => {
        const next = new Set(prev);
        PREMIUM_TOOLS.forEach((id) => next.delete(id));
        return next;
      });
    };
    if (!session) {
      lock();
      return;
    }
    let cancelled = false;
    const check = () =>
      fetchMembership()
        .then((r) => {
          if (cancelled) return;
          const active = !!r.isActive;
          setMembershipActive(active);
          if (!active) lock();
        })
        .catch(() => {
          if (!cancelled) lock();
        });
    check();
    const t = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [session, fetchMembership]);

  // ── 24h % change + list prices for pair cards (self-healing) ──────────────
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const load = () =>
      fetchTicker()
        .then((ticker) => {
          if (cancelled) return;
          setChanges(ticker.changes);
          setPairPrices(ticker.prices);
          setPairVolumes(ticker.volumes);
        })
        .catch(() => {
          // Retry quickly on failure so pair rows never stay stuck without a price.
          if (cancelled || retry) return;
          retry = setTimeout(() => {
            retry = null;
            void load();
          }, 5_000);
        });
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, 30_000);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchTicker]);


  // ── SMC analysis (recomputed only when candles close, not on price ticks) ──
  const analysis = useMemo(
    () => (analysisCandles.length >= 10 ? analyze(analysisCandles) : null),
    [analysisCandles],
  );

  // ── SMC zones (memoized — BOS/CHoCH drawn directly in overlay) ────────────
  const zones = useMemo<Zone[]>(() => {
    if (!analysis) return [];
    // Exclude bos/choch from the zones array; the overlay draws them via
    // detectAllBOS so they remain live on pan/zoom without re-analyzing.
    return zonesForTools({ ...analysis, bos: [], choch: [] }, enabledTools);
  }, [analysis, enabledTools]);
  zonesRef.current = zones;

  // ── overlay draw (updated each render via ref) ────────────────────────────
  drawOverlay.current = () => {
    const chart     = chartRef.current;
    const series    = seriesRef.current;
    const cvs       = overlayRef.current;
    const container = containerRef.current;
    if (!chart || !series || !cvs || !container) return;

    const cssW = container.clientWidth;
    const cssH = container.clientHeight;
    const dpr  = window.devicePixelRatio || 1;

    if (cvs.width !== cssW * dpr || cvs.height !== cssH * dpr) {
      cvs.width        = cssW * dpr;
      cvs.height       = cssH * dpr;
      cvs.style.width  = `${cssW}px`;
      cvs.style.height = `${cssH}px`;
    }

    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const cs = candlesRef.current;
    if (cs.length === 0) return;

    const ts        = chart.timeScale();
    const paneRight = ts.width();
    const visRange  = ts.getVisibleLogicalRange();
    const visFrom   = visRange ? Math.floor(visRange.from) : 0;
    const visTo     = visRange ? Math.ceil(visRange.to)   : cs.length - 1;

    const xOf = (idx: number): number | null => {
      const i = Math.max(0, Math.min(cs.length - 1, idx));
      return ts.timeToCoordinate(cs[i].time as UTCTimestamp) ?? null;
    };
    const yOf = (price: number): number | null =>
      series.priceToCoordinate(price) ?? null;

    // ── IDM (visible-window scoped) ──────────────────────────────────────────
    // Detection runs on the closed-candle set: the cache key deliberately omits
    // the forming candle's close so intra-candle ticks never re-run the pass.
    const idmEnabled = enabledRef.current.has("idm");
    const ac = analysisCandlesRef.current;
    const acLast = ac[ac.length - 1];
    const idmKey = [symbol, timeframe, ac.length, acLast?.time ?? 0].join(":");
    if (idmEnabled && ac.length >= 15) {
      if (!idmCacheRef.current || idmCacheRef.current.key !== idmKey) {
        idmCacheRef.current = { key: idmKey, result: detectVisibleIDM(ac, 0, ac.length - 1) };
      }
    } else {
      idmCacheRef.current = null;
    }
    const visibleIDM = idmEnabled ? (idmCacheRef.current?.result ?? []) : [];


    // ── Non-BOS/CHoCH zones + IDM ────────────────────────────────────────────
    // OB / FVG / POI are anchored to their originating candle, so only the ones
    // formed inside the currently visible candle range are drawn.
    const visibleZones = zonesInVisibleRange(
      zonesRef.current.filter((z) => z.tool !== "idm"),
      visFrom,
      visTo,
    ).filter((z) => z.startIndex <= visTo && (z.endIndex == null || z.endIndex >= visFrom));


for (const z of [...visibleZones, ...visibleIDM]) {
      const baseColor = toolColor(z.tool);
      const alpha     = z.tool === "idm" && z.swept ? 0.35 : 1;

      let x0 = xOf(z.startIndex);
      if (x0 == null) x0 = 0;
      const x1 = paneRight;

      if (z.priceHigh != null && z.priceLow != null) {
        // ── Box zone (OB, FVG, POI, LQ) ────────────────────────────────────
        const yh = yOf(z.priceHigh);
        const yl = yOf(z.priceLow);
        if (yh == null || yl == null) continue;
        const top = Math.min(yh, yl);
        const h   = Math.abs(yl - yh);
        const provisionalMul = z.provisional ? 0.6 : 1;
        ctx.fillStyle   = hexToRgba(baseColor, 0.1 * alpha * provisionalMul);
        ctx.fillRect(x0, top, x1 - x0, h);
        ctx.strokeStyle = hexToRgba(baseColor, 0.85 * alpha * provisionalMul);
        ctx.lineWidth   = 1;
        ctx.setLineDash(z.provisional ? [4, 3] : []);
        ctx.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, h);
        ctx.setLineDash([]);
        ctx.fillStyle   = hexToRgba(baseColor, 0.95 * alpha * provisionalMul);
        ctx.font        = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "bottom";
        ctx.fillText(z.provisional ? `${z.label}?` : z.label, x0 + 4, top - 1 > 10 ? top - 1 : top + 11);
      } else if (z.price != null) {
        const y = yOf(z.price);
        if (y == null) continue;

        if (z.tool === "idm") {
          // ── IDM dashed line ────────────────────────────────────────────────
          const swept     = !!z.swept;
          const lineAlpha = swept ? 0.3 : 0.9;
          const fillAlpha = swept ? 0.35 : 0.95;
          const xRight    = swept && z.sweepIndex != null ? (xOf(z.sweepIndex) ?? x1) : x1;
          const lineStart = Math.max(0, x0);
          const lineEnd   = Math.max(lineStart, xRight);
          if (swept && lineEnd <= 0) continue;

          ctx.strokeStyle = hexToRgba(baseColor, lineAlpha);
          ctx.lineWidth   = 1.5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(lineStart, y);
          ctx.lineTo(lineEnd, y);
          ctx.stroke();
          ctx.setLineDash([]);

          if (x0 >= 0 && x0 <= x1) {
            ctx.fillStyle = hexToRgba(baseColor, fillAlpha);
            ctx.beginPath();
            ctx.arc(x0, y, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          const labelX = Math.max(4, Math.min(x0 + 8, x1 - 46));
          ctx.fillStyle   = hexToRgba(baseColor, fillAlpha);
          ctx.font        = "bold 10px ui-sans-serif, system-ui, sans-serif";
          ctx.textBaseline = "bottom";
          ctx.fillText(z.label, labelX, y - 3);

        } else if (z.tool === "bos" || z.tool === "choch") {
          continue; // handled below via detectAllBOS
        } else {
          // ── Generic line zone (LQ) ─────────────────────────────────────────
          ctx.strokeStyle = hexToRgba(baseColor, 0.9 * alpha);
          ctx.lineWidth   = 1;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle   = hexToRgba(baseColor, 0.95 * alpha);
          ctx.font        = "10px ui-sans-serif, system-ui, sans-serif";
          ctx.textBaseline = "bottom";
          ctx.fillText(z.label, x0 + 4, y - 2);
        }
      }
    }

    // ── BOS / CHoCH (full-history detection, visible-range filter) ───────────
    const bosEnabled   = enabledRef.current.has("bos");
    const chochEnabled = enabledRef.current.has("choch");

    if (ac.length >= 10 && (bosEnabled || chochEnabled)) {
      // Keyed on symbol + timeframe so a switch can never reuse the previous
      // market's structure, and on the closed-candle set so new closes update live.
      const cacheKey = [symbol, timeframe, ac.length, acLast?.time ?? 0].join(":");
      if (!bosCacheRef.current || bosCacheRef.current.key !== cacheKey) {
        bosCacheRef.current = { key: cacheKey, result: detectAllBOS(ac) };
      }
      const { bos: bosAll, choch: chochAll } = bosCacheRef.current.result;
      const visible: Zone[] = [];
      if (bosEnabled)   visible.push(...bosAll.filter((z)  => z.endIndex >= visFrom && z.startIndex <= visTo));
      if (chochEnabled) visible.push(...chochAll.filter((z) => z.endIndex >= visFrom && z.startIndex <= visTo));

      for (const z of visible) {
        if (z.price == null) continue;
        const y = yOf(z.price);
        if (y == null || y < -20 || y > cssH + 20) continue;

        const color  = toolColor(z.tool);
        const xSwing = xOf(z.startIndex);
        const xBreak = xOf(z.endIndex);
        const lineStart = xSwing != null ? Math.max(0, xSwing) : 0;
        const lineEnd   = xBreak != null ? Math.min(paneRight, xBreak) : paneRight;
        if (lineEnd <= 0 || lineStart >= paneRight) continue;

        ctx.strokeStyle = hexToRgba(color, 0.9);
        ctx.lineWidth   = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(lineStart, y);
        ctx.lineTo(lineEnd, y);
        ctx.stroke();

        if (xSwing != null && xSwing >= 0 && xSwing <= paneRight) {
          ctx.fillStyle = hexToRgba(color, 0.95);
          ctx.beginPath();
          ctx.arc(xSwing, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }

        if (xBreak != null && xBreak >= 0 && xBreak <= paneRight) {
          const text  = z.label;
          ctx.font    = "bold 11px ui-sans-serif, system-ui, sans-serif";
          const tw    = ctx.measureText(text).width;
          const padX  = 6;
          const bW    = tw + padX * 2;
          const bH    = 18;
          const isBull = z.kind === "bullish";
          const bX    = Math.max(0, Math.min(xBreak - bW / 2, paneRight - bW));
          const bY    = isBull ? y - bH - 5 : y + 5;
          const r     = 3;

          ctx.fillStyle = hexToRgba(color, 0.92);
          ctx.beginPath();
          ctx.moveTo(bX + r, bY);
          ctx.lineTo(bX + bW - r, bY);
          ctx.quadraticCurveTo(bX + bW, bY, bX + bW, bY + r);
          ctx.lineTo(bX + bW, bY + bH - r);
          ctx.quadraticCurveTo(bX + bW, bY + bH, bX + bW - r, bY + bH);
          ctx.lineTo(bX + r, bY + bH);
          ctx.quadraticCurveTo(bX, bY + bH, bX, bY + bH - r);
          ctx.lineTo(bX, bY + r);
          ctx.quadraticCurveTo(bX, bY, bX + r, bY);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle   = "rgba(5,10,18,0.95)";
          ctx.textBaseline = "middle";
          ctx.fillText(text, bX + padX, bY + bH / 2 + 0.5);

          ctx.strokeStyle = hexToRgba(color, 0.5);
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.moveTo(xBreak, y);
          ctx.lineTo(xBreak, isBull ? bY + bH : bY);
          ctx.stroke();
        }
      }
    }
  };

  // ── chart init — useLayoutEffect so the container is sized before createChart ──
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      localization: { locale: "en-US" },
      layout: {
        background:      { color: C.bg },
        textColor:       C.text,
        fontFamily:      "ui-sans-serif, system-ui, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: C.grid },
        horzLines: { color: C.grid },
      },
      crosshair: {
        mode:     CrosshairMode.Normal,
        vertLine: { color: C.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1b2436" },
        horzLine: { color: C.crosshair, width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1b2436" },
      },
      rightPriceScale: {
        borderColor:  C.border,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor:    C.border,
        timeVisible:    true,
        secondsVisible: false,
        rightOffset:    6,
      },
      handleScroll: true,
      handleScale:  true,
      autoSize:     false,
    });

    const series = chart.addCandlestickSeries({
      upColor:          C.bull,
      downColor:        C.bear,
      borderUpColor:    C.bull,
      borderDownColor:  C.bear,
      wickUpColor:      C.bull,
      wickDownColor:    C.bear,
      priceLineVisible: true,
      priceLineColor:   "#2962ff",
      priceLineWidth:   1,
      lastValueVisible: false,
    });

    chartRef.current  = chart;
    seriesRef.current = series;

    chart.resize(container.clientWidth, container.clientHeight);

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) { chart.resize(w, h); drawOverlay.current(); }
    });
    ro.observe(container);

    const onRange = () => {
      drawOverlay.current();
      updateScrolledState();
      const range = chart.timeScale().getVisibleLogicalRange();
      if (range && range.from < 75) loadOlderRef.current();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    // rAF loop — detects price-scale shifts (lightweight-charts v4 has no
    // subscription for this), redraws overlay so BOS/IDM lines never drift and
    // keeps the live price / countdown badge glued to the price axis.
    let rafId: number;
    let lastRafY: number | null | undefined = undefined;
    let lastRafAt = 0;
    const RAF_MIN_INTERVAL = 16;
    const rafLoop = () => {
      if (document.hidden) {
        rafId = requestAnimationFrame(rafLoop);
        return;
      }
      const now = performance.now();
      if (now - lastRafAt < RAF_MIN_INTERVAL) {
        rafId = requestAnimationFrame(rafLoop);
        return;
      }
      lastRafAt = now;
      const s     = seriesRef.current;
      const close = liveCloseRef.current ?? candlesRef.current[candlesRef.current.length - 1]?.close;
      if (s && close != null) {
        const y = s.priceToCoordinate(close);
        if (y != null && (lastRafY == null || Math.abs(y - lastRafY) >= 0.1)) {
          lastRafY = y;
          setPriceY(y ?? null);
          setScaleWidth(chart.priceScale("right").width());
          drawOverlay.current();
        }
      }
      rafId = requestAnimationFrame(rafLoop);
    };
    rafId = requestAnimationFrame(rafLoop);

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData.size) { setLegend(null); return; }
      const d = param.seriesData.get(series as ISeriesApi<"Candlestick">) as CandlestickData | undefined;
      if (!d) return;
      setLegend({ time: Number(param.time), open: d.open, high: d.high, low: d.low, close: d.close });
    });

    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      cancelAnimationFrame(rafId);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      ro.disconnect();
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  }, [updateScrolledState]);

  // ── fetch all USDT perpetual pairs from Binance exchangeInfo ──────────────
  useEffect(() => {
    fetchSymbols()
      .then(({ symbols, priceFormats }) => {
        if (symbols.length > 0) setAllSymbols(symbols);
        setSymbolPriceFormats(priceFormats);
      })
      .catch(() => { /* keep DEFAULT_SYMBOLS */ });
  }, [fetchSymbols]);

  // ── load historical klines (re-runs on symbol / timeframe / retry change) ─
  const loadHistory = useCallback(
    async (background: boolean) => {
      // A candle-close refresh must never cancel the initial load for a newly
      // selected market, otherwise that market can remain on an empty chart.
      if (background && foregroundLoadingRef.current) return;
      const requestedSymbol = symbol;
      const requestedTimeframe = timeframe;
      const requestedKey = `${requestedSymbol}|${requestedTimeframe}`;
      const requestId = ++historyRequestRef.current;
      historyAbortRef.current?.abort();
      const controller = new AbortController();
      historyAbortRef.current = controller;

      if (!background) {
        foregroundLoadingRef.current = true;
        setLoading(true);
        setError(null);
        setLivePrice(null);
        liveCloseRef.current = null;
        liveCandleRef.current = null;
        setLiveCandle(null);
        // Clear the chart immediately so the old data doesn't flash
        seriesRef.current?.setData([]);
        setBaseCandles([]);
      }
      try {
        let klines: Candle[] = [];
        let lastFailure: unknown;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            const plan = futuresIntervalPlan(requestedTimeframe);
            const initialLimit = plan.aggregateSeconds ? nativeBatchLimit(plan) : TARGET_STRUCTURE_BARS;
            klines = await fetchKlines(requestedSymbol, requestedTimeframe, initialLimit, controller.signal);
            if (klines.length > 0) break;
          } catch (failure) {
            lastFailure = failure;
            if (controller.signal.aborted) throw failure;
          }
          await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        }
        if (
          controller.signal.aborted ||
          historyRequestRef.current !== requestId ||
          selectionKeyRef.current !== requestedKey
        ) return;
        if (klines.length === 0) {
          throw lastFailure instanceof Error
            ? lastFailure
            : new Error(`No candle data returned for ${requestedSymbol}`);
        }
        historyStartRef.current = klines[0]?.time ?? null;
        setBaseCandles(klines);
        const latest = klines[klines.length - 1];
        liveCloseRef.current = latest.close;
        setLivePrice(latest.close);
        if (!background) setError(null);
      } catch (e) {
        if (
          controller.signal.aborted ||
          historyRequestRef.current !== requestId ||
          selectionKeyRef.current !== requestedKey
        ) return;
        if (!background) setError(e instanceof Error ? e.message : "Failed to load chart data");
      } finally {
        if (
          !background &&
          !controller.signal.aborted &&
          historyRequestRef.current === requestId &&
          selectionKeyRef.current === requestedKey
        ) {
          foregroundLoadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [symbol, timeframe],
  );
  const loadHistoryRef = useRef(loadHistory);
  loadHistoryRef.current = loadHistory;

  const loadOlder = useCallback(async () => {
    if (olderLoadingRef.current || reachedHistoryLimitRef.current || foregroundLoadingRef.current) return;
    const oldest = historyStartRef.current ?? baseCandles[0]?.time;
    if (!oldest) return;
    const cutoff = timeframeHistoryCutoff(timeframe);
    if (oldest <= cutoff) {
      reachedHistoryLimitRef.current = true;
      return;
    }
    olderLoadingRef.current = true;
    const requestedKey = `${symbol}|${timeframe}`;
    const controller = new AbortController();
    olderAbortRef.current = controller;
    try {
      const older = await fetchKlines(
        symbol,
        timeframe,
        nativeBatchLimit(futuresIntervalPlan(timeframe)),
        controller.signal,
        oldest * 1000 - 1,
      );
      if (controller.signal.aborted || selectionKeyRef.current !== requestedKey || older.length === 0) return;
      const bounded = older.filter((candle) => candle.time >= cutoff);
      if (bounded.length === 0) {
        reachedHistoryLimitRef.current = true;
        return;
      }
      const currentRange = chartRef.current?.timeScale().getVisibleLogicalRange();
      setBaseCandles((current) => {
        const next = mergeCandles(bounded, current);
        const added = next.length - current.length;
        historyStartRef.current = next[0]?.time ?? oldest;
        if ((next[0]?.time ?? Infinity) <= cutoff || added === 0) reachedHistoryLimitRef.current = true;
        requestAnimationFrame(() => {
          if (currentRange && added > 0 && selectionKeyRef.current === requestedKey) {
            chartRef.current?.timeScale().setVisibleLogicalRange({
              from: currentRange.from + added,
              to: currentRange.to + added,
            });
          }
        });
        return next;
      });
    } catch {
      // Retry when the user approaches the edge again.
    } finally {
      if (olderAbortRef.current === controller) olderAbortRef.current = null;
      olderLoadingRef.current = false;
    }
  }, [baseCandles, fetchKlines, mergeCandles, symbol, timeframe]);
  loadOlderRef.current = () => void loadOlder();



  useEffect(() => {
    selectionKeyRef.current = `${symbol}|${timeframe}`;
    historyStartRef.current = null;
    reachedHistoryLimitRef.current = false;
    olderAbortRef.current?.abort();
    void loadHistory(false);
    return () => {
      historyAbortRef.current?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, retryKey]);

  // ── push historical candles only when a full fetch completes ─────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || baseCandles.length === 0) return;
    const priceFormat = symbolPriceFormats[symbol];
    if (priceFormat) {
      series.applyOptions({
        priceFormat: {
          type: "price",
          precision: priceFormat.precision,
          minMove: priceFormat.minMove,
        },
      });
    }
    series.setData(baseCandles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));

    // Re-apply the live forming candle so a background history refresh
    // never rewinds the chart to a stale close.
    const lc = liveCandleRef.current;
    const lastTime = baseCandles[baseCandles.length - 1].time;
    if (lc && lc.time >= lastTime) {
      series.update({ ...lc, time: lc.time as UTCTimestamp });
    }

    const key = `${symbol}|${timeframe}`;
    if (fitKeyRef.current !== key) {
      fitKeyRef.current = key;
      const scale = chartRef.current?.timeScale();
      const lastIndex = baseCandles.length - 1;
      if (scale && lastIndex >= 0) {
        scale.setVisibleLogicalRange({
          from: Math.max(0, lastIndex - LIVE_WINDOW_BARS + 1),
          to: lastIndex + 6,
        });
      }
      chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
      isScrolledBackRef.current = false;
      setIsScrolledBack(false);
    }
    drawOverlay.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCandles, symbol, symbolPriceFormats]);

  // ── redraw overlay when zones or enabled tools change ────────────────────
  useEffect(() => { drawOverlay.current(); }, [zones, enabledTools]);

  // Custom tool colours repaint the overlay immediately.
  useEffect(() => subscribeToolColors(() => drawOverlay.current()), []);

  // A symbol/timeframe switch must never reuse the previous market's IDM.
  useEffect(() => {
    idmCacheRef.current = null;
    bosCacheRef.current = null;
    drawOverlay.current();
  }, [symbol, timeframe]);

  // ── Live feed: direct Binance Futures WebSocket ───────────────────────────
  // wss://fstream.binance.com/ws/<symbol>@kline_<interval>. Reconnects on
  // symbol/timeframe change and on socket drop. REST remains history-only.
  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let fallbackPoll: ReturnType<typeof setInterval> | null = null;
    let fallbackInFlight = false;
    let attempt = 0;
    let endpointIndex = 0;
    const socketKey = `${symbol}|${timeframe}`;
    const streamPlan = futuresIntervalPlan(timeframe);
    const streamOrigins = ["wss://fstream.binance.com", "wss://fstream.binancefuture.com"];

    // ── Throttled paint: the socket can emit many frames per second, but the
    // chart/React state is only updated ~4x/second so low-end phones stay smooth.
    const FLUSH_MS = 250;
    let pending: Candle | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let lastFlushAt = 0;
    let lastAppliedTime = 0;
    let lastDataAt = Date.now();

    const flush = () => {
      flushTimer = null;
      const c = pending;
      pending = null;
      if (!c || disposed || selectionKeyRef.current !== socketKey) return;
      lastFlushAt = Date.now();
      lastAppliedTime = c.time;
      liveCloseRef.current = c.close;
      liveCandleRef.current = c;
      seriesRef.current?.update({ ...c, time: c.time as UTCTimestamp });
      setLivePrice(c.close);
      setLiveCandle(c);
    };

    const applyCandle = (raw: Candle) => {
      if (disposed || selectionKeyRef.current !== socketKey) return;
      let c = raw;
      if (streamPlan.aggregateSeconds) {
        const bucket = Math.floor(raw.time / streamPlan.aggregateSeconds) * streamPlan.aggregateSeconds;
        const lastBase = candlesRef.current[candlesRef.current.length - 1];
        const current = liveCandleRef.current?.time === bucket
          ? liveCandleRef.current
          : lastBase?.time === bucket ? lastBase : null;
        c = current
          ? {
              time: bucket,
              open: current.open,
              high: Math.max(current.high, raw.high),
              low: Math.min(current.low, raw.low),
              close: raw.close,
            }
          : { ...raw, time: bucket };
      }
      if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)) return;
      if (c.high < c.low || c.open > c.high || c.open < c.low || c.close > c.high || c.close < c.low) return;
      lastDataAt = Date.now();
      pending = c;
      // A new candle must appear immediately; intra-candle ticks are throttled.
      if (c.time !== lastAppliedTime || Date.now() - lastFlushAt >= FLUSH_MS) {
        if (flushTimer) clearTimeout(flushTimer);
        flush();
        return;
      }
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS - (Date.now() - lastFlushAt));
    };

    const stopFallback = () => {
      if (fallbackPoll) clearInterval(fallbackPoll);
      fallbackPoll = null;
    };

    const pollLatest = async () => {
      if (disposed || fallbackInFlight || selectionKeyRef.current !== socketKey) return;
      fallbackInFlight = true;
      try {
        const latest = await fetchKlines(
          symbol,
          timeframe,
          streamPlan.aggregateSeconds ? nativeBatchLimit(streamPlan) : 2,
        );
        if (disposed || selectionKeyRef.current !== socketKey) return;
        const candle = latest[latest.length - 1];
        if (candle) applyCandle(candle);
      } catch {
        // The visible history/error state remains authoritative while reconnecting.
      } finally {
        fallbackInFlight = false;
      }
    };

    const startFallback = () => {
      if (fallbackPoll || disposed) return;
      void pollLatest();
      // Only the selected market is polled, and the server/CDN cache coalesces
      // concurrent viewers. Any delivered WebSocket frame stops this fallback.
      fallbackPoll = setInterval(() => void pollLatest(), 2_000);
    };

    const connect = () => {
      if (disposed) return;
      const stream = `${symbol.toLowerCase()}@kline_${streamPlan.binanceInterval}`;
      try {
        ws = new WebSocket(`${streamOrigins[endpointIndex]}/ws/${stream}`);
      } catch {
        endpointIndex = (endpointIndex + 1) % streamOrigins.length;
        reconnect = setTimeout(connect, 1_000);
        return;
      }

      ws.onopen = () => {
        attempt = 0;
        // Reconnect sockets that handshake but never deliver a market frame.
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          startFallback();
          endpointIndex = (endpointIndex + 1) % streamOrigins.length;
          ws?.close();
        }, 5_000);
      };

      ws.onmessage = (event) => {
        if (disposed || selectionKeyRef.current !== socketKey) return;
        try {
          const msg = JSON.parse(event.data as string) as {
            k?: { t: number; o: string; h: string; l: string; c: string };
          };
          const k = msg.k;
          if (!k) return;
          if (watchdog) {
            clearTimeout(watchdog);
            watchdog = null;
          }
          stopFallback();
          applyCandle({
            time: Math.floor(Number(k.t) / 1000),
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
          });
        } catch {
          // Ignore malformed frames.
        }
      };

      const scheduleReconnect = () => {
        if (disposed || reconnect) return;
        const delay = Math.min(15_000, 1_000 * 2 ** attempt++);
        reconnect = setTimeout(() => {
          reconnect = null;
          connect();
        }, delay);
      };

      ws.onerror = () => ws?.close();
      ws.onclose = scheduleReconnect;
    };


    connect();

    // ── Self-recovery: if no market data arrives for a while (dead socket,
    // sleeping tab, flaky network), poll immediately and rebuild the socket.
    const STALE_MS = 10_000;
    const staleCheck = setInterval(() => {
      if (disposed || document.hidden) return;
      if (Date.now() - lastDataAt < STALE_MS) return;
      lastDataAt = Date.now();
      startFallback();
      attempt = 0;
      endpointIndex = (endpointIndex + 1) % streamOrigins.length;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      } else if (!reconnect) {
        connect();
      }
    }, 5_000);

    // Coming back to a backgrounded tab should recover instantly.
    const onVisible = () => {
      if (document.hidden || disposed) return;
      lastDataAt = Date.now();
      void pollLatest();
      void loadHistoryRef.current?.(true);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      clearInterval(staleCheck);
      document.removeEventListener("visibilitychange", onVisible);
      if (flushTimer) clearTimeout(flushTimer);
      if (watchdog) clearTimeout(watchdog);
      if (reconnect) clearTimeout(reconnect);
      stopFallback();
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe]);



  // ── candle close countdown (matches selected timeframe) ───────────────────
  // Binance uses "1M" for monthly; the timeframe model's monthly id is "1mo".
  const timerTfId = timeframe === "1M" ? "1mo" : timeframe;
  const candleTimer = useCandleTimer(timerTfId);

  // Safety net: whenever a candle closes, refresh history in the background so
  // OHLC stays exact even if the WS "closed" frame was missed (REST fallback).
  useEffect(() => {
    if (candleTimer.epoch === 0) return;
    const t = setTimeout(() => void loadHistory(true), 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candleTimer.epoch]);



  // ── filtered / searched pair list (debounced input) ───────────────────────
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const filteredSymbols = useMemo(() => {
    const q = debouncedQuery.trim().toUpperCase();
    const promotedRank = new Map(promotedSymbols.map((item, index) => [item, index]));
    // Tier 0 = user-promoted, tier 1 = majors (fixed order), tier 2 = the rest
    // ranked by 24h quote volume so micro-cap / multiplier pairs sink.
    const rank = (s: string): [number, number] => {
      const promoted = promotedRank.get(s);
      if (promoted != null) return [0, promoted];
      const major = MAJOR_SYMBOLS.indexOf(s);
      if (major !== -1) return [1, major];
      return [2, -(pairVolumes[s] ?? 0)];
    };
    const ordered = [...allSymbols].sort((a, b) => {
      const [ta, ra] = rank(a);
      const [tb, rb] = rank(b);
      if (ta !== tb) return ta - tb;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });

    return q ? ordered.filter((s) => s.includes(q)) : ordered;
  }, [allSymbols, debouncedQuery, promotedSymbols, pairVolumes]);


  const selectSymbol = useCallback((nextSymbol: string) => {
    if (query.trim()) {
      setPromotedSymbols((previous) => [nextSymbol, ...previous.filter((item) => item !== nextSymbol)]);
      setQuery("");
      setDebouncedQuery("");
    }
    if (nextSymbol === symbol) return;
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    setIsSyncingLive(false);
    selectionKeyRef.current = `${nextSymbol}|${timeframe}`;
    historyAbortRef.current?.abort();
    historyRequestRef.current += 1;
    fitKeyRef.current = "";
    liveCloseRef.current = null;
    liveCandleRef.current = null;
    candlesRef.current = [];
    const nextPriceFormat = symbolPriceFormats[nextSymbol];
    if (nextPriceFormat) {
      seriesRef.current?.applyOptions({
        priceFormat: { type: "price", precision: nextPriceFormat.precision, minMove: nextPriceFormat.minMove },
      });
    }
    seriesRef.current?.setData([]);
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
    setBaseCandles([]);
    setLiveCandle(null);
    setLegend(null);
    setError(null);
    foregroundLoadingRef.current = true;
    setLoading(true);
    setSymbol(nextSymbol);
    setLivePrice(null);
  }, [query, symbol, symbolPriceFormats, timeframe]);

  const selectTimeframe = useCallback((nextTimeframe: string) => {
    if (nextTimeframe === timeframe) return;
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    setIsSyncingLive(false);
    selectionKeyRef.current = `${symbol}|${nextTimeframe}`;
    historyAbortRef.current?.abort();
    historyRequestRef.current += 1;
    fitKeyRef.current = "";
    liveCloseRef.current = null;
    liveCandleRef.current = null;
    candlesRef.current = [];
    seriesRef.current?.setData([]);
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
    setBaseCandles([]);
    setLiveCandle(null);
    setLivePrice(null);
    setLegend(null);
    setError(null);
    foregroundLoadingRef.current = true;
    setLoading(true);
    setTimeframe(nextTimeframe);
  }, [symbol, timeframe]);

  useEffect(() => {
    if (timeframeBar.hydrated && timeframeBar.ids.length > 0 && !timeframeBar.ids.includes(timeframe)) {
      selectTimeframe(timeframeBar.ids[0]);
    }
  }, [selectTimeframe, timeframe, timeframeBar.hydrated, timeframeBar.ids]);

  const addCustomTimeframe = useCallback(() => {
    const id = timeframeBar.add(customInput);
    if (!id) {
      setCustomError("Invalid format. Try 2m, 45m, 3h, 2d");
      return;
    }
    selectTimeframe(id);
    setCustomInput("");
    setCustomError("");
    setTimeframePickerOpen(false);
  }, [customInput, selectTimeframe, timeframeBar]);

  const pinnableTimeframes = useMemo(
    () => [...DEFAULT_TIMEFRAME_IDS, ...QUICK_TIMEFRAME_IDS].filter((id) => !timeframeBar.ids.includes(id)),
    [timeframeBar.ids],
  );

  // ── windowed rendering: only render a slice of the (500+) pair list ───────
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => setVisibleCount(PAGE_SIZE), [debouncedQuery]);
  const visibleSymbols = useMemo(
    () => filteredSymbols.slice(0, visibleCount),
    [filteredSymbols, visibleCount],
  );
  const listScrollRef = useRef<HTMLDivElement>(null);
  const onListScroll = useCallback(() => {
    const el = listScrollRef.current;
    if (!el) return;
    const nearEndY = el.scrollTop + el.clientHeight >= el.scrollHeight - 200;
    const nearEndX = el.scrollLeft + el.clientWidth >= el.scrollWidth - 200;
    if (nearEndY || nearEndX) setVisibleCount((n) => n + PAGE_SIZE);
  }, []);

  const selectedChange = changes[symbol];
  // High/Low over the loaded session — derived from the closed-candle set so a
  // price tick doesn't force a 500-element scan on every frame.
  const { sessionHigh, sessionLow } = useMemo(() => {
    if (analysisCandles.length === 0) return { sessionHigh: NaN, sessionLow: NaN };
    let high = -Infinity;
    let low = Infinity;
    for (const candle of analysisCandles) {
      if (candle.high > high) high = candle.high;
      if (candle.low < low) low = candle.low;
    }
    return { sessionHigh: high, sessionLow: low };
  }, [analysisCandles]);

  const zoneCount = useCallback((id: ToolId) => analysis?.[id]?.length ?? 0, [analysis]);

  // ── tool toggle (premium tools require an active membership) ──────────────
  const toggleTool = useCallback(
    (id: ToolId) => {
      const tool = TOOLS.find((t) => t.id === id);
      if (tool?.tier === "premium" && !membershipActive) {
        toast.error("Premium membership required to use this tool.", {
          description: "Activate your membership from the dashboard.",
          action: { label: "Dashboard", onClick: () => (window.location.href = "/dashboard") },
        });
        return;
      }
      setEnabledTools((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
    },
    [membershipActive],
  );


  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">

      {/* ══ Pair selector — selected pair card on top, list below ══════════ */}
      <aside className="flex shrink-0 flex-col border-b border-border bg-panel lg:w-72 lg:border-b-0 lg:border-r">
        <SlowConnectionBanner />
        <div className="p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pairs…"
              className="w-full rounded-md border border-border bg-secondary/40 py-2 pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
            />
          </div>
        </div>

        <div
          ref={listScrollRef}
          onScroll={onListScroll}
          className="scroll-thin flex gap-2 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:overflow-x-hidden lg:px-2"
        >
          {visibleSymbols.map((s) => {
            const active = s === symbol;
            return (
              <PairRow
                key={s}
                symbol={s}
                active={active}
                change={changes[s]}
                price={active && livePrice != null ? livePrice : pairPrices[s]}
                onSelect={selectSymbol}
              />
            );
          })}
          {visibleSymbols.length < filteredSymbols.length && (
            <button
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              className="shrink-0 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            >
              Load more
            </button>
          )}
        </div>
      </aside>

      {/* ══ Main area ════════════════════════════════════════════════════════ */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">

        {/* ── Toolbar ───────────────────────────────────────────────────────── */}
        <div className="relative z-40 flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 overflow-visible border-b border-border bg-panel/60 px-4 py-2">

          {/* Active symbol + live price + candle countdown */}
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight">{symbol}</span>
            <span className="rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {getTimeframe(timeframe).label}
            </span>
            <span className="flex items-center gap-1 rounded border border-border bg-secondary/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              <Timer className="h-2.5 w-2.5 shrink-0" />
              {candleTimer.formattedTime}
            </span>
          </div>

          {livePrice != null && (
            <div className="flex items-baseline gap-2">
              <span className="tabular text-lg font-semibold">{formatLivePrice(livePrice)}</span>
              {selectedChange != null && Number.isFinite(selectedChange) && (
                <span className={cn("tabular text-sm font-medium", selectedChange >= 0 ? "text-bull" : "text-bear")}>
                  {selectedChange >= 0 ? "+" : ""}{selectedChange.toFixed(2)}%
                </span>
              )}
            </div>
          )}

          <FuturesStat label="High" value={formatLivePrice(sessionHigh)} />
          <FuturesStat label="Low" value={formatLivePrice(sessionLow)} />

          <div className="ml-auto flex items-center gap-1.5">
            {/* Single SMC pill with count badge */}
            <button
              onClick={() => setToolsOpen((v) => !v)}
              aria-label="SMC analysis tools"
              aria-pressed={toolsOpen}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                toolsOpen
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-secondary/50 text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Layers className="h-3 w-3" />
              <span>SMC</span>
              <span className="tabular rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                {enabledTools.size}
              </span>
            </button>

            {/* Timeframe buttons */}
            <div className="scroll-thin flex max-w-[60vw] items-center gap-0.5 overflow-x-auto rounded-md border border-border bg-secondary/40 p-0.5 lg:max-w-none">
              {timeframeBar.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => selectTimeframe(item.id)}
                  className={`shrink-0 rounded px-2 py-1 text-xs font-semibold transition-colors ${
                    timeframe === item.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="relative z-50">
              <button
                type="button"
                onClick={() => setTimeframePickerOpen((open) => !open)}
                aria-label="Add timeframe"
                aria-expanded={timeframePickerOpen}
                className={cn(
                  "flex items-center rounded border border-border p-1.5 text-xs transition-colors",
                  timeframePickerOpen
                    ? "bg-primary/20 text-primary"
                    : "bg-secondary/40 text-muted-foreground hover:text-foreground",
                )}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              {timeframePickerOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-panel shadow-2xl">
                  <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                    Pin a timeframe
                  </div>
                  <div className="grid grid-cols-5 gap-1 p-3">
                    {pinnableTimeframes.length === 0 && (
                      <span className="col-span-5 text-[11px] text-muted-foreground">All presets pinned.</span>
                    )}
                    {pinnableTimeframes.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          timeframeBar.pin(id);
                          selectTimeframe(id);
                          setTimeframePickerOpen(false);
                        }}
                        className="rounded bg-secondary/50 px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-primary/20 hover:text-primary"
                      >
                        {getTimeframe(id).label}
                      </button>
                    ))}
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      addCustomTimeframe();
                    }}
                    className="border-t border-border p-3"
                  >
                    <div className="flex gap-2">
                      <input
                        value={customInput}
                        onChange={(event) => {
                          setCustomInput(event.target.value);
                          setCustomError("");
                        }}
                        placeholder="Custom e.g. 45m, 3h, 2d"
                        aria-label="Custom timeframe"
                        className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                      />
                      <button type="submit" className="rounded bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
                        Add
                      </button>
                    </div>
                    {customError && <p className="mt-1 text-[10px] text-bear">{customError}</p>}
                    <p className="mt-1 text-[10px] text-muted-foreground/60">Units: m h d w mo</p>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>


        {/* ── Chart + overlay ───────────────────────────────────────────────── */}
        <div className="relative z-0 min-h-0 flex-1 bg-card">
          {/* lightweight-charts mounts here */}
          <div ref={containerRef} className="absolute inset-0" />

          {/* SMC overlay canvas — must sit above chart's internal canvases */}
          <canvas
            ref={overlayRef}
            className="pointer-events-none absolute inset-0"
            style={{ zIndex: 2 }}
          />

          {/* Live price + candle-close countdown badge on the right price axis */}
          {priceY != null && scaleWidth > 0 && candles.length > 0 && livePrice != null && (
            <div
              className="pointer-events-none absolute z-10 overflow-hidden"
              style={{ top: priceY - 9, right: 0, width: scaleWidth - 6 }}
            >
              {/* Price row */}
              <div
                className="flex items-center justify-center py-[2px] text-[11px] font-medium tabular-nums text-white"
                style={{ background: "#2962ff" }}
              >
                {formatLivePrice(livePrice)}
              </div>
              {/* Countdown row — time left until the current candle closes */}
              {candleTimer.formattedTime && (
                <div className="flex items-center justify-center bg-[#1b2436] py-[2px] text-[11px] font-medium tabular-nums text-[#38bdf8]">
                  {candleTimer.formattedTime}
                </div>
              )}
            </div>
          )}



          <div className="absolute bottom-8 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[#1E3A6E] bg-[#091629]/90 p-1 shadow-lg backdrop-blur-sm">
            <button
              type="button"
              onClick={() => zoom(0.8)}
              aria-label="Zoom in"
              title="Zoom in"
              className="flex h-7 w-7 items-center justify-center rounded-full text-[#7BA8CC] transition-colors hover:bg-[#1A3560] hover:text-white"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => zoom(1.25)}
              aria-label="Zoom out"
              title="Zoom out"
              className="flex h-7 w-7 items-center justify-center rounded-full text-[#7BA8CC] transition-colors hover:bg-[#1A3560] hover:text-white"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={backToLive}
              disabled={isSyncingLive}
              aria-label="Back to live"
              title="Back to live"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2563EB] text-white transition-colors hover:bg-[#1A3560] disabled:opacity-80"
            >
              <RefreshCw className={isSyncingLive ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            </button>
          </div>

          {/* Crosshair OHLC legend */}
          {legend && (
            <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-3 rounded-md bg-[#0A1428]/80 px-2.5 py-1 text-[11px] backdrop-blur-sm">
              {(["open", "high", "low", "close"] as const).map((k) => (
                <span key={k} className="text-[#7BA8CC]">
                  {k[0].toUpperCase()}{" "}
                  <span className="text-white">{formatLegendPrice(legend[k])}</span>
                </span>
              ))}
            </div>
          )}

          {/* Loading overlay */}
          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0A1428]/80 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-[#7BA8CC]">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
                <span className="text-sm">Loading {symbol}…</span>
              </div>
            </div>
          )}

          {/* Error overlay */}
          {!loading && error && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#0A1428]/90">
              <p className="max-w-xs text-center text-sm text-red-400">{error}</p>
              <button
                onClick={() => { setError(null); setRetryKey((k) => k + 1); }}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/20"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* ── Attribution footer ────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-[#1E3A6E] bg-[#091629] px-3 py-1 text-right text-[10px] text-[#1E3A6E]">
          Data: crypto futures — live market feed · {filteredSymbols.length} symbols loaded
        </div>
      </main>

      {/* ══ SMC tools panel ══════════════════════════════════════════════════ */}
      {toolsOpen && (
        <>
          <div
            onClick={() => setToolsOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-[#1E3A6E] bg-[#091629] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#1E3A6E] px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-white">SMC Analysis</h2>
                <p className="text-[11px] text-[#7BA8CC]">Toggle tools to plot detected zones</p>
              </div>
              <button
                onClick={() => setToolsOpen(false)}
                aria-label="Close SMC tools"
                className="flex h-7 w-7 items-center justify-center rounded-md text-[#7BA8CC] transition-colors hover:bg-[#1A3560] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="scroll-thin flex-1 overflow-y-auto p-3">
              {(["free", "premium"] as const).map((tier) => {
                const tierTools = TOOLS.filter((t) => t.tier === tier);
                if (tierTools.length === 0) return null;
                return (
                  <div key={tier} className="mb-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                          tier === "free"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-amber-500/15 text-amber-400",
                        )}
                      >
                        {tier === "free" ? "Free" : "Premium"}
                      </span>
                      <div className="h-px flex-1 bg-[#1E3A6E]" />
                    </div>

                    <div className="space-y-2">
                      {tierTools.map((t) => {
                        const on = enabledTools.has(t.id);
                        const locked = t.tier === "premium" && !membershipActive;
                        const color = toolColors[t.id];
                        return (
                          <div key={t.id}>
                          <button
                            onClick={() => setColorPickerTool((c) => (c === t.id ? null : t.id))}
                            className={cn(
                              "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                              locked
                                ? "border-[#1E3A6E]/40 bg-transparent opacity-50"
                                : on
                                  ? "border-[#1E3A6E] bg-[#0D1F3C]"
                                  : "border-[#1E3A6E]/60 bg-transparent",
                            )}
                          >
                            <span
                              className="mt-1 h-3 w-3 shrink-0 rounded-sm"
                              style={{
                                backgroundColor: locked ? "transparent" : on ? color : "transparent",
                                border: `1px solid ${locked ? "currentColor" : color}`,
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold text-white">{t.name}</span>
                                {locked ? (
                                  <Lock className="h-3 w-3 shrink-0 text-amber-400" />
                                ) : (
                                  <span className="rounded-full bg-[#0D1F3C] px-1.5 py-0.5 font-mono text-[10px] text-[#7BA8CC]">
                                    {zoneCount(t.id)}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-[11px] leading-snug text-[#7BA8CC]">
                                {locked ? "Active membership required" : t.description}
                              </p>
                            </div>
                            {!locked && (
                              <span
                                role="switch"
                                aria-checked={on}
                                aria-label={`Toggle ${t.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleTool(t.id);
                                }}
                                className={cn(
                                  "mt-0.5 flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors",
                                  on ? "bg-[#2563EB]" : "bg-[#0D1F3C]",
                                )}
                              >
                                <span
                                  className={cn(
                                    "h-3 w-3 rounded-full bg-white transition-transform",
                                    on && "translate-x-3",
                                  )}
                                />
                              </span>
                            )}
                          </button>
                          {colorPickerTool === t.id && !locked && (
                            <ToolColorPicker
                              toolId={t.id}
                              toolName={t.name}
                              color={color}
                              onClose={() => setColorPickerTool(null)}
                            />
                          )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

/**
 * One row in the pair list. Memoized so a live price tick on the selected
 * market never re-renders the other (potentially hundreds of) rows.
 */
const PairRow = memo(function PairRow({
  symbol,
  active,
  change,
  price,
  onSelect,
}: {
  symbol: string;
  active: boolean;
  change: number | undefined;
  price: number | undefined;
  onSelect: (symbol: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(symbol)}
      className={cn(
        "group flex min-w-[150px] shrink-0 items-center justify-between rounded-md border px-3 py-2 text-left transition-colors lg:min-w-0",
        active ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-secondary/50",
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{symbol}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {price != null && Number.isFinite(price) ? formatLivePrice(price) : "Price unavailable"}
        </div>
      </div>
      {change != null && Number.isFinite(change) && (
        <div
          className={cn(
            "tabular flex items-center gap-1 text-xs font-medium",
            change >= 0 ? "text-bull" : "text-bear",
          )}
        >
          {change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {change >= 0 ? "+" : ""}
          {change.toFixed(2)}%
        </div>
      )}
    </button>
  );
});

function FuturesStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden flex-col sm:flex">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="tabular text-sm font-medium">{value}</span>
    </div>
  );
}

