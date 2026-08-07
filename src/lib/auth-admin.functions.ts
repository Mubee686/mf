/**
 * Admin-only auth helpers that need the Supabase service role key.
 * Only import from server functions / *.server.ts modules.
 *
 * Email confirmation is disabled in the Supabase project settings
 * (Authentication → Providers → Email → "Confirm email" OFF), so no
 * programmatic confirmation helpers are needed here.
 */
