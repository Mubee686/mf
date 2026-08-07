/**
 * network-status — tiny external store that tracks whether the user's
 * connection currently looks "slow".
 *
 * Two signals feed it:
 *  1. navigator.connection (effectiveType 2g/slow-2g, or a low downlink).
 *  2. Measured latency of the app's own data fetches, reported via
 *     reportRequestLatency(); anything over SLOW_REQUEST_MS counts as slow
 *     and clears itself once a few fast responses come back.
 */

const SLOW_REQUEST_MS = 3_500;
const RECOVERY_SAMPLES = 2;

type Listener = () => void;

let slowByConnection = false;
let slowByLatency = false;
let fastStreak = 0;
let snapshot = false;

const listeners = new Set<Listener>();

function recompute() {
  const next = slowByConnection || slowByLatency;
  if (next === snapshot) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

function readConnection() {
  if (typeof navigator === "undefined") return;
  const conn = (navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; saveData?: boolean };
  }).connection;
  if (!conn) return;
  const effectiveType = conn.effectiveType ?? "";
  const downlink = typeof conn.downlink === "number" ? conn.downlink : undefined;
  slowByConnection =
    effectiveType === "2g" ||
    effectiveType === "slow-2g" ||
    (downlink !== undefined && downlink > 0 && downlink < 0.4);
  recompute();
}

let connectionBound = false;
function bindConnection() {
  if (connectionBound || typeof navigator === "undefined") return;
  connectionBound = true;
  const conn = (navigator as Navigator & {
    connection?: EventTarget & { addEventListener?: (t: string, l: Listener) => void };
  }).connection;
  readConnection();
  conn?.addEventListener?.("change", readConnection);
}

/** Report how long one app data request took (ms). */
export function reportRequestLatency(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return;
  if (ms > SLOW_REQUEST_MS) {
    slowByLatency = true;
    fastStreak = 0;
  } else if (slowByLatency) {
    fastStreak += 1;
    if (fastStreak >= RECOVERY_SAMPLES) {
      slowByLatency = false;
      fastStreak = 0;
    }
  }
  recompute();
}

export function subscribeNetworkStatus(listener: Listener) {
  bindConnection();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getIsSlowConnection() {
  return snapshot;
}

export function getIsSlowConnectionServer() {
  return false;
}
