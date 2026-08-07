REVOKE ALL ON FUNCTION public.activate_free_trial() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expire_stale_memberships() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_member_code() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.activate_free_trial() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_memberships() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_member_code() TO service_role;