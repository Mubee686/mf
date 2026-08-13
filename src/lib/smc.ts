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
  provisional?: boolean;
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
 * Fair Value Gaps — strict 3-candle imbalance scan across the WHOLE dataset.
 *
 * Bullish FVG: candle[i-1].high < candle[i+1].low  → zone [c1.high, c3.low]
 * Bearish FVG: candle[i-1].low  > candle[i+1].high → zone [c3.high, c1.low]
 *
 * Every valid triplet is evaluated (internal structure included); nothing is
 * created where the maths does not hold. Each triplet yields at most one zone
 * (keyed by its three candle indices + direction + boundaries).
 */
function detectFVG(candles: Candle[], lastIndex: number): Zone[] {
  const zones: Zone[] = [];
  const seen = new Set<string>();

  for (let i = 1; i <= lastIndex - 1; i++) {
    const first = candles[i - 1];
    const mid = candles[i];
    const third = candles[i + 1];
    if (!first || !mid || !third) continue;

    let kind: ZoneKind | null = null;
    let low = 0;
    let high = 0;

    if (first.high < third.low) {
      kind = "bullish";
      low = first.high;
      high = third.low;
    } else if (first.low > third.high) {
      kind = "bearish";
      low = third.high;
      high = first.low;
    }
    if (!kind) continue;

    const size = high - low;
    if (size <= 0) continue;

    // Tiny noise floor only — the 3-candle condition is the real rule.
    const atr = atrAt(candles, i) || 0;
    if (atr > 0 && size < atr * 0.1) continue;

    // Mitigation: skip gaps price has already traded fully back through.
    let filled = false;
    for (let j = i + 2; j <= lastIndex; j++) {
      if (kind === "bullish" ? candles[j].low <= low : candles[j].high >= high) {
        filled = true;
        break;
      }
    }
    if (filled) continue;

    const key = `${kind}-${i - 1}-${i}-${i + 1}-${low}-${high}`;
    if (seen.has(key)) continue;
    seen.add(key);

    zones.push({
      id: `fvg-${kind}-${i - 1}-${i}-${i + 1}`,
      tool: "fvg",
      kind,
      startIndex: i,
      endIndex: lastIndex,
      priceHigh: high,
      priceLow: low,
      label: "FVG",
      detail: kind === "bullish" ? "Bullish 3-candle imbalance" : "Bearish 3-candle imbalance",
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
 * Order Blocks — iterative swing-based scan over the FULL candle dataset.
 *
 * Loop (deterministic, bounded by the candle array):
 *   for each CONFIRMED swing pivot (left + right confirmation)
 *     → require an impulsive displacement out of the pivot
 *     → require the displacement to break structure (prior opposing pivot)
 *     → pick the last opposing candle before the impulse candle as the OB
 *     → reject if mitigated / duplicate / inside an already-used leg
 *
 * Internal swings are first-class: every confirmed pivot is evaluated, not
 * just the highest high / lowest low. Continuation candles inside an already
 * accepted impulse leg can never spawn extra OBs because the scan skips any
 * pivot whose index falls before the previous accepted leg's end.
 */
const OB_PIVOT_SPAN = 3; // candles required on BOTH sides to confirm a swing
const OB_MAX_IMPULSE_BARS = 20; // displacement must resolve within this window

function detectOrderBlocks(candles: Candle[], lastIndex: number): Zone[] {
  const zones: Zone[] = [];
  const seen = new Set<string>();

  // Confirmed pivots only — findSwings requires OB_PIVOT_SPAN candles on each
  // side, so a swing is never marked before it can be confirmed.
  const pivots = findSwings(candles, OB_PIVOT_SPAN);
  if (!pivots.length) return zones;

  // End of the last accepted impulse leg — nothing before it may produce
  // another OB (this is what stops "an OB on every continuation candle").
  let legGuardIndex = -1;

  for (const pivot of pivots) {
    if (pivot.index <= legGuardIndex) continue;

    const kind: ZoneKind = pivot.type === "low" ? "bullish" : "bearish";
    const atr = atrAt(candles, pivot.index) || 0;
    if (atr <= 0) continue;

    // ── 1. Displacement out of the swing ────────────────────────────────────
    const scanTo = Math.min(lastIndex, pivot.index + OB_MAX_IMPULSE_BARS);
    let confirmIndex = -1;
    for (let j = pivot.index + 1; j <= scanTo; j++) {
      const c = candles[j];
      // Pivot invalidated before any displacement → not an OB origin.
      if (kind === "bullish" ? c.close < pivot.price : c.close > pivot.price) break;
      const travel = kind === "bullish" ? c.close - pivot.price : pivot.price - c.close;
      if (travel >= atr * 1.5) {
        confirmIndex = j;
        break;
      }
    }
    if (confirmIndex < 0) continue;

    // ── 2. The leg must contain a genuine impulse candle ────────────────────
    let impulseIndex = -1;
    for (let j = pivot.index + 1; j <= confirmIndex; j++) {
      const c = candles[j];
      const body = Math.abs(c.close - c.open);
      const directional = kind === "bullish" ? c.close > c.open : c.close < c.open;
      if (directional && body >= atr * 0.7) {
        impulseIndex = j;
        break;
      }
    }
    if (impulseIndex < 0) continue;

    // ── 3. Structure interaction: the displacement must take out the last
    //       opposing pivot (the swing that framed the pullback). When no such
    //       pivot exists yet, demand a larger displacement instead.
    const opposing = [...pivots]
      .reverse()
      .find((s) => s.index < pivot.index && s.type !== pivot.type);
    if (opposing) {
      let broke = false;
      for (let j = impulseIndex; j <= confirmIndex; j++) {
        if (
          kind === "bullish" ? candles[j].close > opposing.price : candles[j].close < opposing.price
        ) {
          broke = true;
          break;
        }
      }
      if (!broke) {
        const travel =
          kind === "bullish"
            ? candles[confirmIndex].close - pivot.price
            : pivot.price - candles[confirmIndex].close;
        if (travel < atr * 2.5) continue;
      }
    } else {
      const travel =
        kind === "bullish"
          ? candles[confirmIndex].close - pivot.price
          : pivot.price - candles[confirmIndex].close;
      if (travel < atr * 2.5) continue;
    }

    // ── 4. The qualifying OB candle: the LAST opposing candle immediately
    //       before the impulse candle (never an arbitrary earlier candle).
    const searchFrom = Math.max(0, impulseIndex - 4);
    let obIndex = -1;
    for (let i = impulseIndex - 1; i >= searchFrom; i--) {
      const c = candles[i];
      const isOpposing = kind === "bullish" ? c.close < c.open : c.close > c.open;
      if (isOpposing) {
        obIndex = i;
        break;
      }
    }
    // Fallback: the swing candle itself is the base when no opposing candle
    // sits between it and the impulse.
    if (obIndex < 0) obIndex = pivot.index;

    const ob = candles[obIndex];
    if (!ob) continue;

    // ── 5. Mitigation — a decisive close through the block kills it ─────────
    let mitigated = false;
    for (let j = confirmIndex + 1; j <= lastIndex; j++) {
      if (kind === "bullish" ? candles[j].close < ob.low : candles[j].close > ob.high) {
        mitigated = true;
        break;
      }
    }
    if (mitigated) {
      legGuardIndex = confirmIndex;
      continue;
    }

    // ── 6. Duplicate protection (index + direction + zone boundaries) ───────
    const key = `${kind}-${obIndex}-${ob.high}-${ob.low}`;
    if (seen.has(key)) continue;
    seen.add(key);

    zones.push({
      id: `ob-${kind}-${obIndex}-${confirmIndex}`,
      tool: "orderBlocks",
      kind,
      startIndex: obIndex,
      endIndex: lastIndex,
      priceHigh: ob.high,
      priceLow: ob.low,
      label: kind === "bullish" ? "Bull OB" : "Bear OB",
      detail: kind === "bullish" ? "Demand order block" : "Supply order block",
    });

    // Skip the rest of this impulse leg.
    legGuardIndex = confirmIndex;
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
function detectProvisionalOrderBlock(
  candles: Candle[],
  lastIndex: number,
  legs: SwingLeg[],
): Zone | null {
  if (lastIndex < 5) return null;

  const lastConfirmedIndex = legs.length ? legs[legs.length - 1].endIndex : 0;
  const windowStart = Math.max(lastConfirmedIndex, lastIndex - 6);
  if (lastIndex - windowStart < 2) return null;

  const atr = atrAt(candles, lastIndex) || 0;
  if (atr <= 0) return null;

  let hiIdx = windowStart;
  let loIdx = windowStart;
  for (let i = windowStart; i <= lastIndex; i++) {
    if (candles[i].high > candles[hiIdx].high) hiIdx = i;
    if (candles[i].low < candles[loIdx].low) loIdx = i;
  }

  const lastClose = candles[lastIndex].close;
  const dropFromHigh = candles[hiIdx].high - lastClose;
  const riseFromLow = lastClose - candles[loIdx].low;

  let kind: ZoneKind | null = null;
  let extremeIdx = -1;
  if (dropFromHigh >= atr * 0.5 && dropFromHigh >= riseFromLow) {
    kind = "bearish";
    extremeIdx = hiIdx;
  } else if (riseFromLow >= atr * 0.5) {
    kind = "bullish";
    extremeIdx = loIdx;
  }
  if (!kind || extremeIdx >= lastIndex) return null;

  const searchFrom = Math.max(0, extremeIdx - 3);
  const searchTo = Math.min(lastIndex, extremeIdx + 2);
  let best: { index: number; c: Candle } | null = null;
  for (let i = searchFrom; i <= searchTo; i++) {
    const c = candles[i];
    const isOpposing = kind === "bullish" ? c.close < c.open : c.close > c.open;
    if (!isOpposing) continue;
    if (!best || Math.abs(i - extremeIdx) < Math.abs(best.index - extremeIdx)) {
      best = { index: i, c };
    }
  }
  if (!best) return null;
  const { index: i, c } = best;

  return {
    id: `ob-provisional-${i}`,
    tool: "orderBlocks",
    kind,
    startIndex: i,
    endIndex: lastIndex,
    priceHigh: c.high,
    priceLow: c.low,
    label: kind === "bullish" ? "Bull OB" : "Bear OB",
    detail:
      (kind === "bullish" ? "Demand order block" : "Supply order block") +
      " — forming, not yet confirmed",
    provisional: true,
  };
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
  const fvg = detectFVG(candles, lastIndex);
  const orderBlocks = detectOrderBlocks(candles, lastIndex);
  const provisionalOB = detectProvisionalOrderBlock(candles, lastIndex, legs);
  // Never duplicate a confirmed OB with a forming one on the same candle.
  const orderBlocksOut =
    provisionalOB &&
    !orderBlocks.some((z) => z.startIndex === provisionalOB.startIndex && z.kind === provisionalOB.kind)
      ? [...orderBlocks, provisionalOB]
      : orderBlocks;

  const liquidity = detectLiquidity(candles, swings, lastIndex);
  const poi = detectPOI(orderBlocks, fvg);
  // IDM is intentionally chart-window scoped. TradingChart calls
  // detectVisibleIDM with the current logical range instead of using the
  // full-history analysis result here.
  const idm: Zone[] = [];

 return {
    orderBlocks: orderBlocksOut,
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

