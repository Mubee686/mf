import { createServerFn } from "@tanstack/react-start";
import type { Candle } from "./forex";

export type CandleFetchResult =
  | { ok: true; candles: Candle[]; price: number; prevClose: number | null }
  | { ok: false; error: string };

/**
 * Fetch OHLC candles for a symbol + timeframe from the active market-data
 * provider (currently Twelve Data — see src/lib/providers/twelvedata.server.ts).
 * The API key is used server-side — the browser never talks to the provider
 * directly. To switch providers, swap the import below; nothing else changes.
 */
export const fetchCandles = createServerFn({ method: "GET" })
  .validator((d: unknown) => d as { symbol: string; timeframeId: string })
  .handler(async ({ data }): Promise<CandleFetchResult> => {
    try {
      const { fetchHistory } = await import("./providers/twelvedata.server");
      const series = await fetchHistory(data.symbol, data.timeframeId);
      return {
        ok: true,
        candles: series.candles,
        price: series.price,
        prevClose: series.prevClose,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to load market data",
      };
    }
  });
