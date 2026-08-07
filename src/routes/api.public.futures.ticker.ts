/**
 * GET /api/public/futures/ticker
 *
 * Server-side proxy for Binance Futures 24h ticker statistics (all symbols).
 * Under /api/public/* so the site auth layer doesn't 403 it.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

let cached: { at: number; body: string } | null = null;
const TTL_MS = 15_000;

export const Route = createFileRoute("/api/public/futures/ticker")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        if (cached && Date.now() - cached.at < TTL_MS) {
          return new Response(cached.body, {
            status: 200,
            headers: { "Content-Type": "application/json", "X-Cache": "HIT", ...CORS },
          });
        }
        try {
          let lastStatus = 502;
          let lastBody = JSON.stringify({ error: "Binance Futures is temporarily unavailable" });
          for (const origin of ["https://fapi.binance.com", "https://www.binance.com"]) {
            try {
              const res = await fetch(`${origin}/fapi/v1/ticker/24hr`, {
                headers: { Accept: "application/json", "User-Agent": "MF-SMC-Trader/1.0" },
                signal: AbortSignal.timeout(8_000),
              });
              const body = await res.text();
              lastStatus = res.status;
              lastBody = body;
              if (!res.ok) continue;
              const rows = JSON.parse(body) as unknown;
              if (!Array.isArray(rows) || rows.length === 0) continue;
              cached = { at: Date.now(), body };
              return new Response(body, {
                status: 200,
                headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=15, stale-while-revalidate=60", ...CORS },
              });
            } catch {
              lastStatus = 502;
            }
          }
          if (cached) return new Response(cached.body, { status: 200, headers: { "Content-Type": "application/json", "X-Cache": "STALE", ...CORS } });
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
