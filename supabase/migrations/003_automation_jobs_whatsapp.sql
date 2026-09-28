-- CRM-12 + Phase 5: Hermes automation job queue and WhatsApp templates.
-- Apply after 001_security.sql and 002_candidate_stages.sql. Safe to re-run.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- automation_jobs: the queue Hermes (Juma, Salmin, Ali, ...) consumes via MCP.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,              -- 'cv_build' | 'lead_enrich' | 'whatsapp_send' | 'doc_ocr' | ...
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending', -- pending | claimed | done | failed
  result JSONB,
  requested_by UUID DEFAULT auth.uid() REFERENCES public.users_profiles(id),
  claimed_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.automation_jobs DROP CONSTRAINT IF EXISTS automation_jobs_status_check;
ALTER TABLE public.automation_jobs ADD CONSTRAINT automation_jobs_status_check
  CHECK (status IN ('pending', 'claimed', 'done', 'failed'));
ALTER TABLE public.automation_jobs DROP CONSTRAINT IF EXISTS automation_jobs_type_format;
ALTER TABLE public.automation_jobs ADD CONSTRAINT automation_jobs_type_format
  CHECK (job_type ~ '^[a-z][a-z0-9_]{1,40}$');

CREATE INDEX IF NOT EXISTS idx_automation_jobs_status_created ON public.automation_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_type ON public.automation_jobs(job_type);

ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read jobs" ON public.automation_jobs;
CREATE POLICY "auth read jobs" ON public.automation_jobs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth insert jobs" ON public.automation_jobs;
CREATE POLICY "auth insert jobs" ON public.automation_jobs FOR INSERT TO authenticated WITH CHECK (true);
-- No UPDATE/DELETE policy: only Hermes (service_role via MCP) claims/completes jobs.

-- Browser inserts can't forge attribution or pre-complete a job.
CREATE OR REPLACE FUNCTION public.automation_jobs_client_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    NEW.requested_by := auth.uid();
    NEW.status := 'pending';
    NEW.result := NULL;
    NEW.claimed_at := NULL;
    NEW.finished_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.automation_jobs_client_insert() FROM public;
DROP TRIGGER IF EXISTS automation_jobs_client_insert ON public.automation_jobs;
CREATE TRIGGER automation_jobs_client_insert BEFORE INSERT ON public.automation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.automation_jobs_client_insert();

-- Optional realtime (the UI also polls, so this is best-effort).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.automation_jobs;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- whatsapp_templates: message templates live in the DB, admin-managed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ar', 'sw')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read templates" ON public.whatsapp_templates;
CREATE POLICY "auth read templates" ON public.whatsapp_templates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin insert templates" ON public.whatsapp_templates;
CREATE POLICY "admin insert templates" ON public.whatsapp_templates FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "admin update templates" ON public.whatsapp_templates;
CREATE POLICY "admin update templates" ON public.whatsapp_templates FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "admin delete templates" ON public.whatsapp_templates;
CREATE POLICY "admin delete templates" ON public.whatsapp_templates FOR DELETE TO authenticated USING (public.is_admin());

-- Business templates (not demo data): safe for production.
INSERT INTO public.whatsapp_templates (key, name, body) VALUES
  ('interview', 'Interview Invitation', E'Dear {name},\n\nWe are pleased to invite you for an interview for the position of {position}.\n\nDate: {date}\nTime: {time}\nLocation: {location}\n\nPlease bring your original documents.\n\nBest regards,\nNaim Investments'),
  ('offer', 'Job Offer', E'Dear {name},\n\nCongratulations! We are pleased to offer you the position of {position} in {country}.\n\nSalary: {salary}\n\nPlease confirm your acceptance within 48 hours.\n\nBest regards,\nNaim Investments'),
  ('documents', 'Document Request', E'Dear {name},\n\nPlease submit the following documents for your application:\n\n{documents}\n\nKindly send them at your earliest convenience.\n\nBest regards,\nNaim Investments'),
  ('followup', 'Follow-up', E'Dear {name},\n\nWe hope this message finds you well. We wanted to follow up on your application for {position}.\n\nPlease let us know if you have any questions.\n\nBest regards,\nNaim Investments'),
  ('rejection', 'Rejection', E'Dear {name},\n\nThank you for your interest in the {position} role. After careful consideration, we have decided to move forward with other candidates.\n\nWe wish you all the best in your future endeavors.\n\nBest regards,\nNaim Investments')
ON CONFLICT (key) DO NOTHING;

COMMIT;
