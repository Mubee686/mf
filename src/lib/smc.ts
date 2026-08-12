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
    color: "#fbbf24",
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

/**
 * Structural swing legs — the single source of truth for OB / FVG detection.
 *
 * A leg is the move between two consecutive (alternating) significant swing
 * points. Every leg is evaluated independently, so the most recent swing, the
 * second-most-recent, and all internal swings each get their own OB / FVG.
 */
export interface SwingLeg {
  startIndex: number;
  endIndex: number;
  startPrice: number;
  endPrice: number;
  kind: ZoneKind; // "bullish" = up-leg (low -> high)
  atr: number;
}

/** Alternating, extremes-only swing sequence. */
function alternatingSwings(candles: Candle[], span: number): Swing[] {
  const raw = findSwings(candles, span);
  const out: Swing[] = [];
  for (const s of raw) {
    const prev = out[out.length - 1];
    if (!prev || prev.type !== s.type) {
      out.push(s);
      continue;
    }
    if (s.type === "high" ? s.price > prev.price : s.price < prev.price) {
      out[out.length - 1] = s;
    }
  }
  return out;
}

/**
 * Build every significant swing leg. Legs that are small relative to recent
 * volatility are dropped — those are the noise that produced walls of zones.
 */
export function swingLegs(candles: Candle[], span = 5): SwingLeg[] {
  const swings = alternatingSwings(candles, span);
  const legs: SwingLeg[] = [];
  for (let i = 0; i < swings.length - 1; i++) {
    const a = swings[i];
    const b = swings[i + 1];
    if (b.index <= a.index + 1) continue;
    const atr = atrAt(candles, b.index) || 0;
    const size = Math.abs(b.price - a.price);
    // Significance: a real structural leg travels multiple ATRs.
    if (atr > 0 && size < atr * 0.4) continue;
    legs.push({
      startIndex: a.index,
      endIndex: b.index,
      startPrice: a.price,
      endPrice: b.price,
      kind: b.type === "high" ? "bullish" : "bearish",
      atr,
    });
  }
  return legs;
}

/**
 * Fair Value Gaps — one per structural swing leg (the strongest).
 *
 * Filters: gap must sit inside the leg, be directionally consistent with it,
 * be large relative to recent ATR, and still be unfilled.
 */
function detectFVG(candles: Candle[], lastIndex: number, legs: SwingLeg[]): Zone[] {
  const zones: Zone[] = [];

  for (const leg of legs) {
    const from = Math.max(1, leg.startIndex + 1);
    const to = Math.min(lastIndex - 1, leg.endIndex);
    if (to < from) continue;

    const legLow = Math.min(leg.startPrice, leg.endPrice);
    const legHigh = Math.max(leg.startPrice, leg.endPrice);

    let best: { index: number; low: number; high: number; size: number } | null = null;

    for (let i = from; i <= to; i++) {
      const first = candles[i - 1];
      const third = candles[i + 1];
      if (!first || !third) continue;

      let low: number | null = null;
      let high: number | null = null;
      if (leg.kind === "bullish" && first.high < third.low) {
        low = first.high;
        high = third.low;
      } else if (leg.kind === "bearish" && first.low > third.high) {
        low = third.high;
        high = first.low;
      }
      if (low === null || high === null) continue;

      const size = high - low;
      // Noise filter — a genuine imbalance is a real slice of volatility.
      if (leg.atr > 0 && size < leg.atr * 0.25) continue;
      // Must belong to this leg's price span.
      if (high < legLow || low > legHigh) continue;

      // Mitigation: skip gaps price has already traded fully back through.
      let filled = false;
      for (let j = i + 2; j <= lastIndex; j++) {
        if (leg.kind === "bullish" ? candles[j].low <= low : candles[j].high >= high) {
          filled = true;
          break;
        }
      }
      if (filled) continue;

      if (!best || size > best.size) best = { index: i, low, high, size };
    }

    if (!best) continue;

    zones.push({
      id: `fvg-${leg.startIndex}-${leg.endIndex}-${best.index}`,
      tool: "fvg",
      kind: leg.kind,
      startIndex: best.index,
      endIndex: lastIndex,
      priceHigh: best.high,
      priceLow: best.low,
      label: "FVG",
      detail: leg.kind === "bullish" ? "Bullish swing FVG" : "Bearish swing FVG",
    });
  }

  return dedupeByCandle(zones);
}

/** Keep one zone per originating candle, ordered oldest → newest. */
function dedupeByCandle(zones: Zone[]): Zone[] {
  const map = new Map<number, Zone>();
  for (const z of zones) map.set(z.startIndex, z);
  return Array.from(map.values()).sort((a, b) => a.startIndex - b.startIndex);
}


interface StructureResult {
  bos: Zone[];
  choch: Zone[];
  obSeeds: { index: number; kind: ZoneKind; breakIndex: number }[];
}

/**
 * Swing lookback used for ALL structure (BOS / CHoCH) detection.
 * 5 bars either side keeps only genuinely significant swing points — a
 * smaller span flags minor wiggles as structural breaks.
 * Both terminals (Futures + Forex) share this constant via computeStructure.
 */
export const STRUCTURE_SWING_SPAN = 5;

/** Average true range over the last `period` candles up to `index`. */
function atrAt(candles: Candle[], index: number, period = 14): number {
  const from = Math.max(1, index - period + 1);
  let sum = 0;
  let n = 0;
  for (let i = from; i <= index && i < candles.length; i++) {
    const p = candles[i - 1];
    const c = candles[i];
    sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * SINGLE SOURCE OF TRUTH for BOS / CHoCH.
 *
 * Uptrend  → BOS when a candle CLOSES above the most recent significant
 *            higher high (swing high).
 * Downtrend→ BOS when a candle CLOSES below the most recent significant
 *            lower low (swing low).
 * The first counter-trend break is labelled CHoCH instead of BOS.
 *
 * The break must clear the level by a small ATR buffer so noise doesn't
 * register as structure.
 */
export function computeStructure(
  candles: Candle[],
  span: number = STRUCTURE_SWING_SPAN,
): StructureResult {
  const bos: Zone[] = [];
  const choch: Zone[] = [];
  const obSeeds: { index: number; kind: ZoneKind; breakIndex: number }[] = [];
  if (candles.length < span * 2 + 3) return { bos, choch, obSeeds };

  const swings = findSwings(candles, span);
  // Minor pivots (pullback swings). A CHoCH is the FIRST counter-trend break
  // of the most recent minor pullback swing formed after the last break —
  // shallow pullbacks rarely register as major (span) swings, so using minor
  // pivots here is what makes reversals detectable at all.
  const minorSwings = findSwings(candles, Math.max(2, Math.floor(span / 2)));

  let lastHigh: Swing | null = null;
  let lastLow: Swing | null = null;
  let trend: "up" | "down" | null = null;
  let lastBreakIndex = 0;

  // After a break fires at candle i, only accept a NEW swing formed after it.
  let nextHighMinIdx = 0;
  let nextLowMinIdx = 0;

  const pushZone = (
    isChoch: boolean,
    kind: ZoneKind,
    swingIndex: number,
    price: number,
    i: number,
  ) => {
    const zone: Zone = {
      id: `${isChoch ? "choch" : "bos"}-${kind === "bullish" ? "b" : "s"}-${i}`,
      tool: isChoch ? "choch" : "bos",
      kind,
      startIndex: swingIndex,
      endIndex: i,
      price,
      label: isChoch ? "CHoCH" : "BOS",
      detail: isChoch
        ? kind === "bullish"
          ? "Bullish reversal"
          : "Bearish reversal"
        : kind === "bullish"
          ? "Bullish continuation"
          : "Bearish continuation",
    };
    (isChoch ? choch : bos).push(zone);
    obSeeds.push({ index: swingIndex, kind, breakIndex: i });
  };

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];

    // Confirmed swings up to (but not including) the current candle.
    const priorSwings = swings.filter((s) => s.index <= i - 1);

    const candidateHigh = [...priorSwings]
      .reverse()
      .find((s) => s.type === "high" && s.index >= nextHighMinIdx);
    if (candidateHigh) lastHigh = candidateHigh;

    const candidateLow = [...priorSwings]
      .reverse()
      .find((s) => s.type === "low" && s.index >= nextLowMinIdx);
    if (candidateLow) lastLow = candidateLow;

    // Most recent minor pullback pivot formed after the last structural break.
    const pullbackLow =
      trend === "up"
        ? [...minorSwings]
            .reverse()
            .find((s) => s.type === "low" && s.index > lastBreakIndex && s.index <= i - 1)
        : undefined;
    const pullbackHigh =
      trend === "down"
        ? [...minorSwings]
            .reverse()
            .find((s) => s.type === "high" && s.index > lastBreakIndex && s.index <= i - 1)
        : undefined;

    // Noise filter: the close must clear the level by a fraction of ATR.
    const buffer = atrAt(candles, i) * 0.05;

    // ── Reversal (CHoCH) takes priority over continuation ────────────────────
    if (trend === "up" && pullbackLow && c.close < pullbackLow.price - buffer) {
      pushZone(true, "bearish", pullbackLow.index, pullbackLow.price, i);
      trend = "down";
      lastBreakIndex = i;
      nextHighMinIdx = i + 1;
      nextLowMinIdx = i + 1;
      lastHigh = null;
      lastLow = null;
      continue;
    }
    if (trend === "down" && pullbackHigh && c.close > pullbackHigh.price + buffer) {
      pushZone(true, "bullish", pullbackHigh.index, pullbackHigh.price, i);
      trend = "up";
      lastBreakIndex = i;
      nextHighMinIdx = i + 1;
      nextLowMinIdx = i + 1;
      lastHigh = null;
      lastLow = null;
      continue;
    }

    // ── Continuation (BOS) ───────────────────────────────────────────────────
    if (lastHigh && c.close > lastHigh.price + buffer && trend !== "down") {
      pushZone(false, "bullish", lastHigh.index, lastHigh.price, i);
      nextHighMinIdx = i + 1;
      lastBreakIndex = i;
      trend = "up";
      lastHigh = null;
    } else if (lastLow && c.close < lastLow.price - buffer && trend !== "up") {
      pushZone(false, "bearish", lastLow.index, lastLow.price, i);
      nextLowMinIdx = i + 1;
      lastBreakIndex = i;
      trend = "down";
      lastLow = null;
    }
  }


  return { bos, choch, obSeeds };
}



/**
 * Order Blocks — one per structural swing leg.
 *
 * Bullish OB = the LAST bearish candle before the impulsive up-leg.
 * Bearish OB = the LAST bullish candle before the impulsive down-leg.
 *
 * Validity: the displacement out of the candle must be meaningful relative to
 * ATR, the candle must belong to the leg, and the block must not yet be fully
 * mitigated. Colour alone never creates an OB.
 */
function detectOrderBlocks(candles: Candle[], lastIndex: number, legs: SwingLeg[]): Zone[] {
  const zones: Zone[] = [];

  for (const leg of legs) {
    const from = leg.startIndex;
    const to = Math.min(lastIndex, leg.endIndex);
    if (to <= from + 1) continue;

    const legLow = Math.min(leg.startPrice, leg.endPrice);
    const legHigh = Math.max(leg.startPrice, leg.endPrice);

    for (let i = to - 1; i >= from; i--) {
      const c = candles[i];
      const isOpposing = leg.kind === "bullish" ? c.close < c.open : c.close > c.open;
      if (!isOpposing) continue;

      // Impulse filter — the move away from the block must be significant.
      const displacement =
        leg.kind === "bullish" ? leg.endPrice - c.high : c.low - leg.endPrice;
      if (leg.atr > 0 && displacement < leg.atr * 0.4) continue;

      // The block must sit inside this leg's price span.
      if (c.high < legLow || c.low > legHigh) continue;

      // Mitigation: skip blocks price has already closed fully through.
      let mitigated = false;
      for (let j = to + 1; j <= lastIndex; j++) {
        if (leg.kind === "bullish" ? candles[j].close < c.low : candles[j].close > c.high) {
          mitigated = true;
          break;
        }
      }
      if (mitigated) break;

      zones.push({
        id: `ob-${leg.startIndex}-${leg.endIndex}-${i}`,
        tool: "orderBlocks",
        kind: leg.kind,
        startIndex: i,
        endIndex: lastIndex,
        priceHigh: c.high,
        priceLow: c.low,
        label: leg.kind === "bullish" ? "Bull OB" : "Bear OB",
        detail: leg.kind === "bullish" ? "Demand order block" : "Supply order block",
      });

      // One valid OB per swing leg.
      break;
    }
  }

  return dedupeByCandle(zones);
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

       let pendingCandidate: Swing | undefined;

  // majorHigh is more recent than majorLow => price made a High, then
  // pulled back => the pullback LOW is the bullish IDM. Price is expected
  // to break back above majorHigh (BOS) after the IDM is swept.
  if (majorHigh.index > majorLow.index) {
    if (window.slice(majorHigh.index + 1).some((c) => c.close > majorHigh.price)) {
      return [];
    }
    const candidates = minor
      .filter(
        (s) =>
          s.type === "low" &&
          s.index > majorHigh.index &&
          s.price > majorLow.price,
      )
      .sort((a, b) => a.index - b.index);
    pendingCandidate = candidates[0];
    for (const point of candidates) {
      const sweptAt = findSweep(point, window.length - 1);
      if (sweptAt != null) {
        candidate = point;
        sweepIndex = sweptAt;
        kind = "bullish";
        break;
      }
    }
    if (!candidate && pendingCandidate) kind = "bullish";
  } else {
    // majorLow is more recent than majorHigh => price made a Low, then
    // pulled back => the pullback HIGH is the bearish IDM. Price is
    // expected to break back below majorLow (BOS) after the IDM is swept.
    if (window.slice(majorLow.index + 1).some((c) => c.close < majorLow.price)) {
      return [];
    }
    const candidates = minor
      .filter(
        (s) =>
          s.type === "high" &&
          s.index > majorLow.index &&
          s.price < majorHigh.price,
      )
      .sort((a, b) => a.index - b.index);
    pendingCandidate = candidates[0];
    for (const point of candidates) {
      const sweptAt = findSweep(point, window.length - 1);
      if (sweptAt != null) {
        candidate = point;
        sweepIndex = sweptAt;
        kind = "bearish";
        break;
      }
    }
    if (!candidate && pendingCandidate) kind = "bearish";
  }

  if (candidate && sweepIndex != null && kind) {
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
            ? "Bullish IDM swept — pullback low taken before the break above the prior high"
            : "Bearish IDM swept — pullback high taken before the break below the prior low",
      },
    ];
  }

  if (pendingCandidate && kind) {
    const startIndex = from + pendingCandidate.index;
    return [
      {
        id: `idm-${kind === "bullish" ? "up" : "down"}-${startIndex}-pending`,
        tool: "idm",
        kind,
        startIndex,
        endIndex: to,
        price: pendingCandidate.price,
        swept: false,
        sweepIndex: undefined,
        label: "IDM",
        detail:
          kind === "bullish"
            ? "Bullish IDM — pullback low not yet swept"
            : "Bearish IDM — pullback high not yet swept",
      },
    ];
  }

  return [];
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
 * count cap.  Used by BOTH terminals (Futures + Forex) — it is a thin wrapper
 * over computeStructure so the detection rules can never diverge.
 */
export function detectAllBOS(candles: Candle[]): { bos: Zone[]; choch: Zone[] } {
  const { bos, choch } = computeStructure(candles);
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
  const structure = computeStructure(candles);
  const legs = swingLegs(candles);
  const fvg = detectFVG(candles, lastIndex, legs);
  const orderBlocks = detectOrderBlocks(candles, lastIndex, legs);

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

/**
 * Restrict origin-anchored zones (OB / FVG / POI) to the candles currently in
 * view. A zone whose originating candle is off-screen is not relevant to the
 * visible structure, so a small screen naturally shows fewer zones and a wide
 * one shows more — with no fixed global cap.
 */
export function zonesInVisibleRange(
  zones: Zone[],
  visibleFrom: number,
  visibleTo: number,
): Zone[] {
  const from = Math.floor(visibleFrom);
  const to = Math.ceil(visibleTo);
  const windowed = new Set<ToolId>(["orderBlocks", "fvg", "poi"]);
  return zones.filter((z) =>
    windowed.has(z.tool) ? z.startIndex >= from && z.startIndex <= to : true,
  );
}

