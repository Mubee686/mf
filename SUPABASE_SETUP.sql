-- =============================================================
-- MF SMC Trader — Full Schema Setup
-- Run this entire script in your Supabase SQL Editor.
-- Safe to run multiple times (fully idempotent).
-- =============================================================

-- ── 1. App role enum ───────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. User roles (must exist BEFORE profiles RLS policies) ────
CREATE TABLE IF NOT EXISTS public.user_roles (
  id       UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role     public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL    ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;

-- ── 3. Profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT,
  email       TEXT,
  member_code TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS member_code TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'profiles' AND indexname = 'profiles_member_code_key'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_member_code_key UNIQUE (member_code);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile"   ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins view all profiles"     ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ── 4. Member-code generator ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_member_code()
RETURNS TEXT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE code TEXT;
BEGIN
  LOOP
    code := 'MFSMC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE member_code = code);
  END LOOP;
  RETURN code;
END; $$;

-- ── 5. handle_new_user trigger ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, member_code)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email,
    public.generate_member_code()
  )
  ON CONFLICT (id) DO UPDATE SET
    member_code = COALESCE(public.profiles.member_code, public.generate_member_code()),
    full_name   = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
    email       = COALESCE(public.profiles.email,     EXCLUDED.email);

  IF lower(NEW.email) = 'm62804994@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill: give a code to any profile that is missing one
UPDATE public.profiles
SET member_code = public.generate_member_code()
WHERE member_code IS NULL;

-- Ensure the admin email already in auth.users gets the admin role
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM   auth.users
WHERE  lower(email) = 'm62804994@gmail.com'
ON CONFLICT DO NOTHING;

-- Ensure every other existing user has at least the 'user' role
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'user'::public.app_role
FROM   auth.users
WHERE  lower(email) <> 'm62804994@gmail.com'
ON CONFLICT DO NOTHING;

-- ── 6. Memberships (with revert support + trial tracking) ──────
CREATE TABLE IF NOT EXISTS public.memberships (
  user_id              UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status               TEXT        NOT NULL DEFAULT 'inactive',
  plan_type            TEXT        DEFAULT 'monthly',
  duration_months      INTEGER,
  start_date           TIMESTAMPTZ,
  end_date             TIMESTAMPTZ,
  activated_by         UUID        REFERENCES auth.users(id),
  activated_at         TIMESTAMPTZ,
  expiry_notified_at   TIMESTAMPTZ,
  trial_used           BOOLEAN     NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  prev_status          TEXT,
  prev_plan_type       TEXT,
  prev_start_date      TIMESTAMPTZ,
  prev_end_date        TIMESTAMPTZ,
  prev_duration_months INTEGER,
  revert_available     BOOLEAN     NOT NULL DEFAULT false
);

-- Add columns that may be missing when upgrading an existing DB
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS plan_type            TEXT        DEFAULT 'monthly';
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS trial_used           BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS prev_status          TEXT;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS prev_plan_type       TEXT;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS prev_start_date      TIMESTAMPTZ;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS prev_end_date        TIMESTAMPTZ;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS prev_duration_months INTEGER;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS revert_available     BOOLEAN NOT NULL DEFAULT false;

GRANT SELECT, INSERT, UPDATE ON public.memberships TO authenticated;
GRANT ALL    ON public.memberships TO service_role;
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
  USING  (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS memberships_end_date_idx ON public.memberships (end_date);

-- ── 7. expire_stale_memberships RPC ────────────────────────────
-- Called automatically by getMyMembership on every dashboard/terminal load.
-- Flips status to 'expired' for any membership whose end_date has passed.
CREATE OR REPLACE FUNCTION public.expire_stale_memberships()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.memberships
     SET status = 'expired', updated_at = now()
   WHERE status = 'active'
     AND end_date IS NOT NULL
     AND end_date < now();
$$;

GRANT EXECUTE ON FUNCTION public.expire_stale_memberships() TO authenticated, service_role;

-- ── 8. activate_free_trial RPC ─────────────────────────────────
-- One-time self-serve trial for genuinely new users.
-- Enforced entirely inside the database — cannot be bypassed client-side.
-- Checks:
--   • trial_used = true        → already consumed, blocked
--   • activated_at IS NOT NULL → admin ever activated for them, blocked
--   • status = 'active'        → currently active membership, blocked
CREATE OR REPLACE FUNCTION public.activate_free_trial()
RETURNS public.memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid      uuid := auth.uid();
  existing public.memberships;
  result   public.memberships;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO existing FROM public.memberships WHERE user_id = uid;

  IF existing.user_id IS NOT NULL THEN
    -- Already used the trial
    IF existing.trial_used THEN
      RAISE EXCEPTION 'Free trial already used';
    END IF;
    -- Currently has an active paid/admin membership
    IF existing.status = 'active' AND (existing.end_date IS NULL OR existing.end_date > now()) THEN
      RAISE EXCEPTION 'You already have an active membership';
    END IF;
    -- Admin previously activated a membership for them (not a new-user account)
    IF existing.activated_at IS NOT NULL THEN
      RAISE EXCEPTION 'Free trial is only available to new accounts';
    END IF;

    -- Eligible — update existing row
    UPDATE public.memberships
       SET status             = 'active',
           plan_type          = 'trial',
           duration_months    = NULL,
           start_date         = now(),
           end_date           = now() + interval '1 day',
           trial_used         = true,
           activated_at       = now(),
           expiry_notified_at = NULL,
           revert_available   = false,
           updated_at         = now()
     WHERE user_id = uid
     RETURNING * INTO result;
  ELSE
    -- No membership row yet — insert fresh trial
    INSERT INTO public.memberships (
      user_id, status, plan_type, start_date, end_date, trial_used, activated_at
    ) VALUES (
      uid, 'active', 'trial', now(), now() + interval '1 day', true, now()
    )
    RETURNING * INTO result;
  END IF;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_free_trial() TO authenticated, service_role;

-- ── 9. Security hardening — revoke from anonymous callers ──────
REVOKE ALL ON FUNCTION public.activate_free_trial()       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expire_stale_memberships()  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_member_code()      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE  ON FUNCTION public.generate_member_code()  TO service_role;
