-- CRM-6: enforce the canonical candidate stage vocabulary at the database.
-- Must match CANDIDATE_STAGES in src/utils/constants.js and
-- CANONICAL_STAGES in mcp-server/crm_helpers.py.
-- Safe to re-run.
BEGIN;

-- 1. Fold legacy spellings written by older builds.
UPDATE public.candidates SET stage = 'Interview' WHERE stage = 'Interviewing';
UPDATE public.candidates SET stage = 'Placed'    WHERE stage = 'Hired';

-- 2. Anything else unrecognised: keep the original value in notes (no data
--    loss), then park the candidate at 'Pending' for a human to re-stage.
UPDATE public.candidates
   SET notes = concat_ws(E'\n', NULLIF(notes, ''), '[legacy stage: ' || coalesce(stage, 'NULL') || ']'),
       stage = 'Pending'
 WHERE stage IS NULL OR stage NOT IN (
   'New','Source','Screening','Interview','Assessment','Shortlist','Offer',
   'Contract Signing','Visa Processing','Onboarding','Placed','Completed',
   'Rejected','Withdrawn','Pending','Draft'
 );

-- 3. Lock it in.
ALTER TABLE public.candidates ALTER COLUMN stage SET DEFAULT 'New';
ALTER TABLE public.candidates ALTER COLUMN stage SET NOT NULL;
ALTER TABLE public.candidates DROP CONSTRAINT IF EXISTS candidates_stage_check;
ALTER TABLE public.candidates ADD CONSTRAINT candidates_stage_check CHECK (stage IN (
  'New','Source','Screening','Interview','Assessment','Shortlist','Offer',
  'Contract Signing','Visa Processing','Onboarding','Placed','Completed',
  'Rejected','Withdrawn','Pending','Draft'
));

COMMIT;
