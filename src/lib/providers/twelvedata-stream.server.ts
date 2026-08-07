/**
 * Twelve Data live-tick bridge — SERVER-ONLY singleton.
 *
 * Twelve Data's push WebSocket feed is a Pro-plan feature, so on a
 * free-tier key "live" prices are delivered by polling the `/price` REST
 * endpoint on a per-symbol interval and fanning ticks out to any number of
 * local subscribers (SSE clients) — mirroring the same subscribe/unsubscribe,
 * ref-counted shape the app expects from a market-data stream. Only one
 * upstream poll timer runs per distinct symbol, no matter how many browser
 * tabs/pairs are watching it, to stay well under the free-tier rate limit.
 *
 * Stored on `globalThis` so Vite's dev-server HMR (which re-evaluates this
 * module on every edit) reuses the same poll timers instead of leaking new
 * ones per reload.
 */
import { fetchLatestPrice } from "./twelvedata.server";

export interface Tick {
  symbol: string;
  price: number;
  timestamp: number; // ms
}

type Listener = (tick: Tick) => void;

interface StreamState {
  timers: Map<string, ReturnType<typeof setInterval>>; // symbol -> poll timer
  listeners: Map<string, Set<Listener>>; // symbol -> listeners
  lastTick: Map<string, Tick>;
  inFlight: Set<string>; // symbols with a poll request currently in flight
}

const GLOBAL_KEY = "__twelveDataStreamState__";

// Conservative poll cadence — free-tier Twelve Data allows only a handful of
// requests per minute, and this app typically streams one symbol per open tab.
const POLL_INTERVAL_MS = 8_000;

function getState(): StreamState {
  const g = globalThis as unknown as Record<string, StreamState | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      timers: new Map(),
      listeners: new Map(),
      lastTick: new Map(),
      inFlight: new Set(),
    };
  }
  return g[GLOBAL_KEY]!;
}

async function poll(symbol: string) {
  const state = getState();
  if (state.inFlight.has(symbol)) return; // don't overlap a slow request
  state.inFlight.add(symbol);
  try {
    const price = await fetchLatestPrice(symbol);
    const tick: Tick = { symbol, price, timestamp: Date.now() };
    state.lastTick.set(symbol, tick);
    const subs = state.listeners.get(symbol);
    if (subs) for (const fn of subs) fn(tick);
  } catch (err) {
    // Log non-trivial errors so they're visible in server output; transient
    // rate-limit / network blips are expected and not worth alerting on.
    const msg = err instanceof Error ? err.message : String(err);
    const isTransient =
      msg.includes("rate limit") ||
      msg.includes("429") ||
      msg.includes("ECONNRESET") ||
      msg.includes("timeout");
    if (!isTransient) {
      console.warn(`[twelvedata] poll error for ${symbol}:`, msg);
    }
  } finally {
    state.inFlight.delete(symbol);
  }
}

/**
 * Subscribe to live ticks for a display symbol (e.g. "EUR/USD").
 * Returns an unsubscribe function. Lazily starts polling on first
 * subscriber; stops polling when the last local listener unsubscribes.
 *
 * If TWELVEDATA_API_KEY is not set the function returns a no-op immediately
 * — a single warning is logged once at startup so the server log stays clean
 * instead of repeating the same error every 8 s.
 */
export function subscribeTicks(symbol: string, onTick: Listener): () => void {
  // Guard: refuse to start polling when the API key is absent.
  const apiKey = process.env.TWELVEDATA_API_KEY ?? process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    // Log once globally (across HMR reloads) so the message appears exactly
    // once in the server console, not on every SSE connection.
    const g = globalThis as unknown as Record<string, boolean | undefined>;
    if (!g.__twelveDataKeyWarned__) {
      g.__twelveDataKeyWarned__ = true;
      console.warn(
        "[twelvedata] TWELVEDATA_API_KEY is not set — live price feed disabled. " +
        "Add the secret to enable real-time prices.",
      );
    }
    return () => {}; // no-op unsubscribe — no timer started
  }

  const state = getState();

  if (!state.listeners.has(symbol)) {
    state.listeners.set(symbol, new Set());
  }
  const set = state.listeners.get(symbol)!;
  set.add(onTick);

  if (!state.timers.has(symbol)) {
    void poll(symbol); // fire immediately instead of waiting for the first interval tick
    state.timers.set(
      symbol,
      setInterval(() => void poll(symbol), POLL_INTERVAL_MS),
    );
  }

  return () => {
    set.delete(onTick);
    if (set.size === 0) {
      state.listeners.delete(symbol);
      const timer = state.timers.get(symbol);
      if (timer) clearInterval(timer);
      state.timers.delete(symbol);
    }
  };
}

/** Latest known tick for a symbol, if any — used to seed a new SSE client instantly. */
export function getLastTick(symbol: string): Tick | null {
  return getState().lastTick.get(symbol) ?? null;
}
