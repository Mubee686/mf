/**
 * useCandleTimer — tracks the remaining time until the current candle closes.
 *
 * Returns:
 *   formattedTime  — e.g. "04:37", "01:22:09", "3d 06:00:00"
 *   secondsLeft    — raw seconds (0 at close boundary)
 *   epoch          — increments every time a candle closes; watch this in
 *                    useMarketData to trigger a full candle reload.
 *
 * SSR-safe: initialises with 0 / "00:00" on the server and syncs to the
 * real wall-clock value after first client render, avoiding hydration mismatches.
 */
import { useEffect, useRef, useState } from "react";

import { candleSecondsLeft, formatCountdown } from "@/lib/timeframes";

export interface CandleTimer {
  formattedTime: string;
  secondsLeft: number;
  /** Increments on every candle close — use as a reload signal. */
  epoch: number;
}

export function useCandleTimer(timeframeId: string): CandleTimer {
  // Start at 0 during SSR so both server and client render the same HTML.
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const mountedRef = useRef(false);
  // Track previous seconds via ref so candle-close detection doesn't need
  // a nested setState call (which can misfire under React 19 Strict Mode).
  const prevSecondsRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;

    // Compute the real value immediately on mount.
    const initial = candleSecondsLeft(timeframeId);
    prevSecondsRef.current = initial;
    setSecondsLeft(initial);

    // Align the first tick to the next wall-clock second boundary so the
    // display counts down in exact 1-second steps without drifting.
    const msUntilNextSecond = 1000 - (Date.now() % 1000);

    let intervalId: ReturnType<typeof setInterval>;

    const alignId = setTimeout(() => {
      const tick = () => {
        const left = candleSecondsLeft(timeframeId);
        // Candle closed: previous value was at/near 0 and value has reset to ~period.
        if (prevSecondsRef.current <= 1 && left > 1) {
          setEpoch((e) => e + 1);
        }
        prevSecondsRef.current = left;
        setSecondsLeft(left);
      };

      tick();
      intervalId = setInterval(tick, 1000);
    }, msUntilNextSecond);

    return () => {
      clearTimeout(alignId);
      clearInterval(intervalId);
    };
  }, [timeframeId]);

  return {
    formattedTime: mountedRef.current ? formatCountdown(secondsLeft) : "--:--",
    secondsLeft,
    epoch,
  };
}
