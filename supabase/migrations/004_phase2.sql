-- Phase 2: document expiry, soft-delete everywhere, activity log, stage-transition
-- guard, admin-vs-staff enforcement in RLS. Apply after 001, 002, 003. Safe to re-run.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columns the Phase 2 features need
-- ---------------------------------------------------------------------------
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS expiry_date DATE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS uploaded_by UUID DEFAULT auth.uid() REFERENCES public.users_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_documents_expiry ON public.documents(expiry_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_deleted ON public.documents(deleted_at);

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS candidate_id UUID REFERENCES public.candidates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tasks_candidate ON public.tasks(candidate_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deleted ON public.tasks(deleted_at);

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_appointments_deleted ON public.appointments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_appointments_candidate ON public.appointments(candidate_id);
CREATE INDEX IF NOT EXISTS idx_jobs_deleted ON public.jobs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_candidates_updated ON public.candidates(updated_at);

-- ---------------------------------------------------------------------------
-- 2. Stage-transition guard (mirrors src/utils/stageTransitions.js exactly)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_valid_stage_transition(from_stage TEXT, to_stage TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  pipeline TEXT[] := ARRAY['New', 'Source', 'Screening', 'Interview', 'Assessment', 'Shortlist', 'Offer', 'Contract Signing', 'Visa Processing', 'Onboarding', 'Placed', 'Completed'];
  gates TEXT[] := ARRAY['Interview', 'Offer', 'Visa Processing', 'Placed'];
  f TEXT := COALESCE(NULLIF(from_stage, ''), 'New');
  fi INT;
  ti INT;
  gi INT;
  g TEXT;
BEGIN
  IF to_stage IS NULL THEN RETURN FALSE; END IF;
  IF f = to_stage THEN RETURN TRUE; END IF;
  IF to_stage IN ('Rejected', 'Withdrawn') THEN RETURN f <> 'Completed'; END IF;
  IF to_stage = 'Pending' THEN RETURN f <> 'Completed'; END IF;
  IF to_stage = 'Draft' THEN RETURN f IN ('New', 'Draft', 'Pending'); END IF;
  IF f IN ('Rejected', 'Withdrawn') THEN RETURN to_stage IN ('New', 'Screening', 'Pending'); END IF;
  IF f = 'Completed' THEN RETURN to_stage = 'Placed'; END IF;
  IF f IN ('Pending', 'Draft') THEN f := 'New'; END IF;
  fi := array_position(pipeline, f);
  ti := array_position(pipeline, to_stage);
  IF fi IS NULL OR ti IS NULL THEN RETURN FALSE; END IF;
  IF ti <= fi THEN RETURN TRUE; END IF;
  FOREACH g IN ARRAY gates LOOP
    gi := array_position(pipeline, g);
    IF gi > fi AND gi < ti THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_stage_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage AND NOT public.is_valid_stage_transition(OLD.stage, NEW.stage) THEN
    RAISE EXCEPTION 'Invalid stage transition: % -> %', COALESCE(OLD.stage, 'New'), NEW.stage
      USING ERRCODE = '23514', HINT = 'Move the candidate through the required checkpoint stages first.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_stage_transition ON public.candidates;
CREATE TRIGGER enforce_stage_transition BEFORE UPDATE OF stage ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_stage_transition();

-- ---------------------------------------------------------------------------
-- 3. activity_log: append-only audit trail (who changed what, when)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('candidate', 'document', 'task', 'appointment', 'job', 'automation_job', 'lead')),
  entity_id UUID,
  candidate_id UUID REFERENCES public.candidates(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]{1,40}$'),
  summary TEXT,
  changes JSONB NOT NULL DEFAULT '{}',
  actor_id UUID DEFAULT auth.uid() REFERENCES public.users_profiles(id) ON DELETE SET NULL,
  actor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_candidate_created ON public.activity_log(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON public.activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON public.activity_log(created_at DESC);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read activity" ON public.activity_log;
CREATE POLICY "auth read activity" ON public.activity_log FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth insert activity" ON public.activity_log;
CREATE POLICY "auth insert activity" ON public.activity_log FOR INSERT TO authenticated WITH CHECK (true);
-- No UPDATE/DELETE policies: the log is append-only for every browser user.

-- Browser inserts cannot forge the actor or backdate an entry.
CREATE OR REPLACE FUNCTION public.activity_log_client_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    NEW.actor_id := auth.uid();
    NEW.created_at := now();
    SELECT COALESCE(NULLIF(display_name, ''), NEW.actor_name) INTO NEW.actor_name
      FROM public.users_profiles WHERE id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.activity_log_client_insert() FROM public;
DROP TRIGGER IF EXISTS activity_log_client_insert ON public.activity_log;
CREATE TRIGGER activity_log_client_insert BEFORE INSERT ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_client_insert();

-- The browser logs its own changes through the service layer. Writes that do
-- NOT come from a signed-in browser (Hermes via MCP with service_role, SQL
-- editor) are logged here so the history is complete without double entries.
CREATE OR REPLACE FUNCTION public.log_server_candidate_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_log (entity_type, entity_id, candidate_id, action, summary, actor_name)
    VALUES ('candidate', NEW.id, NEW.id, 'created', 'Candidate created by automation', 'Hermes / system');
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.activity_log (entity_type, entity_id, candidate_id, action, summary, changes, actor_name)
    VALUES ('candidate', NEW.id, NEW.id, 'stage_change', 'Stage changed by automation',
            jsonb_build_object('from', OLD.stage, 'to', NEW.stage), 'Hermes / system');
  ELSIF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    INSERT INTO public.activity_log (entity_type, entity_id, candidate_id, action, summary, actor_name)
    VALUES ('candidate', NEW.id, NEW.id, CASE WHEN NEW.deleted_at IS NULL THEN 'restored' ELSE 'deleted' END,
            'Changed by automation', 'Hermes / system');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.log_server_candidate_change() FROM public;
DROP TRIGGER IF EXISTS log_server_candidate_change ON public.candidates;
CREATE TRIGGER log_server_candidate_change AFTER INSERT OR UPDATE ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION public.log_server_candidate_change();

-- ---------------------------------------------------------------------------
-- 4. Admin vs staff, enforced in the database (not UI-only)
--    staff (role 'user'/'manager'): create, edit, soft-delete (to Recycle Bin)
--    admin only: restore from Recycle Bin, permanent delete, delete stored files,
--                manage users/roles (001), manage WhatsApp templates (003)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_recycle_bin_restore() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'authenticated' AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can restore items from the Recycle Bin' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_recycle_bin_restore() FROM public;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['candidates', 'jobs', 'tasks', 'appointments', 'documents'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS guard_recycle_bin_restore ON public.%I', t);
    EXECUTE format('CREATE TRIGGER guard_recycle_bin_restore BEFORE UPDATE OF deleted_at ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_recycle_bin_restore()', t);
  END LOOP;
END $$;

-- Candidates / jobs: permanent DELETE is admin-only.
DROP POLICY IF EXISTS "Authenticated users can delete candidates" ON public.candidates;
DROP POLICY IF EXISTS "Admins can delete candidates" ON public.candidates;
CREATE POLICY "Admins can delete candidates" ON public.candidates FOR DELETE TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Authenticated users can delete jobs" ON public.jobs;
DROP POLICY IF EXISTS "Admins can delete jobs" ON public.jobs;
CREATE POLICY "Admins can delete jobs" ON public.jobs FOR DELETE TO authenticated USING (public.is_admin());

-- Appointments / tasks / documents had FOR ALL policies: split them so DELETE is admin-only.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['appointments', 'tasks', 'documents'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Authenticated users can manage ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth read ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth insert ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'auth update ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'admin delete ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', 'auth read ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', 'auth insert ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', 'auth update ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_admin())', 'admin delete ' || t, t);
  END LOOP;
END $$;

-- Stored files: removing an object from the private bucket is admin-only
-- (staff "delete" moves the document row to the Recycle Bin; the file stays).
DROP POLICY IF EXISTS "Authenticated users can delete" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete documents" ON storage.objects;
CREATE POLICY "Admins can delete documents" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'documents' AND public.is_admin());

-- Staff page access: new invitees get the working set of pages (Settings and
-- Recycle Bin stay admin-only). Admins always see every page.
ALTER TABLE public.users_profiles ALTER COLUMN page_permissions SET DEFAULT ARRAY[
  'dashboard', 'candidates', 'pipeline', 'cv-builder', 'documents', 'associates', 'receptionist-view',
  'tasks', 'appointments', 'jobs', 'job-generator', 'reports', 'whatsapp'
];
UPDATE public.users_profiles
  SET page_permissions = ARRAY['dashboard', 'candidates', 'pipeline', 'cv-builder', 'documents', 'associates', 'receptionist-view',
                               'tasks', 'appointments', 'jobs', 'job-generator', 'reports', 'whatsapp']
  WHERE role <> 'admin' AND (page_permissions IS NULL OR page_permissions = ARRAY['dashboard']);

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users_profiles (id, display_name, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', ''), 'user');
  RETURN NEW;
END;
$$;

COMMIT;
