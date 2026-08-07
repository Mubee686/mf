import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_TIMEFRAME_IDS,
  getTimeframe,
  parseTimeframe,
  type Timeframe,
} from "@/lib/timeframes";

const STORAGE_KEY = "mf-smc-timeframe-bar-v1";

function sanitize(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const tf = parseTimeframe(raw);
    if (tf && !seen.has(tf.id)) {
      seen.add(tf.id);
      out.push(tf.id);
    }
  }
  return out.length ? out : [...DEFAULT_TIMEFRAME_IDS];
}

function loadInitial(): string[] {
  return [...DEFAULT_TIMEFRAME_IDS];
}

export interface TimeframeBar {
  /** Ordered ids currently pinned to the bar. */
  ids: string[];
  /** Resolved Timeframe objects for the bar. */
  items: Timeframe[];
  hydrated: boolean;
  isPinned: (id: string) => boolean;
  pin: (id: string) => void;
  unpin: (id: string) => void;
  moveLeft: (id: string) => void;
  moveRight: (id: string) => void;
  /** Replace an existing timeframe with a new interval (returns new id or null). */
  edit: (oldId: string, raw: string) => string | null;
  /** Add / pin a custom interval (returns canonical id or null on invalid). */
  add: (raw: string) => string | null;
  reset: () => void;
}

/**
 * Manages the user's timeframe bar with permanent localStorage persistence.
 * Pinned timeframes appear in the bar; unpinned/deleted ones disappear.
 */
export function useTimeframeBar(): TimeframeBar {
  const [ids, setIds] = useState<string[]>(loadInitial);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from storage after mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setIds(sanitize(parsed.map(String)));
      }
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true);
  }, []);

  // Persist on change (only after hydration so we don't clobber saved prefs).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      /* ignore quota errors */
    }
  }, [ids, hydrated]);

  const isPinned = useCallback((id: string) => ids.includes(id), [ids]);

  const pin = useCallback((raw: string) => {
    const tf = parseTimeframe(raw);
    if (!tf) return;
    setIds((prev) => (prev.includes(tf.id) ? prev : [...prev, tf.id]));
  }, []);

  const unpin = useCallback((id: string) => {
    setIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const move = useCallback((id: string, dir: -1 | 1) => {
    setIds((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  const moveLeft = useCallback((id: string) => move(id, -1), [move]);
  const moveRight = useCallback((id: string) => move(id, 1), [move]);

  const add = useCallback((raw: string): string | null => {
    const tf = parseTimeframe(raw);
    if (!tf) return null;
    setIds((prev) => (prev.includes(tf.id) ? prev : [...prev, tf.id]));
    return tf.id;
  }, []);

  const edit = useCallback((oldId: string, raw: string): string | null => {
    const tf = parseTimeframe(raw);
    if (!tf) return null;
    setIds((prev) => {
      const i = prev.indexOf(oldId);
      if (i < 0) return prev.includes(tf.id) ? prev : [...prev, tf.id];
      const next = [...prev];
      if (prev.includes(tf.id) && tf.id !== oldId) {
        // target already exists — just remove the old slot
        next.splice(i, 1);
      } else {
        next[i] = tf.id;
      }
      return next;
    });
    return tf.id;
  }, []);

  const reset = useCallback(() => setIds([...DEFAULT_TIMEFRAME_IDS]), []);

  // Memoize so consumers that include `items` in effect deps don't re-fire on
  // every render — `ids` is stable state; items only changes when ids changes.
  const items = useMemo(() => ids.map(getTimeframe), [ids]);

  return {
    ids,
    items,
    hydrated,
    isPinned,
    pin,
    unpin,
    moveLeft,
    moveRight,
    edit,
    add,
    reset,
  };
}
