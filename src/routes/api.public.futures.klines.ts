/**
 * GET /api/public/futures/klines?symbol=BTCUSDT&interval=1m&limit=500
 *
 * Server-side proxy for Binance USDT-M Futures klines (fapi.binance.com).
 * Lives under /api/public/* so the published/preview site auth layer does not
 * block it (that gate returns a CloudFront 403 for other /api/* paths).
 * Calling Binance directly from the browser also fails on geo-restricted IPs.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

// Small in-memory cache to avoid hammering Binance (weight-based rate limits).
const cache = new Map<string, { at: number; body: string }>();
const TTL_MS = 1_500;
const VALID_SYMBOL = /^[A-Z0-9]{2,24}$/;
const VALID_INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]);

export const Route = createFileRoute("/api/public/futures/klines")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase();
        const interval = url.searchParams.get("interval") ?? "1m";
        const limitRaw = parseInt(url.searchParams.get("limit") ?? "500", 10);
        const limit = Math.min(1500, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 500));
        const endTimeRaw = Number(url.searchParams.get("endTime"));
        const endTime = Number.isFinite(endTimeRaw) && endTimeRaw > 0 ? Math.floor(endTimeRaw) : null;
        if (!VALID_SYMBOL.test(symbol) || !VALID_INTERVALS.has(interval)) {
          return Response.json({ error: "Invalid market request" }, { status: 400, headers: CORS });
        }

        const key = `${symbol}|${interval}|${limit}|${endTime ?? "latest"}`;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < TTL_MS) {
          return new Response(hit.body, {
            status: 200,
            headers: { "Content-Type": "application/json", "X-Cache": "HIT", ...CORS },
          });
        }

        try {
          const endTimeParam = endTime == null ? "" : `&endTime=${endTime}`;
          const path = `/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}${endTimeParam}`;
          let lastStatus = 502;
          let lastBody = JSON.stringify({ error: "Binance Futures is temporarily unavailable" });
          for (const origin of ["https://fapi.binance.com", "https://www.binance.com"]) {
            try {
              const res = await fetch(`${origin}${path}`, {
                headers: { Accept: "application/json", "User-Agent": "MF-SMC-Trader/1.0" },
                signal: AbortSignal.timeout(8_000),
              });
              const body = await res.text();
              lastStatus = res.status;
              lastBody = body;
              if (!res.ok) continue;
              const rows = JSON.parse(body) as unknown;
              if (!Array.isArray(rows) || rows.length === 0) continue;
              cache.set(key, { at: Date.now(), body });
              return new Response(body, {
                status: 200,
                headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1, stale-while-revalidate=10", ...CORS },
              });
            } catch {
              lastStatus = 502;
            }
          }
          if (hit) return new Response(hit.body, { status: 200, headers: { "Content-Type": "application/json", "X-Cache": "STALE", ...CORS } });
          return new Response(lastBody, {
            status: lastStatus,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: msg }), {
            status: 502,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
      },
    },
  },
  component: () => null,
});
