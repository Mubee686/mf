ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS plan_type text,
  ADD COLUMN IF NOT EXISTS trial_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prev_status text,
  ADD COLUMN IF NOT EXISTS prev_plan_type text,
  ADD COLUMN IF NOT EXISTS prev_start_date timestamptz,
  ADD COLUMN IF NOT EXISTS prev_end_date timestamptz,
  ADD COLUMN IF NOT EXISTS prev_duration_months integer,
  ADD COLUMN IF NOT EXISTS revert_available boolean NOT NULL DEFAULT false;

GRANT SELECT, INSERT, UPDATE ON public.memberships TO authenticated;
GRANT ALL ON public.memberships TO service_role;

DROP POLICY IF EXISTS "Admins insert memberships" ON public.memberships;
CREATE POLICY "Admins insert memberships" ON public.memberships
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update memberships" ON public.memberships;
CREATE POLICY "Admins update memberships" ON public.memberships
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins view all profiles" ON public.profiles;
CREATE POLICY "Admins view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Expire memberships whose end date has passed
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

GRANT EXECUTE ON FUNCTION public.expire_stale_memberships() TO authenticated;

-- One-time 1-day free trial, self-served by the signed-in user
CREATE OR REPLACE FUNCTION public.activate_free_trial()
RETURNS public.memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  existing public.memberships;
  result public.memberships;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO existing FROM public.memberships WHERE user_id = uid;

  IF existing.user_id IS NOT NULL THEN
    IF existing.trial_used THEN
      RAISE EXCEPTION 'Free trial already used';
    END IF;
    IF existing.status = 'active' AND (existing.end_date IS NULL OR existing.end_date > now()) THEN
      RAISE EXCEPTION 'You already have an active membership';
    END IF;
    IF existing.activated_at IS NOT NULL THEN
      RAISE EXCEPTION 'Free trial is only available to new accounts';
    END IF;

    UPDATE public.memberships
       SET status = 'active',
           plan_type = 'trial',
           duration_months = NULL,
           start_date = now(),
           end_date = now() + interval '1 day',
           trial_used = true,
           activated_at = now(),
           expiry_notified_at = NULL,
           revert_available = false,
           updated_at = now()
     WHERE user_id = uid
     RETURNING * INTO result;
  ELSE
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

GRANT EXECUTE ON FUNCTION public.activate_free_trial() TO authenticated;