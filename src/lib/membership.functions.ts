import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ADMIN_EMAIL } from "@/lib/admin-config";
import {
  getMembershipAdminWriter,
  requireMembershipAdmin,
  type MembershipClient,
} from "@/lib/membership.server";

// Cast to any locally — the generated types.ts predates these tables.
// Runtime safety is enforced by Zod validators + Supabase RLS.
type AnyClient = MembershipClient;
type AnyRow = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ─── Public (user-facing) ─────────────────────────────────────────────────────

/** Current user's profile (with member_code) + membership record. */
export const getMyMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as AnyClient;

    // Auto-expire any membership whose end date has passed (incl. the 1-day trial)
    await sb.rpc("expire_stale_memberships");

    // NOTE: select("*") — an explicit column list silently 400s (and yields a
    // null row → "Inactive") if any single column is missing on the live DB.
    const [profileRes, memRes] = await Promise.all([
      sb
        .from("profiles")
        .select("full_name, email, member_code, created_at")
        .eq("id", context.userId)
        .maybeSingle(),
      sb
        .from("memberships")
        .select("*")
        .eq("user_id", context.userId)
        .limit(1),
    ]);

    let m: AnyRow | null = (memRes.data?.[0] as AnyRow | undefined) ?? null;

    // If the user's own RLS read returns nothing (missing/incorrect
    // "Users view own membership" policy, or a PostgREST error), re-read the
    // caller's OWN row with the service-role client. Strictly scoped to
    // context.userId, which comes from the verified bearer token.
    if (!m) {
      if (memRes.error) {
        console.error("[getMyMembership] own-row read failed:", memRes.error.message);
      }
      const db = await getMembershipAdminWriter(sb);
      if (db !== sb) {
        const { data: fallback, error: fbErr } = await db
          .from("memberships")
          .select("*")
          .eq("user_id", context.userId)
          .limit(1);
        if (fbErr) console.error("[getMyMembership] fallback read failed:", fbErr.message);
        m = (fallback?.[0] as AnyRow | undefined) ?? null;
      }
    }

    const isActive =
      m?.status === "active" && (!m?.end_date || new Date(m.end_date).getTime() > Date.now());

    // Free trial: only for brand-new accounts that never had a membership activated
    const trialEligible = !m || (!m.trial_used && !m.activated_at && !isActive);

    return { profile: profileRes.data, membership: m, isActive, trialEligible };
  });


/** Activate the one-time 1-day free trial for the current user. */
export const activateFreeTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as AnyClient;
    const { data, error } = await sb.rpc("activate_free_trial");
    if (error) throw new Error(error.message);
    return { ok: true, membership: data };
  });


/** Is the current user an admin? */
export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as AnyClient;

    // Get the real email directly from Supabase Auth (most reliable source)
    const { data: userData } = await sb.auth.getUser();
    const email = userData?.user?.email ?? "";

    // Primary check: user_roles table
    const { data: roleData } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();

    if (roleData) return { isAdmin: true };

    // Fallback: direct email match (works even if user_roles row is missing)
    if (email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      return { isAdmin: true };
    }

    return { isAdmin: false };
  });

// ─── Admin — second-layer password ───────────────────────────────────────────

/** Verify the admin dashboard password (SHA-256 compared server-side). */
export const adminVerifyPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ password: z.string().min(1) }).parse(data))
  .handler(async ({ context, data }) => {
    const _email = (context.claims as any)?.email as string | undefined;
    await requireMembershipAdmin(context.supabase as AnyClient, context.userId, _email);
    const { createHash } = await import("node:crypto");
    const stored = process.env.ADMIN_DASHBOARD_PASSWORD_HASH ?? "";
    const input = createHash("sha256").update(data.password).digest("hex");
    return { ok: input === stored };
  });

// ─── Admin — user list ────────────────────────────────────────────────────────

export interface UserMembership {
  status: string;
  plan_type: string | null;
  duration_months: number | null;
  start_date: string | null;
  end_date: string | null;
  activated_at: string | null;
  revert_available: boolean;
}

export interface UserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  member_code: string;
  created_at: string;
  membership: UserMembership | null;
}

/** List all registered users with their membership state (admin only). */
export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as AnyClient;
    const email = (context.claims as any)?.email as string | undefined;
    await requireMembershipAdmin(sb, context.userId, email);

    const [profilesRes, membershipsRes] = await Promise.all([
      sb
        .from("profiles")
        .select("id, full_name, email, member_code, created_at")
        .order("created_at", { ascending: false }),
      sb
        .from("memberships")
        .select("user_id, status, plan_type, duration_months, start_date, end_date, activated_at, revert_available"),
    ]);

    if (profilesRes.error) throw new Error(profilesRes.error.message);

    const memMap = new Map<string, UserMembership>(
      (membershipsRes.data ?? []).map((m: AnyRow) => [m.user_id, m as UserMembership]),
    );

    return (profilesRes.data ?? []).map((p: AnyRow): UserRow => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      member_code: p.member_code,
      created_at: p.created_at,
      membership: memMap.get(p.id) ?? null,
    }));
  });

// ─── Admin — membership actions ───────────────────────────────────────────────

export type DurationOption = "trial" | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/**
 * Activate a membership (trial = 1 day, or 1–12 months).
 * Saves the previous state so the action can be reverted once.
 */
export const adminActivateMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({
      userId: z.string().uuid(),
      duration: z.union([
        z.literal("trial"), z.literal(1), z.literal(2), z.literal(3),
        z.literal(4), z.literal(5), z.literal(6), z.literal(7),
        z.literal(8), z.literal(9), z.literal(10), z.literal(11), z.literal(12),
      ]),
    }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as AnyClient;
    const email = (context.claims as any)?.email as string | undefined;
    await requireMembershipAdmin(sb, context.userId, email);
    const db = await getMembershipAdminWriter(sb);

    // Snapshot current state for revert
    const { data: cur } = await db
      .from("memberships")
      .select("status, plan_type, duration_months, start_date, end_date")
      .eq("user_id", data.userId)
      .maybeSingle();

    const now = new Date();
    const end = new Date(now);
    let durationMonths: number | null = null;
    let planType: string;

    if (data.duration === "trial") {
      end.setDate(end.getDate() + 1);
      planType = "trial";
    } else {
      end.setMonth(end.getMonth() + (data.duration as number));
      durationMonths = data.duration as number;
      planType = "monthly";
    }

    const { error } = await db.from("memberships").upsert(
      {
        user_id:             data.userId,
        status:              "active",
        plan_type:           planType,
        duration_months:     durationMonths,
        start_date:          now.toISOString(),
        end_date:            end.toISOString(),
        activated_by:        context.userId,
        activated_at:        now.toISOString(),
        expiry_notified_at:  null,
        updated_at:          now.toISOString(),
        // Revert snapshot
        prev_status:          cur?.status          ?? null,
        prev_plan_type:       cur?.plan_type       ?? null,
        prev_start_date:      cur?.start_date      ?? null,
        prev_end_date:        cur?.end_date        ?? null,
        prev_duration_months: cur?.duration_months ?? null,
        revert_available:     true,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, start: now.toISOString(), end: end.toISOString() };
  });

/**
 * Cancel an active membership.
 * Saves the previous state so the cancel can be reverted once.
 */
export const adminCancelMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as AnyClient;
    const email = (context.claims as any)?.email as string | undefined;
    await requireMembershipAdmin(sb, context.userId, email);
    const db = await getMembershipAdminWriter(sb);

    const { data: cur } = await db
      .from("memberships")
      .select("status, plan_type, duration_months, start_date, end_date")
      .eq("user_id", data.userId)
      .maybeSingle();

    if (!cur) throw new Error("No membership record found for this user");

    const { error } = await db.from("memberships").update({
      status:               "inactive",
      end_date:             null,
      updated_at:           new Date().toISOString(),
      prev_status:          cur.status,
      prev_plan_type:       cur.plan_type,
      prev_start_date:      cur.start_date,
      prev_end_date:        cur.end_date,
      prev_duration_months: cur.duration_months,
      revert_available:     true,
    }).eq("user_id", data.userId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Revert the last activate or cancel action for a user.
 * Only one revert is allowed per action — once reverted, revert_available = false.
 */
export const adminRevertMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as AnyClient;
    const email = (context.claims as any)?.email as string | undefined;
    await requireMembershipAdmin(sb, context.userId, email);
    const db = await getMembershipAdminWriter(sb);

    const { data: cur } = await db
      .from("memberships")
      .select("revert_available, prev_status, prev_plan_type, prev_start_date, prev_end_date, prev_duration_months")
      .eq("user_id", data.userId)
      .maybeSingle();

    if (!cur)                  throw new Error("No membership record found");
    if (!cur.revert_available) throw new Error("No revert available for this user");

    const { error } = await db.from("memberships").update({
      status:               cur.prev_status          ?? "inactive",
      plan_type:            cur.prev_plan_type        ?? null,
      start_date:           cur.prev_start_date       ?? null,
      end_date:             cur.prev_end_date         ?? null,
      duration_months:      cur.prev_duration_months  ?? null,
      updated_at:           new Date().toISOString(),
      prev_status:          null,
      prev_plan_type:       null,
      prev_start_date:      null,
      prev_end_date:        null,
      prev_duration_months: null,
      revert_available:     false,
    }).eq("user_id", data.userId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
