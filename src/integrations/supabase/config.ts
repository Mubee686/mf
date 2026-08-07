/**
 * Public Supabase connection settings.
 *
 * The project URL and the publishable ("anon") key are public by design —
 * they ship in the browser bundle of every Supabase app and are protected by
 * Row Level Security. They are kept here as constants (with env overrides) so
 * the app works in Lovable's preview and published environments, where the
 * `VITE_SUPABASE_*` / `SUPABASE_*` variable names are reserved by the platform.
 *
 * SECRETS (service role key, API keys) are NEVER referenced from this file —
 * they live in Lovable's secret store and are read inside server-only code.
 */
export const SUPABASE_PROJECT_ID = "cgirdlkuarpzrpaybrkb";

export const SUPABASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined) ||
  "https://cgirdlkuarpzrpaybrkb.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY) ||
  (typeof process !== "undefined" ? process.env.SUPABASE_PUBLISHABLE_KEY : undefined) ||
  "sb_publishable_TdHq5P1Gn_fxZyApaGBJww_SpehDX8i";

/**
 * Server-only: the service role key. Read lazily inside server handlers.
 * Accepts the platform-managed name or the project secret `SB_SERVICE_ROLE_KEY`.
 */
export function getServiceRoleKey(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SB_SERVICE_ROLE_KEY;
}
