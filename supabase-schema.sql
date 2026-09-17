-- Naim CRM App - Supabase Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =====================================================
-- USERS PROFILES (extends auth.users)
-- =====================================================
CREATE TABLE users_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'manager', 'user')),
  page_permissions TEXT[] DEFAULT ARRAY['dashboard'],
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO users_profiles (id, display_name, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', ''), 'user');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =====================================================
-- CANDIDATES
-- =====================================================
CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  stage TEXT DEFAULT 'New',
  job_title TEXT,
  salary NUMERIC,
  currency TEXT DEFAULT 'KWD',
  country_applying_to TEXT,
  passport_number TEXT,
  nationality TEXT,
  religion TEXT,
  date_of_birth DATE,
  place_of_birth TEXT,
  gender TEXT,
  civil_status TEXT,
  education_level TEXT,
  work_position TEXT,
  work_company TEXT,
  work_city TEXT,
  city TEXT,
  country TEXT,
  emergency_contact TEXT,
  contact TEXT,
  notes TEXT,
  status TEXT DEFAULT 'active',
  height TEXT,
  weight TEXT,
  number_of_kids INTEGER DEFAULT 0,
  next_of_kin_name TEXT,
  spouse TEXT,
  father TEXT,
  mother TEXT,
  age INTEGER,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_candidates_stage ON candidates(stage);
CREATE INDEX idx_candidates_country ON candidates(country_applying_to);
CREATE INDEX idx_candidates_deleted ON candidates(deleted_at);
CREATE INDEX idx_candidates_search ON candidates USING gin(name gin_trgm_ops);

-- =====================================================
-- JOBS
-- =====================================================
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  country TEXT,
  salary_min NUMERIC,
  salary_max NUMERIC,
  currency TEXT DEFAULT 'KWD',
  status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Draft', 'Closed')),
  requirements TEXT,
  responsibilities TEXT,
  schedule TEXT,
  contract_duration TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- APPOINTMENTS
-- =====================================================
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  time TIME,
  type TEXT DEFAULT 'Interview',
  status TEXT DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'Completed', 'Cancelled', 'Rescheduled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_appointments_date ON appointments(date);

-- =====================================================
-- TASKS
-- =====================================================
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Overdue')),
  priority TEXT DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  due_date DATE,
  assigned_to UUID REFERENCES users_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);

-- =====================================================
-- DOCUMENTS
-- =====================================================
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_url TEXT,
  file_size BIGINT,
  mime_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_documents_candidate ON documents(candidate_id);

-- =====================================================
-- CV DRAFTS
-- =====================================================
CREATE TABLE cv_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  template TEXT DEFAULT 'professional',
  full_name TEXT,
  email TEXT,
  phone TEXT,
  objective TEXT,
  experience TEXT,
  education TEXT,
  skills TEXT,
  languages TEXT,
  "references" TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- STORAGE BUCKET
-- =====================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false);

-- Storage policy: authenticated users can upload
CREATE POLICY "Authenticated users can upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents');

-- Storage policy: authenticated signed access only
CREATE POLICY "Authenticated read access" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'documents');

-- Storage policy: users can delete their uploads
CREATE POLICY "Authenticated users can delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'documents');

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE cv_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE users_profiles ENABLE ROW LEVEL SECURITY;

-- Candidates: authenticated users can read/write
CREATE POLICY "Authenticated users can view candidates" ON candidates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert candidates" ON candidates
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update candidates" ON candidates
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete candidates" ON candidates
  FOR DELETE TO authenticated USING (true);

-- Jobs: authenticated users can read/write
CREATE POLICY "Authenticated users can view jobs" ON jobs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert jobs" ON jobs
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update jobs" ON jobs
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete jobs" ON jobs
  FOR DELETE TO authenticated USING (true);

-- Migration 2026-07-24: Jobs extended fields (Job Openings reference page)
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS experience TEXT,
  ADD COLUMN IF NOT EXISTS accommodation TEXT,
  ADD COLUMN IF NOT EXISTS age_range TEXT,
  ADD COLUMN IF NOT EXISTS nationality TEXT,
  ADD COLUMN IF NOT EXISTS duty_hours TEXT,
  ADD COLUMN IF NOT EXISTS work_days TEXT,
  ADD COLUMN IF NOT EXISTS overtime TEXT,
  ADD COLUMN IF NOT EXISTS transport TEXT,
  ADD COLUMN IF NOT EXISTS contract_period TEXT,
  ADD COLUMN IF NOT EXISTS vacancies_left INTEGER,
  ADD COLUMN IF NOT EXISTS linked_candidates INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS uploads TEXT,
  ADD COLUMN IF NOT EXISTS additional_details TEXT;

-- Appointments: authenticated users can read/write
CREATE POLICY "Authenticated users can manage appointments" ON appointments
  FOR ALL TO authenticated USING (true);

-- Tasks: authenticated users can read/write
CREATE POLICY "Authenticated users can manage tasks" ON tasks
  FOR ALL TO authenticated USING (true);

-- Documents: authenticated users can read/write
CREATE POLICY "Authenticated users can manage documents" ON documents
  FOR ALL TO authenticated USING (true);

-- CV Drafts: authenticated users can read/write
CREATE POLICY "Authenticated users can manage cv_drafts" ON cv_drafts
  FOR ALL TO authenticated USING (true);

-- Apply supabase/migrations/001_security.sql immediately after this bootstrap.
-- Users profiles: users can view all, update own
CREATE POLICY "Authenticated users can view profiles" ON users_profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON users_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Admins can update all profiles" ON users_profiles
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
