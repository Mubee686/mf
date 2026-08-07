import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Lock,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuthSession } from "@/hooks/use-auth";
import {
  amIAdmin,
  adminVerifyPassword,
  adminListUsers,
  adminActivateMembership,
  adminCancelMembership,
  adminRevertMembership,
} from "@/lib/membership.functions";
import type { UserRow, DurationOption } from "@/lib/membership.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — MF SMC Trader" },
      { name: "description", content: "Membership management (admin only)." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

// ─── Constants ────────────────────────────────────────────────────────────────

type Phase = "loading" | "not-admin" | "password-gate" | "ready";

const DURATION_OPTIONS: { value: DurationOption; label: string }[] = [
  { value: "trial", label: "Trial (1 day)" },
  { value: 1,       label: "1 Month"       },
  { value: 2,       label: "2 Months"      },
  { value: 3,       label: "3 Months"      },
  { value: 4,       label: "4 Months"      },
  { value: 5,       label: "5 Months"      },
  { value: 6,       label: "6 Months"      },
  { value: 7,       label: "7 Months"      },
  { value: 8,       label: "8 Months"      },
  { value: 9,       label: "9 Months"      },
  { value: 10,      label: "10 Months"     },
  { value: 11,      label: "11 Months"     },
  { value: 12,      label: "12 Months"     },
];

function defaultDuration(u: UserRow): DurationOption {
  if (!u.membership) return "trial";
  const { status, plan_type } = u.membership;
  // Trial expired/cancelled → suggest 1 month upgrade
  if ((status === "inactive" || status === "expired") && plan_type === "trial") return 1;
  return "trial";
}

// ─── Root component (handles auth phases) ────────────────────────────────────

function AdminPage() {
  const { session, loading } = useAuthSession();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("loading");

  const _checkAdmin = useServerFn(amIAdmin);
  const checkAdmin = useCallback(_checkAdmin, []);

  useEffect(() => {
    if (loading) return;
    if (!session) { navigate({ to: "/login" }); return; }
    checkAdmin()
      .then((r) => setPhase(r.isAdmin ? "password-gate" : "not-admin"))
      .catch(() => setPhase("not-admin"));
  }, [loading, session, navigate, checkAdmin]);

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/login" });
  }

  if (phase === "loading") {
    return (
      <div className="auth-bg flex min-h-screen items-center justify-center text-muted-foreground text-sm">
        Checking access…
      </div>
    );
  }

  if (phase === "not-admin") {
    return (
      <div className="auth-bg flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <ShieldCheck className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-3 text-xl font-semibold text-foreground">Admin access only</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You are not authorised to view this page.
          </p>
          <Link
            to="/dashboard"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "password-gate") {
    return <PasswordGate onVerified={() => setPhase("ready")} onSignOut={signOut} />;
  }

  return <AdminDashboard onSignOut={signOut} />;
}

// ─── Password gate ────────────────────────────────────────────────────────────

function PasswordGate({
  onVerified,
  onSignOut,
}: {
  onVerified: () => void;
  onSignOut: () => void;
}) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const _verify = useServerFn(adminVerifyPassword);
  const verify = useCallback(_verify, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pw.trim()) return;
    setBusy(true);
    try {
      const r = await verify({ data: { password: pw } });
      if (r.ok) {
        onVerified();
      } else {
        toast.error("Incorrect admin password");
        setPw("");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-bg flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-[0_25px_60px_-20px_oklch(0.78_0.13_195/0.15)]">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <Lock className="h-5 w-5 text-primary" />
            </span>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Admin Access</h1>
              <p className="text-xs text-muted-foreground">
                Enter your admin password to continue
              </p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="Admin password"
                autoFocus
                className="w-full rounded-md border border-border bg-secondary px-4 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary text-sm"
                tabIndex={-1}
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>

            <button
              type="submit"
              disabled={busy || !pw.trim()}
              className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-opacity"
            >
              {busy ? "Verifying…" : "Unlock Dashboard"}
            </button>
          </form>

          <button
            onClick={onSignOut}
            className="mt-5 w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main admin dashboard ─────────────────────────────────────────────────────

function AdminDashboard({ onSignOut }: { onSignOut: () => void }) {
  const [users, setUsers]           = useState<UserRow[]>([]);
  const [fetching, setFetching]     = useState(true);
  const [search, setSearch]         = useState("");
  const [durations, setDurations]   = useState<Record<string, DurationOption>>({});
  const [rowBusy, setRowBusy]       = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId]     = useState<string | null>(null);

  const _listUsers = useServerFn(adminListUsers);
  const listUsers  = useCallback(_listUsers, []);
  const _activate  = useServerFn(adminActivateMembership);
  const activate   = useCallback(_activate, []);
  const _cancel    = useServerFn(adminCancelMembership);
  const cancel     = useCallback(_cancel, []);
  const _revert    = useServerFn(adminRevertMembership);
  const revert     = useCallback(_revert, []);

  const fetchUsers = useCallback(async () => {
    setFetching(true);
    try {
      const data = await listUsers();
      setUsers(data);
      // Initialise duration dropdown for new rows; keep existing selections
      setDurations((prev) => {
        const next: Record<string, DurationOption> = {};
        for (const u of data) {
          next[u.id] = prev[u.id] ?? defaultDuration(u);
        }
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setFetching(false);
    }
  }, [listUsers]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  function setBusy(id: string, val: boolean) {
    setRowBusy((p) => ({ ...p, [id]: val }));
  }

  async function onActivate(u: UserRow) {
    const duration = durations[u.id] ?? "trial";
    setBusy(u.id, true);
    try {
      await activate({ data: { userId: u.id, duration } });
      const label =
        duration === "trial"
          ? "Trial (1 day)"
          : `${duration} month${(duration as number) > 1 ? "s" : ""}`;
      toast.success(`Activated: ${label} for ${u.email ?? u.full_name ?? "user"}`);
      await fetchUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Activation failed");
    } finally {
      setBusy(u.id, false);
    }
  }

  async function onCancel(u: UserRow) {
    setBusy(u.id, true);
    try {
      await cancel({ data: { userId: u.id } });
      toast.success(`Cancelled membership for ${u.email ?? u.full_name ?? "user"}`);
      await fetchUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setBusy(u.id, false);
    }
  }

  async function onRevert(u: UserRow) {
    setBusy(u.id, true);
    try {
      await revert({ data: { userId: u.id } });
      toast.success(`Reverted last action for ${u.email ?? u.full_name ?? "user"}`);
      await fetchUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revert failed");
    } finally {
      setBusy(u.id, false);
    }
  }

  function copyCode(u: UserRow) {
    navigator.clipboard.writeText(u.member_code);
    setCopiedId(u.id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("Code copied to clipboard");
  }

  const filtered = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      u.email?.toLowerCase().includes(q) ||
      u.member_code?.toLowerCase().includes(q) ||
      u.full_name?.toLowerCase().includes(q)
    );
  });

  const totalActive   = users.filter((u) => u.membership?.status === "active").length;
  const totalExpired  = users.filter((u) => u.membership?.status === "expired").length;
  const totalInactive = users.filter(
    (u) => !u.membership || u.membership.status === "inactive",
  ).length;

  return (
    <div className="auth-bg min-h-screen w-full">
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-card/90 px-4 py-3 backdrop-blur">
        <Link to="/dashboard" className="flex items-center gap-2">
          <img src="/logo.png" alt="MF SMC Trader" className="h-8 w-8 rounded-md object-contain" />

          <span className="hidden text-sm font-semibold text-foreground sm:inline">
            MF SMC Trader · Admin
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchUsers}
            disabled={fetching}
            title="Refresh user list"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${fetching ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        {/* ── Stats ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              { icon: Users,         label: "Total Users", value: users.length,  color: "text-primary"      },
              { icon: CheckCircle2,  label: "Active",      value: totalActive,   color: "text-emerald-400"  },
              { icon: XCircle,       label: "Expired",     value: totalExpired,  color: "text-destructive"  },
              { icon: Clock,         label: "Inactive",    value: totalInactive, color: "text-amber-400"    },
            ] as const
          ).map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${color}`} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* ── Search ── */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or member code…"
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </div>

        {/* ── Users table ── */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {fetching ? (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
              Loading users…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
              {search ? "No users match your search." : "No registered users yet."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/40">
                    {["#", "User", "Member Code", "Status", "Expires", "Duration", "Actions"].map(
                      (h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium tracking-wide text-muted-foreground"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>

                <tbody className="divide-y divide-border">
                  {filtered.map((u, idx) => {
                    const m        = u.membership;
                    const isActive = m?.status === "active";
                    const isBusy   = rowBusy[u.id] ?? false;
                    const dur      = durations[u.id] ?? "trial";
                    const copied   = copiedId === u.id;

                    const statusColor = isActive
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : m?.status === "expired"
                        ? "bg-destructive/15 text-destructive border-destructive/30"
                        : "bg-amber-500/15 text-amber-400 border-amber-500/30";

                    return (
                      <tr
                        key={u.id}
                        className="transition-colors hover:bg-secondary/30"
                      >
                        {/* # */}
                        <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>

                        {/* User */}
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">
                            {u.full_name ?? "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">{u.email ?? "—"}</div>
                        </td>

                        {/* Code + copy */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <code className="rounded border border-border bg-secondary px-2 py-0.5 font-mono text-xs text-primary">
                              {u.member_code}
                            </code>
                            <button
                              onClick={() => copyCode(u)}
                              title="Copy code"
                              className="rounded p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                            >
                              {copied ? (
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${statusColor}`}
                          >
                            {m?.status ?? "inactive"}
                          </span>
                          {m?.plan_type === "trial" && isActive && (
                            <span className="ml-1.5 text-xs text-amber-400">(trial)</span>
                          )}
                        </td>

                        {/* Expires */}
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                          {m?.end_date
                            ? new Date(m.end_date).toLocaleDateString(undefined, {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })
                            : "—"}
                        </td>

                        {/* Duration dropdown */}
                        <td className="px-4 py-3">
                          <select
                            value={String(dur)}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setDurations((prev) => ({
                                ...prev,
                                [u.id]: (raw === "trial"
                                  ? "trial"
                                  : (parseInt(raw) as DurationOption)),
                              }));
                            }}
                            disabled={isBusy}
                            className="rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary disabled:opacity-50"
                          >
                            {DURATION_OPTIONS.map((opt) => (
                              <option key={String(opt.value)} value={String(opt.value)}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {/* Activate (always shown) */}
                            <button
                              onClick={() => onActivate(u)}
                              disabled={isBusy}
                              className="whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            >
                              {isBusy ? "…" : "Activate"}
                            </button>

                            {/* Cancel (only if currently active) */}
                            {isActive && (
                              <button
                                onClick={() => onCancel(u)}
                                disabled={isBusy}
                                className="whitespace-nowrap rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            )}

                            {/* Revert (only if last action is revertible) */}
                            {m?.revert_available && (
                              <button
                                onClick={() => onRevert(u)}
                                disabled={isBusy}
                                className="whitespace-nowrap rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                              >
                                Revert
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
