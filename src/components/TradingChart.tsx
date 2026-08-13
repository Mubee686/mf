/**
 * TradingView-style chart powered by lightweight-charts.
 *
 * Chart instance is created ONCE and reused.  Candle data is pushed via:
 *   series.setData()  — on full reloads (symbol/TF change, epoch fetch)
 *   series.update()   — on live price ticks (only last bar changes)
 *
 * This avoids visual wick flickering that happens when setData() is called
 * on every 15-second price poll.  SMC zones are drawn on a synced overlay
 * canvas sitting on top of the chart pane.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import {
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";

import type { Candle } from "@/lib/forex";
import { formatPrice } from "@/lib/forex";
import { getToolColor, subscribeToolColors } from "@/lib/tool-colors";
import { TOOLS, detectAllBOS, detectVisibleIDM, zonesInVisibleRange, type Zone, type ToolId } from "@/lib/smc";

export type ChartType = "candlestick" | "line";

interface Props {
  candles: Candle[];
  zones: Zone[];
  digits: number;
  /** Changes when symbol or timeframe changes → chart re-fits content. */
  resetKey: string;
  isLoading?: boolean;
  chartType?: ChartType;
  /** Candle countdown string from useCandleTimer, e.g. "04:37" */
  formattedTime?: string;
  /** Which SMC tools are toggled on — gates BOS/CHoCH rendering without inferring from zone list. */
  enabledTools: Set<ToolId>;
  /** Pull the newest server candle while returning a historical viewport to live. */
  onRequestLatest?: () => void;
}

// ─── chart palette ───────────────────────────────────────────────────────────
const C = {
  bg: "#0A1428",
  text: "#a9b3c4",
  grid: "rgba(43,52,68,0.55)",
  border: "rgba(60,72,92,0.7)",
  bull: "#26a69a",
  bear: "#ef5350",
  crosshair: "rgba(148,163,184,0.5)",
};

const toolColor = (id: Zone["tool"]) => getToolColor(id);

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function toBar(c: Candle): CandlestickData {
  return {
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

function toLinePoint(c: Candle): LineData {
  return { time: c.time as UTCTimestamp, value: c.close };
}

function createSeriesForType(
  chart: IChartApi,
  type: ChartType,
  digits: number,
): ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> {
  const priceFormat = {
    type: "price" as const,
    precision: digits,
    minMove: 1 / Math.pow(10, digits),
  };

  if (type === "line") {
    return chart.addLineSeries({
      color: C.bull,
      lineWidth: 2,
      priceLineVisible: true,
      priceLineColor: "#2962ff",
      priceLineWidth: 1,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      priceFormat,
    });
  }

  return chart.addCandlestickSeries({
    upColor: C.bull,
    downColor: C.bear,
    borderUpColor: C.bull,
    borderDownColor: C.bear,
    wickUpColor: C.bull,
    wickDownColor: C.bear,
    priceLineVisible: true,
    priceLineColor: "#2962ff",
    priceLineWidth: 1,
    lastValueVisible: false,
    priceFormat,
  });
}

function pushSeriesData(
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">,
  type: ChartType,
  candles: Candle[],
) {
  if (type === "line") {
    (series as ISeriesApi<"Line">).setData(candles.map(toLinePoint));
  } else {
    (series as ISeriesApi<"Candlestick">).setData(candles.map(toBar));
  }
}

function updateSeriesLast(
  series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line">,
  type: ChartType,
  last: Candle,
) {
  if (type === "line") {
    (series as ISeriesApi<"Line">).update(toLinePoint(last));
  } else {
    (series as ISeriesApi<"Candlestick">).update(toBar(last));
  }
}

function TradingChartComponent({
  candles,
  zones,
  digits,
  resetKey,
  isLoading,
  chartType = "candlestick",
  formattedTime,
  enabledTools,
  onRequestLatest,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | null>(null);
  const seriesTypeRef = useRef<ChartType>(chartType);

  // Keep refs so overlay draw always sees current values
  const candlesRef = useRef<Candle[]>(candles);
  const zonesRef = useRef<Zone[]>(zones);
  const digitsRef = useRef<number>(digits);
  const enabledToolsRef = useRef<Set<ToolId>>(enabledTools);
  candlesRef.current = candles;
  zonesRef.current = zones;
  digitsRef.current = digits;
  enabledToolsRef.current = enabledTools;

  // BOS detection cache — keyed by candle count + last timestamp so we only
  // recompute when new data arrives, not on every pan / zoom / rAF tick.
  const bosCacheRef = useRef<{ key: string; result: ReturnType<typeof detectAllBOS> } | null>(null);
  const idmCacheRef = useRef<{ key: string; result: Zone[] } | null>(null);

  // Track previous candles to decide setData vs update
  const prevCandlesRef = useRef<Candle[]>([]);

  const [legend, setLegend] = useState<Candle | null>(null);
  // Y-coordinate (px) of the current price on the chart, for timer placement
  const [priceY, setPriceY] = useState<number | null>(null);
  // Width of the right price scale, so timer badge exactly matches the price badge width
  const [scaleWidth, setScaleWidth] = useState<number>(0);
  const [isScrolledBack, setIsScrolledBack] = useState(false);
  const isScrolledBackRef = useRef(false);
  const [isSyncingLive, setIsSyncingLive] = useState(false);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    setIsSyncingLive(true);
    let stableChecks = 0;
    const sync = () => {
      onRequestLatest?.();
      const scale = chartRef.current?.timeScale();
      scale?.scrollToRealTime();
      const range = scale?.getVisibleLogicalRange();
      const lastIndex = candlesRef.current.length - 1;
      const caughtUp = Boolean(range && lastIndex >= 0 && range.to >= lastIndex - 0.25);
      stableChecks = caughtUp ? stableChecks + 1 : 0;
      if (stableChecks >= 3) {
        setIsScrolledBack(false);
        isScrolledBackRef.current = false;
        setIsSyncingLive(false);
        syncTimerRef.current = null;
        return;
      }
      syncTimerRef.current = setTimeout(sync, 300);
    };
    sync();
  }, [onRequestLatest]);

  // ── price-Y updater — called on every event that can shift the Y scale ──
  const updatePriceY = useRef<() => void>(() => {});
  updatePriceY.current = () => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const cs = candlesRef.current;
    if (!chart || !series || cs.length === 0) return;
    const lastClose = cs[cs.length - 1].close;
    const y = series.priceToCoordinate(lastClose);
    setPriceY(y ?? null);
    setScaleWidth(chart.priceScale("right").width());
  };

  // ── overlay drawing ───────────────────────────────────────────────────────
  const drawOverlay = useRef<() => void>(() => {});
  drawOverlay.current = () => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const cvs = overlayRef.current;
    const container = containerRef.current;
    if (!chart || !series || !cvs || !container) return;

    const cssW = container.clientWidth;
    const cssH = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (cvs.width !== cssW * dpr || cvs.height !== cssH * dpr) {
      cvs.width = cssW * dpr;
      cvs.height = cssH * dpr;
      cvs.style.width = `${cssW}px`;
      cvs.style.height = `${cssH}px`;
    }
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const cs = candlesRef.current;
    if (cs.length === 0) return;


    const ts = chart.timeScale();
    const paneRight = ts.width();
    const visibleRange = ts.getVisibleLogicalRange();
    const visibleFrom = visibleRange ? Math.floor(visibleRange.from) : 0;
    const visibleTo = visibleRange ? Math.ceil(visibleRange.to) : cs.length - 1;

    const xOf = (idx: number): number | null => {
      const i = Math.max(0, Math.min(cs.length - 1, idx));
      const t = cs[i].time as UTCTimestamp;
      const x = ts.timeToCoordinate(t);
      return x == null ? null : x;
    };
    const yOf = (price: number): number | null => {
      const y = series.priceToCoordinate(price);
      return y == null ? null : y;
    };

    const idmEnabled = enabledToolsRef.current.has("idm");
    const lastCandle = cs[cs.length - 1];
    const idmCacheKey = [
      resetKey,
      cs.length,
      lastCandle?.time ?? 0,
      lastCandle?.high ?? 0,
      lastCandle?.low ?? 0,
      lastCandle?.close ?? 0,
      visibleFrom,
      visibleTo,
    ].join(":");
    if (idmEnabled && cs.length >= 15) {
      if (!idmCacheRef.current || idmCacheRef.current.key !== idmCacheKey) {
        idmCacheRef.current = {
          key: idmCacheKey,
          result: detectVisibleIDM(cs, visibleFrom, visibleTo),
        };
      }
    } else {
      idmCacheRef.current = null;
    }
    const visibleIDM = idmEnabled ? (idmCacheRef.current?.result ?? []) : [];

    // The general analysis covers the fetched history, but OB/FVG/POI are only
    // relevant where their originating candle is on screen. IDM is different:
    // only the detector result for the currently visible window is drawable.
    for (const z of [
      ...zonesInVisibleRange(
        zonesRef.current.filter((zone) => zone.tool !== "idm"),
        visibleFrom,
        visibleTo,
      ),
      ...visibleIDM,
    ]) {

      const baseColor = toolColor(z.tool);
      // Swept IDM renders faded; everything else at full opacity
      const alpha = z.tool === "idm" && z.swept ? 0.35 : 1;
      const color = baseColor;

      let x0 = xOf(z.startIndex);
      if (x0 == null) x0 = 0;
      const nextX = xOf(Math.min(cs.length - 1, z.startIndex + 1));
      const prevX = xOf(Math.max(0, z.startIndex - 1));
      const barSpacing = nextX != null ? nextX - x0 : prevX != null ? x0 - prevX : 0;
      if (barSpacing) x0 -= barSpacing / 2;
      const x1 = paneRight;

      if (z.priceHigh != null && z.priceLow != null) {
        // ── Box zone (OB, FVG, POI, LQ) ──────────────────────────────────
        const yh = yOf(z.priceHigh);
        const yl = yOf(z.priceLow);
        if (yh == null || yl == null) continue;
        const top = Math.min(yh, yl);
        const h = Math.abs(yl - yh);
        const provisionalMul = z.provisional ? 0.6 : 1;
        ctx.fillStyle = hexToRgba(color, 0.1 * alpha * provisionalMul);
        ctx.fillRect(x0, top, x1 - x0, h);
        ctx.strokeStyle = hexToRgba(color, 0.85 * alpha * provisionalMul);
        ctx.lineWidth = 1;
        ctx.setLineDash(z.provisional ? [4, 3] : []);
        ctx.strokeRect(x0 + 0.5, top + 0.5, x1 - x0 - 1, h);
        ctx.setLineDash([]);
        ctx.fillStyle = hexToRgba(color, 0.95 * alpha * provisionalMul);
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "bottom";
        ctx.fillText(z.provisional ? `${z.label}?` : z.label, x0 + 4, top - 1 > 10 ? top - 1 : top + 11);
      } else if (z.price != null) {
        const y = yOf(z.price);
        if (y == null) continue;

        if (z.tool === "idm") {
          // ── IDM: dashed horizontal price-level line ───────────────────────
          const swept = !!z.swept;
          const lineAlpha = swept ? 0.3 : 0.9;
          const fillAlpha = swept ? 0.35 : 0.95;

          // Right edge: end exactly at the sweep candle when mitigated,
          // otherwise extend to the live right edge of the chart.
          const xRight = swept && z.sweepIndex != null
            ? (xOf(z.sweepIndex) ?? x1)
            : x1;

          // Clamp line start to the canvas left boundary so the line never
          // extends into candles that predate the IDM formation.
          const lineStart = Math.max(0, x0);
          const lineEnd   = Math.max(lineStart, xRight);

          // Skip if the entire zone is scrolled off screen
          if (swept && lineEnd <= 0) continue;

          // Dashed horizontal line
          ctx.strokeStyle = hexToRgba(color, lineAlpha);
          ctx.lineWidth = 1.5;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          ctx.moveTo(lineStart, y);
          ctx.lineTo(lineEnd, y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Filled circle anchoring the line at the IDM candle
          // (only when the candle is within the visible pane)
          if (x0 >= 0 && x0 <= x1) {
            ctx.fillStyle = hexToRgba(color, fillAlpha);
            ctx.beginPath();
            ctx.arc(x0, y, 3, 0, Math.PI * 2);
            ctx.fill();
          }

          // Label: "IDM" (active) or "IDM ✓" (swept).
          // Pin label to IDM candle; clamp so it stays inside the visible pane.
          const labelX = Math.max(4, Math.min(x0 + 8, x1 - 46));
          ctx.fillStyle = hexToRgba(color, fillAlpha);
          ctx.font = "bold 10px ui-sans-serif, system-ui, sans-serif";
          ctx.textBaseline = "bottom";
          ctx.fillText(z.label, labelX, y - 3);

        } else if (z.tool === "bos" || z.tool === "choch") {
          // BOS / CHoCH are drawn dynamically below — skip here to avoid
          // double-drawing with the zones-prop (which may still carry them).
          continue;

        } else {
          // ── Generic line zone (LQ lines, etc.) ───────────────────────
          ctx.strokeStyle = hexToRgba(color, 0.9 * alpha);
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = hexToRgba(color, 0.95 * alpha);
          ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
          ctx.textBaseline = "bottom";
          ctx.fillText(z.label, x0 + 4, y - 2);
        }
      }
    }

    // ── BOS / CHoCH: detect on full candle set, draw only visible range ────
    // Detection runs on all candles so trend context is always correct.
    // The result is cached (keyed by candle count + last timestamp) so it is
    // never recomputed on pan, zoom, or rAF ticks — only when data changes.
    // Every coordinate is derived from timeToCoordinate / priceToCoordinate so
    // lines move exactly with the candles on every redraw.
    const bosEnabled   = enabledToolsRef.current.has("bos");
    const chochEnabled = enabledToolsRef.current.has("choch");

    if (cs.length >= 10 && (bosEnabled || chochEnabled)) {
      // resetKey is `${symbol}|${timeframe}` — including it guarantees a pair or
      // timeframe switch never reuses the previous market's structure.
      const cacheKey = [resetKey, cs.length, cs[cs.length - 1]?.time ?? 0].join(":");
      if (!bosCacheRef.current || bosCacheRef.current.key !== cacheKey) {
        bosCacheRef.current = { key: cacheKey, result: detectAllBOS(cs) };
      }
      const { bos: bosAll, choch: chochAll } = bosCacheRef.current.result;

      // Filter to zones that overlap the visible logical (candle-index) range.
      const visibleBOS: Zone[] = [];
      if (bosEnabled)   visibleBOS.push(...bosAll.filter((z)  => z.endIndex >= visibleFrom && z.startIndex <= visibleTo));
      if (chochEnabled) visibleBOS.push(...chochAll.filter((z) => z.endIndex >= visibleFrom && z.startIndex <= visibleTo));

      for (const z of visibleBOS) {
        if (z.price == null) continue;
        // y is derived from priceToCoordinate — always anchored to price data.
        const y = yOf(z.price);
        if (y == null || y < -20 || y > cssH + 20) continue;

        const color = toolColor(z.tool);

        // x coordinates come from timeToCoordinate on the candle's timestamp —
        // they automatically follow the candle on every pan / zoom / resize.
        const xSwing = xOf(z.startIndex); // broken swing level origin
        const xBreak = xOf(z.endIndex);   // candle that closed through the level

        // Clamp visible portion to canvas bounds
        const lineStart = xSwing != null ? Math.max(0, xSwing) : 0;
        const lineEnd   = xBreak != null ? Math.min(paneRight, xBreak) : paneRight;
        if (lineEnd <= 0 || lineStart >= paneRight) continue;

        // ── Solid horizontal line from swing origin to break candle ────────
        ctx.strokeStyle = hexToRgba(color, 0.9);
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(lineStart, y);
        ctx.lineTo(lineEnd, y);
        ctx.stroke();

        // ── Circle at swing origin (when on-screen) ────────────────────────
        if (xSwing != null && xSwing >= 0 && xSwing <= paneRight) {
          ctx.fillStyle = hexToRgba(color, 0.95);
          ctx.beginPath();
          ctx.arc(xSwing, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // ── Label badge centred on the break candle ────────────────────────
        if (xBreak != null && xBreak >= 0 && xBreak <= paneRight) {
          const labelText = z.label; // "BOS" or "CHoCH"
          ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
          const textW  = ctx.measureText(labelText).width;
          const padX   = 6;
          const badgeW = textW + padX * 2;
          const badgeH = 18;
          const isBull = z.kind === "bullish";
          // Clamp badge so it never spills outside the pane
          const badgeX = Math.max(0, Math.min(xBreak - badgeW / 2, paneRight - badgeW));
          const badgeY = isBull ? y - badgeH - 5 : y + 5;

          // Rounded rectangle
          const r = 3;
          ctx.fillStyle = hexToRgba(color, 0.92);
          ctx.beginPath();
          ctx.moveTo(badgeX + r, badgeY);
          ctx.lineTo(badgeX + badgeW - r, badgeY);
          ctx.quadraticCurveTo(badgeX + badgeW, badgeY, badgeX + badgeW, badgeY + r);
          ctx.lineTo(badgeX + badgeW, badgeY + badgeH - r);
          ctx.quadraticCurveTo(badgeX + badgeW, badgeY + badgeH, badgeX + badgeW - r, badgeY + badgeH);
          ctx.lineTo(badgeX + r, badgeY + badgeH);
          ctx.quadraticCurveTo(badgeX, badgeY + badgeH, badgeX, badgeY + badgeH - r);
          ctx.lineTo(badgeX, badgeY + r);
          ctx.quadraticCurveTo(badgeX, badgeY, badgeX + r, badgeY);
          ctx.closePath();
          ctx.fill();

          // Badge text
          ctx.fillStyle = "rgba(5,10,18,0.95)";
          ctx.textBaseline = "middle";
          ctx.fillText(labelText, badgeX + padX, badgeY + badgeH / 2 + 0.5);

          // Vertical tick from line to badge bottom/top edge
          ctx.strokeStyle = hexToRgba(color, 0.5);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(xBreak, y);
          ctx.lineTo(xBreak, isBull ? badgeY + badgeH : badgeY);
          ctx.stroke();
        }
      }
    }
  };

  // ── create chart once ────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      localization: { locale: "en-US" },
      layout: {
        background: { color: C.bg },
        textColor: C.text,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: C.grid },
        horzLines: { color: C.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: C.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#1b2436",
        },
        horzLine: {
          color: C.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#1b2436",
        },
      },
      rightPriceScale: {
        borderColor: C.border,
        scaleMargins: { top: 0.08, bottom: 0.08 },
        entireTextOnly: false,
        ticksVisible: true,
      },
      timeScale: {
        borderColor: C.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
      handleScroll: true,
      handleScale: true,
      autoSize: false,
    });

    const series = createSeriesForType(chart, seriesTypeRef.current, digitsRef.current);

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        chart.resize(w, h);
        drawOverlay.current();
        updatePriceY.current();
      }
    });
    ro.observe(container);
    chart.resize(container.clientWidth, container.clientHeight);

    const onRange = () => {
      drawOverlay.current();
      updatePriceY.current();
      updateScrolledState();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    // rAF loop — detects vertical scale changes by watching whether the last
    // candle's priceToCoordinate result shifted.  When it does, both the price
    // badge and the overlay canvas are refreshed so BOS lines never drift.
    // (lightweight-charts has no price-scale-change subscription in v4.)
    let rafId: number;
    let lastRafPriceY: number | null | undefined = undefined;
    const rafLoop = () => {
      if (document.hidden) {
        rafId = requestAnimationFrame(rafLoop);
        return;
      }
      const s = seriesRef.current;
      const cs = candlesRef.current;
      if (s && cs.length > 0) {
        const y = s.priceToCoordinate(cs[cs.length - 1].close);
        if (y !== lastRafPriceY) {
          lastRafPriceY = y;
          updatePriceY.current();  // update the DOM price badge
          drawOverlay.current();   // redraw canvas so BOS lines follow candles
        }
      }
      rafId = requestAnimationFrame(rafLoop);
    };
    rafId = requestAnimationFrame(rafLoop);

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData.size) {
        setLegend(null);
        return;
      }
      const raw = param.seriesData.get(series as ISeriesApi<"Candlestick" | "Line">);
      if (!raw) return;
      if (seriesTypeRef.current === "line") {
        const d = raw as LineData;
        setLegend({
          time: Number(param.time),
          open: d.value,
          high: d.value,
          low: d.value,
          close: d.value,
        });
      } else {
        const d = raw as CandlestickData;
        setLegend({
          time: Number(param.time),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        });
      }
    });

    if (candlesRef.current.length) {
      pushSeriesData(series, seriesTypeRef.current, candlesRef.current);
      prevCandlesRef.current = candlesRef.current;
      chart.timeScale().fitContent();
      drawOverlay.current();
    }

    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      cancelAnimationFrame(rafId);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [updateScrolledState]);

  // ── update price format when digits change ──────────────────────────────
  useEffect(() => {
    seriesRef.current?.applyOptions({
      priceFormat: {
        type: "price",
        precision: digits,
        minMove: 1 / Math.pow(10, digits),
      },
    });
  }, [digits]);

  // ── smart candle push: update() for live bar, setData() for full reload ──
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length === 0) return;

    const prev = prevCandlesRef.current;
    const last = candles[candles.length - 1];
    const prevLast = prev[prev.length - 1];

    // Live update: same candle count and same last-bar timestamp → only OHLC changed
    if (prev.length > 0 && prev.length === candles.length && prevLast?.time === last?.time) {
      updateSeriesLast(series, seriesTypeRef.current, last);
    } else {
      // Full reload: candle count changed or first data
      pushSeriesData(series, seriesTypeRef.current, candles);
    }

    prevCandlesRef.current = candles;
    drawOverlay.current();
    updatePriceY.current();
  }, [candles]);

  // ── swap series type (candlestick ⇄ line) without recreating the chart ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || seriesTypeRef.current === chartType) return;

    if (seriesRef.current) chart.removeSeries(seriesRef.current);
    const series = createSeriesForType(chart, chartType, digitsRef.current);
    seriesRef.current = series;
    seriesTypeRef.current = chartType;

    if (candlesRef.current.length) {
      pushSeriesData(series, chartType, candlesRef.current);
      prevCandlesRef.current = candlesRef.current;
      chart.timeScale().fitContent();
    }
    drawOverlay.current();
  }, [chartType]);

  // ── re-fit + clear prev-ref when symbol / timeframe changes ────────────
  useEffect(() => {
    prevCandlesRef.current = [];
    if (candles.length === 0) return;
    const scale = chartRef.current?.timeScale();
    scale?.fitContent();
    scale?.scrollToRealTime();
    isScrolledBackRef.current = false;
    setIsScrolledBack(false);
    drawOverlay.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Custom tool colours repaint the overlay immediately.
  useEffect(() => subscribeToolColors(() => drawOverlay.current()), []);

  // A symbol/timeframe switch must never reuse the previous market's
  // IDM or BOS/CHoCH structure.
  useEffect(() => {
    idmCacheRef.current = null;
    bosCacheRef.current = null;
    drawOverlay.current();
  }, [resetKey]);


  // ── redraw overlay when zones change ───────────────────────────────────
  useEffect(() => {
    drawOverlay.current();
  }, [zones]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" style={{ zIndex: 2 }} />

      <div className="absolute bottom-8 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-panel/90 p-1 shadow-lg backdrop-blur-sm">
        <button
          type="button"
          onClick={() => zoom(0.8)}
          aria-label="Zoom in"
          title="Zoom in"
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => zoom(1.25)}
          aria-label="Zoom out"
          title="Zoom out"
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={backToLive}
          disabled={isSyncingLive}
          aria-label="Back to live"
          title="Back to live"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-80"
        >
          <RefreshCw className={isSyncingLive ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
        </button>
      </div>

      {legend && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex gap-3 rounded-md bg-panel/80 px-2.5 py-1 text-[11px] backdrop-blur-sm">
          <span className="text-muted-foreground">
            O <span className="tabular text-foreground">{formatPrice(legend.open, digits)}</span>
          </span>
          <span className="text-muted-foreground">
            H <span className="tabular text-foreground">{formatPrice(legend.high, digits)}</span>
          </span>
          <span className="text-muted-foreground">
            L <span className="tabular text-foreground">{formatPrice(legend.low, digits)}</span>
          </span>
          <span className="text-muted-foreground">
            C <span className="tabular text-foreground">{formatPrice(legend.close, digits)}</span>
          </span>
        </div>
      )}

      {/* Combined price + timer badge — one single element on the right axis */}
      {priceY != null && scaleWidth > 0 && candles.length > 0 && (
        <div
          className="pointer-events-none absolute z-10 overflow-hidden"
          style={{ top: priceY - 9, right: 0, width: scaleWidth - 6 }}
        >
          {/* Price row */}
          <div
            className="flex items-center justify-center py-[2px] text-[11px] font-medium tabular-nums text-white"
            style={{ background: "#2962ff" }}
          >
            {formatPrice(candles[candles.length - 1].close, digits)}
          </div>
          {/* Timer row */}
          {formattedTime && (
            <div className="flex items-center justify-center bg-[#1b2436] py-[2px] text-[11px] font-medium tabular-nums text-[#38bdf8]">
              {formattedTime}
            </div>
          )}
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col gap-2 bg-background/60 p-6 backdrop-blur-sm transition-smooth">
          <div className="skeleton h-6 w-40 rounded-md" />
          <div className="mt-auto flex items-end gap-1.5">
            {Array.from({ length: 24 }).map((_, i) => (
              <div
                key={i}
                className="skeleton flex-1 rounded-sm"
                style={{ height: `${20 + ((i * 37) % 60)}%` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const TradingChart = memo(TradingChartComponent);
