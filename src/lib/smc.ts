import type { Candle } from "./forex";

export type ToolId = "orderBlocks" | "fvg" | "liquidity" | "bos" | "choch" | "poi" | "idm";

export type ZoneKind = "bullish" | "bearish" | "neutral";

export interface Zone {
  id: string;
  tool: ToolId;
  kind: ZoneKind;
  startIndex: number;
  endIndex: number;
  // box zones
  priceHigh?: number;
  priceLow?: number;
  // line zones
  price?: number;
  label: string;
  detail: string;
  // IDM-specific
  swept?: boolean;
  sweepIndex?: number; // candle index where price first traded through the IDM level
}

export interface ToolMeta {
  id: ToolId;
  name: string;
  short: string;
  color: string; // representative colour for legend / chip
  description: string;
  tier: "free" | "premium";
}

export const TOOLS: ToolMeta[] = [
  {
    id: "idm",
    name: "Inducement",
    short: "IDM",
    color: "#fb923c",
    tier: "free",
    description: "Minor liquidity swing used to lure traders before the real move.",
  },
  {
    id: "bos",
    name: "Break of Structure",
    short: "BOS",
    color: "#34d399",
    tier: "free",
    description: "Trend continuation break of a prior swing point.",
  },
  {
    id: "orderBlocks",
    name: "Order Blocks",
    short: "OB",
    color: "#38bdf8",
    tier: "premium",
    description: "Last opposing candle before an impulsive structure break.",
  },
  {
    id: "poi",
    name: "Points of Interest",
    short: "POI",
    color: "#ec4899",
    tier: "premium",
    description: "High-probability order blocks confluent with an FVG.",
  },
  {
    id: "liquidity",
    name: "Liquidity Zones",
    short: "LQ",
    color: "#f59e0b",
    tier: "premium",
    description: "Equal highs / lows resting liquidity (BSL & SSL).",
  },
  {
    id: "choch",
    name: "Change of Character",
    short: "CHoCH",
    color: "#facc15",
    tier: "premium",
    description: "First counter-trend break signalling a reversal.",
  },
  {
    id: "fvg",
    name: "Fair Value Gaps",
    short: "FVG",
    color: "#a78bfa",
    tier: "premium",
    description: "Three-candle imbalance where price left an inefficiency.",
  },
];

interface Swing {
  index: number;
  price: number;
  type: "high" | "low";
}

export function findSwings(candles: Candle[], span = 2): Swing[] {
  const swings: Swing[] = [];
  for (let i = span; i < candles.length - span; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - span; j <= i + span; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) swings.push({ index: i, price: candles[i].high, type: "high" });
    if (isLow) swings.push({ index: i, price: candles[i].low, type: "low" });
  }
  return swings.sort((a, b) => a.index - b.index);
}

function detectFVG(candles: Candle[], lastIndex: number): Zone[] {
  const zones: Zone[] = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const a = candles[i - 1];
    const c = candles[i + 1];
    if (a.high < c.low) {
      zones.push({
        id: `fvg-${i}`,
        tool: "fvg",
        kind: "bullish",
        startIndex: i,
        endIndex: lastIndex,
        priceHigh: c.low,
        priceLow: a.high,
        label: "FVG",
        detail: "Bullish imbalance",
      });
    } else if (a.low > c.high) {
      zones.push({
        id: `fvg-${i}`,
        tool: "fvg",
        kind: "bearish",
        startIndex: i,
        endIndex: lastIndex,
        priceHigh: a.low,
        priceLow: c.high,
        label: "FVG",
        detail: "Bearish imbalance",
      });
    }
  }
  return zones.slice(-6);
}

interface StructureResult {
  bos: Zone[];
  choch: Zone[];
  obSeeds: { index: number; kind: ZoneKind; breakIndex: number }[];
}

function detectStructure(candles: Candle[], swings: Swing[]): StructureResult {
  const bos: Zone[] = [];
  const choch: Zone[] = [];
  const obSeeds: { index: number; kind: ZoneKind; breakIndex: number }[] = [];

  let lastHigh: Swing | null = null;
  let lastLow: Swing | null = null;
  let trend: "up" | "down" | null = null;

  // After a BOS fires at candle breakI, only accept a NEW swing that formed
  // strictly after breakI.  This prevents cycling between nearby old swings.
  let nextHighMinIdx = 0; // next swing high must have index >= this
  let nextLowMinIdx  = 0; // next swing low  must have index >= this

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];

    // Confirmed swings up to (but not including) the current candle.
    const priorSwings = swings.filter((s) => s.index <= i - 1);

    // Pick the most-recent swing high / low that formed at or after the
    // minimum allowed index (set after the last break to stop cycling).
    const candidateHigh = [...priorSwings]
      .reverse()
      .find((s) => s.type === "high" && s.index >= nextHighMinIdx);
    if (candidateHigh) lastHigh = candidateHigh;

    const candidateLow = [...priorSwings]
      .reverse()
      .find((s) => s.type === "low" && s.index >= nextLowMinIdx);
    if (candidateLow) lastLow = candidateLow;

    if (lastHigh && c.close > lastHigh.price) {
      const kind: ZoneKind = "bullish";
      const isChoch = trend === "down";
      const zone: Zone = {
        id: `${isChoch ? "choch" : "bos"}-b-${i}`,
        tool: isChoch ? "choch" : "bos",
        kind,
        startIndex: lastHigh.index,
        endIndex: i,
        price: lastHigh.price,
        label: isChoch ? "CHoCH" : "BOS",
        detail: isChoch ? "Bullish reversal" : "Bullish continuation",
      };
      (isChoch ? choch : bos).push(zone);
      obSeeds.push({ index: lastHigh.index, kind: "bullish", breakIndex: i });
      // Next swing high must have formed AFTER this break candle
      nextHighMinIdx = i + 1;
      trend = "up";
      lastHigh = null;
    } else if (lastLow && c.close < lastLow.price) {
      const kind: ZoneKind = "bearish";
      const isChoch = trend === "up";
      const zone: Zone = {
        id: `${isChoch ? "choch" : "bos"}-s-${i}`,
        tool: isChoch ? "choch" : "bos",
        kind,
        startIndex: lastLow.index,
        endIndex: i,
        price: lastLow.price,
        label: isChoch ? "CHoCH" : "BOS",
        detail: isChoch ? "Bearish reversal" : "Bearish continuation",
      };
      (isChoch ? choch : bos).push(zone);
      obSeeds.push({ index: lastLow.index, kind: "bearish", breakIndex: i });
      // Next swing low must have formed AFTER this break candle
      nextLowMinIdx = i + 1;
      trend = "down";
      lastLow = null;
    }
  }

  return { bos: bos.slice(-5), choch: choch.slice(-4), obSeeds };
}

function detectOrderBlocks(
  candles: Candle[],
  seeds: StructureResult["obSeeds"],
  lastIndex: number,
): Zone[] {
  const zones: Zone[] = [];
  for (const seed of seeds) {
    // find the last opposing candle before the break move
    let obIndex = -1;
    for (let i = seed.breakIndex - 1; i >= Math.max(0, seed.breakIndex - 12); i--) {
      const bearish = candles[i].close < candles[i].open;
      const bullish = candles[i].close > candles[i].open;
      if (seed.kind === "bullish" && bearish) {
        obIndex = i;
        break;
      }
      if (seed.kind === "bearish" && bullish) {
        obIndex = i;
        break;
      }
    }
    if (obIndex < 0) continue;
    const c = candles[obIndex];
    zones.push({
      id: `ob-${obIndex}`,
      tool: "orderBlocks",
      kind: seed.kind,
      startIndex: obIndex,
      endIndex: lastIndex,
      priceHigh: c.high,
      priceLow: c.low,
      label: seed.kind === "bullish" ? "Bull OB" : "Bear OB",
      detail: seed.kind === "bullish" ? "Demand order block" : "Supply order block",
    });
  }
  // dedupe by index, keep most recent
  const map = new Map<number, Zone>();
  for (const z of zones) map.set(z.startIndex, z);
  return Array.from(map.values()).slice(-5);
}

function detectLiquidity(candles: Candle[], swings: Swing[], lastIndex: number): Zone[] {
  const zones: Zone[] = [];
  const tol =
    (candles.reduce((s, c) => s + (c.high - c.low), 0) / candles.length) * 0.35 || 0.0001;

  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");

  const cluster = (points: Swing[], kind: "buy" | "sell") => {
    const used = new Set<number>();
    for (let i = 0; i < points.length; i++) {
      if (used.has(i)) continue;
      const group = [points[i]];
      for (let j = i + 1; j < points.length; j++) {
        if (used.has(j)) continue;
        if (Math.abs(points[j].price - points[i].price) <= tol) {
          group.push(points[j]);
          used.add(j);
        }
      }
      if (group.length >= 2) {
        const price = group.reduce((s, g) => s + g.price, 0) / group.length;
        const start = Math.min(...group.map((g) => g.index));
        zones.push({
          id: `lq-${kind}-${start}`,
          tool: "liquidity",
          kind: kind === "buy" ? "bullish" : "bearish",
          startIndex: start,
          endIndex: lastIndex,
          price,
          label: kind === "buy" ? "BSL" : "SSL",
          detail: kind === "buy" ? "Buy-side liquidity" : "Sell-side liquidity",
        });
      }
    }
  };

  cluster(highs, "buy");
  cluster(lows, "sell");
  return zones.slice(-6);
}

/**
 * IDM (Inducement) Detection
 *
 * Real SMC logic:
 * 1. Identify the current trend via major swings (span=5).
 * 2. In an uptrend leg: the IDM is the LOWEST minor swing low that formed
 *    AFTER the last major swing low (the leg's base) and BEFORE current
 *    price.  Smart money sweeps this minor low (grabbing stops) before
 *    driving price to a new Higher High.
 * 3. In a downtrend leg: the IDM is the HIGHEST minor swing high that
 *    formed AFTER the last major swing high (the leg's top) and BEFORE
 *    current price.  SM sweeps this minor high before driving to a new
 *    Lower Low.
 * 4. "Swept" = any candle AFTER the IDM candle has wicked through it
 *    (low < IDM price for bullish / high > IDM price for bearish).
 * 5. Recalculated on every candle close → always reflects the latest IDM.
 */
function detectIDM(candles: Candle[], _swings: Swing[], lastIndex: number): Zone[] {
  if (candles.length < 15) return [];

  // Major swings for trend direction (span=5 = more significant pivots)
  const majorSwings = findSwings(candles, 5);
  // Minor swings for IDM candidates (span=2 = internal pivots)
  const minorSwings = findSwings(candles, 2);

  const majorHighs = majorSwings.filter((s) => s.type === "high");
  const majorLows  = majorSwings.filter((s) => s.type === "low");
  const minorHighs = minorSwings.filter((s) => s.type === "high");
  const minorLows  = minorSwings.filter((s) => s.type === "low");

  const zones: Zone[] = [];

  // ── UPTREND LEG ───────────────────────────────────────────────────────────
  // We need at least two major lows (Higher Low pattern) and the last major
  // high must come AFTER the last major low (price pushing up).
  if (majorLows.length >= 1 && majorHighs.length >= 1) {
    const lastMajorLow  = majorLows[majorLows.length - 1];
    const lastMajorHigh = majorHighs[majorHighs.length - 1];

    // Uptrend leg: last major LOW occurred before the last major HIGH
    if (lastMajorLow.index < lastMajorHigh.index) {
      // IDM candidates: minor lows that formed between the last major low
      // and the last major high (the in-between liquidity pool)
      const candidates = minorLows.filter(
        (s) =>
          s.index > lastMajorLow.index &&
          s.index < lastMajorHigh.index &&
          s.price > lastMajorLow.price, // must be above the major low
      );

      if (candidates.length > 0) {
        // Pick the LOWEST of the candidates — deepest liquidity pool
        const idm = candidates.reduce((best, s) => (s.price < best.price ? s : best));

        // Find the first candle after the IDM that wicked below it (the sweep candle)
        const candlesAfter = candles.slice(idm.index + 1);
        const sweepOffset = candlesAfter.findIndex((c) => c.low < idm.price);
        const swept = sweepOffset !== -1;
        const sweepIndex = swept ? idm.index + 1 + sweepOffset : undefined;

        zones.push({
          id: `idm-bull-${idm.index}`,
          tool: "idm",
          kind: "bullish",
          startIndex: idm.index,
          endIndex: swept ? sweepIndex! : lastIndex,
          price: idm.price,
          swept,
          sweepIndex,
          label: swept ? "IDM ✓" : "IDM",
          detail: swept
            ? "Bullish inducement swept — SM grabbed stops, expect HH"
            : "Bullish IDM — minor low, stops below targeted before new HH",
        });
      }
    }
  }

  // ── DOWNTREND LEG ─────────────────────────────────────────────────────────
  // Last major HIGH occurred before the last major LOW (price pushing down).
  if (majorHighs.length >= 1 && majorLows.length >= 1) {
    const lastMajorHigh = majorHighs[majorHighs.length - 1];
    const lastMajorLow  = majorLows[majorLows.length - 1];

    if (lastMajorHigh.index < lastMajorLow.index) {
      // IDM candidates: minor highs between the last major high and last
      // major low — the minor liquidity pool SM will sweep first
      const candidates = minorHighs.filter(
        (s) =>
          s.index > lastMajorHigh.index &&
          s.index < lastMajorLow.index &&
          s.price < lastMajorHigh.price, // must be below the major high
      );

      if (candidates.length > 0) {
        // Pick the HIGHEST candidate — most prominent stop cluster
        const idm = candidates.reduce((best, s) => (s.price > best.price ? s : best));

        // Find the first candle after the IDM that wicked above it (the sweep candle)
        const candlesAfter = candles.slice(idm.index + 1);
        const sweepOffset = candlesAfter.findIndex((c) => c.high > idm.price);
        const swept = sweepOffset !== -1;
        const sweepIndex = swept ? idm.index + 1 + sweepOffset : undefined;

        zones.push({
          id: `idm-bear-${idm.index}`,
          tool: "idm",
          kind: "bearish",
          startIndex: idm.index,
          endIndex: swept ? sweepIndex! : lastIndex,
          price: idm.price,
          swept,
          sweepIndex,
          label: swept ? "IDM ✓" : "IDM",
          detail: swept
            ? "Bearish inducement swept — SM grabbed stops, expect LL"
            : "Bearish IDM — minor high, stops above targeted before new LL",
        });
      }
    }
  }

  return zones;
}

/**
 * Detect the single confirmed IDM inside a visible candle window.
 *
 * The window is intentional: IDM is a liquidity-sweep-before-structure
 * pattern, so candles outside the current chart range must not create or
 * preserve a marker. The returned index values are mapped back to the full
 * candle array for chart coordinates.
 */
export function detectVisibleIDM(
  candles: Candle[],
  visibleFrom = 0,
  visibleTo = candles.length - 1,
): Zone[] {
  const from = Math.max(0, Math.floor(visibleFrom));
  const to = Math.min(candles.length - 1, Math.ceil(visibleTo));
  if (from > to || to - from + 1 < 15) return [];

  const window = candles.slice(from, to + 1);
  const major = findSwings(window, 5);
  const minor = findSwings(window, 2);
  const majorHigh = major.filter((s) => s.type === "high").at(-1);
  const majorLow = major.filter((s) => s.type === "low").at(-1);
  if (!majorHigh || !majorLow) return [];

  const findSweep = (candidate: Swing, endIndex: number) => {
    for (let i = candidate.index + 1; i <= endIndex; i++) {
      const candle = window[i];
      const pierced =
        candidate.type === "high" ? candle.high > candidate.price : candle.low < candidate.price;
      if (!pierced) continue;

      const closedBackInside =
        candidate.type === "high" ? candle.close < candidate.price : candle.close > candidate.price;
      if (closedBackInside) return i;

      // A close-through is only a brief sweep when the next candle closes
      // back across the level. A sustained close-through is a structure break.
      const next = window[i + 1];
      if (next) {
        const nextClosedBackInside =
          candidate.type === "high" ? next.close < candidate.price : next.close > candidate.price;
        if (nextClosedBackInside) return i;
      }
      return undefined;
    }
    return undefined;
  };

  let candidate: Swing | undefined;
  let sweepIndex: number | undefined;
  let kind: ZoneKind | undefined;

  if (majorLow.index < majorHigh.index) {
    // Once the real structural high has closed beyond its level, the leg is
    // complete and its IDM is no longer the active inducement.
    if (window.slice(majorHigh.index + 1).some((c) => c.close > majorHigh.price)) {
      return [];
    }
    // Bullish structure: buy-side liquidity above the latest internal high.
    const candidates = minor
      .filter(
        (s) =>
          s.type === "high" &&
          s.index > majorLow.index &&
          s.index < majorHigh.index &&
          s.price < majorHigh.price,
      )
      .sort((a, b) => b.index - a.index);
    for (const point of candidates) {
      const sweptAt = findSweep(point, majorHigh.index - 1);
      if (sweptAt != null) {
        candidate = point;
        sweepIndex = sweptAt;
        kind = "bullish";
        break;
      }
    }
  } else {
    // Same invalidation for a bearish leg: a close below the structural low
    // is the actual break, not a sweep of the preceding inducement.
    if (window.slice(majorLow.index + 1).some((c) => c.close < majorLow.price)) {
      return [];
    }
    // Bearish structure: sell-side liquidity below the latest internal low.
    const candidates = minor
      .filter(
        (s) =>
          s.type === "low" &&
          s.index > majorHigh.index &&
          s.index < majorLow.index &&
          s.price > majorLow.price,
      )
      .sort((a, b) => b.index - a.index);
    for (const point of candidates) {
      const sweptAt = findSweep(point, majorLow.index - 1);
      if (sweptAt != null) {
        candidate = point;
        sweepIndex = sweptAt;
        kind = "bearish";
        break;
      }
    }
  }

  if (!candidate || sweepIndex == null || !kind) return [];
  const startIndex = from + candidate.index;
  const globalSweepIndex = from + sweepIndex;
  return [
    {
      id: `idm-${kind === "bullish" ? "up" : "down"}-${startIndex}`,
      tool: "idm",
      kind,
      startIndex,
      endIndex: globalSweepIndex,
      price: candidate.price,
      swept: true,
      sweepIndex: globalSweepIndex,
      label: "IDM ✓",
      detail:
        kind === "bullish"
          ? "Bullish IDM swept — internal high taken before the structural high"
          : "Bearish IDM swept — internal low taken before the structural low",
    },
  ];
}

function detectPOI(orderBlocks: Zone[], fvgs: Zone[]): Zone[] {
  const zones: Zone[] = [];
  for (const ob of orderBlocks) {
    if (ob.priceHigh == null || ob.priceLow == null) continue;
    const overlap = fvgs.find(
      (f) =>
        f.priceHigh != null &&
        f.priceLow != null &&
        f.priceLow <= ob.priceHigh! &&
        f.priceHigh >= ob.priceLow!,
    );
    if (overlap) {
      zones.push({
        id: `poi-${ob.startIndex}`,
        tool: "poi",
        kind: ob.kind,
        startIndex: Math.min(ob.startIndex, overlap.startIndex),
        endIndex: ob.endIndex,
        priceHigh: Math.max(ob.priceHigh!, overlap.priceHigh!),
        priceLow: Math.min(ob.priceLow!, overlap.priceLow!),
        label: "POI",
        detail: "OB + FVG confluence",
      });
    }
  }
  return zones.slice(-4);
}

/**
 * Returns ALL detected BOS and CHoCH zones for the given candle set with no
 * count cap.  Used by TradingChart to dynamically filter by the visible
 * logical range on every pan / zoom so historical BOS is always shown when
 * the user scrolls left.
 */
export function detectAllBOS(candles: Candle[]): { bos: Zone[]; choch: Zone[] } {
  if (candles.length < 10) return { bos: [], choch: [] };
  const swings = findSwings(candles, 2);

  const bos: Zone[] = [];
  const choch: Zone[] = [];

  let lastHigh: Swing | null = null;
  let lastLow: Swing | null = null;
  let trend: "up" | "down" | null = null;
  let nextHighMinIdx = 0;
  let nextLowMinIdx  = 0;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const priorSwings = swings.filter((s) => s.index <= i - 1);

    const candidateHigh = [...priorSwings]
      .reverse()
      .find((s) => s.type === "high" && s.index >= nextHighMinIdx);
    if (candidateHigh) lastHigh = candidateHigh;

    const candidateLow = [...priorSwings]
      .reverse()
      .find((s) => s.type === "low" && s.index >= nextLowMinIdx);
    if (candidateLow) lastLow = candidateLow;

    if (lastHigh && c.close > lastHigh.price) {
      const isChoch = trend === "down";
      const zone: Zone = {
        id: `${isChoch ? "choch" : "bos"}-b-${i}`,
        tool: isChoch ? "choch" : "bos",
        kind: "bullish",
        startIndex: lastHigh.index,
        endIndex: i,
        price: lastHigh.price,
        label: isChoch ? "CHoCH" : "BOS",
        detail: isChoch ? "Bullish reversal" : "Bullish continuation",
      };
      (isChoch ? choch : bos).push(zone);
      nextHighMinIdx = i + 1;
      trend = "up";
      lastHigh = null;
    } else if (lastLow && c.close < lastLow.price) {
      const isChoch = trend === "up";
      const zone: Zone = {
        id: `${isChoch ? "choch" : "bos"}-s-${i}`,
        tool: isChoch ? "choch" : "bos",
        kind: "bearish",
        startIndex: lastLow.index,
        endIndex: i,
        price: lastLow.price,
        label: isChoch ? "CHoCH" : "BOS",
        detail: isChoch ? "Bearish reversal" : "Bearish continuation",
      };
      (isChoch ? choch : bos).push(zone);
      nextLowMinIdx = i + 1;
      trend = "down";
      lastLow = null;
    }
  }

  return { bos, choch };
}

export interface AnalysisResult {
  orderBlocks: Zone[];
  fvg: Zone[];
  liquidity: Zone[];
  bos: Zone[];
  choch: Zone[];
  poi: Zone[];
  idm: Zone[];
}

export function analyze(candles: Candle[]): AnalysisResult {
  const empty: AnalysisResult = {
    orderBlocks: [],
    fvg: [],
    liquidity: [],
    bos: [],
    choch: [],
    poi: [],
    idm: [],
  };
  if (candles.length < 10) return empty;

  const lastIndex = candles.length - 1;
  const swings = findSwings(candles, 2);
  const fvg = detectFVG(candles, lastIndex);
  const structure = detectStructure(candles, swings);
  const orderBlocks = detectOrderBlocks(candles, structure.obSeeds, lastIndex);
  const liquidity = detectLiquidity(candles, swings, lastIndex);
  const poi = detectPOI(orderBlocks, fvg);
  // IDM is intentionally chart-window scoped. TradingChart calls
  // detectVisibleIDM with the current logical range instead of using the
  // full-history analysis result here.
  const idm: Zone[] = [];

  return {
    orderBlocks,
    fvg,
    liquidity,
    bos: structure.bos,
    choch: structure.choch,
    poi,
    idm,
  };
}

export function zonesForTools(result: AnalysisResult, enabled: Set<ToolId>): Zone[] {
  const out: Zone[] = [];
  (Object.keys(result) as ToolId[]).forEach((k) => {
    if (enabled.has(k)) out.push(...result[k]);
  });
  return out;
}
