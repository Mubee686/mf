import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LogOut, LineChart, Copy, ShieldCheck, Mail, CheckCircle2, Zap, Crown, Clock } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuthSession } from "@/hooks/use-auth";
import { ADMIN_EMAIL } from "@/lib/admin-config";
import { OpenTerminalButton } from "@/components/TerminalChoiceModal";
import { getMyMembership } from "@/lib/membership.functions";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — MF SMC Trader" },
      { name: "description", content: "Your MF SMC Trader membership dashboard." },
    ],
  }),
  component: Dashboard,
});

interface Membership {
  status: string;
  plan_type: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_months: number | null;
}

function Dashboard() {
  const { session, loading } = useAuthSession();
  const navigate = useNavigate();
  const isAdmin = session?.user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const _fetchMembership = useServerFn(getMyMembership);
  const fetchMembership = useCallback(_fetchMembership, []);

  const [code, setCode] = useState<string | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [trialEligible, setTrialEligible] = useState(false);
  const contactRef = useRef<HTMLDivElement>(null);

  function scrollToContact() {
    contactRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  const load = useCallback(() => {
    return fetchMembership()
      .then((r) => {
        setCode(r.profile?.member_code ?? null);
        setName(r.profile?.full_name ?? null);
        setMembership(r.membership as Membership | null);
        setTrialEligible(!!r.trialEligible);
      })
      .catch((err: Error) => toast.error(err.message));
  }, [fetchMembership]);

  useEffect(() => {
    if (!session) return;
    load();
  }, [session, load]);

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/login" });
  }

  function copyCode() {
    if (!code) return;
    navigator.clipboard.writeText(code);
    toast.success("Code copied");
  }

  const displayName = name ?? session?.user?.email;
  const status = membership?.status ?? "inactive";
  const statusColor =
    status === "active"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
      : status === "expired"
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : "bg-amber-500/15 text-amber-400 border-amber-500/30";

  return (
    <div className="auth-bg min-h-screen w-full">
      <header className="relative z-10 flex items-center justify-between border-b border-border bg-card/80 px-4 py-3 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 text-primary">
          <img src="/logo.png" alt="MF SMC Trader" className="h-8 w-8 rounded-md object-contain" />
          <span className="text-sm font-semibold text-foreground">MF SMC Trader</span>
        </Link>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link
              to="/admin"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/20 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20"
            >
              <ShieldCheck className="h-4 w-4" /> Admin
            </Link>
          )}
          <button
            onClick={signOut}
            className="inline-flex items-center gap-1.5 rounded-md bg-secondary border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 space-y-6">
        <div className="auth-fade-up rounded-2xl border border-border bg-card p-8 shadow-[0_25px_60px_-20px_oklch(0.78_0.13_195/0.15)]">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Welcome{displayName ? `, ${displayName}` : ""} 👋
          </h1>
          <p className="mt-2 text-muted-foreground">Your permanent membership code and status.</p>

          <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-5">
            <div className="text-xs font-medium uppercase tracking-widest text-primary">
              Your unique membership code
            </div>
            <div className="mt-2 flex items-center gap-3">
              <code className="flex-1 rounded-md bg-secondary px-4 py-3 text-lg font-mono font-semibold tracking-widest text-primary border border-border">
                {code ?? "…"}
              </code>
              <button
                onClick={copyCode}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Copy className="h-4 w-4" /> Copy
              </button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              This code is fixed to your account — it never changes.
            </p>
          </div>

          {/* Active trial banner */}
          {status === "active" && membership?.plan_type === "trial" && membership?.end_date && (
            <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div className="text-xs text-emerald-300">
                <span className="font-semibold">Free trial active — </span>
                all premium features unlocked until{" "}
                <span className="font-semibold">
                  {new Date(membership.end_date).toLocaleString(undefined, {
                    month: "short", day: "numeric", year: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </span>
                . Access reverts automatically when the trial ends.
              </div>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between rounded-xl border border-border bg-secondary/50 p-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Membership status
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${statusColor}`}>
                  {membership?.plan_type === "trial" && status === "active" ? "Trial" : status}
                </span>
                {membership?.end_date && (
                  <span className="text-xs text-muted-foreground">
                    {membership.plan_type === "trial"
                      ? `expires ${new Date(membership.end_date).toLocaleString(undefined, {
                          month: "short", day: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}`
                      : `until ${new Date(membership.end_date).toLocaleDateString()}`}
                  </span>
                )}
              </div>
            </div>
            <OpenTerminalButton className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90">
              <LineChart className="h-4 w-4" /> Open Terminal
            </OpenTerminalButton>

          </div>
        </div>

        {/* ── How to activate (contact) ─────────────────────────────────── */}
        <div ref={contactRef} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Mail className="h-5 w-5 text-primary" /> How to activate your membership
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-6 text-sm text-muted-foreground">
            <li>Copy your unique code above.</li>
            <li>
              Contact us on WhatsApp / Email:{" "}
              <a
                href={`mailto:${ADMIN_EMAIL}`}
                className="font-medium text-primary hover:underline"
              >
                {ADMIN_EMAIL}
              </a>
              <a
                href="https://wa.me/923337323452"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-3 inline-flex items-center gap-1.5 rounded-md border border-green-500/40 bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/20"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                +92 333 7323452
              </a>
            </li>
            <li>Share your code with us to activate your membership.</li>
            <li>Your status here will update automatically once activated.</li>
          </ol>
        </div>

        {/* ── Membership Plans ─────────────────────────────────────────── */}
        <div>
          <h2 className="mb-4 text-xl font-semibold text-foreground">Membership Plans</h2>
          <div className="grid gap-4 sm:grid-cols-2">

            {/* ── Free Trial — new users only ──────────────────────────── */}
            {trialEligible && (
              <div className="relative sm:col-span-2 overflow-hidden rounded-2xl border border-emerald-500/30 bg-card p-6 shadow-sm">
                {/* "New users only" pill */}
                <div className="absolute -top-px left-6 rounded-b-full border border-t-0 border-emerald-500/40 bg-emerald-500 px-3 pb-1 pt-0.5 text-[11px] font-bold uppercase tracking-widest text-white shadow-sm">
                  New users only
                </div>

                <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
                  {/* Left: copy */}
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <Zap className="h-5 w-5 text-emerald-400" />
                      <span className="text-sm font-bold uppercase tracking-widest text-emerald-400">
                        Free Trial
                      </span>
                    </div>
                    <div className="mb-3 flex items-end gap-1">
                      <span className="text-4xl font-extrabold text-foreground">Free</span>
                      <span className="mb-1 text-sm text-muted-foreground">/ 24 hours</span>
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Get full access to every premium SMC tool for 24 hours at no cost.
                      One activation per account — contact us below to claim your free trial.
                    </p>
                  </div>

                  {/* Right: CTA */}
                  <div className="flex shrink-0 flex-col items-center gap-1.5">
                    <button
                      onClick={scrollToContact}
                      className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500 px-6 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-600 active:bg-emerald-700"
                    >
                      <Zap className="h-4 w-4" />
                      Claim Free Trial
                    </button>
                    <span className="text-xs text-muted-foreground">No credit card needed</span>
                  </div>
                </div>
              </div>
            )}



            {/* Standard — $25 */}
            <div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-5 w-5 text-primary" />
                <span className="text-sm font-semibold uppercase tracking-widest text-primary">Standard</span>
              </div>
              <div className="mt-2 flex items-end gap-1">
                <span className="text-4xl font-bold text-foreground">$25</span>
                <span className="mb-1 text-sm text-muted-foreground">/month</span>
              </div>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm text-muted-foreground">
                {["Inducement (IDM)", "Fair Value Gaps (FVG)", "Liquidity Zones", "Points of Interest (POI)", "Break of Structure (BOS)"].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={scrollToContact}
                className="mt-6 w-full rounded-lg bg-primary/10 border border-primary/30 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
              >
                Buy Standard
              </button>
            </div>

            {/* Pro — $50 */}
            <div className="relative flex flex-col rounded-2xl border border-primary/40 bg-card p-6 shadow-[0_0_30px_-10px_oklch(0.78_0.13_195/0.25)]">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-[11px] font-bold uppercase tracking-widest text-primary-foreground">
                Best Value
              </div>
              <div className="flex items-center gap-2 mb-1">
                <Crown className="h-5 w-5 text-primary" />
                <span className="text-sm font-semibold uppercase tracking-widest text-primary">Pro</span>
              </div>
              <div className="mt-2 flex items-end gap-1">
                <span className="text-4xl font-bold text-foreground">$50</span>
                <span className="mb-1 text-sm text-muted-foreground">/month</span>
              </div>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm text-muted-foreground">
                {[
                  "Inducement (IDM)",
                  "Break of Structure (BOS)",
                  "Liquidity Zones",
                  "Fair Value Gaps (FVG)",
                  "Points of Interest (POI)",
                  "Order Blocks",
                  "Change of Character (CHoCH)",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={scrollToContact}
                className="mt-6 w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Buy Pro
              </button>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
