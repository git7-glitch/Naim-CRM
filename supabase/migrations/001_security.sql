-- Apply after supabase-schema.sql. Existing projects: apply this migration directly.
BEGIN;

UPDATE storage.buckets SET public = false WHERE id = 'documents';
DROP POLICY IF EXISTS "Public read access" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read access" ON storage.objects;
CREATE POLICY "Authenticated read access" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'documents');
UPDATE public.documents SET file_url = NULL WHERE file_url LIKE '%/object/public/%';

-- The CURRENT schema has a recursive UPDATE policy, not the predecessor's SELECT policy.
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users_profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.users_profiles;
CREATE POLICY "Admins can view all profiles" ON public.users_profiles
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.users_profiles;
CREATE POLICY "Admins can update all profiles" ON public.users_profiles
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- RLS permits updating one's own profile; prevent self-escalation of role/permissions.
-- A trusted service-role migration/invitation can still provision admins.
CREATE OR REPLACE FUNCTION public.protect_profile_privileges() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NOT public.is_admin() AND (
    NEW.role IS DISTINCT FROM OLD.role OR
    NEW.page_permissions IS DISTINCT FROM OLD.page_permissions OR
    NEW.id IS DISTINCT FROM OLD.id
  ) THEN
    RAISE EXCEPTION 'Only an admin may change profile permissions' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM public;
DROP TRIGGER IF EXISTS protect_profile_privileges ON public.users_profiles;
CREATE TRIGGER protect_profile_privileges BEFORE UPDATE ON public.users_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileges();
ALTER FUNCTION public.handle_new_user() SET search_path = public;
COMMIT;
