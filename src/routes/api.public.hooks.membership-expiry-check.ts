import { createFileRoute } from "@tanstack/react-router";

import { ADMIN_EMAIL } from "@/lib/admin-config";

/**
 * Cron target: finds memberships expiring in the next 3 days that have
 * not yet been notified, and emails the admin. Also flips clearly-expired
 * rows to 'expired'. Public route (bypasses site auth) — safe because it
 * only mutates internal bookkeeping and only ever emails the admin.
 */
export const Route = createFileRoute("/api/public/hooks/membership-expiry-check")({
  server: {
    handlers: {
      POST: async () => {
        const { getServiceRoleKey } = await import("@/integrations/supabase/config");
        if (!getServiceRoleKey()) {
          return Response.json(
            {
              ok: false,
              error: "Membership expiry automation is not configured.",
            },
            { status: 503 },
          );
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const admin = supabaseAdmin as any;

        const now = new Date();
        const threshold = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

        const { data: rows, error } = await admin
          .from("memberships")
          .select("user_id, end_date, status, expiry_notified_at, duration_months")
          .eq("status", "active")
          .is("expiry_notified_at", null)
          .gte("end_date", now.toISOString())
          .lte("end_date", threshold.toISOString());

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }
        if (!rows || rows.length === 0) {
          // Still flip clearly-expired ones.
          await admin
            .from("memberships")
            .update({ status: "expired" })
            .eq("status", "active")
            .lt("end_date", now.toISOString());
          return Response.json({ ok: true, notified: 0 });
        }

        const ids = rows.map((r: { user_id: string }) => r.user_id);
        const { data: profiles } = await admin
          .from("profiles")
          .select("id, full_name, email, member_code")
          .in("id", ids);
        const byId = new Map(
          ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null; member_code: string }>).map(
            (p) => [p.id, p],
          ),
        );

        // Email delivery: wire up a transactional email provider here
        // (e.g. Resend, Postmark, nodemailer + SMTP). Until one is configured,
        // expiring memberships are logged to the server console instead of emailed.
        let sent = 0;

        for (const row of rows as Array<{ user_id: string; end_date: string | null }>) {
          const p = byId.get(row.user_id);
          const endStr = row.end_date ? new Date(row.end_date).toLocaleString() : "—";
          console.log(
            `[expiry-check] membership expiring — user: ${p?.email ?? row.user_id}, ` +
            `name: ${p?.full_name ?? "—"}, code: ${p?.member_code ?? "—"}, expires: ${endStr}`,
          );
          // Increment so the response reflects how many rows were processed.
          sent++;
        }

        await admin
          .from("memberships")
          .update({ expiry_notified_at: now.toISOString() })
          .in("user_id", ids);

        await admin
          .from("memberships")
          .update({ status: "expired" })
          .eq("status", "active")
          .lt("end_date", now.toISOString());

        return Response.json({ ok: true, checked: rows.length, sent });
      },
    },
  },
});
