/**
 * /futures — MF SMC Futures page
 *
 * Full-screen layout matching the Forex terminal.
 * All chart / data / SMC logic lives in FuturesChart.tsx — this file is
 * purely page shell + header navigation.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { User } from "lucide-react";

import { useAuthSession } from "@/hooks/use-auth";
import { FuturesChart } from "@/components/FuturesChart";

export const Route = createFileRoute("/futures")({
  head: () => ({
    meta: [
      { title: "MF SMC Futures — Crypto Futures Chart" },
      {
        name: "description",
        content:
          "Real-time crypto futures candlestick charts with full SMC analysis. BTCUSDT, ETHUSDT and 100+ pairs.",
      },
    ],
  }),
  component: FuturesPage,
});

function FuturesPage() {
  const { session } = useAuthSession();
  const accountName =
    (session?.user.user_metadata?.full_name as string | undefined) ??
    session?.user.email ??
    "Account";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* ══ Header ═══════════════════════════════════════════════════════════ */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-panel px-4">
        <div className="flex items-center gap-3">
          <Link to="/">
            <img
              src="/logo.png"
              alt="MF SMC Logo"
              className="h-9 w-9 rounded-lg object-cover"
            />
          </Link>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">MF SMC Trader</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Live Futures · SMC Analysis
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/terminal"
            className="rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Forex
          </Link>
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2.5 py-1">
            <span className="live-dot h-2 w-2 rounded-full bg-bull" />
            <span className="text-[11px] font-medium text-muted-foreground">Live</span>
          </div>

          {session ? (
            <Link
              to="/dashboard"
              title="Open dashboard"
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <User className="h-3.5 w-3.5" />
              <span className="max-w-[140px] truncate">{accountName}</span>
            </Link>
          ) : (
            <Link
              to="/login"
              className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            >
              Login
            </Link>
          )}
        </div>
      </header>

      {/* ══ Chart fills remaining height ════════════════════════════════════ */}
      <FuturesChart />
    </div>
  );
}
