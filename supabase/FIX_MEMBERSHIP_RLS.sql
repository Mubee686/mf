-- ════════════════════════════════════════════════════════════════════════════
-- FIX: "new row violates row-level security policy for table memberships"
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
-- Safe to re-run.
--
-- Causes it fixes:
--   1. `authenticated` had only SELECT on public.memberships (no INSERT/UPDATE).
--   2. Admin INSERT/UPDATE policies may be missing on the live database.
--   3. The admin account (mfsmctrader786@gmail.com) may have no 'admin' row in
--      public.user_roles, so public.has_role(auth.uid(),'admin') returned false.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Grants ------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.memberships TO authenticated;
GRANT ALL    ON public.memberships TO service_role;

-- 2. Policies ----------------------------------------------------------------
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own membership"     ON public.memberships;
DROP POLICY IF EXISTS "Admins view all memberships"   ON public.memberships;
DROP POLICY IF EXISTS "Admins manage all memberships" ON public.memberships;
DROP POLICY IF EXISTS "Admins insert memberships"     ON public.memberships;
DROP POLICY IF EXISTS "Admins update memberships"     ON public.memberships;

CREATE POLICY "Users view own membership"
  ON public.memberships FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all memberships"
  ON public.memberships FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert memberships"
  ON public.memberships FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update memberships"
  ON public.memberships FOR UPDATE TO authenticated
  USING      (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Make sure the admin account actually has the 'admin' role ---------------
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM   auth.users
WHERE  lower(email) = 'mfsmctrader786@gmail.com'
ON CONFLICT DO NOTHING;

-- Verify
SELECT u.email, r.role
FROM   auth.users u
JOIN   public.user_roles r ON r.user_id = u.id
WHERE  r.role = 'admin';
