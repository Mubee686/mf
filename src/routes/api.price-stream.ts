/**
 * SSE endpoint: GET /api/price-stream?symbol=EUR/USD
 *
 * Pushes live price ticks to the browser as they arrive from the server's
 * Twelve Data polling loop — the browser itself never polls. The browser
 * subscribes via the native `EventSource`, which auto-reconnects on its own
 * if the HTTP connection drops; the server side keeps a single shared poll
 * timer per symbol independently (see twelvedata-stream.server.ts) no matter
 * how many browser tabs are watching it.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/price-stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const symbol = url.searchParams.get("symbol");
        if (!symbol) {
          return new Response("Missing symbol", { status: 400 });
        }

        const { resolveSymbol } = await import("@/lib/providers/twelvedata.server");
        const { subscribeTicks, getLastTick } =
          await import("@/lib/providers/twelvedata-stream.server");

        const providerSymbol = resolveSymbol(symbol);
        const encoder = new TextEncoder();

        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let unsubscribe: (() => void) | undefined;

        const stream = new ReadableStream({
          start(controller) {
            const send = (payload: unknown) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            };

            // Seed the client instantly with the last known price, if any,
            // instead of waiting for the next tick.
            const last = getLastTick(providerSymbol);
            if (last) send({ price: last.price, timestamp: last.timestamp });

            unsubscribe = subscribeTicks(providerSymbol, (tick) => {
              send({ price: tick.price, timestamp: tick.timestamp });
            });

            // Keep intermediate proxies from timing out the connection.
            heartbeat = setInterval(() => {
              controller.enqueue(encoder.encode(`: ping\n\n`));
            }, 15_000);
          },
          cancel() {
            unsubscribe?.();
            if (heartbeat) clearInterval(heartbeat);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
