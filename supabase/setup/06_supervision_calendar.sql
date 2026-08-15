-- ============================================================================
-- SCHOOL MANAGEMENT SYSTEM — FRESH INSTALL, PART 6 OF 7
-- Instructional supervision, schedule override, school calendar, request access
-- ============================================================================
-- GENERATED FILE — do not edit by hand; run supabase/setup/generate.sh instead.
-- A byte-for-byte concatenation of the 10 migrations listed below, in the
-- exact order a migration runner would apply them.
--
-- FOR NEW / EMPTY DATABASES ONLY. Never run this against a database that already
-- has the migration history applied — use supabase/migrations/ for that.
--
-- Run the seven parts strictly in order: 01 -> 07. Each part is one transaction,
-- so a failure rolls the whole part back and leaves nothing half-applied.
--
-- Migrations merged into this part:
--   120_crla_reading_time_and_experience.sql
--   121_instructional_supervision.sql
--   122_supervision_lesson_plan_storage.sql
--   123_supervision_rls_and_integrity.sql
--   124_schedule_conflict_override.sql
--   125_school_calendar_days.sql
--   126_graduation_lock_on_reactivation.sql
--   127_record_request_origin_enrollment.sql
--   128_one_gpa_source_of_truth.sql
--   129_requests_access_control.sql
-- ============================================================================

BEGIN;

SET search_path TO procurements, public;

-- ============================================================================
-- >>> BEGIN 120_crla_reading_time_and_experience.sql
-- ============================================================================

-- ============================================================================
-- CRLA — reading time + learner experience on the Part 2 Record Form
--
-- The DepEd CRLA workbook ("Reading Scoresheet" / "Class Record" / "Class
-- Summary" sheets) reports three Part 2 figures the app could not produce:
--
--   Number of Words Read  = total words in the story - total miscues   (derived)
--   Words per Minute      = words read * 60 / reading time             (needs TIME)
--   % of Correct Words Read = words read / total words                 (derived)
--
-- Only the reading TIME is genuinely new input; the rest is derivable from what
-- sms_crla_record_form_records + _line_scores already hold. The scoresheet also
-- carries a "Learner Experience (Rating 1-5)" column, which likewise has no
-- home today.
--
-- Both columns are nullable: every existing record stays valid, and the
-- printables simply leave the derived cells blank until a time is recorded.
--
-- The 5-level READING PROFILE the workbook reports (Low Emerging / High
-- Emerging / Developing / Transitioning / Reading At Grade Level) is NOT stored
-- — it is derived in the app from the Part 1 band + reading accuracy +
-- comprehension (see crlaReadingProfile in lib/constants/assessments.ts), so a
-- change to the DepEd scoring reference does not invalidate history.
-- ============================================================================

SET search_path TO procurements, public;

ALTER TABLE procurements.sms_crla_record_form_records
  ADD COLUMN IF NOT EXISTS reading_time_seconds INTEGER
    CHECK (reading_time_seconds IS NULL OR reading_time_seconds >= 0),
  ADD COLUMN IF NOT EXISTS learner_experience INTEGER
    CHECK (learner_experience IS NULL OR learner_experience BETWEEN 1 AND 5);

COMMENT ON COLUMN procurements.sms_crla_record_form_records.reading_time_seconds IS
  'Total time the learner used reading the story, in seconds (DepEd form caps the read at 1 minute). Drives words-per-minute.';

COMMENT ON COLUMN procurements.sms_crla_record_form_records.learner_experience IS
  'Learner Experience rating 1-5 from the DepEd CRLA reading scoresheet.';

-- <<< END 120_crla_reading_time_and_experience.sql

-- ============================================================================
-- >>> BEGIN 121_instructional_supervision.sql
-- ============================================================================

-- ============================================================================
-- INSTRUCTIONAL SUPERVISION (Supervisory Plan + COT / PMES classroom observation)
-- ============================================================================
-- Implements the school's instructional supervision cycle as it is actually
-- run on paper today:
--
--   1. PLAN        — the School Head writes an INSTRUCTIONAL SUPERVISORY PLAN
--                    per term (SY is split into Term 1 Jun-Aug, Term 2 Sep-Nov,
--                    Term 3 Jan-Mar). Each row of that matrix names the
--                    teacher/s, the priority KRA and strand, the objective, the
--                    enabling activity, the success indicator, the means of
--                    verification, the time frame, and the STAR remark.
--                    → sms_supervision_plans / sms_supervision_plan_entries
--
--   2. SCHEDULE    — teachers (and the School Head) SUGGEST an observation
--                    schedule using the per-teacher supervisory plan slip:
--                    position, rated / non-rated, term, grade & section, date
--                    and time of pre-conference, date and time of the actual
--                    observation, focus KRA, focus indicator, ILAW lesson plan.
--                    The School Head approves or rejects. Only once APPROVED is
--                    the schedule exportable to a calendar.
--                    → sms_supervision_schedules
--
--                    Calendar export is a client-side "Add to Google Calendar"
--                    link plus a downloadable .ics — no OAuth, no stored Google
--                    tokens. `calendar_exported_at` only records that somebody
--                    took the export, so the board can show what still needs to
--                    be put on a calendar; it is a convenience flag, never a
--                    guarantee that the event exists on anyone's calendar.
--
--   3. OBSERVE     — during the actual observation each observer fills a COT
--                    RATING SHEET (Annex E-2) and may keep OBSERVATION NOTES
--                    (Annex E-4). Where a school fields more than one observer,
--                    they meet afterwards and agree on a single FINAL rating per
--                    indicator on the INTER-OBSERVER AGREEMENT FORM (Annex E-3).
--                    → sms_cot_observations / sms_cot_ratings
--
-- THE OBSERVER IS NOT NECESSARILY THE SCHOOL HEAD. Master teachers routinely
-- observe. Who may observe is a per-school-year designation made by the School
-- Head (sms_supervision_observers) rather than a role check, because the pool
-- differs by school and DepEd does not tie it to a plantilla position.
--
-- ── WHAT THE COT FORMS ACTUALLY VARY BY ─────────────────────────────────────
-- Two independent axes, and getting them confused is the classic error:
--
--   * CAREER STAGE fixes the RATING SCALE only. The indicator TEXT is written
--     in Proficient Teacher language for everyone; only the levels shift —
--     Teacher I-III use 2-6, Teacher IV-VII 3-7, Master Teacher I-II 4-8, and
--     Master Teacher III-V 5-9. "Not Observed" is not a zero: it automatically
--     scores the LOWEST level of that stage (2 / 3 / 4 / 5 respectively).
--
--   * SCHOOL YEAR fixes WHICH INDICATORS appear. The PMES rotates a 9/9/8
--     indicator set on a three-year cycle (SY 2025-2026, 2026-2027, 2027-2028,
--     then repeating). Every career stage in a given SY rates the SAME list.
--
-- Both are therefore stored ON THE OBSERVATION ROW (career_stage, form_cycle_sy)
-- and never re-derived at print time: a teacher promoted from Teacher III to
-- Teacher IV mid-year must not retroactively change the scale of an observation
-- already signed on paper. Indicator codes are stored as free TEXT and resolved
-- against lib/constants/supervision.ts, per the 119 precedent — DepEd revises
-- the PPST indicator set between memoranda and a CHECK constraint would turn
-- each revision into a migration that invalidates history.
--
-- RLS = authenticated with app-layer scoping, matching 105 / 119.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. DESIGNATED OBSERVERS — who may rate a COT, per school year
--
--    A designation, not a role: the School Head names master teachers, the
--    assistant school head, department heads — whoever actually observes.
--    Deactivating (is_active = FALSE) rather than deleting keeps the audit
--    trail for observations they already signed.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_supervision_observers (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES procurements.sms_users(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  designated_by BIGINT REFERENCES procurements.sms_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sms_supervision_observers_uniq UNIQUE (school_id, school_year, user_id)
);

COMMENT ON TABLE procurements.sms_supervision_observers IS
  'Staff designated by the School Head as classroom observers for a school year. The observer need not be the School Head — master teachers routinely observe.';

CREATE INDEX IF NOT EXISTS idx_sms_supervision_observers_scope
  ON procurements.sms_supervision_observers(school_id, school_year);

CREATE TRIGGER update_sms_supervision_observers_updated_at
  BEFORE UPDATE ON procurements.sms_supervision_observers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. INSTRUCTIONAL SUPERVISORY PLAN — one per (school, school year, term)
--
--    The printed document is one matrix per term with a "Prepared by" block.
--    prepared_by_name / prepared_by_position are SNAPSHOT strings rather than a
--    join to sms_users: the signed plan carries the name and designation as of
--    signing, and a later rename or promotion must not rewrite a filed plan.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_supervision_plans (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  term SMALLINT NOT NULL CHECK (term BETWEEN 1 AND 3),

  prepared_by BIGINT REFERENCES procurements.sms_users(id),
  prepared_by_name TEXT,
  prepared_by_position TEXT,

  created_by BIGINT REFERENCES procurements.sms_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sms_supervision_plans_uniq UNIQUE (school_id, school_year, term)
);

COMMENT ON TABLE procurements.sms_supervision_plans IS
  'School Head Instructional Supervisory Plan, one per term (T1 Jun-Aug, T2 Sep-Nov, T3 Jan-Mar).';
COMMENT ON COLUMN procurements.sms_supervision_plans.prepared_by_name IS
  'Snapshot of the signatory name at the time the plan was written; not re-derived from sms_users.';

CREATE INDEX IF NOT EXISTS idx_sms_supervision_plans_scope
  ON procurements.sms_supervision_plans(school_id, school_year);

CREATE TRIGGER update_sms_supervision_plans_updated_at
  BEFORE UPDATE ON procurements.sms_supervision_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 3. PLAN ENTRIES — the rows of that matrix
--
--    `teachers` is free TEXT, matching the source document: a single row
--    routinely covers a named list ("Jessa Lyka F. Savandal, Teresa M. Ruaya,
--    ...") or a whole group ("All Primary Grade Teachers", "All Teachers divided
--    by clusters"). Forcing it into a join table would make the second form
--    unrepresentable. teacher_ids is an OPTIONAL parallel list, used only to
--    offer those teachers when generating schedules from the plan.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_supervision_plan_entries (
  id BIGSERIAL PRIMARY KEY,
  plan_id BIGINT NOT NULL REFERENCES procurements.sms_supervision_plans(id) ON DELETE CASCADE,

  teachers TEXT NOT NULL,                 -- "Name of Teachers / Learning Area / Level"
  teacher_ids BIGINT[] NOT NULL DEFAULT '{}',
  kra TEXT,                               -- Key Result Area (Priority Strand)
  priority_strand TEXT,                   -- the PPST strand under that KRA
  objectives TEXT,
  activities TEXT,                        -- Enabling Projects and/or Activities
  success_indicators TEXT,
  means_of_verification TEXT,
  time_frame TEXT,                        -- free text: the source has "TBA" rows
  accomplishment TEXT,                    -- Accomplishment / Status
  remarks TEXT,                           -- Remarks (STAR Approach)
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN procurements.sms_supervision_plan_entries.teachers IS
  'Free text by design — a plan row may name individuals or a whole group ("All Primary Grade Teachers").';
COMMENT ON COLUMN procurements.sms_supervision_plan_entries.remarks IS
  'Remarks written with the STAR approach (Situation, Task, Action, Result).';

CREATE INDEX IF NOT EXISTS idx_sms_supervision_plan_entries_plan
  ON procurements.sms_supervision_plan_entries(plan_id, sort_order);

CREATE TRIGGER update_sms_supervision_plan_entries_updated_at
  BEFORE UPDATE ON procurements.sms_supervision_plan_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 4. OBSERVATION SCHEDULES — the per-teacher supervisory plan slip
--
--    Proposed by the teacher OR by the School Head (proposed_by tells which),
--    then approved / rejected. Rescheduling is an UPDATE that returns the row to
--    'proposed'; the previous decision fields are cleared by the app so an
--    approved-then-moved slot cannot masquerade as still approved.
--
--    career_stage is captured HERE, at scheduling time, because it selects which
--    COT rating scale the observers will use and the School Head confirms it
--    when approving. It is copied onto each observation row on creation.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_supervision_schedules (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  term SMALLINT NOT NULL CHECK (term BETWEEN 1 AND 3),

  teacher_id BIGINT NOT NULL REFERENCES procurements.sms_users(id) ON DELETE CASCADE,
  teacher_position TEXT,                  -- snapshot of the plantilla position
  career_stage TEXT NOT NULL DEFAULT 'proficient_a'
    CHECK (career_stage IN (
      'proficient_a',        -- Teacher I-III,        levels 2-6
      'proficient_b',        -- Teacher IV-VII,       levels 3-7
      'highly_proficient',   -- Master Teacher I-II,  levels 4-8
      'distinguished'        -- Master Teacher III-V, levels 5-9
    )),

  -- "Type of Instructional Supervision: Rated / Non-rated". A non-rated
  -- (fleeting) observation still gets notes but no COT rating sheet.
  supervision_type TEXT NOT NULL DEFAULT 'rated'
    CHECK (supervision_type IN ('rated', 'non_rated')),
  observation_round SMALLINT NOT NULL DEFAULT 1 CHECK (observation_round IN (1, 2)),
  quarter SMALLINT CHECK (quarter IS NULL OR quarter BETWEEN 1 AND 4),

  section_id BIGINT REFERENCES procurements.sms_sections(id) ON DELETE SET NULL,
  subject_id BIGINT REFERENCES procurements.sms_subjects(id) ON DELETE SET NULL,
  -- Printed on the COT as "SUBJECT & GRADE LEVEL TAUGHT". Kept as text so a
  -- filed form still prints correctly after a section or subject is renamed
  -- or deleted, and so classes outside sms_subjects can be scheduled.
  class_label TEXT,

  pre_conference_at TIMESTAMPTZ,
  observation_at TIMESTAMPTZ NOT NULL,
  observation_end_at TIMESTAMPTZ,

  focus_kra TEXT,
  focus_indicator TEXT,                   -- PPST indicator code, e.g. '1.1.2'
  lesson_plan_url TEXT,                   -- attached ILAW lesson plan
  notes TEXT,

  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected', 'completed', 'cancelled')),
  proposed_by BIGINT REFERENCES procurements.sms_users(id),
  decided_by BIGINT REFERENCES procurements.sms_users(id),
  decided_at TIMESTAMPTZ,
  decision_notes TEXT,

  -- Set when someone takes the calendar export (link or .ics). Advisory only.
  calendar_exported_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sms_supervision_schedules_window
    CHECK (observation_end_at IS NULL OR observation_end_at > observation_at)
);

COMMENT ON TABLE procurements.sms_supervision_schedules IS
  'Suggested / approved classroom observation slots. Only approved schedules are exportable to a calendar.';
COMMENT ON COLUMN procurements.sms_supervision_schedules.career_stage IS
  'Fixes the COT rating scale only (2-6 / 3-7 / 4-8 / 5-9). The indicator text is identical across stages.';
COMMENT ON COLUMN procurements.sms_supervision_schedules.supervision_type IS
  'non_rated = fleeting observation: notes are kept, no COT rating sheet is produced.';
COMMENT ON COLUMN procurements.sms_supervision_schedules.calendar_exported_at IS
  'Advisory flag: someone downloaded the .ics / opened the Add-to-Calendar link. Not proof the event exists on any calendar.';

CREATE INDEX IF NOT EXISTS idx_sms_supervision_schedules_scope
  ON procurements.sms_supervision_schedules(school_id, school_year, term);
CREATE INDEX IF NOT EXISTS idx_sms_supervision_schedules_teacher
  ON procurements.sms_supervision_schedules(teacher_id, school_year);
CREATE INDEX IF NOT EXISTS idx_sms_supervision_schedules_status
  ON procurements.sms_supervision_schedules(school_id, status, observation_at);

CREATE TRIGGER update_sms_supervision_schedules_updated_at
  BEFORE UPDATE ON procurements.sms_supervision_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 5. SCHEDULE OBSERVERS — who is assigned to observe this slot
--
--    The Inter-Observer Agreement Form prints three observer signature lines, so
--    `slot` is constrained to 1-3 and drives which line an observer signs. One
--    observer is the normal case ("For schools with only one observer, this form
--    will serve as the final rating sheet") — the E-3 is only produced when a
--    slot has more than one.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_supervision_schedule_observers (
  id BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT NOT NULL
    REFERENCES procurements.sms_supervision_schedules(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES procurements.sms_users(id) ON DELETE CASCADE,
  slot SMALLINT NOT NULL DEFAULT 1 CHECK (slot BETWEEN 1 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sms_supervision_schedule_observers_uniq UNIQUE (schedule_id, user_id),
  CONSTRAINT sms_supervision_schedule_observers_slot_uniq UNIQUE (schedule_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_sms_supervision_schedule_observers_schedule
  ON procurements.sms_supervision_schedule_observers(schedule_id);
CREATE INDEX IF NOT EXISTS idx_sms_supervision_schedule_observers_user
  ON procurements.sms_supervision_schedule_observers(user_id);

-- ----------------------------------------------------------------------------
-- 6. COT OBSERVATIONS — one row per filled form
--
--    kind:
--      'rating'    Annex E-2 COT Rating Sheet          — one per observer
--      'agreement' Annex E-3 Inter-Observer Agreement  — one per schedule, the
--                  reasoned CONSENSUS rating (explicitly NOT an average)
--      'notes'     Annex E-4 COT Observation Notes     — one per observer
--
--    form_cycle_sy names the school year whose indicator SET this form uses. It
--    is normally the schedule's school year, but is stored separately and
--    explicitly so a form filed under a superseded set keeps printing its own
--    indicators when the 3-year cycle rolls over.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_cot_observations (
  id BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT NOT NULL
    REFERENCES procurements.sms_supervision_schedules(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,

  kind TEXT NOT NULL CHECK (kind IN ('rating', 'agreement', 'notes')),
  -- NULL only for 'agreement', which is the observers' joint output.
  observer_id BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  observer_name TEXT,                     -- snapshot for the signature line

  career_stage TEXT NOT NULL
    CHECK (career_stage IN (
      'proficient_a', 'proficient_b', 'highly_proficient', 'distinguished'
    )),
  form_cycle_sy TEXT NOT NULL,            -- which indicator set this form uses

  observation_date DATE,
  time_started TEXT,                      -- printed verbatim ("8:20 a.m.")
  time_ended TEXT,
  quarter SMALLINT CHECK (quarter IS NULL OR quarter BETWEEN 1 AND 4),
  observation_round SMALLINT NOT NULL DEFAULT 1 CHECK (observation_round IN (1, 2)),
  class_label TEXT,                       -- "SUBJECT & GRADE LEVEL TAUGHT"

  comments TEXT,                          -- "OTHER COMMENTS" (E-2 / E-3)
  notes TEXT,                             -- free-form narrative (E-4)

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted')),
  submitted_at TIMESTAMPTZ,

  created_by BIGINT REFERENCES procurements.sms_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sms_cot_observations_observer_required
    CHECK (kind = 'agreement' OR observer_id IS NOT NULL)
);

COMMENT ON TABLE procurements.sms_cot_observations IS
  'One filled COT form: E-2 rating sheet (per observer), E-3 inter-observer agreement (per schedule), or E-4 observation notes.';
COMMENT ON COLUMN procurements.sms_cot_observations.form_cycle_sy IS
  'School year whose PMES indicator set this form uses. Stored, never re-derived: the set rotates on a 3-year cycle.';
COMMENT ON COLUMN procurements.sms_cot_observations.career_stage IS
  'Copied from the schedule at creation. A later promotion must not change the scale of an already-signed form.';

-- One rating sheet and one notes form per observer per schedule; one agreement
-- per schedule. Partial indexes because the rule differs per kind, and because
-- observer_id is NULL on agreements (a plain UNIQUE would not constrain them).
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_cot_observations_rating_uniq
  ON procurements.sms_cot_observations(schedule_id, observer_id)
  WHERE kind = 'rating';
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_cot_observations_notes_uniq
  ON procurements.sms_cot_observations(schedule_id, observer_id)
  WHERE kind = 'notes';
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_cot_observations_agreement_uniq
  ON procurements.sms_cot_observations(schedule_id)
  WHERE kind = 'agreement';

CREATE INDEX IF NOT EXISTS idx_sms_cot_observations_schedule
  ON procurements.sms_cot_observations(schedule_id);
CREATE INDEX IF NOT EXISTS idx_sms_cot_observations_observer
  ON procurements.sms_cot_observations(observer_id);

CREATE TRIGGER update_sms_cot_observations_updated_at
  BEFORE UPDATE ON procurements.sms_cot_observations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 7. COT RATINGS — one row per indicator on a rating sheet / agreement form
--
--    `rating` is nullable and DELIBERATELY unconstrained in range: the legal
--    band depends on the career stage on the parent row (2-6 / 3-7 / 4-8 / 5-9),
--    which a per-row CHECK cannot see. The app enforces the band from
--    lib/constants/supervision.ts, which is also the only place the bands are
--    written down.
--
--    The three states are mutually exclusive and all meaningful:
--      rating set              — observed and scored
--      not_observed = TRUE     — "NO": automatically scores the LOWEST level of
--                                the stage, so `rating` is stored as that level
--                                too, and the printed form marks the NO column
--      not_applicable = TRUE   — "N/A": excluded from the form entirely, no score
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_cot_ratings (
  id BIGSERIAL PRIMARY KEY,
  observation_id BIGINT NOT NULL
    REFERENCES procurements.sms_cot_observations(id) ON DELETE CASCADE,
  indicator_code TEXT NOT NULL,           -- e.g. '1.1.2'; see lib/constants/supervision.ts
  rating SMALLINT,
  not_observed BOOLEAN NOT NULL DEFAULT FALSE,
  not_applicable BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sms_cot_ratings_uniq UNIQUE (observation_id, indicator_code),
  CONSTRAINT sms_cot_ratings_exclusive
    CHECK (NOT (not_observed AND not_applicable))
);

COMMENT ON COLUMN procurements.sms_cot_ratings.rating IS
  'Range depends on the parent observation career_stage (2-6 / 3-7 / 4-8 / 5-9) and is enforced in the app, not by a CHECK.';
COMMENT ON COLUMN procurements.sms_cot_ratings.not_observed IS
  'The COT "NO" column. Not a zero: it scores the lowest level of the career stage, which is also written to `rating`.';

CREATE INDEX IF NOT EXISTS idx_sms_cot_ratings_observation
  ON procurements.sms_cot_ratings(observation_id);

CREATE TRIGGER update_sms_cot_ratings_updated_at
  BEFORE UPDATE ON procurements.sms_cot_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- RLS + GRANTS (roster / school scoping enforced in the app layer, per 105/119)
-- ----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sms_supervision_observers',
    'sms_supervision_plans',
    'sms_supervision_plan_entries',
    'sms_supervision_schedules',
    'sms_supervision_schedule_observers',
    'sms_cot_observations',
    'sms_cot_ratings'
  ] LOOP
    EXECUTE format('ALTER TABLE procurements.%1$s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s: select" ON procurements.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s: insert" ON procurements.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s: update" ON procurements.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s: delete" ON procurements.%1$s', t);
    EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
  END LOOP;
END $$;

-- <<< END 121_instructional_supervision.sql

-- ============================================================================
-- >>> BEGIN 122_supervision_lesson_plan_storage.sql
-- ============================================================================

-- ============================================================================
-- STORAGE: ILAW lesson plan attachments for observation schedules
-- ============================================================================
-- The per-teacher supervisory plan slip ends with "Attach ILAW Lesson Plan".
-- Migration 121 modelled that as a link (`lesson_plan_url`), which pushed the
-- actual document out to whatever Drive folder the teacher happened to use.
-- This migration makes it a real attachment.
--
-- Files live under the `supervision-lesson-plans/` prefix of the existing
-- `school-management` bucket, following the crla-materials / philiri-materials
-- convention from 088 / 089 / 110.
--
-- ⚠ PRIVACY NOTE: `school-management` is a PUBLIC bucket (078 sets
-- `public = true`) so that landing-page hero images resolve without auth. That
-- means any object in it — including a lesson plan — is readable by anyone who
-- has the object URL, with no sign-in. The uuid in the path makes the URL
-- unguessable, but this is obscurity, not access control. If lesson plans ever
-- need to be genuinely restricted, they must move to a private bucket (see the
-- `diplomas` pattern in 026); flipping this bucket to private would break the
-- public hero images that depend on it.
--
-- Object path layout:
--   supervision-lesson-plans/<school_id>/<school_year>/<uuid>-<filename>
-- The uuid prefix means a file can be uploaded BEFORE its schedule row exists
-- (the modal uploads on pick, so the teacher sees the attachment land before
-- submitting) and two teachers uploading "ILAW.docx" never collide.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Write policies for the new prefix
--
--    078 grants bucket-wide SELECT to authenticated, so reads already work.
--    Its INSERT/UPDATE/DELETE policies, however, are scoped to `landing-hero/`
--    only — without the policies below every upload fails with
--    "new row violates row-level security policy".
--
--    Roles: the School Head side (/supervision) plus teachers, who propose
--    their own observation slots from /teacher/supervision and attach their own
--    lesson plan. Master teachers carry type 'teacher'; their observer status is
--    a designation (sms_supervision_observers), not a user type.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "school_management supervision insert" ON storage.objects;
DROP POLICY IF EXISTS "school_management supervision update" ON storage.objects;
DROP POLICY IF EXISTS "school_management supervision delete" ON storage.objects;

DO $$
DECLARE
  prefix TEXT := 'supervision-lesson-plans';
  roles  TEXT := '''teacher'', ''school_head'', ''assistant_school_head'', ''admin'', ''super admin''';
BEGIN
  EXECUTE format(
    'CREATE POLICY "school_management supervision insert" ON storage.objects
       FOR INSERT TO authenticated
       WITH CHECK (
         bucket_id = ''school-management''
         AND split_part(name, ''/'', 1) = %1$L
         AND EXISTS (
           SELECT 1 FROM procurements.sms_users u
           WHERE u.user_id = auth.uid() AND u.type IN (%2$s)
         )
       )', prefix, roles);

  EXECUTE format(
    'CREATE POLICY "school_management supervision update" ON storage.objects
       FOR UPDATE TO authenticated
       USING (
         bucket_id = ''school-management''
         AND split_part(name, ''/'', 1) = %1$L
         AND EXISTS (
           SELECT 1 FROM procurements.sms_users u
           WHERE u.user_id = auth.uid() AND u.type IN (%2$s)
         )
       )', prefix, roles);

  EXECUTE format(
    'CREATE POLICY "school_management supervision delete" ON storage.objects
       FOR DELETE TO authenticated
       USING (
         bucket_id = ''school-management''
         AND split_part(name, ''/'', 1) = %1$L
         AND EXISTS (
           SELECT 1 FROM procurements.sms_users u
           WHERE u.user_id = auth.uid() AND u.type IN (%2$s)
         )
       )', prefix, roles);
END $$;

-- ----------------------------------------------------------------------------
-- 2. The column now holds a storage OBJECT PATH, not a URL
--
--    Guarded so this migration is safe whether or not 121 has already been
--    applied, and re-runnable either way.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'procurements'
      AND table_name = 'sms_supervision_schedules'
      AND column_name = 'lesson_plan_url'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'procurements'
      AND table_name = 'sms_supervision_schedules'
      AND column_name = 'lesson_plan_path'
  ) THEN
    ALTER TABLE procurements.sms_supervision_schedules
      RENAME COLUMN lesson_plan_url TO lesson_plan_path;
  END IF;
END $$;

-- The original filename, so the UI can show "ILAW-Grade5-Math.docx" rather than
-- the uuid-prefixed object key, and downloads keep a meaningful name.
ALTER TABLE procurements.sms_supervision_schedules
  ADD COLUMN IF NOT EXISTS lesson_plan_name TEXT;

COMMENT ON COLUMN procurements.sms_supervision_schedules.lesson_plan_path IS
  'Object path under supervision-lesson-plans/ in the school-management bucket. That bucket is PUBLIC — anyone with the URL can read the file.';
COMMENT ON COLUMN procurements.sms_supervision_schedules.lesson_plan_name IS
  'Original filename as uploaded, for display and for the download filename.';

-- <<< END 122_supervision_lesson_plan_storage.sql

-- ============================================================================
-- >>> BEGIN 123_supervision_rls_and_integrity.sql
-- ============================================================================

-- ============================================================================
-- 123. Instructional Supervision — real RLS, plus the integrity repairs 121
--      declared but did not deliver.
--
-- 121 shipped every one of its seven tables with
--
--     USING (auth.role() = 'authenticated')
--
-- citing the 105/119 precedent. Those tables hold rosters and tags. These hold
-- COT ratings — the evidence behind a teacher's RPMS score — and a formal
-- approval gate. With no middleware in this app, every rule in the module was
-- a client-side suggestion: from the browser console any signed-in user could
-- self-approve their own observation, rewrite another observer's submitted
-- rating sheet, or read and write another school's supervision records.
--
-- This migration:
--   1. re-creates 121's six triggers idempotently, so the file can be re-run
--      after a partial apply (121 used bare CREATE TRIGGER and aborts on 42710)
--   2. replaces the blanket policies with school-scoped ones, and observer
--      ownership on the two tables that carry ratings
--   3. protects the decision columns with a trigger, so only supervision staff
--      can approve or reject
--   4. school-scopes the storage policies from 122, whose paths are per-school
--      but whose policies were not
--   5. repairs the FK delete rules that would abort or silently destroy
--      signed forms
--
-- Idempotent throughout: safe to run more than once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Make 121's triggers re-runnable
--
-- Every other statement in 121 is guarded. These six were not, which meant a
-- 121 that failed partway could not be recovered by re-running it. Follows the
-- 118 precedent.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sms_supervision_observers',
    'sms_supervision_plans',
    'sms_supervision_plan_entries',
    'sms_supervision_schedules',
    'sms_cot_observations',
    'sms_cot_ratings'
  ] LOOP
    IF to_regclass('procurements.' || t) IS NOT NULL THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS update_%1$s_updated_at ON procurements.%1$s', t);
      EXECUTE format(
        'CREATE TRIGGER update_%1$s_updated_at
           BEFORE UPDATE ON procurements.%1$s
           FOR EACH ROW EXECUTE FUNCTION procurements.update_updated_at_column()', t);
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Who is asking?
--
-- SECURITY DEFINER so a policy can resolve the caller without depending on
-- sms_users' own RLS (and without the recursion that would invite). search_path
-- is pinned, which is what makes SECURITY DEFINER safe here.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.sms_actor_id()
RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT id FROM procurements.sms_users WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION procurements.sms_actor_school_id()
RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT school_id FROM procurements.sms_users WHERE user_id = auth.uid() LIMIT 1;
$$;

/**
 * Division-wide roles. `super admin` is here per the 113/115 precedent: an
 * override swaps their active school, so pinning them to one school_id would
 * lock them out of the very thing the override exists for.
 */
CREATE OR REPLACE FUNCTION procurements.sms_actor_is_division()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT COALESCE(
    (SELECT type IN ('division_admin', 'super admin')
       FROM procurements.sms_users WHERE user_id = auth.uid() LIMIT 1),
    FALSE);
$$;

/** Who may run the supervision cycle: write plans, designate observers, decide. */
CREATE OR REPLACE FUNCTION procurements.sms_actor_is_supervision_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT COALESCE(
    (SELECT type IN ('school_head', 'assistant_school_head', 'admin',
                     'super admin', 'division_admin')
       FROM procurements.sms_users WHERE user_id = auth.uid() LIMIT 1),
    FALSE);
$$;

/** True when the caller may see/touch rows belonging to `target_school`. */
CREATE OR REPLACE FUNCTION procurements.sms_supervision_in_scope(target_school BIGINT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = procurements, public
AS $$
  SELECT procurements.sms_actor_is_division()
      OR (target_school IS NOT NULL
          AND target_school = procurements.sms_actor_school_id());
$$;

GRANT EXECUTE ON FUNCTION procurements.sms_actor_id() TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.sms_actor_school_id() TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.sms_actor_is_division() TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.sms_actor_is_supervision_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.sms_supervision_in_scope(BIGINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Replace the blanket policies
--
-- Read stays school-wide: a supervisory plan and the observation board are
-- meant to be visible to the school's staff, and the app already filters to
-- what each view should show. Write is where the rules bite.
-- ----------------------------------------------------------------------------

-- Drop this migration's own policy names too, so it is genuinely re-runnable
-- and not merely re-runnable against 121's output.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sms_supervision_observers',
    'sms_supervision_plans',
    'sms_supervision_plan_entries',
    'sms_supervision_schedules',
    'sms_supervision_schedule_observers',
    'sms_cot_observations',
    'sms_cot_ratings'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s: write" ON procurements.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s: select" ON procurements.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s: insert" ON procurements.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s: update" ON procurements.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s: delete" ON procurements.%1$s', t);
  END LOOP;
END $$;

-- 2a. Tables that carry school_id directly.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sms_supervision_observers',
    'sms_supervision_plans',
    'sms_supervision_schedules',
    'sms_cot_observations'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s: select" ON procurements.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s: insert" ON procurements.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s: update" ON procurements.%1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s: delete" ON procurements.%1$s', t);

    EXECUTE format(
      'CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT
         USING (procurements.sms_supervision_in_scope(school_id))', t);
  END LOOP;
END $$;

-- Observers and plans are the School Head's to maintain.
CREATE POLICY "sms_supervision_observers: write"
  ON procurements.sms_supervision_observers FOR ALL
  USING (
    procurements.sms_supervision_in_scope(school_id)
    AND procurements.sms_actor_is_supervision_staff()
  )
  WITH CHECK (
    procurements.sms_supervision_in_scope(school_id)
    AND procurements.sms_actor_is_supervision_staff()
  );

CREATE POLICY "sms_supervision_plans: write"
  ON procurements.sms_supervision_plans FOR ALL
  USING (
    procurements.sms_supervision_in_scope(school_id)
    AND procurements.sms_actor_is_supervision_staff()
  )
  WITH CHECK (
    procurements.sms_supervision_in_scope(school_id)
    AND procurements.sms_actor_is_supervision_staff()
  );

-- A teacher may suggest a slot for themselves; staff may act on any slot.
-- The decision columns are policed separately, by trigger (section 3).
CREATE POLICY "sms_supervision_schedules: insert"
  ON procurements.sms_supervision_schedules FOR INSERT
  WITH CHECK (
    procurements.sms_supervision_in_scope(school_id)
    AND (
      procurements.sms_actor_is_supervision_staff()
      OR teacher_id = procurements.sms_actor_id()
    )
  );

CREATE POLICY "sms_supervision_schedules: update"
  ON procurements.sms_supervision_schedules FOR UPDATE
  USING (
    procurements.sms_supervision_in_scope(school_id)
    AND (
      procurements.sms_actor_is_supervision_staff()
      OR teacher_id = procurements.sms_actor_id()
      OR EXISTS (
        SELECT 1 FROM procurements.sms_supervision_schedule_observers so
        WHERE so.schedule_id = sms_supervision_schedules.id
          AND so.user_id = procurements.sms_actor_id()
      )
    )
  )
  WITH CHECK (procurements.sms_supervision_in_scope(school_id));

CREATE POLICY "sms_supervision_schedules: delete"
  ON procurements.sms_supervision_schedules FOR DELETE
  USING (
    procurements.sms_supervision_in_scope(school_id)
    AND procurements.sms_actor_is_supervision_staff()
  );

-- The sharp one: a COT form belongs to the observer whose name is on it.
-- Staff may correct any form; an observer may touch only their own; the rated
-- teacher may touch none. `kind = 'agreement'` carries no observer_id, so it is
-- restricted to the observers actually assigned to that slot.
CREATE POLICY "sms_cot_observations: insert"
  ON procurements.sms_cot_observations FOR INSERT
  WITH CHECK (
    procurements.sms_supervision_in_scope(school_id)
    AND (
      procurements.sms_actor_is_supervision_staff()
      OR observer_id = procurements.sms_actor_id()
      OR (
        kind = 'agreement'
        AND EXISTS (
          SELECT 1 FROM procurements.sms_supervision_schedule_observers so
          WHERE so.schedule_id = sms_cot_observations.schedule_id
            AND so.user_id = procurements.sms_actor_id()
        )
      )
    )
  );

CREATE POLICY "sms_cot_observations: update"
  ON procurements.sms_cot_observations FOR UPDATE
  USING (
    procurements.sms_supervision_in_scope(school_id)
    AND (
      procurements.sms_actor_is_supervision_staff()
      OR observer_id = procurements.sms_actor_id()
      OR (
        kind = 'agreement'
        AND EXISTS (
          SELECT 1 FROM procurements.sms_supervision_schedule_observers so
          WHERE so.schedule_id = sms_cot_observations.schedule_id
            AND so.user_id = procurements.sms_actor_id()
        )
      )
    )
  )
  WITH CHECK (procurements.sms_supervision_in_scope(school_id));

CREATE POLICY "sms_cot_observations: delete"
  ON procurements.sms_cot_observations FOR DELETE
  USING (
    procurements.sms_supervision_in_scope(school_id)
    AND (
      procurements.sms_actor_is_supervision_staff()
      OR observer_id = procurements.sms_actor_id()
    )
  );

-- 2b. Child tables, scoped through their parent.
DROP POLICY IF EXISTS "sms_supervision_plan_entries: select"
  ON procurements.sms_supervision_plan_entries;
DROP POLICY IF EXISTS "sms_supervision_plan_entries: insert"
  ON procurements.sms_supervision_plan_entries;
DROP POLICY IF EXISTS "sms_supervision_plan_entries: update"
  ON procurements.sms_supervision_plan_entries;
DROP POLICY IF EXISTS "sms_supervision_plan_entries: delete"
  ON procurements.sms_supervision_plan_entries;

CREATE POLICY "sms_supervision_plan_entries: select"
  ON procurements.sms_supervision_plan_entries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM procurements.sms_supervision_plans p
    WHERE p.id = plan_id AND procurements.sms_supervision_in_scope(p.school_id)
  ));

CREATE POLICY "sms_supervision_plan_entries: write"
  ON procurements.sms_supervision_plan_entries FOR ALL
  USING (
    procurements.sms_actor_is_supervision_staff()
    AND EXISTS (
      SELECT 1 FROM procurements.sms_supervision_plans p
      WHERE p.id = plan_id AND procurements.sms_supervision_in_scope(p.school_id)
    )
  )
  WITH CHECK (
    procurements.sms_actor_is_supervision_staff()
    AND EXISTS (
      SELECT 1 FROM procurements.sms_supervision_plans p
      WHERE p.id = plan_id AND procurements.sms_supervision_in_scope(p.school_id)
    )
  );

DROP POLICY IF EXISTS "sms_supervision_schedule_observers: select"
  ON procurements.sms_supervision_schedule_observers;
DROP POLICY IF EXISTS "sms_supervision_schedule_observers: insert"
  ON procurements.sms_supervision_schedule_observers;
DROP POLICY IF EXISTS "sms_supervision_schedule_observers: update"
  ON procurements.sms_supervision_schedule_observers;
DROP POLICY IF EXISTS "sms_supervision_schedule_observers: delete"
  ON procurements.sms_supervision_schedule_observers;

CREATE POLICY "sms_supervision_schedule_observers: select"
  ON procurements.sms_supervision_schedule_observers FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM procurements.sms_supervision_schedules s
    WHERE s.id = schedule_id AND procurements.sms_supervision_in_scope(s.school_id)
  ));

-- A teacher names preferred observers when suggesting a slot; the School Head
-- confirms or replaces them. Both need write access to their own school's slots.
CREATE POLICY "sms_supervision_schedule_observers: write"
  ON procurements.sms_supervision_schedule_observers FOR ALL
  USING (EXISTS (
    SELECT 1 FROM procurements.sms_supervision_schedules s
    WHERE s.id = schedule_id
      AND procurements.sms_supervision_in_scope(s.school_id)
      AND (procurements.sms_actor_is_supervision_staff()
           OR s.teacher_id = procurements.sms_actor_id())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurements.sms_supervision_schedules s
    WHERE s.id = schedule_id
      AND procurements.sms_supervision_in_scope(s.school_id)
      AND (procurements.sms_actor_is_supervision_staff()
           OR s.teacher_id = procurements.sms_actor_id())
  ));

DROP POLICY IF EXISTS "sms_cot_ratings: select" ON procurements.sms_cot_ratings;
DROP POLICY IF EXISTS "sms_cot_ratings: insert" ON procurements.sms_cot_ratings;
DROP POLICY IF EXISTS "sms_cot_ratings: update" ON procurements.sms_cot_ratings;
DROP POLICY IF EXISTS "sms_cot_ratings: delete" ON procurements.sms_cot_ratings;

CREATE POLICY "sms_cot_ratings: select"
  ON procurements.sms_cot_ratings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM procurements.sms_cot_observations o
    WHERE o.id = observation_id AND procurements.sms_supervision_in_scope(o.school_id)
  ));

-- Ratings inherit their parent form's ownership exactly.
CREATE POLICY "sms_cot_ratings: write"
  ON procurements.sms_cot_ratings FOR ALL
  USING (EXISTS (
    SELECT 1 FROM procurements.sms_cot_observations o
    WHERE o.id = observation_id
      AND procurements.sms_supervision_in_scope(o.school_id)
      AND (procurements.sms_actor_is_supervision_staff()
           OR o.observer_id = procurements.sms_actor_id()
           OR (o.kind = 'agreement' AND EXISTS (
                 SELECT 1 FROM procurements.sms_supervision_schedule_observers so
                 WHERE so.schedule_id = o.schedule_id
                   AND so.user_id = procurements.sms_actor_id())))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM procurements.sms_cot_observations o
    WHERE o.id = observation_id
      AND procurements.sms_supervision_in_scope(o.school_id)
      AND (procurements.sms_actor_is_supervision_staff()
           OR o.observer_id = procurements.sms_actor_id()
           OR (o.kind = 'agreement' AND EXISTS (
                 SELECT 1 FROM procurements.sms_supervision_schedule_observers so
                 WHERE so.schedule_id = o.schedule_id
                   AND so.user_id = procurements.sms_actor_id())))
  ));

-- ----------------------------------------------------------------------------
-- 3. Only supervision staff may approve or reject
--
-- A policy cannot express "you may update this row, but not these four
-- columns", so the decision fields are policed by trigger. Without this a
-- teacher who is legitimately allowed to edit their own proposed slot could set
-- status = 'approved' in the same statement.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.sms_supervision_guard_decision()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = procurements, public
AS $$
BEGIN
  IF procurements.sms_actor_is_supervision_staff() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
     OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
     OR NEW.decision_notes IS DISTINCT FROM OLD.decision_notes
  THEN
    -- One exception: editing an approved slot must still return it to
    -- `proposed` and clear the decision, which is the workflow's own rule.
    IF NEW.status = 'proposed'
       AND NEW.decided_by IS NULL
       AND NEW.decided_at IS NULL
       AND NEW.decision_notes IS NULL
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'Only the School Head may approve or reject an observation schedule.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sms_supervision_guard_decision
  ON procurements.sms_supervision_schedules;
CREATE TRIGGER sms_supervision_guard_decision
  BEFORE UPDATE ON procurements.sms_supervision_schedules
  FOR EACH ROW EXECUTE FUNCTION procurements.sms_supervision_guard_decision();

-- ----------------------------------------------------------------------------
-- 4. School-scope the storage policies
--
-- 122 matched only the first path segment. The path it builds is
-- `supervision-lesson-plans/<school_id>/<school_year>/<uuid>-<name>`, so a
-- teacher at school A could overwrite or delete school B's lesson plans.
-- Segment 2 is the school; `::text` is required because sms_users.school_id is
-- BIGINT (013) while the path segment is text.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "school_management supervision insert" ON storage.objects;
DROP POLICY IF EXISTS "school_management supervision update" ON storage.objects;
DROP POLICY IF EXISTS "school_management supervision delete" ON storage.objects;

DO $$
DECLARE
  prefix TEXT := 'supervision-lesson-plans';
  roles  TEXT := '''teacher'', ''school_head'', ''assistant_school_head'', ''admin'', ''super admin''';
  guard  TEXT;
  op     TEXT;
  clause TEXT;
BEGIN
  guard := format(
    'bucket_id = ''school-management''
     AND split_part(name, ''/'', 1) = %1$L
     AND EXISTS (
       SELECT 1 FROM procurements.sms_users u
       WHERE u.user_id = auth.uid()
         AND u.type IN (%2$s)
         AND (u.type IN (''super admin'', ''division_admin'')
              OR split_part(name, ''/'', 2) = u.school_id::text)
     )', prefix, roles);

  FOREACH op IN ARRAY ARRAY['insert', 'update', 'delete'] LOOP
    -- INSERT takes WITH CHECK; UPDATE and DELETE take USING.
    clause := CASE WHEN op = 'insert' THEN 'WITH CHECK' ELSE 'USING' END;
    EXECUTE format(
      'CREATE POLICY "school_management supervision %1$s" ON storage.objects
         FOR %1$s TO authenticated %2$s (%3$s)',
      op, clause, guard);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. FK delete rules 121 got wrong
-- ----------------------------------------------------------------------------

-- 5a. `observer_id ON DELETE SET NULL` contradicted the CHECK that requires it
--     to be non-null for rating/notes forms: deleting any user who had ever
--     filed a form aborted with 23514 instead of cascading cleanly.
--     `observer_name` is already the snapshot that makes SET NULL safe, so the
--     CHECK is the half that was wrong.
ALTER TABLE procurements.sms_cot_observations
  DROP CONSTRAINT IF EXISTS sms_cot_observations_observer_required;
ALTER TABLE procurements.sms_cot_observations
  ADD CONSTRAINT sms_cot_observations_observer_required
  CHECK (kind = 'agreement' OR observer_id IS NOT NULL OR observer_name IS NOT NULL);

-- 5b. N/A means the indicator is excluded entirely, so it cannot also carry a
--     score. 121 documented this but did not constrain it.
ALTER TABLE procurements.sms_cot_ratings
  DROP CONSTRAINT IF EXISTS sms_cot_ratings_na_unscored;
ALTER TABLE procurements.sms_cot_ratings
  ADD CONSTRAINT sms_cot_ratings_na_unscored
  CHECK (NOT not_applicable OR rating IS NULL);

-- 5c. Audit FKs into sms_users had no ON DELETE rule, so they defaulted to
--     NO ACTION and would 23503 on the first account purge. All are nullable
--     provenance columns; SET NULL is the house rule (001).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'procurements'
      AND c.contype = 'f'
      AND c.confrelid = 'procurements.sms_users'::regclass
      AND c.confdeltype = 'a'  -- NO ACTION
      AND t.relname IN (
        'sms_supervision_observers', 'sms_supervision_plans',
        'sms_supervision_schedules', 'sms_cot_observations')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  ALTER TABLE procurements.sms_supervision_observers
    ADD CONSTRAINT sms_supervision_observers_designated_by_fkey
    FOREIGN KEY (designated_by) REFERENCES procurements.sms_users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE procurements.sms_supervision_plans
    ADD CONSTRAINT sms_supervision_plans_prepared_by_fkey
    FOREIGN KEY (prepared_by) REFERENCES procurements.sms_users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE procurements.sms_supervision_plans
    ADD CONSTRAINT sms_supervision_plans_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES procurements.sms_users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE procurements.sms_supervision_schedules
    ADD CONSTRAINT sms_supervision_schedules_proposed_by_fkey
    FOREIGN KEY (proposed_by) REFERENCES procurements.sms_users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE procurements.sms_supervision_schedules
    ADD CONSTRAINT sms_supervision_schedules_decided_by_fkey
    FOREIGN KEY (decided_by) REFERENCES procurements.sms_users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE procurements.sms_cot_observations
    ADD CONSTRAINT sms_cot_observations_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES procurements.sms_users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5d. `teacher_id ON DELETE CASCADE` silently destroyed signed COT forms:
--     schedule -> cot_observations -> cot_ratings, all gone with the account.
--     121's own header argues for deactivating rather than deleting. RESTRICT
--     makes that argument enforceable — the delete fails loudly instead.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT c.conname INTO cname
  FROM pg_constraint c
  WHERE c.conrelid = 'procurements.sms_supervision_schedules'::regclass
    AND c.contype = 'f'
    AND c.confrelid = 'procurements.sms_users'::regclass
    AND c.conkey = ARRAY[(
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'procurements.sms_supervision_schedules'::regclass
        AND attname = 'teacher_id')]::smallint[]
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE procurements.sms_supervision_schedules DROP CONSTRAINT %I', cname);
  END IF;

  ALTER TABLE procurements.sms_supervision_schedules
    ADD CONSTRAINT sms_supervision_schedules_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES procurements.sms_users(id) ON DELETE RESTRICT;
END $$;

COMMENT ON FUNCTION procurements.sms_supervision_in_scope(BIGINT) IS
  'True when the caller may access supervision rows for the given school. '
  'Division roles see every school; everyone else is pinned to their own.';

-- <<< END 123_supervision_rls_and_integrity.sql

-- ============================================================================
-- >>> BEGIN 124_schedule_conflict_override.sql
-- ============================================================================

-- ============================================================================
-- FORCED SCHEDULE CREATION (accepted conflicts / shared slots)
-- ============================================================================
-- Conflict detection was absolute: the BEFORE INSERT OR UPDATE trigger from
-- 004 (narrowed for Temporary rows in 117) RAISEs on any room / teacher /
-- section double-booking, so the timetable could not express arrangements that
-- schools genuinely run:
--
--   * two grade levels combined in one room under one teacher (multigrade,
--     small enrolment, or a shared MEP / TLE session)
--   * a hall or covered court used by more than one class at once
--
-- The client already warned about these before saving; there was simply no way
-- through. This adds one: `conflict_override`, set by the encoder ticking
-- "Create anyway" on the warning shown in the Add Schedule modal.
--
-- Semantics, deliberately narrow:
--
--   * The flag exempts THIS row from the trigger. It is not a global mute --
--     the overridden row still occupies its room/teacher/day/time and still
--     surfaces as a conflict to the NEXT person scheduling against it, who
--     must acknowledge it themselves. An override is one person accepting one
--     clash, not a hole in the timetable.
--   * The flag is a record, not a preference. The app writes TRUE only when a
--     conflict was actually detected at save time, so editing the clash away
--     clears it back to FALSE.
--   * Default FALSE, so every existing row and every ordinary insert keeps the
--     old behaviour untouched.
--
-- Nothing here relaxes the Temporary (teacher_id NULL) rules from 117; a
-- Temporary row that clashes on room can now be overridden like any other.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. The flag
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_subject_schedules
  ADD COLUMN IF NOT EXISTS conflict_override BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN procurements.sms_subject_schedules.conflict_override IS
  'TRUE = saved despite a detected room/teacher/section conflict, deliberately (e.g. two grade levels sharing one room). Exempts this row from the conflict trigger only; the row still counts as a conflict for schedules created after it.';

-- ----------------------------------------------------------------------------
-- 2. Honour the flag in the trigger
-- ----------------------------------------------------------------------------
-- Only the early return is new; the body is otherwise 117's. check_schedule_
-- conflicts() itself is left alone on purpose -- it stays a pure "what clashes
-- with this slot?" report, which is what the UI reads through the client-side
-- mirror in lib/utils/scheduleConflicts.ts.
CREATE OR REPLACE FUNCTION public.check_schedule_conflicts_trigger()
RETURNS TRIGGER AS $$
DECLARE
  conflict_record RECORD;
  conflict_messages TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Encoder accepted the clash on this row; skip enforcement for it alone.
  IF COALESCE(NEW.conflict_override, FALSE) THEN
    RETURN NEW;
  END IF;

  -- Check for conflicts
  FOR conflict_record IN
    SELECT * FROM public.check_schedule_conflicts(
      NEW.room_id,
      NEW.teacher_id,
      NEW.section_id,
      NEW.days_of_week,
      NEW.start_time,
      NEW.end_time,
      NEW.school_year,
      NEW.id
    )
  LOOP
    conflict_messages := array_append(conflict_messages, conflict_record.conflict_message);
  END LOOP;

  -- If conflicts found, raise exception
  IF array_length(conflict_messages, 1) > 0 THEN
    RAISE EXCEPTION 'Schedule conflict detected: %', array_to_string(conflict_messages, '; ');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Verification
-- ----------------------------------------------------------------------------
-- Column should read boolean / NOT NULL / default false
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'procurements'
  AND table_name   = 'sms_subject_schedules'
  AND column_name  = 'conflict_override';

-- No existing row should be silently exempted
SELECT COUNT(*) AS overridden_rows
FROM procurements.sms_subject_schedules
WHERE conflict_override;

-- <<< END 124_schedule_conflict_override.sql

-- ============================================================================
-- >>> BEGIN 125_school_calendar_days.sql
-- ============================================================================

-- ============================================================================
-- SCHOOL CALENDAR — NON-CLASS DAYS (and their inverse)
-- ============================================================================
-- Until now nothing in the schema modelled a day without classes. The monthly
-- attendance grid enumerated every Mon-Fri of the month and treated a missing
-- cell as PRESENT, so a holiday silently credited every learner with a full
-- day; SF2's "No. of Days of Classes" counted the same weekday slots, so the
-- denominator was inflated by exactly the days that were never held. Both the
-- numerator and the denominator were wrong, in opposite directions.
--
-- The two cases schools hit constantly:
--
--   * regular and special non-working holidays (national, and local ones like
--     the city fiesta or a division-called activity)
--   * the opening weeks, where the calendar month has started but classes have
--     not -- enrolment week is not attendance week
--
-- Modelled once per school per date, never per learner. A "holiday" is a fact
-- about the school, not about each of 40 children; storing it per learner
-- would multiply one fact across N rows and would lose the day entirely for a
-- section with no enrolees yet -- exactly the opening-week case.
--
-- Design notes:
--
--   * `school_id` NULL = division-wide, per the 106/118 convention. The
--     division office enters the DepEd holiday calendar once and every school
--     inherits it; a school adds only its own local entries.
--   * A date RANGE, not one row per date. "First two weeks -- enrolment, no
--     classes" is one row, and moving the opening date is one edit rather than
--     a delete-and-reinsert. Callers expand to a set of dates; a month is at
--     most 31 keys, so this is cheap client-side.
--   * `period` ('whole' | 'am' | 'pm') because suspensions here are routinely
--     half-day (a signal raised at noon cancels the PM session only). Half a
--     column is awkward to retrofit once totals depend on it.
--   * `day_type = 'class_day'` is the INVERSE entry: there ARE classes. It is
--     what makes precedence unambiguous when a school holds a make-up class on
--     a division no-class day, and it is the only way a Saturday can appear in
--     the grid at all (make-up classes after a suspension). Resolution order,
--     implemented in lib/utils/schoolCalendar.ts and applied identically by the
--     grid, SF2 and the report card: a `class_day` covering the date wins over
--     any blocking row, whatever its scope.
--
-- Deliberately NOT done: no attendance row is deleted or rewritten here. Rows
-- already saved against a date that later turns out to be a holiday simply
-- stop being counted -- the calendar is the authority at read time. That keeps
-- a mis-entered holiday fully reversible and touches no learner data.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. The table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_school_calendar_days (
  id BIGSERIAL PRIMARY KEY,
  -- NULL = division-wide, inherited by every school (106/118 convention)
  school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  day_type TEXT NOT NULL CHECK (day_type IN ('holiday', 'no_class', 'suspension', 'class_day')),
  period TEXT NOT NULL DEFAULT 'whole' CHECK (period IN ('whole', 'am', 'pm')),
  title TEXT NOT NULL,
  created_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sms_school_calendar_days_range_ck CHECK (end_date >= start_date)
);

-- No unique constraint on (school_id, start_date): overlapping entries are
-- legitimate and common -- a one-day suspension declared inside a week already
-- marked as a school activity is two true facts, and both merely block.

CREATE INDEX IF NOT EXISTS idx_sms_school_calendar_days_scope
  ON procurements.sms_school_calendar_days(school_year, school_id);
CREATE INDEX IF NOT EXISTS idx_sms_school_calendar_days_range
  ON procurements.sms_school_calendar_days(start_date, end_date);

DROP TRIGGER IF EXISTS update_sms_school_calendar_days_updated_at
  ON procurements.sms_school_calendar_days;
CREATE TRIGGER update_sms_school_calendar_days_updated_at
  BEFORE UPDATE ON procurements.sms_school_calendar_days
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE procurements.sms_school_calendar_days IS
  'Calendar exceptions: dates with no classes (holiday / no_class / suspension) and their inverse (class_day, e.g. a Saturday make-up). NULL school_id = division-wide. Authoritative denominator for the attendance grid, SF2 days-of-classes, and report card attendance.';
COMMENT ON COLUMN procurements.sms_school_calendar_days.school_id IS
  'NULL = division-wide entry inherited by every school; set = that school only (106/118 convention).';
COMMENT ON COLUMN procurements.sms_school_calendar_days.period IS
  'whole | am | pm. Half-day suspensions block one session only; the other session still counts toward the day.';
COMMENT ON COLUMN procurements.sms_school_calendar_days.day_type IS
  'class_day is the inverse entry (classes ARE held) and overrides any blocking row covering the same date, whatever its scope.';

-- ----------------------------------------------------------------------------
-- 2. RLS
-- ----------------------------------------------------------------------------
-- Readable by every authenticated user: the calendar is a denominator, and
-- SF2 / report card generation for any school needs it. Writes follow the
-- 113 shape -- division roles anywhere, school roles only within their own
-- school, and only division roles may touch a division-wide (NULL) row.
--
-- Note the qualified `sms_school_calendar_days.school_id` on both sides of
-- every comparison: 115's bug was an unqualified `u.school_id = school_id`
-- binding to the inner table, always true and silently type-valid.
ALTER TABLE procurements.sms_school_calendar_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "school_calendar_days_select" ON procurements.sms_school_calendar_days;
CREATE POLICY "school_calendar_days_select"
  ON procurements.sms_school_calendar_days FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "school_calendar_days_insert" ON procurements.sms_school_calendar_days;
CREATE POLICY "school_calendar_days_insert"
  ON procurements.sms_school_calendar_days FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND (
          u.type IN ('division_admin', 'division_type', 'super admin')
          OR (
            u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar')
            AND procurements.sms_school_calendar_days.school_id IS NOT NULL
            AND u.school_id = procurements.sms_school_calendar_days.school_id
          )
        )
    )
  );

DROP POLICY IF EXISTS "school_calendar_days_update" ON procurements.sms_school_calendar_days;
CREATE POLICY "school_calendar_days_update"
  ON procurements.sms_school_calendar_days FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND (
          u.type IN ('division_admin', 'division_type', 'super admin')
          OR (
            u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar')
            AND procurements.sms_school_calendar_days.school_id IS NOT NULL
            AND u.school_id = procurements.sms_school_calendar_days.school_id
          )
        )
    )
  );

DROP POLICY IF EXISTS "school_calendar_days_delete" ON procurements.sms_school_calendar_days;
CREATE POLICY "school_calendar_days_delete"
  ON procurements.sms_school_calendar_days FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND (
          u.type IN ('division_admin', 'division_type', 'super admin')
          OR (
            u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar')
            AND procurements.sms_school_calendar_days.school_id IS NOT NULL
            AND u.school_id = procurements.sms_school_calendar_days.school_id
          )
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_school_calendar_days TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_school_calendar_days_id_seq TO authenticated;

-- <<< END 125_school_calendar_days.sql

-- ============================================================================
-- >>> BEGIN 126_graduation_lock_on_reactivation.sql
-- ============================================================================

-- Graduation lock: close the reactivation bypass, and stop blocking the
-- Grade 6 → Grade 7 / Grade 10 → Grade 11 progression.
--
-- Two defects in migration 062's enforce_graduation_lock():
--
-- (1) IT NEVER SAW UPDATEs.
--     The function returns early for anything that is not an INSERT, but both
--     re-enrolment paths reactivate an existing row with an UPDATE:
--       * EnrollmentWizard's "existing student" branch finds a stale enrollment
--         at this school for the target school year — its stale list included
--         'graduated' — and flips it to active.
--       * enroll_student_with_record_request (066) reactivates any existing row
--         at the requesting school for that school year, whatever its status.
--     A completer could be put back on the active roster with no error at all.
--
-- (2) IT WAS TOO BROAD.
--     lib/constants/enrollment.ts treats Grades 6, 10 and 12 as terminal, so
--     PromoteStudentModal writes 'graduated' for an elementary or JHS completer
--     — and 062 then refused to let that learner enrol in Grade 7 or Grade 11
--     ANYWHERE, at any school, in any later year: 'Student % has already
--     graduated and cannot be re-enrolled.' Only Grade 12 is genuinely an exit
--     from K-12.
--
-- The rule this replaces both with: a graduation may never be walked backwards.
-- A new or reactivated on-the-roster enrollment is refused when it would put
-- the learner at or below a grade level they already graduated, or in that
-- school year or earlier. Moving forward — the completer's next grade, in a
-- later school year, at any school — is allowed.
--
--   G6 graduated in SY 2025-2026  →  G7 in SY 2026-2027   allowed
--   G6 graduated in SY 2025-2026  →  G6 in SY 2026-2027   blocked (repeat)
--   G6 graduated in SY 2025-2026  →  G6 in SY 2025-2026   blocked (the bypass)
--   G12 graduated                 →  anything             blocked (nothing above 12)
--
-- School years are "YYYY-YYYY", so lexicographic comparison orders them
-- correctly.

CREATE OR REPLACE FUNCTION procurements.enforce_graduation_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_grad_grade       INTEGER;
  v_grad_school_year TEXT;
BEGIN
  -- Only guard transitions INTO an on-the-roster status. Historical rows can
  -- still be corrected in every other direction.
  IF NEW.enrollment_status NOT IN ('active', 'pending_transfer', 'pending_review') THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only fire when the status actually moves. Re-saving an already
  -- active row (section change, grade-level correction) must stay allowed.
  IF TG_OP = 'UPDATE'
     AND OLD.enrollment_status IS NOT DISTINCT FROM NEW.enrollment_status THEN
    RETURN NEW;
  END IF;

  -- The graduation that would be walked backwards, if any. Deliberately NOT
  -- excluding NEW.id: when the row being reactivated IS the graduated one,
  -- that row is exactly the bypass, and BEFORE UPDATE still sees its old
  -- value in the table.
  SELECT e.grade_level, e.school_year
    INTO v_grad_grade, v_grad_school_year
  FROM procurements.sms_enrollments e
  WHERE e.student_id = NEW.student_id
    AND e.status = 'approved'
    AND e.enrollment_status = 'graduated'
    AND (
      NEW.grade_level <= e.grade_level
      OR NEW.school_year <= e.school_year
    )
  ORDER BY e.school_year DESC, e.grade_level DESC
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Student % graduated from grade % in SY %. They cannot be enrolled in grade % for SY % — a graduation cannot be walked back.',
      NEW.student_id, v_grad_grade, v_grad_school_year,
      NEW.grade_level, NEW.school_year
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- 062 created the trigger as BEFORE INSERT only; it has to see UPDATEs now.
DROP TRIGGER IF EXISTS trg_enforce_graduation_lock
  ON procurements.sms_enrollments;

CREATE TRIGGER trg_enforce_graduation_lock
BEFORE INSERT OR UPDATE OF enrollment_status
ON procurements.sms_enrollments
FOR EACH ROW
EXECUTE FUNCTION procurements.enforce_graduation_lock();

COMMENT ON FUNCTION procurements.enforce_graduation_lock IS
  'Refuses a new or reactivated on-the-roster enrollment that would put a learner at or below a grade level they already graduated, or in that school year or earlier. Covers INSERT and the UPDATE reactivation path. Grade 6/10 completers may still move up to Grade 7/11.';

-- <<< END 126_graduation_lock_on_reactivation.sql

-- ============================================================================
-- >>> BEGIN 127_record_request_origin_enrollment.sql
-- ============================================================================

-- Pin every record request to the ONE origin enrollment it is about.
--
-- The transfer RPCs in 066 all identify the origin enrollment by predicate —
-- (student_id, origin_school_id, status = 'approved', enrollment_status IN …) —
-- with no school year or row id. A learner who has attended the origin school
-- before matches on several rows, so:
--
--   * remove_transfer_student reverted EVERY historical 'transferred_out' row
--     at that school back to 'active'. Undoing one transfer resurrected the
--     learner as concurrently enrolled in several past school years.
--   * respond_to_record_request / cancel_record_request had the same shape on
--     their pending_transfer reverts.
--
-- Fix: sms_record_requests.origin_enrollment_id records the exact row when the
-- request is created, and every RPC acts on that id alone.
--
-- Legacy rows: the column is backfilled below, but only where the predicate
-- resolves to exactly one candidate. Where it is still NULL the RPCs fall back
-- to the most recent matching row (ORDER BY school_year DESC, created_at DESC
-- LIMIT 1) — one row, never the whole history.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

ALTER TABLE procurements.sms_record_requests
  ADD COLUMN IF NOT EXISTS origin_enrollment_id BIGINT
    REFERENCES procurements.sms_enrollments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_record_requests_origin_enrollment
  ON procurements.sms_record_requests (origin_enrollment_id);

COMMENT ON COLUMN procurements.sms_record_requests.origin_enrollment_id IS
  'The single enrollment row at the origin school this request is about. NULL only for requests created before migration 127 whose origin row could not be identified unambiguously.';

-- ---------------------------------------------------------------------------
-- 2. Backfill — additive, writes only the new column
-- ---------------------------------------------------------------------------
-- Touches: sms_record_requests rows where origin_enrollment_id IS NULL (all of
-- them, since the column is new) — and sets a value only for those whose origin
-- school has exactly ONE enrollment for that learner in a transfer-related
-- state. Ambiguous ones stay NULL and use the fallback path. No other column,
-- table or row is modified.

UPDATE procurements.sms_record_requests r
SET origin_enrollment_id = (
  SELECT e.id
  FROM procurements.sms_enrollments e
  WHERE e.student_id = r.student_id
    AND e.school_id = r.origin_school_id
    AND e.status = 'approved'
    AND e.enrollment_status IN ('active', 'pending_transfer', 'transferred_out')
)
WHERE r.origin_enrollment_id IS NULL
  AND (
    SELECT COUNT(*)
    FROM procurements.sms_enrollments e
    WHERE e.student_id = r.student_id
      AND e.school_id = r.origin_school_id
      AND e.status = 'approved'
      AND e.enrollment_status IN ('active', 'pending_transfer', 'transferred_out')
  ) = 1;

-- ---------------------------------------------------------------------------
-- 3. enroll_student_with_record_request — record the origin row, scope the
--    pending_transfer mark to it
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION procurements.enroll_student_with_record_request(
  p_student_id BIGINT, p_requesting_school_id BIGINT, p_requested_by BIGINT,
  p_section_id BIGINT, p_grade_level INTEGER, p_school_year TEXT,
  p_semester INTEGER DEFAULT NULL, p_remarks TEXT DEFAULT NULL
) RETURNS TABLE (enrollment_id BIGINT, request_id BIGINT) AS $$
DECLARE
  v_origin_school_id BIGINT; v_student_lrn TEXT;
  v_enrollment_id BIGINT; v_request_id BIGINT;
  v_origin_status TEXT;
  v_origin_enrollment_id BIGINT;
  v_existing_enrollment_id BIGINT;
BEGIN
  SELECT s.lrn INTO v_student_lrn FROM procurements.sms_students s WHERE s.id = p_student_id;
  IF v_student_lrn IS NULL THEN RAISE EXCEPTION 'Student not found'; END IF;

  -- The learner's latest approved enrollment IS the origin — capture its id,
  -- not just its school, so every later step acts on this one row.
  SELECT e.id, e.school_id, e.enrollment_status
    INTO v_origin_enrollment_id, v_origin_school_id, v_origin_status
  FROM procurements.sms_enrollments e
  WHERE e.student_id = p_student_id AND e.status = 'approved'
    AND e.enrollment_status IN ('active', 'completed', 'transferred_out', 'promoted', 'graduated', 'retained')
  ORDER BY e.school_year DESC, e.created_at DESC LIMIT 1;

  IF v_origin_school_id IS NULL THEN RAISE EXCEPTION 'Student has no active enrollment'; END IF;
  IF v_origin_school_id = p_requesting_school_id THEN RAISE EXCEPTION 'Student already at this school'; END IF;

  -- Create record request for data access
  INSERT INTO procurements.sms_record_requests (
    student_id, student_lrn, requesting_school_id, origin_school_id,
    origin_enrollment_id, requested_by, target_grade_level, target_school_year, remarks
  ) VALUES (
    p_student_id, v_student_lrn, p_requesting_school_id, v_origin_school_id,
    v_origin_enrollment_id, p_requested_by, p_grade_level, p_school_year, p_remarks
  ) RETURNING id INTO v_request_id;

  -- Mark THAT origin enrollment as pending_transfer (only if still active)
  IF v_origin_status = 'active' THEN
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'pending_transfer'
    WHERE id = v_origin_enrollment_id;
  END IF;

  -- Check if student already has an enrollment at this school for this school year
  -- (e.g., student transferred away and is now returning). Reactivate it instead of
  -- inserting a duplicate that would violate the unique constraint.
  SELECT id INTO v_existing_enrollment_id
  FROM procurements.sms_enrollments
  WHERE student_id = p_student_id
    AND school_id = p_requesting_school_id
    AND school_year = p_school_year
    AND COALESCE(semester, 0) = COALESCE(p_semester, 0)
  LIMIT 1;

  IF v_existing_enrollment_id IS NOT NULL THEN
    -- Reactivate the existing enrollment. A row that was left 'graduated' is
    -- refused by trg_enforce_graduation_lock (126), not silently revived.
    UPDATE procurements.sms_enrollments
    SET section_id = p_section_id, grade_level = p_grade_level,
        status = 'approved', enrollment_status = 'active',
        origin_school_id = v_origin_school_id, record_request_id = v_request_id,
        enrolled_by = p_requested_by, approved_by = p_requested_by,
        remarks = NULL, updated_at = NOW()
    WHERE id = v_existing_enrollment_id
    RETURNING id INTO v_enrollment_id;
  ELSE
    -- Create new enrollment — immediately approved & active
    INSERT INTO procurements.sms_enrollments (
      student_id, school_id, section_id, grade_level, school_year, semester,
      status, enrollment_status, origin_school_id, record_request_id,
      enrolled_by, approved_by
    ) VALUES (
      p_student_id, p_requesting_school_id, p_section_id, p_grade_level, p_school_year,
      p_semester, 'approved', 'active', v_origin_school_id, v_request_id,
      p_requested_by, p_requested_by
    ) RETURNING id INTO v_enrollment_id;
  END IF;

  -- Update student record
  UPDATE procurements.sms_students
  SET school_id = p_requesting_school_id, enrollment_status = 'enrolled',
      grade_level = p_grade_level, current_section_id = p_section_id
  WHERE id = p_student_id;

  RETURN QUERY SELECT v_enrollment_id, v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 4. respond_to_record_request — act on the pinned origin row only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION procurements.respond_to_record_request(
  p_request_id BIGINT, p_action TEXT, p_responder_id BIGINT,
  p_rejection_reason TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_request RECORD;
  v_origin_enrollment_id BIGINT;
BEGIN
  IF p_action NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Invalid action'; END IF;

  SELECT * INTO v_request FROM procurements.sms_record_requests
  WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  -- Pinned row, or — for a pre-127 request — the most recent single candidate.
  v_origin_enrollment_id := COALESCE(
    v_request.origin_enrollment_id,
    (SELECT e.id FROM procurements.sms_enrollments e
      WHERE e.student_id = v_request.student_id
        AND e.school_id = v_request.origin_school_id
        AND e.status = 'approved'
        AND e.enrollment_status IN ('active', 'pending_transfer')
      ORDER BY e.school_year DESC, e.created_at DESC LIMIT 1)
  );

  UPDATE procurements.sms_record_requests
  SET status = p_action, approved_by = p_responder_id, responded_at = NOW(),
      rejection_reason = CASE WHEN p_action = 'rejected' THEN p_rejection_reason ELSE NULL END,
      record_access_granted = CASE WHEN p_action = 'approved' THEN TRUE ELSE FALSE END,
      access_granted_at = CASE WHEN p_action = 'approved' THEN NOW() ELSE NULL END,
      origin_enrollment_id = COALESCE(origin_enrollment_id, v_origin_enrollment_id)
  WHERE id = p_request_id;

  IF p_action = 'approved' THEN
    -- Mark that one origin enrollment as transferred_out
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'transferred_out', updated_at = NOW()
    WHERE id = v_origin_enrollment_id
      AND status = 'approved'
      AND enrollment_status IN ('active', 'pending_transfer');

  ELSIF p_action = 'rejected' THEN
    -- Revert that one origin enrollment to active (if it was pending_transfer)
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'active', updated_at = NOW()
    WHERE id = v_origin_enrollment_id
      AND status = 'approved'
      AND enrollment_status = 'pending_transfer';
    -- Destination enrollment stays active — student remains enrolled
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 5. cancel_record_request — same scoping
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION procurements.cancel_record_request(
  p_request_id BIGINT, p_user_id BIGINT
) RETURNS VOID AS $$
DECLARE
  v_request RECORD;
  v_origin_enrollment_id BIGINT;
BEGIN
  SELECT * INTO v_request FROM procurements.sms_record_requests
  WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  v_origin_enrollment_id := COALESCE(
    v_request.origin_enrollment_id,
    (SELECT e.id FROM procurements.sms_enrollments e
      WHERE e.student_id = v_request.student_id
        AND e.school_id = v_request.origin_school_id
        AND e.status = 'approved'
        AND e.enrollment_status = 'pending_transfer'
      ORDER BY e.school_year DESC, e.created_at DESC LIMIT 1)
  );

  UPDATE procurements.sms_record_requests SET status = 'cancelled' WHERE id = p_request_id;

  -- Revert that one origin enrollment to active (if it was pending_transfer)
  UPDATE procurements.sms_enrollments
  SET enrollment_status = 'active', updated_at = NOW()
  WHERE id = v_origin_enrollment_id
    AND status = 'approved'
    AND enrollment_status = 'pending_transfer';
  -- Destination enrollment stays active
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 6. remove_transfer_student — revert ONE origin enrollment, not the history
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION procurements.remove_transfer_student(
  p_request_id BIGINT,
  p_remover_id BIGINT,
  p_reason TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_request RECORD;
  v_enrollment RECORD;
  v_origin_enrollment_id BIGINT;
BEGIN
  -- Must have approved request with data access granted
  SELECT * INTO v_request FROM procurements.sms_record_requests
  WHERE id = p_request_id AND status = 'approved' AND record_access_granted = TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or records not yet accessible';
  END IF;

  -- Find the active enrollment at the requesting school
  SELECT * INTO v_enrollment FROM procurements.sms_enrollments
  WHERE record_request_id = p_request_id AND status = 'approved' AND enrollment_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active enrollment found for this request';
  END IF;

  -- Drop the enrollment
  UPDATE procurements.sms_enrollments
  SET enrollment_status = 'dropped', status = 'rejected',
      remarks = COALESCE(p_reason, 'Removed after record review'), updated_at = NOW()
  WHERE id = v_enrollment.id;

  -- Revoke data access
  UPDATE procurements.sms_record_requests
  SET record_access_granted = FALSE
  WHERE id = p_request_id;

  -- Revert the ONE origin enrollment this request transferred out. Pre-127
  -- requests fall back to the most recent single candidate — never the whole
  -- transfer history, which is what this migration exists to stop.
  v_origin_enrollment_id := COALESCE(
    v_request.origin_enrollment_id,
    (SELECT e.id FROM procurements.sms_enrollments e
      WHERE e.student_id = v_request.student_id
        AND e.school_id = v_request.origin_school_id
        AND e.status = 'approved'
        AND e.enrollment_status = 'transferred_out'
      ORDER BY e.school_year DESC, e.created_at DESC LIMIT 1)
  );

  UPDATE procurements.sms_enrollments
  SET enrollment_status = 'active', updated_at = NOW()
  WHERE id = v_origin_enrollment_id
    AND status = 'approved'
    AND enrollment_status = 'transferred_out';

  -- Revert student record to origin school
  UPDATE procurements.sms_students
  SET enrollment_status = 'enrolled',
      school_id = v_request.origin_school_id,
      current_section_id = NULL
  WHERE id = v_request.student_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION procurements.remove_transfer_student TO authenticated;

-- <<< END 127_record_request_origin_enrollment.sql

-- ============================================================================
-- >>> BEGIN 128_one_gpa_source_of_truth.sql
-- ============================================================================

-- One GPA implementation for section placement.
--
-- Two code paths decided which section a learner lands in, and they disagreed:
--
--   * EnrollmentWizard → get_student_previous_gpa (036, then 076): excludes
--     madrasah subjects, but averages EVERY grade row — including the zeros
--     that stand for "not encoded yet". A section with one quarter still blank
--     therefore reported a GPA well below the learner's real standing, which
--     pushed them toward a Crack section.
--   * EnrollStudentsTabContent (Auto Enroll): filtered `grade > 0` in
--     JavaScript, but had no idea about madrasah subjects, so MEP grades were
--     counted toward the general average — contrary to DepEd practice and to
--     what migration 076 established.
--
-- Same learner, two answers, two placements. This makes students_gpa_for_grade
-- the only implementation — madrasah excluded, zeros excluded — and reduces
-- get_student_previous_gpa to a single-student wrapper over it.
--
-- The batch form also replaces a client-side fetch of every grade row for a
-- whole grade level, which Auto Enroll was doing on each run.

-- ---------------------------------------------------------------------------
-- 1. The one implementation
-- ---------------------------------------------------------------------------
-- Returns one row per id in p_student_ids, gpa NULL when the learner has no
-- enrollment at that grade level or no usable grades. p_school_year pins the
-- source year (Auto Enroll knows it exactly); NULL takes the most recent.

CREATE OR REPLACE FUNCTION procurements.students_gpa_for_grade(
  p_student_ids BIGINT[],
  p_grade_level INTEGER,
  p_school_year TEXT DEFAULT NULL,
  p_school_id   BIGINT DEFAULT NULL
)
RETURNS TABLE (student_id BIGINT, gpa NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT ids.sid, avg_row.value
  FROM unnest(COALESCE(p_student_ids, ARRAY[]::BIGINT[])) AS ids(sid)
  -- The enrollment that grade level was taken in …
  LEFT JOIN LATERAL (
    SELECT e.section_id, e.school_year
    FROM procurements.sms_enrollments e
    WHERE e.student_id = ids.sid
      AND e.grade_level = p_grade_level
      AND e.status = 'approved'
      AND (p_school_year IS NULL OR e.school_year = p_school_year)
      AND (p_school_id IS NULL OR e.school_id = p_school_id)
    ORDER BY e.school_year DESC, e.created_at DESC
    LIMIT 1
  ) src ON TRUE
  -- … and its average, excluding MEP subjects and un-encoded zeros.
  LEFT JOIN LATERAL (
    SELECT ROUND(AVG(g.grade)::numeric, 2) AS value
    FROM procurements.sms_grades g
    JOIN procurements.sms_subjects s ON s.id = g.subject_id
    WHERE g.student_id  = ids.sid
      AND g.section_id  = src.section_id
      AND g.school_year = src.school_year
      AND COALESCE(s.is_madrasah, false) = false
      AND g.grade > 0
  ) avg_row ON TRUE;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION procurements.students_gpa_for_grade IS
  'Average grade per learner for a given grade level, excluding madrasah subjects and un-encoded (0) grades. The single source of truth for section placement — both the enrollment wizard and Auto Enroll go through it.';

GRANT EXECUTE ON FUNCTION procurements.students_gpa_for_grade(BIGINT[], INTEGER, TEXT, BIGINT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_student_previous_gpa is now a wrapper
-- ---------------------------------------------------------------------------
-- Same signature and meaning as 076 (the average at grade_level - 1); it now
-- also drops zero grades, which is the behaviour change this migration exists
-- for.

CREATE OR REPLACE FUNCTION procurements.get_student_previous_gpa(
  p_student_id BIGINT,
  p_grade_level INTEGER,
  p_school_id BIGINT DEFAULT NULL
)
RETURNS NUMERIC AS $$
  SELECT g.gpa
  FROM procurements.students_gpa_for_grade(
    ARRAY[p_student_id], p_grade_level - 1, NULL, p_school_id
  ) g;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION procurements.get_student_previous_gpa IS
  'Average grade from a learner''s most recent approved enrollment at (grade_level - 1), excluding madrasah subjects and un-encoded (0) grades. Thin wrapper over students_gpa_for_grade.';

-- <<< END 128_one_gpa_source_of_truth.sql

-- ============================================================================
-- >>> BEGIN 129_requests_access_control.sql
-- ============================================================================

-- ============================================================================
-- Migration 129: Close the Requests module's access holes
-- ============================================================================
--
-- APPLY AFTER 127. This migration revokes EXECUTE on the three transfer RPCs
-- that 127 rewrote; the code that replaces those direct calls (server actions
-- in lib/requests/record-actions.ts) ships in the same change.
--
-- ---------------------------------------------------------------------------
-- What is wrong today
-- ---------------------------------------------------------------------------
--
-- 1. Migration 049 gave `anon` blanket access to the document-request tables:
--
--      sms_requests_public_read          SELECT  TO anon, authenticated  USING (true)
--      sms_requests_public_insert        INSERT  TO anon, authenticated  WITH CHECK (true)
--      sms_requests_authenticated_update UPDATE  TO authenticated        USING (true)
--      sms_request_attachments_all       ALL     TO anon, authenticated  USING (true) WITH CHECK (true)
--      sms_request_logs_all              ALL     TO anon, authenticated  USING (true) WITH CHECK (true)
--
--    NEXT_PUBLIC_SUPABASE_ANON_KEY ships in the browser bundle, so every one of
--    those is reachable by anybody on the internet: read every learner name,
--    LRN, requester name, contact number, email and purpose across the whole
--    division, and insert/update/delete rows in the audit log and the
--    attachment index at will. `..._authenticated_update USING (true)` also
--    lets any signed-in account — a teacher, a librarian — rewrite the status
--    of any request directly, going around the state machine in
--    updateRequestStatus entirely.
--
-- 2. respond_to_record_request / cancel_record_request / remove_transfer_student
--    are SECURITY DEFINER and granted to `authenticated`, and none of them
--    checks who is calling — they trust the responder id passed in as an
--    argument. RLS cannot help: a definer function runs as its owner, so the
--    "Record requests updatable by origin school" policy never applies. Any
--    signed-in user could approve a transfer on behalf of any school, or call
--    remove_transfer_student to drop a learner's enrollment and move them back
--    to their previous school.
--
-- ---------------------------------------------------------------------------
-- What replaces it
-- ---------------------------------------------------------------------------
--
-- The public portal never needed table access: submitting and tracking both
-- run server-side on the service-role client (lib/requests/actions.ts), and
-- the last anon read — the "you already have a request for this document"
-- check — moved into getExistingRequestsForLrn in the same file. So `anon`
-- loses these tables completely.
--
-- Staff keep SELECT, scoped to their own school, because the queue, the detail
-- modal, the dashboards and the sidebar badge all read through the RLS client.
-- Every WRITE goes through a server action that authenticates the caller
-- (lib/requests/auth.ts), so no write policy is granted to anyone.
--
-- ---------------------------------------------------------------------------
-- Blast radius
-- ---------------------------------------------------------------------------
--
-- Drops 5 POLICIES on 3 tables and REVOKEs EXECUTE on 3 FUNCTIONS. It creates
-- no table, drops no table, drops no column, and modifies NO ROWS — there is
-- no DML in this file at all. Reversible by re-running the policy block from
-- migration 049 and re-granting EXECUTE.
--
-- Before applying, count the rows that become invisible to school staff —
-- requests whose school_id was never set (a public submission whose LRN did
-- not resolve to a school). They stay readable by division staff, and the
-- server actions still let school staff act on them (canActOnSchool treats a
-- NULL school as unowned), but they will not appear in a school's list:
--
--   SELECT count(*) FROM procurements.sms_requests WHERE school_id IS NULL;
--
-- If that count is not zero, decide where those belong before applying.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. sms_requests
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "sms_requests_public_read"          ON procurements.sms_requests;
DROP POLICY IF EXISTS "sms_requests_public_insert"        ON procurements.sms_requests;
DROP POLICY IF EXISTS "sms_requests_authenticated_update" ON procurements.sms_requests;

-- Staff read their own school's requests. Division staff read everything, and
-- so pick up the unattributed (school_id IS NULL) rows.
CREATE POLICY "sms_requests_staff_read"
  ON procurements.sms_requests FOR SELECT
  TO authenticated
  USING (
    school_id = (
      SELECT u.school_id FROM procurements.sms_users u
      WHERE u.user_id = auth.uid() LIMIT 1
    )
    OR (
      SELECT u.type FROM procurements.sms_users u
      WHERE u.user_id = auth.uid() LIMIT 1
    ) IN ('division_admin', 'division_type', 'super admin')
  );

-- No INSERT/UPDATE/DELETE policy on purpose: every write in this module runs
-- through a server action on the service-role client, which is not subject to
-- RLS. Adding one here would re-open the hole this migration closes.

-- ---------------------------------------------------------------------------
-- 2. sms_request_attachments — visible with the request they belong to
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "sms_request_attachments_all" ON procurements.sms_request_attachments;

CREATE POLICY "sms_request_attachments_staff_read"
  ON procurements.sms_request_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM procurements.sms_requests r
      WHERE r.id = request_id
        AND (
          r.school_id = (
            SELECT u.school_id FROM procurements.sms_users u
            WHERE u.user_id = auth.uid() LIMIT 1
          )
          OR (
            SELECT u.type FROM procurements.sms_users u
            WHERE u.user_id = auth.uid() LIMIT 1
          ) IN ('division_admin', 'division_type', 'super admin')
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. sms_request_logs — the audit trail; readable with its request, never
--    writable from a client. anon could previously delete from this table.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "sms_request_logs_all" ON procurements.sms_request_logs;

CREATE POLICY "sms_request_logs_staff_read"
  ON procurements.sms_request_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM procurements.sms_requests r
      WHERE r.id = request_id
        AND (
          r.school_id = (
            SELECT u.school_id FROM procurements.sms_users u
            WHERE u.user_id = auth.uid() LIMIT 1
          )
          OR (
            SELECT u.type FROM procurements.sms_users u
            WHERE u.user_id = auth.uid() LIMIT 1
          ) IN ('division_admin', 'division_type', 'super admin')
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Table-level grants — belt and braces alongside the policies above
-- ---------------------------------------------------------------------------

REVOKE ALL ON procurements.sms_requests             FROM anon;
REVOKE ALL ON procurements.sms_request_attachments  FROM anon;
REVOKE ALL ON procurements.sms_request_logs         FROM anon;

REVOKE INSERT, UPDATE, DELETE ON procurements.sms_requests            FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON procurements.sms_request_attachments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON procurements.sms_request_logs        FROM authenticated;

GRANT SELECT ON procurements.sms_requests             TO authenticated;
GRANT SELECT ON procurements.sms_request_attachments  TO authenticated;
GRANT SELECT ON procurements.sms_request_logs         TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. The transfer RPCs — service-role only from here on
-- ---------------------------------------------------------------------------
--
-- These stay SECURITY DEFINER and their bodies are untouched (127 owns those).
-- What changes is who may call them: the server actions in
-- lib/requests/record-actions.ts resolve the acting staff member from the
-- session cookie and check their school against the request first. Revoking
-- EXECUTE is what makes that check impossible to skip.
--
-- enroll_student_with_record_request is deliberately NOT revoked: the
-- enrollment wizard still calls it directly, and it opens a request rather
-- than answering one. It has the same unchecked-caller shape and should get
-- the same treatment in a follow-up.

REVOKE EXECUTE ON FUNCTION procurements.respond_to_record_request(BIGINT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION procurements.cancel_record_request(BIGINT, BIGINT)                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION procurements.remove_transfer_student(BIGINT, BIGINT, TEXT)         FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION procurements.respond_to_record_request(BIGINT, TEXT, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION procurements.cancel_record_request(BIGINT, BIGINT)                 TO service_role;
GRANT EXECUTE ON FUNCTION procurements.remove_transfer_student(BIGINT, BIGINT, TEXT)         TO service_role;

-- <<< END 129_requests_access_control.sql

COMMIT;
