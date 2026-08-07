import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { TrendingUp, BarChart2, Shield, Zap, ChevronDown, ArrowRight, User } from "lucide-react";
import { useAuthSession } from "@/hooks/use-auth";
import { OpenTerminalButton } from "@/components/TerminalChoiceModal";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MF SMC Trader — Professional Forex SMC Analysis" },
      {
        name: "description",
        content:
          "Professional forex trading terminal with live market data, Smart Money Concept analysis, and real-time candlestick charts.",
      },
    ],
  }),
  component: LandingPage,
});

/* ─── Candlestick SVG illustration ─────────────────────────────────────── */
function CandlestickIllustration() {
  return (
    <svg viewBox="0 0 320 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full max-w-sm">
      {/* Grid lines */}
      {[40, 80, 120, 160].map((y) => (
        <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="#1E3A6E" strokeWidth="1" />
      ))}
      {[40, 80, 120, 160, 200, 240, 280].map((x) => (
        <line key={x} x1={x} y1="0" x2={x} y2="200" stroke="#1E3A6E" strokeWidth="1" />
      ))}

      {/* Trend line */}
      <path
        d="M10,155 L50,140 L90,125 L130,105 L170,95 L210,80 L250,65 L290,50 L310,40"
        stroke="#2563EB"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Bullish candles */}
      {[
        { x: 30, body: [130, 148], wick: [125, 155] },
        { x: 110, body: [98, 115], wick: [92, 122] },
        { x: 190, body: [74, 92], wick: [68, 98] },
        { x: 270, body: [48, 65], wick: [42, 72] },
      ].map(({ x, body, wick }) => (
        <g key={x}>
          <line x1={x} y1={wick[0]} x2={x} y2={wick[1]} stroke="#10B981" strokeWidth="1.5" />
          <rect x={x - 7} y={body[0]} width="14" height={body[1] - body[0]} rx="2" fill="#10B981" />
        </g>
      ))}

      {/* Bearish candles */}
      {[
        { x: 70, body: [128, 143], wick: [122, 150] },
        { x: 150, body: [90, 104], wick: [85, 112] },
        { x: 230, body: [62, 76], wick: [56, 82] },
      ].map(({ x, body, wick }) => (
        <g key={x}>
          <line x1={x} y1={wick[0]} x2={x} y2={wick[1]} stroke="#EF4444" strokeWidth="1.5" />
          <rect x={x - 7} y={body[0]} width="14" height={body[1] - body[0]} rx="2" fill="#EF4444" />
        </g>
      ))}

      {/* OB zone */}
      <rect x="155" y="86" width="85" height="20" rx="2" fill="#1A3560" stroke="#2563EB" strokeWidth="0.75" />
      <text x="160" y="100" fill="#60A5FA" fontSize="8" fontFamily="monospace">OB</text>

      {/* Live price line */}
      <line x1="0" y1="48" x2="300" y2="48" stroke="#2563EB" strokeWidth="1" strokeDasharray="4 3" />
      <rect x="285" y="41" width="35" height="14" rx="3" fill="#2563EB" />
      <text x="302" y="51" fill="white" fontSize="7.5" fontFamily="monospace" textAnchor="middle">LIVE</text>
    </svg>
  );
}

/* ─── Scroll-reveal hook ────────────────────────────────────────────────── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, visible };
}

/* ─── Nav auth button ───────────────────────────────────────────────────── */
function NavAuth() {
  const { session, loading } = useAuthSession();
  if (loading) return null;
  if (!session) {
    return (
      <Link
        to="/login"
        className="rounded-lg border border-[#1E3A6E] bg-[#0D1F3C] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1A3560] hover:border-[#2563EB]"
      >
        Sign in
      </Link>
    );
  }
  const name =
    (session.user?.user_metadata?.full_name as string | undefined) ??
    session.user?.email ??
    "Account";
  return (
    <Link
      to="/dashboard"
      className="flex items-center gap-2 rounded-lg border border-[#2563EB] bg-[#1A3560] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2563EB]"
    >
      <User className="h-4 w-4" />
      <span className="max-w-[120px] truncate">{name}</span>
    </Link>
  );
}

/* ─── Membership Plans ──────────────────────────────────────────────────── */
function PlanCard({
  badge, title, price, period, features, cta, highlight, delay,
}: {
  badge?: string;
  title: string;
  price: string;
  period: string;
  features: string[];
  cta: string;
  highlight?: boolean;
  delay: string;
}) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      style={{
        transitionDelay: delay,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: "opacity 0.4s ease, transform 0.4s ease",
      }}
      className={`relative flex flex-col rounded-2xl border p-7 ${
        highlight
          ? "border-[#2563EB] bg-[#0D1F3C] shadow-[0_0_40px_rgba(37,99,235,0.15)]"
          : "border-[#1E3A6E] bg-[#0D1F3C]"
      }`}
    >
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-[#2563EB] bg-[#1A3560] px-3 py-0.5 text-[11px] font-bold uppercase tracking-widest text-[#60A5FA]">
          {badge}
        </div>
      )}
      <div className="mb-5">
        <h3 className="mb-1 text-lg font-bold text-white">{title}</h3>
        <div className="flex items-end gap-1">
          <span className="text-3xl font-extrabold text-white">{price}</span>
          <span className="mb-1 text-sm text-[#7BA8CC]">{period}</span>
        </div>
      </div>
      <ul className="mb-7 flex flex-col gap-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-[#7BA8CC]">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {f}
          </li>
        ))}
      </ul>
      <Link
        to="/register"
        className={`mt-auto block w-full rounded-xl py-3 text-center text-sm font-bold transition-colors ${
          highlight
            ? "bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
            : "border border-[#1E3A6E] text-white hover:border-[#2563EB] hover:bg-[#1A3560]"
        }`}
      >
        {cta}
      </Link>
    </div>
  );
}

function MembershipPlans() {
  const { ref: headRef, visible: headVisible } = useReveal();
  return (
    <section className="relative px-6 py-20" style={{ background: "#0A1428" }}>
      {/* subtle divider */}
      <div className="mx-auto mb-14 max-w-5xl">
        <div
          ref={headRef}
          style={{
            opacity: headVisible ? 1 : 0,
            transform: headVisible ? "translateY(0)" : "translateY(20px)",
            transition: "opacity 0.4s ease, transform 0.4s ease",
          }}
          className="text-center"
        >
          <div className="mx-auto mb-4 w-fit rounded-full border border-[#1E3A6E] bg-[#0D1F3C] px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-[#60A5FA]">
            Membership Plans
          </div>
          <h2 className="mb-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Choose your access level
          </h2>
          <p className="mx-auto max-w-xl text-base text-[#7BA8CC]">
            Start with a free trial or unlock full access. All plans include every SMC tool, live data, and both Forex and Futures terminals.
          </p>
        </div>
      </div>

      <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
        <PlanCard
          title="Free Trial"
          price="Free"
          period="/ 1 day"
          features={[
            "Full terminal access for 24 hours",
            "All SMC tools (OB, BOS, FVG, IDM…)",
            "Live Forex & Futures charts",
            "No credit card required",
          ]}
          cta="Start free trial"
          delay="0ms"
        />
        <PlanCard
          badge="Most Popular"
          title="Monthly"
          price="Contact"
          period="/ month"
          features={[
            "Unlimited terminal access",
            "All SMC tools & timeframes",
            "Live Forex & Futures charts",
            "529+ crypto futures pairs",
            "Priority support",
          ]}
          cta="Get monthly access"
          highlight
          delay="60ms"
        />
        <PlanCard
          title="Annual"
          price="Contact"
          period="/ year"
          features={[
            "Everything in Monthly",
            "Best value — save vs monthly",
            "529+ crypto futures pairs",
            "Early access to new features",
            "Priority support",
          ]}
          cta="Get annual access"
          delay="120ms"
        />
      </div>

      <p className="mt-8 text-center text-sm text-[#7BA8CC]">
        After registering, contact{" "}
        <a href="mailto:mfsmctrader786@gmail.com" className="text-[#60A5FA] hover:underline">
          mfsmctrader786@gmail.com
        </a>{" "}
        to activate your plan.
      </p>
    </section>
  );
}

/* ─── Feature card ─────────────────────────────────────────────────────── */
function FeatureCard({
  icon, title, desc, delay,
}: { icon: React.ReactNode; title: string; desc: string; delay: string }) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      style={{
        transitionDelay: delay,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: "opacity 0.4s ease, transform 0.4s ease",
      }}
      className="flex flex-col items-start gap-4 rounded-2xl border border-[#1E3A6E] bg-[#0D1F3C] p-6"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#1E3A6E] bg-[#1A3560] text-[#60A5FA]">
        {icon}
      </div>
      <div>
        <h3 className="mb-1 text-base font-semibold text-white">{title}</h3>
        <p className="text-sm leading-relaxed text-[#7BA8CC]">{desc}</p>
      </div>
    </div>
  );
}

/* ─── Landing page ──────────────────────────────────────────────────────── */
function LandingPage() {
  const authRef = useRef<HTMLDivElement>(null);

  function scrollToAuth() {
    authRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  const { ref: featuresRef, visible: featuresVisible } = useReveal();
  const { ref: authRevealRef, visible: authRevealVisible } = useReveal();

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ fontFamily: "'Space Grotesk', sans-serif", background: "#0A1428" }}>

      {/* ══════════════════════════════════════════════════════
          HERO SECTION
      ════════════════════════════════════════════════════════ */}
      <section className="relative flex min-h-screen flex-col items-center justify-center px-6 text-center" style={{ background: "#0A1428" }}>

        {/* Nav bar */}
        <nav className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-[#1E3A6E] bg-[#091629] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="MF SMC Logo" className="h-9 w-9 rounded-xl object-cover" />
            <span className="text-base font-bold text-white">MF SMC Trader</span>
          </div>
          <div className="flex items-center gap-2">
            <NavAuth />
          </div>
        </nav>

        {/* Hero content */}
        <div className="relative z-10 flex max-w-4xl flex-col items-center gap-8 pt-20">
          {/* Badge */}
          <div className="flex items-center gap-2 rounded-full border border-[#1E3A6E] bg-[#0D1F3C] px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-[#60A5FA]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Live Market Data · SMC Analysis
          </div>

          {/* Headline */}
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl md:text-6xl">
            Trade Smarter with{" "}
            <span className="text-[#60A5FA]">Smart Money</span>
          </h1>

          {/* Tagline */}
          <p className="max-w-xl text-lg leading-relaxed text-[#7BA8CC] sm:text-xl">
            Professional Forex terminal with real-time SMC zones, live candlestick charts, and institutional-grade analysis tools.
          </p>

          {/* Illustration */}
          <div className="w-full max-w-sm">
            <CandlestickIllustration />
          </div>

          {/* CTA buttons */}
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <button
              onClick={scrollToAuth}
              className="flex items-center gap-2 rounded-xl border border-[#2563EB] bg-[#2563EB] px-8 py-3.5 text-base font-bold text-white transition-colors hover:bg-[#1D4ED8]"
            >
              Get Started Free
              <ArrowRight className="h-4 w-4" />
            </button>
            <OpenTerminalButton className="flex items-center gap-2 rounded-xl border border-[#1E3A6E] bg-[#0D1F3C] px-8 py-3.5 text-base font-semibold text-white transition-colors hover:bg-[#1A3560]" />

          </div>
        </div>

        {/* Scroll indicator */}
        <button
          onClick={scrollToAuth}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5 text-[#7BA8CC] transition-colors hover:text-white"
          aria-label="Scroll down"
        >
          <span className="text-[11px] font-medium uppercase tracking-widest">Scroll</span>
          <ChevronDown className="h-5 w-5" />
        </button>
      </section>

      {/* ══════════════════════════════════════════════════════
          FEATURES SECTION
      ════════════════════════════════════════════════════════ */}
      <section className="relative px-6 py-20" style={{ background: "#0A1428" }}>
        <div className="mx-auto max-w-5xl">
          <div
            ref={featuresRef}
            style={{
              opacity: featuresVisible ? 1 : 0,
              transform: featuresVisible ? "translateY(0)" : "translateY(20px)",
              transition: "opacity 0.4s ease, transform 0.4s ease",
            }}
            className="mb-14 text-center"
          >
            <h2 className="mb-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Everything you need to trade professionally
            </h2>
            <p className="mx-auto max-w-xl text-base text-[#7BA8CC]">
              Built for traders who want institutional-grade analysis in a clean, fast platform.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<TrendingUp className="h-5 w-5" />}
              title="Live Market Data"
              desc="Real-time forex prices streamed directly to your terminal without delay."
              delay="0ms"
            />
            <FeatureCard
              icon={<BarChart2 className="h-5 w-5" />}
              title="SMC Zones"
              desc="Auto-detect Order Blocks, FVGs, BOS/CHoCH, and liquidity levels."
              delay="60ms"
            />
            <FeatureCard
              icon={<Zap className="h-5 w-5" />}
              title="Custom Timeframes"
              desc="Pin any timeframe from 1 minute to monthly. Long-press to manage."
              delay="120ms"
            />
            <FeatureCard
              icon={<Shield className="h-5 w-5" />}
              title="Multi-Pair Watchlist"
              desc="Monitor 15+ forex pairs simultaneously with live price updates."
              delay="180ms"
            />
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          MEMBERSHIP PLANS SECTION
      ════════════════════════════════════════════════════════ */}
      <MembershipPlans />

      {/* ══════════════════════════════════════════════════════
          AUTH SECTION
      ════════════════════════════════════════════════════════ */}
      <section ref={authRef} className="relative px-6 py-24" style={{ background: "#0A1428" }}>
        <div
          ref={authRevealRef}
          style={{
            opacity: authRevealVisible ? 1 : 0,
            transform: authRevealVisible ? "translateY(0)" : "translateY(20px)",
            transition: "opacity 0.4s ease, transform 0.4s ease",
          }}
          className="mx-auto max-w-2xl"
        >
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Ready to start trading?
            </h2>
            <p className="text-base text-[#7BA8CC]">
              Create a free account or sign in to access the full terminal.
            </p>
          </div>

          {/* Auth cards */}
          <div className="grid gap-5 sm:grid-cols-2">
            <Link
              to="/login"
              className="flex flex-col items-center gap-5 rounded-2xl border border-[#1E3A6E] bg-[#0D1F3C] p-8 transition-colors hover:border-[#2563EB]"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#1E3A6E] bg-[#091629] text-white">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
              </div>
              <div className="text-center">
                <div className="mb-1 text-xl font-bold text-white">Sign In</div>
                <div className="text-sm text-[#7BA8CC]">Access your existing account</div>
              </div>
              <div className="w-full rounded-xl border border-[#1E3A6E] bg-[#091629] py-3 text-center text-sm font-bold text-white">
                Login →
              </div>
            </Link>

            <Link
              to="/register"
              className="flex flex-col items-center gap-5 rounded-2xl border border-[#2563EB] bg-[#0D1F3C] p-8 transition-colors hover:bg-[#1A3560]"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#2563EB] bg-[#1A3560] text-white">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <div className="text-center">
                <div className="mb-1 text-xl font-bold text-white">Create Account</div>
                <div className="text-sm text-[#7BA8CC]">Start for free, no credit card</div>
              </div>
              <div className="w-full rounded-xl border border-[#2563EB] bg-[#2563EB] py-3 text-center text-sm font-bold text-white">
                Register →
              </div>
            </Link>
          </div>

          <div className="mt-8 text-center">
            <Link
              to="/terminal"
              className="inline-flex items-center gap-2 text-sm font-medium text-[#7BA8CC] transition-colors hover:text-white"
            >
              <BarChart2 className="h-4 w-4" />
              Continue without account — open terminal
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════════════════ */}
      <footer className="border-t border-[#1E3A6E] bg-[#091629] px-6 py-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <img src="/logo.png" alt="MF SMC" className="h-6 w-6 rounded-lg object-cover" />
          <span className="text-sm font-semibold text-[#7BA8CC]">MF SMC Trader</span>
        </div>
        <p className="text-xs text-[#1E3A6E]">
          Professional Forex SMC Analysis Terminal · {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
