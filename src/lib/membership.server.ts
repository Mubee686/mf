import type { SupabaseClient } from "@supabase/supabase-js";

import { ADMIN_EMAIL } from "@/lib/admin-config";

export type MembershipClient = SupabaseClient<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function requireMembershipAdmin(
  client: MembershipClient,
  userId: string,
  email?: string,
) {
  const { data } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (data || email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return;
  throw new Error("Forbidden");
}

export async function getMembershipAdminWriter(
  fallback: MembershipClient,
): Promise<MembershipClient> {
  const { getServiceRoleKey } = await import("@/integrations/supabase/config");
  if (!getServiceRoleKey()) return fallback;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin as MembershipClient;
  } catch {
    return fallback;
  }
}