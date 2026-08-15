-- ============================================================================
-- SCHOOL MANAGEMENT SYSTEM — FRESH INSTALL, PART 5 OF 7
-- Item analysis, ARAL, anecdotal, grade monitoring, School Report Card, KPI
-- ============================================================================
-- GENERATED FILE — do not edit by hand; run supabase/setup/generate.sh instead.
-- A byte-for-byte concatenation of the 20 migrations listed below, in the
-- exact order a migration runner would apply them.
--
-- FOR NEW / EMPTY DATABASES ONLY. Never run this against a database that already
-- has the migration history applied — use supabase/migrations/ for that.
--
-- Run the seven parts strictly in order: 01 -> 07. Each part is one transaction,
-- so a failure rolls the whole part back and leaves nothing half-applied.
--
-- Migrations merged into this part:
--   100_exam_sections.sql
--   101_item_analysis.sql
--   102_aral_tutors.sql
--   103_evaluation_school_head_target.sql
--   104_aral_tutor_attendance_progress.sql
--   105_anecdotal_and_cardex.sql
--   106_school_authored_assessment_materials.sql
--   107_grade_encoding_status.sql
--   108_crla_grade3_english_two_task.sql
--   109_fix_division_classroom_needs.sql
--   110_school_authored_material_uploads.sql
--   111_learner_health_bmi_bands.sql
--   112_school_report_card.sql
--   113_fix_src_superadmin_access.sql
--   114_student_ethnicity_and_4ps.sql
--   115_fix_subjects_superadmin_access.sql
--   116_fix_subject_fk_delete_rules.sql
--   117_optional_schedule_teacher.sql
--   118_key_performance_indicators.sql
--   119_learner_manifestation_tagging.sql
-- ============================================================================

BEGIN;

SET search_path TO procurements, public;

-- ============================================================================
-- >>> BEGIN 100_exam_sections.sql
-- ============================================================================

-- ============================================================================
-- EXAM SECTIONS — per-question-type directions for a grouped exam.
--
-- An exam is printed in parts grouped by question type (I. Multiple Choice,
-- II. True/False, …). Each part carries its own directions/instructions, stored
-- here (one row per type present in the exam). Ordering is by `position`.
-- ============================================================================

SET search_path TO procurements, public;

CREATE TABLE IF NOT EXISTS procurements.sms_exam_sections (
  id BIGSERIAL PRIMARY KEY,
  exam_id BIGINT NOT NULL REFERENCES procurements.sms_exams(id) ON DELETE CASCADE,
  question_type TEXT NOT NULL CHECK (question_type IN (
    'multiple_choice', 'true_false', 'modified_true_false',
    'matching', 'short_answer', 'completion', 'essay'
  )),
  instructions TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exam_id, question_type)
);

COMMENT ON TABLE procurements.sms_exam_sections IS
  'Directions per question-type group for a grouped/printed exam.';

CREATE INDEX IF NOT EXISTS idx_sms_exam_sections_exam
  ON procurements.sms_exam_sections(exam_id, position);

CREATE TRIGGER update_sms_exam_sections_updated_at
  BEFORE UPDATE ON procurements.sms_exam_sections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE procurements.sms_exam_sections ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT := 'sms_exam_sections';
BEGIN
  EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
  EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
  EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
  EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
END $$;

-- <<< END 100_exam_sections.sql

-- ============================================================================
-- >>> BEGIN 101_item_analysis.sql
-- ============================================================================

-- ============================================================================
-- ITEM ANALYSIS with MPS — record exam results per section and analyse items.
--
-- After a section takes an exam (from the Exam Creator), the teacher records
-- which auto-scorable items each learner got right. From that the app computes:
--   * per-item difficulty index (p) and discrimination index (D) -> retain /
--     revise / reject verdict
--   * each learner's score and the class Mean Percentage Score (MPS) + mastery.
--
--   sms_exam_results          one per exam + section + school year
--   sms_exam_result_students  one per learner; correct_items = item numbers right
--
-- Records carry school_id; scoping is enforced in the app layer. Essays and
-- other non-auto-scorable items are excluded from the analysis (app layer).
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. EXAM RESULTS (one administration of an exam by a section)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_exam_results (
  id BIGSERIAL PRIMARY KEY,
  exam_id BIGINT NOT NULL REFERENCES procurements.sms_exams(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  teacher_id BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  date_administered DATE,
  total_items INTEGER NOT NULL DEFAULT 0,  -- auto-scorable item count (snapshot)
  mps NUMERIC(5,2),                        -- computed Mean Percentage Score
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exam_id, section_id, school_year)
);

COMMENT ON TABLE procurements.sms_exam_results IS
  'One exam administration per section/school-year; MPS + item analysis computed in the app.';

CREATE INDEX IF NOT EXISTS idx_sms_exam_results_exam    ON procurements.sms_exam_results(exam_id);
CREATE INDEX IF NOT EXISTS idx_sms_exam_results_section ON procurements.sms_exam_results(section_id);
CREATE INDEX IF NOT EXISTS idx_sms_exam_results_school  ON procurements.sms_exam_results(school_id);
CREATE INDEX IF NOT EXISTS idx_sms_exam_results_sy      ON procurements.sms_exam_results(school_year);

CREATE TRIGGER update_sms_exam_results_updated_at
  BEFORE UPDATE ON procurements.sms_exam_results
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. EXAM RESULT STUDENTS (one per learner; correct_items = item numbers right)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_exam_result_students (
  id BIGSERIAL PRIMARY KEY,
  result_id BIGINT NOT NULL REFERENCES procurements.sms_exam_results(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  correct_items INTEGER[] NOT NULL DEFAULT '{}',  -- item numbers the learner got correct
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (result_id, student_id)
);

COMMENT ON TABLE procurements.sms_exam_result_students IS
  'Per-learner exam result; correct_items holds the item numbers answered correctly.';

CREATE INDEX IF NOT EXISTS idx_sms_exam_result_students_result
  ON procurements.sms_exam_result_students(result_id);

CREATE TRIGGER update_sms_exam_result_students_updated_at
  BEFORE UPDATE ON procurements.sms_exam_result_students
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 3. RLS + GRANTS (permissive; scoping enforced in the app layer)
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_exam_results         ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_exam_result_students ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sms_exam_results', 'sms_exam_result_students'
  ] LOOP
    EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
  END LOOP;
END $$;

-- <<< END 101_item_analysis.sql

-- ============================================================================
-- >>> BEGIN 102_aral_tutors.sql
-- ============================================================================

-- ============================================================================
-- ARAL — Tutors
--
-- Adds a lightweight "tutor" login role for the ARAL intervention program.
-- A tutor is an sms_users row (type = 'tutor') created from the ARAL > Tutors
-- page; they sign in via the same Google email match as all staff, and see only
-- the learners assigned to them. Assignment happens on two levels:
--   * sms_aral_tutors      — the tutor's assigned program + section (metadata)
--   * sms_aral_enrollments.tutor_id — the specific learners handed to the tutor
--
-- Scoping is enforced in the app layer (RLS is `authenticated`), matching the
-- ARAL enrollment table and the assessment modules.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. Allow the 'tutor' user type
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_users DROP CONSTRAINT IF EXISTS sms_users_type_check;
ALTER TABLE procurements.sms_users ADD CONSTRAINT sms_users_type_check
  CHECK (type IN (
    'school_head', 'assistant_school_head', 'teacher', 'registrar',
    'admin', 'super admin', 'division_admin', 'division_type',
    'librarian', 'tutor'
  ));

-- ----------------------------------------------------------------------------
-- 2. Per-learner tutor assignment on the ARAL roster
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_aral_enrollments
  ADD COLUMN IF NOT EXISTS tutor_id BIGINT
  REFERENCES procurements.sms_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sms_aral_enrollments_tutor
  ON procurements.sms_aral_enrollments(tutor_id);

-- ----------------------------------------------------------------------------
-- 3. Tutor assignment metadata (tutor -> program + grade level)
-- ----------------------------------------------------------------------------
-- Dropped-and-recreated so this migration re-runs cleanly even if an earlier
-- draft created the table with a different shape (e.g. a section_id column).
-- This table is new in 102 and holds no critical data, so a rebuild is safe.
DROP TABLE IF EXISTS procurements.sms_aral_tutors CASCADE;

CREATE TABLE IF NOT EXISTS procurements.sms_aral_tutors (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES procurements.sms_users(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  program TEXT NOT NULL CHECK (program IN ('reading', 'mathematics', 'science', 'summer')),
  grade_level INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, program, grade_level)
);

COMMENT ON TABLE procurements.sms_aral_tutors IS
  'ARAL tutor assignments; links a tutor (sms_users) to a program and grade level.';

CREATE INDEX IF NOT EXISTS idx_sms_aral_tutors_scope
  ON procurements.sms_aral_tutors(school_id, program, grade_level);
CREATE INDEX IF NOT EXISTS idx_sms_aral_tutors_user
  ON procurements.sms_aral_tutors(user_id);

CREATE TRIGGER update_sms_aral_tutors_updated_at
  BEFORE UPDATE ON procurements.sms_aral_tutors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- RLS + GRANTS (scoping enforced in the app layer)
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_aral_tutors ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sms_aral_tutors'] LOOP
    EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
  END LOOP;
END $$;

-- <<< END 102_aral_tutors.sql

-- ============================================================================
-- >>> BEGIN 103_evaluation_school_head_target.sql
-- ============================================================================

-- ============================================================================
-- Add student_to_principal evaluation type + explicit school head target
-- ============================================================================
-- "Teacher to School Head" (teacher_to_principal) and the new
-- "Student to School Head" (student_to_principal) evaluations now target a
-- specific school head / assistant school head, stored on the evaluation via
-- evaluatee_id (references procurements.sms_users.id).

SET search_path TO procurements, public;

-- Allow the new student_to_principal type
ALTER TABLE procurements.sms_evaluations
  DROP CONSTRAINT IF EXISTS sms_evaluations_type_check;

ALTER TABLE procurements.sms_evaluations
  ADD CONSTRAINT sms_evaluations_type_check
  CHECK (type IN (
    'student_to_teacher',
    'teacher_to_principal',
    'principal_to_teacher',
    'student_to_principal'
  ));

-- Specific school head being evaluated (for *_to_principal types)
ALTER TABLE procurements.sms_evaluations
  ADD COLUMN IF NOT EXISTS evaluatee_id BIGINT;

COMMENT ON COLUMN procurements.sms_evaluations.evaluatee_id IS
  'For teacher_to_principal / student_to_principal: the specific school head or assistant school head being evaluated (sms_users.id)';

-- respondent_type already permits student/teacher/principal (migration 060),
-- which covers student_to_principal (respondent = student).

COMMENT ON TABLE procurements.sms_evaluations IS
  'Evaluation questionnaires — student-to-teacher, teacher-to-principal, principal-to-teacher, or student-to-principal';

-- <<< END 103_evaluation_school_head_target.sql

-- ============================================================================
-- >>> BEGIN 104_aral_tutor_attendance_progress.sql
-- ============================================================================

-- ============================================================================
-- ARAL — Tutor Attendance + Individual Progress Tracker
--
-- Two tutor-facing tools layered on top of the ARAL roster (sms_aral_enrollments):
--
--   1. Attendance — a per-session-date grid. The tutor adds session dates as the
--      program runs (sms_aral_attendance_dates) and marks each learner
--      Present / Absent / Late / Excused per date (sms_aral_attendance).
--
--   2. Individual Progress Tracker — mirrors the DepEd "Individual Progress
--      Tracker" sheet: Week 1..8, each week with a DYNAMIC number of session
--      columns the tutor defines (sms_aral_progress_sessions, each with a topic
--      label). Per learner per session the tutor records a Phil-IRI reading
--      level (IDL / ISL / FL) plus an optional note (sms_aral_progress_marks).
--
-- Session/date columns are scoped to the TUTOR + school_year (a tutor's whole
-- roster shares one column set), matching the "My Learners" page which lists all
-- of a tutor's learners together. Marks reference the ARAL enrollment so they
-- follow the learner. Scoping is enforced in the app layer (RLS = authenticated),
-- matching sms_aral_enrollments and the assessment modules.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. ATTENDANCE — session dates (column definitions)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_aral_attendance_dates (
  id BIGSERIAL PRIMARY KEY,
  tutor_id BIGINT NOT NULL REFERENCES procurements.sms_users(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  session_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tutor_id, school_year, session_date)
);

COMMENT ON TABLE procurements.sms_aral_attendance_dates IS
  'ARAL tutor attendance session dates; one column per date, scoped to tutor + school year.';

CREATE INDEX IF NOT EXISTS idx_sms_aral_attendance_dates_scope
  ON procurements.sms_aral_attendance_dates(tutor_id, school_year);

CREATE TRIGGER update_sms_aral_attendance_dates_updated_at
  BEFORE UPDATE ON procurements.sms_aral_attendance_dates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. ATTENDANCE — per learner per date
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_aral_attendance (
  id BIGSERIAL PRIMARY KEY,
  date_id BIGINT NOT NULL REFERENCES procurements.sms_aral_attendance_dates(id) ON DELETE CASCADE,
  enrollment_id BIGINT NOT NULL REFERENCES procurements.sms_aral_enrollments(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (date_id, enrollment_id)
);

COMMENT ON TABLE procurements.sms_aral_attendance IS
  'ARAL tutor attendance marks; one row per learner per session date.';

CREATE INDEX IF NOT EXISTS idx_sms_aral_attendance_date
  ON procurements.sms_aral_attendance(date_id);
CREATE INDEX IF NOT EXISTS idx_sms_aral_attendance_enrollment
  ON procurements.sms_aral_attendance(enrollment_id);

CREATE TRIGGER update_sms_aral_attendance_updated_at
  BEFORE UPDATE ON procurements.sms_aral_attendance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 3. PROGRESS TRACKER — session columns (dynamic per week)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_aral_progress_sessions (
  id BIGSERIAL PRIMARY KEY,
  tutor_id BIGINT NOT NULL REFERENCES procurements.sms_users(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 8),
  session_no INTEGER NOT NULL CHECK (session_no >= 1),
  label TEXT,                                     -- topic/focus, e.g. 'Mm, Ss, Aa, Ii'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tutor_id, school_year, week, session_no)
);

COMMENT ON TABLE procurements.sms_aral_progress_sessions IS
  'ARAL Individual Progress Tracker session columns; dynamic count per week, scoped to tutor + school year.';

CREATE INDEX IF NOT EXISTS idx_sms_aral_progress_sessions_scope
  ON procurements.sms_aral_progress_sessions(tutor_id, school_year, week);

CREATE TRIGGER update_sms_aral_progress_sessions_updated_at
  BEFORE UPDATE ON procurements.sms_aral_progress_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 4. PROGRESS TRACKER — per learner per session mark
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_aral_progress_marks (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES procurements.sms_aral_progress_sessions(id) ON DELETE CASCADE,
  enrollment_id BIGINT NOT NULL REFERENCES procurements.sms_aral_enrollments(id) ON DELETE CASCADE,
  level TEXT CHECK (level IN ('IDL', 'ISL', 'FL')),   -- Phil-IRI: Independent / Instructional / Frustration
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, enrollment_id)
);

COMMENT ON TABLE procurements.sms_aral_progress_marks IS
  'ARAL Individual Progress Tracker marks; one row per learner per session (reading level + note).';

CREATE INDEX IF NOT EXISTS idx_sms_aral_progress_marks_session
  ON procurements.sms_aral_progress_marks(session_id);
CREATE INDEX IF NOT EXISTS idx_sms_aral_progress_marks_enrollment
  ON procurements.sms_aral_progress_marks(enrollment_id);

CREATE TRIGGER update_sms_aral_progress_marks_updated_at
  BEFORE UPDATE ON procurements.sms_aral_progress_marks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- RLS + GRANTS (scoping enforced in the app layer)
-- ----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sms_aral_attendance_dates',
    'sms_aral_attendance',
    'sms_aral_progress_sessions',
    'sms_aral_progress_marks'
  ] LOOP
    EXECUTE format('ALTER TABLE procurements.%1$s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
  END LOOP;
END $$;

-- <<< END 104_aral_tutor_attendance_progress.sql

-- ============================================================================
-- >>> BEGIN 105_anecdotal_and_cardex.sql
-- ============================================================================

-- ============================================================================
-- Anecdotal Record + Learner Cardex — class-adviser tools
--
-- Three per-learner dated-entry logs kept by class advisers, modeled on the
-- ARAL tutor tools (migration 104) but scoped to the adviser's advisory-section
-- learners (sms_enrollments) instead of ARAL enrollments:
--
--   1. Anecdotal Record (sms_anecdotal_records) — dated, objective behavior
--      observations with the adviser's interpretation + action taken.
--
--   2. Learner Cardex, sheet 1 — Needs, Progress & Achievement
--      (sms_cardex_needs): identified need, intervention, progress/achievement.
--
--   3. Learner Cardex, sheet 2 — Parent/Guardian Communication
--      (sms_cardex_communication): mode, person contacted, purpose, outcome.
--
-- Each row references the STUDENT (so the log follows the learner, cumulatively)
-- and records created_by for attribution. Roster + scoping are enforced in the
-- app layer (RLS = authenticated), matching sms_aral_* and the assessment
-- modules. There is no per-row ownership check in Postgres.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. ANECDOTAL RECORD — one row per observation
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_anecdotal_records (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  observation_date DATE NOT NULL,
  setting TEXT,                       -- place/context, e.g. 'Classroom', 'Playground'
  incident TEXT NOT NULL,             -- observed behavior (objective anecdote)
  interpretation TEXT,                -- adviser's interpretation / analysis
  action_taken TEXT,                  -- recommendation / action taken
  created_by BIGINT REFERENCES procurements.sms_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_anecdotal_records IS
  'Class-adviser anecdotal records; one row per dated behavior observation per learner.';

CREATE INDEX IF NOT EXISTS idx_sms_anecdotal_records_scope
  ON procurements.sms_anecdotal_records(student_id, school_year);

CREATE TRIGGER update_sms_anecdotal_records_updated_at
  BEFORE UPDATE ON procurements.sms_anecdotal_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. CARDEX — Needs, Progress & Achievement
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_cardex_needs (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  entry_date DATE NOT NULL,
  need TEXT NOT NULL,                 -- learner's need / area of concern
  intervention TEXT,                  -- intervention / strategy applied
  progress TEXT,                      -- progress & achievement
  remarks TEXT,
  created_by BIGINT REFERENCES procurements.sms_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_cardex_needs IS
  'Learner Cardex sheet: needs, progress & achievement; one row per dated entry per learner.';

CREATE INDEX IF NOT EXISTS idx_sms_cardex_needs_scope
  ON procurements.sms_cardex_needs(student_id, school_year);

CREATE TRIGGER update_sms_cardex_needs_updated_at
  BEFORE UPDATE ON procurements.sms_cardex_needs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 3. CARDEX — Parent/Guardian Communication
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_cardex_communication (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  communication_date DATE NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN (
    'phone_call', 'text_sms', 'messenger', 'home_visit', 'conference', 'letter', 'other'
  )),
  person_contacted TEXT,             -- parent/guardian name + relationship
  purpose TEXT NOT NULL,             -- purpose / concern discussed
  outcome TEXT,                      -- agreement / action taken
  created_by BIGINT REFERENCES procurements.sms_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_cardex_communication IS
  'Learner Cardex sheet: parent/guardian communication log; one row per dated contact per learner.';

CREATE INDEX IF NOT EXISTS idx_sms_cardex_communication_scope
  ON procurements.sms_cardex_communication(student_id, school_year);

CREATE TRIGGER update_sms_cardex_communication_updated_at
  BEFORE UPDATE ON procurements.sms_cardex_communication
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- RLS + GRANTS (scoping enforced in the app layer)
-- ----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sms_anecdotal_records',
    'sms_cardex_needs',
    'sms_cardex_communication'
  ] LOOP
    EXECUTE format('ALTER TABLE procurements.%1$s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
  END LOOP;
END $$;

-- <<< END 105_anecdotal_and_cardex.sql

-- ============================================================================
-- >>> BEGIN 106_school_authored_assessment_materials.sql
-- ============================================================================

-- ============================================================================
-- School-authored assessment materials (CRLA / Phil-IRI / RMA)
--
-- Until now every assessment material was authored by the division office and
-- shared with all schools. School heads now need to author materials for their
-- OWN school, usable only by that school's teachers.
--
-- Authoring follows the TOS / Exam sharing model (migrations 096, 099):
--   * school_id IS NULL -> DIVISION-authored, usable by ALL schools.
--   * school_id set      -> SCHOOL-authored, usable only by that school.
--
-- Existing rows keep school_id NULL, so every current material stays division-
-- wide. Scoping is enforced in the app layer (matching sms_tos / sms_exams).
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- CRLA materials
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_crla_materials
  ADD COLUMN IF NOT EXISTS school_id BIGINT
  REFERENCES procurements.sms_schools(id) ON DELETE CASCADE;

COMMENT ON COLUMN procurements.sms_crla_materials.school_id IS
  'NULL = division-authored (usable by all schools); set = school-authored (that school only).';

CREATE INDEX IF NOT EXISTS idx_sms_crla_materials_school
  ON procurements.sms_crla_materials(school_id);

-- ----------------------------------------------------------------------------
-- CRLA record forms (Part 2: reading fluency & comprehension)
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_crla_record_forms
  ADD COLUMN IF NOT EXISTS school_id BIGINT
  REFERENCES procurements.sms_schools(id) ON DELETE CASCADE;

COMMENT ON COLUMN procurements.sms_crla_record_forms.school_id IS
  'NULL = division-authored (usable by all schools); set = school-authored (that school only).';

CREATE INDEX IF NOT EXISTS idx_sms_crla_record_forms_school
  ON procurements.sms_crla_record_forms(school_id);

-- ----------------------------------------------------------------------------
-- Phil-IRI materials
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_philiri_materials
  ADD COLUMN IF NOT EXISTS school_id BIGINT
  REFERENCES procurements.sms_schools(id) ON DELETE CASCADE;

COMMENT ON COLUMN procurements.sms_philiri_materials.school_id IS
  'NULL = division-authored (usable by all schools); set = school-authored (that school only).';

CREATE INDEX IF NOT EXISTS idx_sms_philiri_materials_school
  ON procurements.sms_philiri_materials(school_id);

-- ----------------------------------------------------------------------------
-- RMA materials
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_rma_materials
  ADD COLUMN IF NOT EXISTS school_id BIGINT
  REFERENCES procurements.sms_schools(id) ON DELETE CASCADE;

COMMENT ON COLUMN procurements.sms_rma_materials.school_id IS
  'NULL = division-authored (usable by all schools); set = school-authored (that school only).';

CREATE INDEX IF NOT EXISTS idx_sms_rma_materials_school
  ON procurements.sms_rma_materials(school_id);

-- <<< END 106_school_authored_assessment_materials.sql

-- ============================================================================
-- >>> BEGIN 107_grade_encoding_status.sql
-- ============================================================================

-- ============================================================================
-- GRADE ENCODING STATUS
-- ============================================================================
-- Lets school heads see which teachers have encoded grades, for which subjects
-- and sections, and how far along each grading period is.
--
-- Everything here is derived from existing tables — no new state is stored.
-- The aggregation lives in SQL because a school's sms_grades rows (learners x
-- subjects x periods) run well past the client's default row limit.
--
-- `sms_subject_schedules` is the denominator: it is the source of truth for
-- teacher <-> subject <-> section <-> school year. A subject/section with no
-- schedule row cannot be monitored here because nobody is assigned to it.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- get_grade_encoding_status
--   p_periods is 4 for quarter-based school years and 3 for MATATAG terms
--   (SY 2026-2027+); the caller decides via getGradingPeriods().
--
-- SECURITY INVOKER: reads stay subject to the existing RLS policies, so this
-- exposes nothing the caller could not already select.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.get_grade_encoding_status(
  p_school_id   BIGINT,
  p_school_year TEXT,
  p_periods     INTEGER
)
RETURNS TABLE (
  subject_id        BIGINT,
  subject_name      TEXT,
  is_madrasah       BOOLEAN,
  section_id        BIGINT,
  section_name      TEXT,
  grade_level       INTEGER,
  assigned_teachers TEXT[],
  grading_period    INTEGER,
  expected_learners INTEGER,
  encoded_learners  INTEGER,
  encoders          TEXT[],
  last_encoded_at   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO procurements, public
AS $$
  WITH sched AS (
    -- One row per subject+section. Team-taught combinations collapse into a
    -- single row listing every assigned teacher.
    SELECT
      ss.subject_id,
      ss.section_id,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT u.name), NULL) AS assigned_teachers
    FROM procurements.sms_subject_schedules ss
    LEFT JOIN procurements.sms_users u ON u.id = ss.teacher_id
    WHERE ss.school_id = p_school_id
      AND ss.school_year = p_school_year
    GROUP BY ss.subject_id, ss.section_id
  ),
  enrolled AS (
    -- Denominator for regular subjects: everyone holding a section slot.
    SELECT e.section_id, COUNT(DISTINCT e.student_id) AS n
    FROM procurements.sms_enrollments e
    WHERE e.school_year = p_school_year
      AND e.status = 'approved'
      AND e.enrollment_status IN
          ('active', 'promoted', 'graduated', 'retained', 'completed')
    GROUP BY e.section_id
  ),
  madrasah AS (
    -- Denominator for Madrasah (MEP) subjects: only selectively enrolled
    -- learners, mirroring TeacherGradeEntryTable's own split.
    SELECT sub.subject_id, sub.section_id, COUNT(DISTINCT sub.student_id) AS n
    FROM procurements.sms_student_subjects sub
    WHERE sub.school_year = p_school_year
      AND sub.school_id = p_school_id
    GROUP BY sub.subject_id, sub.section_id
  ),
  encoded AS (
    -- `grade > 0` is what counts as encoded, not row existence: the quarter
    -- entry screen writes a 0-filled row for every learner and period on save,
    -- so COUNT(*) would report an untouched section as fully encoded. Valid
    -- DepEd grades never reach 0 (the entry input floors at 60).
    SELECT
      g.subject_id,
      g.section_id,
      g.grading_period,
      COUNT(DISTINCT g.student_id) AS n,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT u.name), NULL) AS encoders,
      MAX(g.updated_at) AS last_encoded_at
    FROM procurements.sms_grades g
    JOIN sched s
      ON s.subject_id = g.subject_id
     AND s.section_id = g.section_id
    LEFT JOIN procurements.sms_users u ON u.id = g.teacher_id
    WHERE g.school_year = p_school_year
      AND g.grade > 0
    GROUP BY g.subject_id, g.section_id, g.grading_period
  )
  SELECT
    s.subject_id,
    subj.name AS subject_name,
    subj.is_madrasah,
    s.section_id,
    sec.name AS section_name,
    sec.grade_level,
    s.assigned_teachers,
    p.period AS grading_period,
    COALESCE(
      CASE WHEN subj.is_madrasah THEN m.n ELSE en.n END, 0
    )::INTEGER AS expected_learners,
    COALESCE(e.n, 0)::INTEGER AS encoded_learners,
    COALESCE(e.encoders, ARRAY[]::TEXT[]) AS encoders,
    e.last_encoded_at
  FROM sched s
  JOIN procurements.sms_subjects subj ON subj.id = s.subject_id
  JOIN procurements.sms_sections sec  ON sec.id = s.section_id
  CROSS JOIN generate_series(1, p_periods) AS p(period)
  LEFT JOIN enrolled en ON en.section_id = s.section_id
  LEFT JOIN madrasah m
    ON m.subject_id = s.subject_id AND m.section_id = s.section_id
  LEFT JOIN encoded e
    ON e.subject_id = s.subject_id
   AND e.section_id = s.section_id
   AND e.grading_period = p.period
  ORDER BY sec.grade_level, sec.name, subj.name, p.period;
$$;

COMMENT ON FUNCTION procurements.get_grade_encoding_status(BIGINT, TEXT, INTEGER) IS
  'Grade encoding progress per subject/section/grading period for one school '
  'and school year. Denominator is sms_subject_schedules; a learner counts as '
  'encoded only when their grade > 0.';

-- Speeds up the encoded CTE, which filters sms_grades by school year and
-- groups by subject/section/period.
CREATE INDEX IF NOT EXISTS idx_grades_sy_subject_section_period
  ON procurements.sms_grades(school_year, subject_id, section_id, grading_period);

GRANT EXECUTE ON FUNCTION
  procurements.get_grade_encoding_status(BIGINT, TEXT, INTEGER) TO authenticated;

-- <<< END 107_grade_encoding_status.sql

-- ============================================================================
-- >>> BEGIN 108_crla_grade3_english_two_task.sql
-- ============================================================================

-- ============================================================================
-- CRLA — GRADE 3 ENGLISH TWO-TASK FORM (20-point total)
--
-- DepEd ships a reduced CRLA form for Grade 3 English ONLY: two tasks, 10
-- points each, with no Task 2L / Task 2H branch. Both tasks are always
-- administered, nothing is auto-awarded, and every learner gets a Part 2
-- Record Form. The Reading Profile is banded off the 0–20 total:
--       0 Full Refresher · 1–10 Moderate · 11–16 Light · 17–20 Grade Ready.
--
-- Migration 091 normalized EVERY CRLA material to the 3-task / 30-point shape,
-- including Grade 3 English. This migration walks that back for that one
-- grade+language combination:
--   1. Task 1 keeps its label/score; Task 2L is relabelled 'Task 2'.
--   2. Task 2H (position 2) is DELETED — its per-learner scores cascade away.
--   3. Bands are replaced with the 20-point set.
--   4. Existing records are re-totalled from the two surviving tasks and
--      re-banded against the new bands.
--
-- NOTE ON DATA: under the 3-task flow the app auto-awarded and persisted
-- Task 2L = 10 whenever Task 1 >= 7. Those synthetic 10s are kept as the
-- learner's Task 2 score (decision: keep rather than blank for re-assessment),
-- so some learners will shift band — e.g. Task1=8 / 2L=10 auto / 2H=5 was 23
-- (Light Refresher) and becomes 18 (Grade Ready). Materials with a task count
-- other than the expected 3 are left alone and reported via RAISE NOTICE.
-- ============================================================================

SET search_path TO procurements, public;

DO $$
DECLARE
  mat          RECORD;
  task_ids     BIGINT[];
  n            INT;
  materials    INT := 0;
  records_hit  INT := 0;
BEGIN
  FOR mat IN
    SELECT id, title
      FROM procurements.sms_crla_materials
     WHERE grade_level = 3
       AND language = 'English'
  LOOP
    SELECT array_agg(id ORDER BY position, id)
      INTO task_ids
      FROM procurements.sms_crla_material_tasks
     WHERE material_id = mat.id;
    n := COALESCE(array_length(task_ids, 1), 0);

    IF n = 2 THEN
      -- Already the 2-task shape (e.g. re-run); just normalize the label.
      UPDATE procurements.sms_crla_material_tasks
         SET label = 'Task 2', task_type = 'words', max_score = 10, position = 1
       WHERE id = task_ids[2];
    ELSIF n = 3 THEN
      UPDATE procurements.sms_crla_material_tasks
         SET label = 'Task 1', task_type = 'letters', max_score = 10, position = 0
       WHERE id = task_ids[1];

      UPDATE procurements.sms_crla_material_tasks
         SET label = 'Task 2', task_type = 'words', max_score = 10, position = 1
       WHERE id = task_ids[2];

      -- Drops Task 2H and cascades sms_crla_record_scores for it.
      DELETE FROM procurements.sms_crla_material_tasks WHERE id = task_ids[3];
    ELSE
      RAISE NOTICE 'CRLA material % (%) has % task(s); expected 3. Left unchanged — fix by hand.',
        mat.id, mat.title, n;
      CONTINUE;
    END IF;

    -- Replace the bands with the 20-point set.
    DELETE FROM procurements.sms_crla_bands WHERE material_id = mat.id;
    INSERT INTO procurements.sms_crla_bands
      (material_id, min_score, max_score, label, position)
    VALUES
      (mat.id,  0,  0, 'Full Refresher',     0),
      (mat.id,  1, 10, 'Moderate Refresher', 1),
      (mat.id, 11, 16, 'Light Refresher',    2),
      (mat.id, 17, 20, 'Grade Ready',        3);

    -- Re-total and re-band every learner record for this material. Records
    -- with no score at all keep a NULL total/profile.
    WITH totals AS (
      SELECT r.id AS record_id,
             SUM(COALESCE(sc.raw_score, 0))    AS total,
             COUNT(sc.raw_score)               AS entered
        FROM procurements.sms_crla_records r
        LEFT JOIN procurements.sms_crla_record_scores sc ON sc.record_id = r.id
       WHERE r.material_id = mat.id
       GROUP BY r.id
    )
    UPDATE procurements.sms_crla_records r
       SET total_score   = CASE WHEN t.entered > 0 THEN t.total END,
           profile_label = CASE
             WHEN t.entered > 0 THEN (
               SELECT b.label
                 FROM procurements.sms_crla_bands b
                WHERE b.material_id = mat.id
                  AND t.total BETWEEN b.min_score AND b.max_score
                ORDER BY b.position
                LIMIT 1
             )
           END
      FROM totals t
     WHERE r.id = t.record_id;

    GET DIAGNOSTICS n = ROW_COUNT;
    records_hit := records_hit + n;
    materials   := materials + 1;
  END LOOP;

  RAISE NOTICE 'CRLA Grade 3 English: % material(s) collapsed to the 2-task form, % learner record(s) re-banded.',
    materials, records_hit;
END $$;

-- <<< END 108_crla_grade3_english_two_task.sql

-- ============================================================================
-- >>> BEGIN 109_fix_division_classroom_needs.sql
-- ============================================================================

-- ============================================================================
-- FIX: division_classroom_needs — enrolled always returned 0
-- ============================================================================
-- Two defects in the version from migration 075:
--
--   1. The enroll CTE filtered on e.status, which is the *approval* status
--      ('pending','approved','rejected' — migration 001). The lifecycle values
--      it tested for ('active','promoted',...) live in e.enrollment_status
--      (migration 038). The filter therefore matched no rows, so every school
--      reported enrolled = 0 and classrooms_needed = 0, which in turn made
--      delta equal the raw classroom count — i.e. a phantom surplus everywhere.
--      (enrollment_autofill in migration 072 already uses enrollment_status.)
--
--   2. Enrollments were attributed to sms_students.school_id (the learner's
--      home-school record) instead of sms_enrollments.school_id (the school
--      they are actually enrolled at for that school year). These diverge for
--      transferees, who are immediately active at the destination school while
--      their student record may still point elsewhere. Counting by
--      e.school_id matches how every other division report scopes enrollment.
--
-- Signature and result columns are unchanged — no frontend change required.
-- Read-only aggregate; no schema or data changes.
-- ============================================================================

SET search_path TO procurements, public;

CREATE OR REPLACE FUNCTION procurements.division_classroom_needs(
  p_school_year TEXT
)
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  school_type TEXT,
  grade_level INT,
  enrolled BIGINT,
  standard_class_size INT,
  classrooms_needed INT,
  classrooms_available BIGINT,
  delta INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  WITH enroll AS (
    SELECT
      e.school_id,
      e.grade_level,
      COUNT(*) AS enrolled
    FROM procurements.sms_enrollments e
    WHERE e.school_year = p_school_year
      AND e.enrollment_status IN
        ('active','promoted','retained','graduated','completed')
    GROUP BY e.school_id, e.grade_level
  ),
  classrooms AS (
    SELECT
      r.school_id,
      COUNT(*) AS classrooms_available
    FROM procurements.sms_rooms r
    WHERE r.is_active AND r.room_type = 'classroom'
    GROUP BY r.school_id
  )
  SELECT
    s.id AS school_id,
    s.name AS school_name,
    s.school_type,
    COALESCE(e.grade_level, 0) AS grade_level,
    COALESCE(e.enrolled, 0) AS enrolled,
    COALESCE(st.max_students, 40) AS standard_class_size,
    CEIL(COALESCE(e.enrolled, 0)::numeric / GREATEST(COALESCE(st.max_students, 40), 1))::int
      AS classrooms_needed,
    COALESCE(c.classrooms_available, 0) AS classrooms_available,
    (COALESCE(c.classrooms_available, 0)::int
      - CEIL(COALESCE(e.enrolled, 0)::numeric / GREATEST(COALESCE(st.max_students, 40), 1))::int
    ) AS delta
  FROM procurements.sms_schools s
  LEFT JOIN enroll e ON e.school_id = s.id
  LEFT JOIN classrooms c ON c.school_id = s.id
  LEFT JOIN procurements.sms_class_size_standards st
    ON st.grade_level = e.grade_level
  WHERE s.is_active
  ORDER BY s.name, grade_level;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_classroom_needs(TEXT) TO authenticated;

COMMENT ON FUNCTION procurements.division_classroom_needs(TEXT) IS
  'Classroom shortage/surplus per (school, grade_level) from live enrollments '
  'vs classrooms vs class size standards. Counts enrollments by '
  'sms_enrollments.school_id and enrollment_status (not status).';

-- <<< END 109_fix_division_classroom_needs.sql

-- ============================================================================
-- >>> BEGIN 110_school_authored_material_uploads.sql
-- ============================================================================

-- ============================================================================
-- Storage: let school heads upload CRLA / Phil-IRI material files
--
-- Migration 106 opened material authoring to schools (nullable school_id), and
-- the school Assessments pages reuse the same AddModal as the division office.
-- But the storage policies from 088 (crla-materials/) and 089 (philiri-
-- materials/) still restrict INSERT/UPDATE/DELETE to division_admin / super
-- admin, so a school head attaching a task file gets
-- "new row violates row-level security policy" on storage.objects.
--
-- Widen the write policies to the roles the sidebar admits to
-- /school/assessments (see AppSidebar `isSchoolHead`). Read stays bucket-wide
-- authenticated per migration 078, so advisers still download materials.
-- ============================================================================

DROP POLICY IF EXISTS "school_management crla insert" ON storage.objects;
DROP POLICY IF EXISTS "school_management crla update" ON storage.objects;
DROP POLICY IF EXISTS "school_management crla delete" ON storage.objects;
DROP POLICY IF EXISTS "school_management philiri insert" ON storage.objects;
DROP POLICY IF EXISTS "school_management philiri update" ON storage.objects;
DROP POLICY IF EXISTS "school_management philiri delete" ON storage.objects;

DO $$
DECLARE
  prefix TEXT;
  label  TEXT;
  roles  TEXT := '''division_admin'', ''super admin'', ''school_head'', ''assistant_school_head''';
BEGIN
  FOREACH prefix IN ARRAY ARRAY['crla-materials', 'philiri-materials'] LOOP
    label := split_part(prefix, '-', 1);

    EXECUTE format(
      'CREATE POLICY "school_management %1$s insert" ON storage.objects
         FOR INSERT TO authenticated
         WITH CHECK (
           bucket_id = ''school-management''
           AND split_part(name, ''/'', 1) = %2$L
           AND EXISTS (
             SELECT 1 FROM procurements.sms_users u
             WHERE u.user_id = auth.uid() AND u.type IN (%3$s)
           )
         )', label, prefix, roles);

    EXECUTE format(
      'CREATE POLICY "school_management %1$s update" ON storage.objects
         FOR UPDATE TO authenticated
         USING (
           bucket_id = ''school-management''
           AND split_part(name, ''/'', 1) = %2$L
           AND EXISTS (
             SELECT 1 FROM procurements.sms_users u
             WHERE u.user_id = auth.uid() AND u.type IN (%3$s)
           )
         )', label, prefix, roles);

    EXECUTE format(
      'CREATE POLICY "school_management %1$s delete" ON storage.objects
         FOR DELETE TO authenticated
         USING (
           bucket_id = ''school-management''
           AND split_part(name, ''/'', 1) = %2$L
           AND EXISTS (
             SELECT 1 FROM procurements.sms_users u
             WHERE u.user_id = auth.uid() AND u.type IN (%3$s)
           )
         )', label, prefix, roles);
  END LOOP;
END $$;

-- <<< END 110_school_authored_material_uploads.sql

-- ============================================================================
-- >>> BEGIN 111_learner_health_bmi_bands.sql
-- ============================================================================

-- ============================================================================
-- LEARNER HEALTH — DepEd BMI-for-Age (wasting) bands
-- ============================================================================
-- sms_learner_health.nutritional_status was created (migration 023) with
--       underweight · normal · overweight · obese
-- but every DepEd instrument that consumes this column — SF8 and the School
-- Report Card, section II — reports the BMI-for-Age *wasting* scale:
--       severely_wasted · wasted · normal · overweight · obese
-- The old set has no 'severely wasted' bucket at all, and 'underweight' is not
-- a band on that scale. This migration replaces the CHECK with the DepEd five.
--
-- NOTE ON DATA: existing 'underweight' rows are mapped to 'wasted' — the same
-- bucket under its DepEd name. This mapping is deliberately NOT split into
-- severely_wasted/wasted: that split needs WHO BMI-for-age z-score cutoffs,
-- which are age- and sex-specific and are not modelled in this system. Height
-- and weight are stored, so a future migration could re-band precisely once
-- those reference tables exist; until then, learners previously recorded as
-- underweight land in 'wasted' and can be re-encoded by the adviser if they
-- belong in 'severely_wasted'. normal/overweight/obese are unaffected.
-- ============================================================================

SET search_path TO procurements, public;

-- Drop first: the old CHECK would reject the re-band UPDATE below.
ALTER TABLE procurements.sms_learner_health
  DROP CONSTRAINT IF EXISTS sms_learner_health_nutritional_status_check;

DO $$
DECLARE
  moved INT;
BEGIN
  UPDATE procurements.sms_learner_health
     SET nutritional_status = 'wasted'
   WHERE nutritional_status = 'underweight';

  GET DIAGNOSTICS moved = ROW_COUNT;
  RAISE NOTICE 'Learner health: % row(s) re-banded from underweight to wasted.', moved;
END $$;

ALTER TABLE procurements.sms_learner_health
  ADD CONSTRAINT sms_learner_health_nutritional_status_check
  CHECK (
    nutritional_status IS NULL
    OR nutritional_status IN (
      'severely_wasted', 'wasted', 'normal', 'overweight', 'obese'
    )
  );

COMMENT ON COLUMN procurements.sms_learner_health.nutritional_status IS
  'DepEd BMI-for-Age band: severely_wasted, wasted, normal, overweight, obese (SF8 / SRC section II).';

COMMENT ON COLUMN procurements.sms_learner_health.height_for_age IS
  'DepEd Height-for-Age band: severely_stunted, stunted, normal, tall (SF8 / SRC section II).';

-- <<< END 111_learner_health_bmi_bands.sql

-- ============================================================================
-- >>> BEGIN 112_school_report_card.sql
-- ============================================================================

-- ============================================================================
-- SCHOOL REPORT CARD (SRC)
-- ============================================================================
-- The annual school-level accountability document a school head publishes to
-- stakeholders and has certified by four signatories. NOT the learner's report
-- card (SF9) — that is lib/pdf/generateReportCard.ts and sms_report_card_*.
--
-- Sixteen sections (I–XVI). Six are derivable from live data, ten are not
-- (professional development, funding, awards, SBM, CFSS, participation, and
-- the toilet/seat facility counts, which the system does not model).
--
-- DESIGN — every section is user-inputtable; autofill is a convenience:
--   * The SRC is signed and published. If a section were recomputed at render
--     time, a grade edited in a later school year would silently alter a
--     document already certified. So content is SNAPSHOT into this table at
--     entry time and never re-derived. src_autofill() only PREFILLS a draft.
--   * School heads reconcile SRC figures against official BOSY/EOSY snapshots,
--     which routinely disagree with live operational data. They must be able
--     to override every derived number.
--   * Back-filling past school years works even where live data is absent.
-- This mirrors the sms_division_report_submissions module (migration 072):
--   header + draft/submitted/locked + *_autofill RPC.
--
-- STORAGE — hybrid, deliberately:
--   * sms_src_submissions holds the scalar indicators as TYPED COLUMNS, so the
--     division can compare SBM level / dropout rate / ratios ACROSS schools.
--   * sms_src_sections holds each section's tabular body + narrative as JSONB,
--     typed in TypeScript as a map on section_key (types/index.ts). These are
--     display-only and their shape follows the DepEd template, which changes;
--     JSONB keeps template revisions from being a migration every time.
--
-- DERIVED, NOT STORED: the SBM level ('2.20' -> Level II, Maturing) is banded
-- in the app layer from sbm_rating, the same way CRLA reading profiles are
-- (DO 83 s. 2012: 0.50–1.49 Level I, 1.50–2.49 Level II, 2.50–3.00 Level III).
-- The CFSS interpretation ('33' -> Outstanding) is deliberately NOT derived:
-- the official point thresholds are not known to this codebase, and inventing
-- bands would put a fabricated DepEd standard on a signed document. It is
-- stored as typed-in text alongside the points.
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- 1. sms_src_submissions (header)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_src_submissions (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'locked')),

  -- Governance indicators (SRC sections X, XI) — typed for division roll-up.
  -- SBM is scored 0.00–3.00; the Level (I/II/III) is derived, not stored.
  sbm_rating NUMERIC(4, 2) CHECK (sbm_rating >= 0 AND sbm_rating <= 3),
  cfss_points INT CHECK (cfss_points >= 0),
  cfss_interpretation TEXT,

  -- Finance (section V). MOOE is the headline figure; the partner and
  -- stakeholder-contribution tables live in the section payload.
  mooe_amount NUMERIC(14, 2) CHECK (mooe_amount >= 0),

  -- Access/quality headline rates (sections VII, VIII), as percentages.
  dropout_rate NUMERIC(5, 2) CHECK (dropout_rate >= 0 AND dropout_rate <= 100),
  promotion_rate NUMERIC(5, 2) CHECK (promotion_rate >= 0 AND promotion_rate <= 100),

  -- Denominators for the four ratio sections (XIII–XVI). teacher_count and
  -- classroom_count are autofilled; toilet_count and seat_count have no
  -- source in this system and are always typed in.
  teacher_count INT CHECK (teacher_count >= 0),
  classroom_count INT CHECK (classroom_count >= 0),
  toilet_count INT CHECK (toilet_count >= 0),
  seat_count INT CHECK (seat_count >= 0),

  -- [{ role, name, title }] — school head, teacher rep, GPTA president, SSG
  -- president. Only the school head is derivable (sms_school_settings).
  signatories JSONB NOT NULL DEFAULT '[]'::jsonb,

  submitted_at TIMESTAMPTZ,
  submitted_by_user_id BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, school_year)
);

COMMENT ON TABLE procurements.sms_src_submissions IS
  'School Report Card header: one per (school, school_year). Scalar indicators typed for division roll-up; section bodies in sms_src_sections.';

CREATE INDEX IF NOT EXISTS idx_src_submissions_school_year
  ON procurements.sms_src_submissions (school_year);
CREATE INDEX IF NOT EXISTS idx_src_submissions_school
  ON procurements.sms_src_submissions (school_id);

DROP TRIGGER IF EXISTS update_sms_src_submissions_updated_at
  ON procurements.sms_src_submissions;
CREATE TRIGGER update_sms_src_submissions_updated_at
  BEFORE UPDATE ON procurements.sms_src_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 2. sms_src_sections (body — one row per SRC section)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_src_sections (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL
    REFERENCES procurements.sms_src_submissions(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL CHECK (section_key IN (
    'enrollment',                 -- I
    'health',                     -- II
    'materials',                  -- III
    'professional_development',   -- IV
    'funding',                    -- V
    'awards',                     -- VI
    'dropouts',                   -- VII
    'promotion',                  -- VIII
    'academic_performance',       -- IX
    'sbm',                        -- X
    'cfss',                       -- XI
    'stakeholder_participation',  -- XII
    'learner_teacher',            -- XIII
    'learner_classroom',          -- XIV
    'learner_toilet',             -- XV
    'learner_seat'                -- XVI
  )),
  -- Every section carries an analysis paragraph in the DepEd template,
  -- including the autofilled ones ("From 2019, the number of enrollees...").
  narrative TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (submission_id, section_key)
);

COMMENT ON COLUMN procurements.sms_src_sections.payload IS
  'Section body. Shape varies by section_key; typed in TS as SrcSectionPayloadMap (types/index.ts).';

CREATE INDEX IF NOT EXISTS idx_src_sections_submission
  ON procurements.sms_src_sections (submission_id);

DROP TRIGGER IF EXISTS update_sms_src_sections_updated_at
  ON procurements.sms_src_sections;
CREATE TRIGGER update_sms_src_sections_updated_at
  BEFORE UPDATE ON procurements.sms_src_sections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 3. RLS
-- ============================================================================
-- Readable by any authenticated user (the SRC is a published document).
-- Writable by the owning school's staff while not locked; division admins
-- always. Mirrors can_write_submission from migration 072/095.
-- ============================================================================
ALTER TABLE procurements.sms_src_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_src_sections ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION procurements.can_write_src(p_submission_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM procurements.sms_src_submissions s
    JOIN procurements.sms_users u ON u.user_id = auth.uid()
    WHERE s.id = p_submission_id
      AND u.is_active
      AND (
        u.type IN ('division_admin', 'division_type')
        OR (
          u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar')
          AND u.school_id = s.school_id
          AND s.status <> 'locked'
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION procurements.can_write_src(BIGINT) TO authenticated;

DROP POLICY IF EXISTS "src_submissions_select" ON procurements.sms_src_submissions;
CREATE POLICY "src_submissions_select"
  ON procurements.sms_src_submissions FOR SELECT
  USING (auth.role() = 'authenticated');

-- INSERT cannot call can_write_src (no row id yet): gate on the target school.
DROP POLICY IF EXISTS "src_submissions_insert" ON procurements.sms_src_submissions;
CREATE POLICY "src_submissions_insert"
  ON procurements.sms_src_submissions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND (
          u.type IN ('division_admin', 'division_type')
          OR (
            u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar')
            AND u.school_id = sms_src_submissions.school_id
          )
        )
    )
  );

DROP POLICY IF EXISTS "src_submissions_update" ON procurements.sms_src_submissions;
CREATE POLICY "src_submissions_update"
  ON procurements.sms_src_submissions FOR UPDATE
  USING (procurements.can_write_src(id))
  WITH CHECK (procurements.can_write_src(id));

-- Only division admins may delete a published SRC.
DROP POLICY IF EXISTS "src_submissions_delete" ON procurements.sms_src_submissions;
CREATE POLICY "src_submissions_delete"
  ON procurements.sms_src_submissions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND u.type IN ('division_admin', 'division_type')
    )
  );

DROP POLICY IF EXISTS "src_sections_select" ON procurements.sms_src_sections;
CREATE POLICY "src_sections_select"
  ON procurements.sms_src_sections FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "src_sections_write" ON procurements.sms_src_sections;
CREATE POLICY "src_sections_write"
  ON procurements.sms_src_sections FOR ALL
  USING (procurements.can_write_src(submission_id))
  WITH CHECK (procurements.can_write_src(submission_id));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON procurements.sms_src_submissions TO authenticated;
GRANT USAGE, SELECT
  ON SEQUENCE procurements.sms_src_submissions_id_seq TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON procurements.sms_src_sections TO authenticated;
GRANT USAGE, SELECT
  ON SEQUENCE procurements.sms_src_sections_id_seq TO authenticated;

-- ============================================================================
-- 4. RPC: src_autofill
-- ============================================================================
-- Returns live figures for the six derivable sections as one JSONB document,
-- shaped to match the section payloads. PREFILL ONLY — the caller writes these
-- into a draft, where they can be edited. Nothing here is authoritative.
--
-- Scoping follows migration 109: enrollment counts come from
-- sms_enrollments.school_id (where the learner actually is that year), never
-- sms_students.school_id, which diverges for transferees. Lifecycle filters
-- use enrollment_status, not status (which is the approval flag).
--
-- NOT autofilled, and why:
--   * materials / PD / funding / awards / SBM / CFSS / participation — no
--     source tables; typed in by the school head.
--   * toilet_count / seat_count — sms_rooms models neither. sms_rooms.capacity
--     is a room's seating capacity, which is a proxy for seat INVENTORY, not
--     the same thing; deliberately not passed off as the real count.
--   * semester on academic_performance — sms_grades and sms_sections carry no
--     semester column, so SHS 1st/2nd-sem subject splits come back NULL and
--     are set by hand. Immaterial for elementary/JHS schools.
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.src_autofill(
  p_school_id BIGINT,
  p_school_year TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_enrollment      JSONB;
  v_health          JSONB;
  v_performance     JSONB;
  v_teacher_count   INT;
  v_classroom_count INT;
  v_total_enrolled  INT;
  v_dropped         INT;
  v_promoted        INT;
  v_dropout_rate    NUMERIC(5, 2);
  v_promotion_rate  NUMERIC(5, 2);
  v_lt_rows         JSONB;
  v_lc_rows         JSONB;
BEGIN
  -- Section I — enrollment by grade level, semester and sex.
  SELECT COALESCE(jsonb_agg(r ORDER BY r.grade_level, r.semester NULLS FIRST), '[]'::jsonb)
    INTO v_enrollment
    FROM (
      SELECT
        p_school_year                                       AS school_year,
        e.grade_level                                       AS grade_level,
        e.semester                                          AS semester,
        COUNT(*) FILTER (WHERE st.gender = 'male')::int     AS male,
        COUNT(*) FILTER (WHERE st.gender = 'female')::int   AS female
      FROM procurements.sms_enrollments e
      JOIN procurements.sms_students st ON st.id = e.student_id
      WHERE e.school_id = p_school_id
        AND e.school_year = p_school_year
        AND e.enrollment_status IN
          ('active', 'completed', 'promoted', 'retained', 'graduated')
      GROUP BY e.grade_level, e.semester
    ) r;

  -- Section II — BMI-for-age and height-for-age bands by grade level and sex.
  -- Scoped through the section the measurement was taken in (sms_learner_health
  -- has no school_id); that section is at the school the learner attends.
  SELECT COALESCE(jsonb_agg(r ORDER BY r.band_type, r.grade_level, r.sex), '[]'::jsonb)
    INTO v_health
    FROM (
      SELECT
        sec.grade_level        AS grade_level,
        st.gender              AS sex,
        'bmi'                  AS band_type,
        lh.nutritional_status  AS band,
        COUNT(*)::int          AS count
      FROM procurements.sms_learner_health lh
      JOIN procurements.sms_sections sec ON sec.id = lh.section_id
      JOIN procurements.sms_students st  ON st.id = lh.student_id
      WHERE sec.school_id = p_school_id
        AND lh.school_year = p_school_year
        AND lh.nutritional_status IS NOT NULL
      GROUP BY sec.grade_level, st.gender, lh.nutritional_status

      UNION ALL

      SELECT
        sec.grade_level     AS grade_level,
        st.gender           AS sex,
        'hfa'               AS band_type,
        lh.height_for_age   AS band,
        COUNT(*)::int       AS count
      FROM procurements.sms_learner_health lh
      JOIN procurements.sms_sections sec ON sec.id = lh.section_id
      JOIN procurements.sms_students st  ON st.id = lh.student_id
      WHERE sec.school_id = p_school_id
        AND lh.school_year = p_school_year
        AND lh.height_for_age IS NOT NULL
      GROUP BY sec.grade_level, st.gender, lh.height_for_age
    ) r;

  -- Section IX — general average per learning area, across grading periods.
  SELECT COALESCE(jsonb_agg(r ORDER BY r.grade_level, r.subject), '[]'::jsonb)
    INTO v_performance
    FROM (
      SELECT
        sec.grade_level                        AS grade_level,
        NULL::int                              AS semester,
        sub.name                               AS subject,
        ROUND(AVG(g.grade), 2)                 AS general_average
      FROM procurements.sms_grades g
      JOIN procurements.sms_sections sec ON sec.id = g.section_id
      JOIN procurements.sms_subjects sub ON sub.id = g.subject_id
      WHERE sec.school_id = p_school_id
        AND g.school_year = p_school_year
      GROUP BY sec.grade_level, sub.name
    ) r;

  -- Sections VII & VIII — dropout and promotion rates over BOSY enrollment.
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE e.enrollment_status = 'dropped')::int,
    COUNT(*) FILTER (WHERE e.enrollment_status IN ('promoted', 'graduated'))::int
  INTO v_total_enrolled, v_dropped, v_promoted
  FROM procurements.sms_enrollments e
  WHERE e.school_id = p_school_id
    AND e.school_year = p_school_year
    AND e.enrollment_status IN
      ('active', 'completed', 'promoted', 'retained', 'graduated', 'dropped');

  IF v_total_enrolled > 0 THEN
    v_dropout_rate   := ROUND((v_dropped::numeric  / v_total_enrolled) * 100, 2);
    v_promotion_rate := ROUND((v_promoted::numeric / v_total_enrolled) * 100, 2);
  END IF;

  -- Sections XIII & XIV — ratio denominators.
  -- Teachers are counted by type, not staff_category_code: the latter (added
  -- in migration 071 for the non-teaching breakdown) is NULL on rows predating
  -- it, so counting by it would undercount.
  SELECT COUNT(*)::int
    INTO v_teacher_count
    FROM procurements.sms_users u
   WHERE u.school_id = p_school_id
     AND u.is_active
     AND u.type = 'teacher';

  SELECT COUNT(*)::int
    INTO v_classroom_count
    FROM procurements.sms_rooms r
   WHERE r.school_id = p_school_id
     AND r.is_active
     AND r.room_type = 'classroom';

  -- Per-grade learner counts drive the ratio tables; units are school-wide.
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'grade_level', t.grade_level,
             'learners',    t.learners,
             'units',       v_teacher_count
           ) ORDER BY t.grade_level), '[]'::jsonb)
    INTO v_lt_rows
    FROM (
      SELECT e.grade_level, COUNT(*)::int AS learners
        FROM procurements.sms_enrollments e
       WHERE e.school_id = p_school_id
         AND e.school_year = p_school_year
         AND e.enrollment_status IN
           ('active', 'completed', 'promoted', 'retained', 'graduated')
       GROUP BY e.grade_level
    ) t;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'grade_level', t.grade_level,
             'learners',    t.learners,
             'units',       v_classroom_count
           ) ORDER BY t.grade_level), '[]'::jsonb)
    INTO v_lc_rows
    FROM (
      SELECT e.grade_level, COUNT(*)::int AS learners
        FROM procurements.sms_enrollments e
       WHERE e.school_id = p_school_id
         AND e.school_year = p_school_year
         AND e.enrollment_status IN
           ('active', 'completed', 'promoted', 'retained', 'graduated')
       GROUP BY e.grade_level
    ) t;

  RETURN jsonb_build_object(
    'enrollment',           jsonb_build_object('rows', v_enrollment),
    'health',               jsonb_build_object('rows', v_health),
    'academic_performance', jsonb_build_object('rows', v_performance),
    'dropouts', jsonb_build_object(
      'rows', jsonb_build_array(jsonb_build_object(
        'school_year', p_school_year,
        'frequency',   v_dropped,
        'percentage',  v_dropout_rate
      )),
      'causes', '[]'::jsonb
    ),
    'promotion', jsonb_build_object(
      'rows', jsonb_build_array(jsonb_build_object(
        'school_year', p_school_year,
        'frequency',   v_promoted,
        'percentage',  v_promotion_rate
      ))
    ),
    'learner_teacher',   jsonb_build_object('rows', v_lt_rows),
    'learner_classroom', jsonb_build_object('rows', v_lc_rows),
    'indicators', jsonb_build_object(
      'teacher_count',   v_teacher_count,
      'classroom_count', v_classroom_count,
      'dropout_rate',    v_dropout_rate,
      'promotion_rate',  v_promotion_rate
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.src_autofill(BIGINT, TEXT) TO authenticated;

-- <<< END 112_school_report_card.sql

-- ============================================================================
-- >>> BEGIN 113_fix_src_superadmin_access.sql
-- ============================================================================

-- ============================================================================
-- FIX: /reports/school-report-card fails with 403 for super admins.
-- ============================================================================
-- Migration 112 gated SRC writes on two branches:
--   (a) division_admin / division_type          -> full access
--   (b) school_head / assistant_school_head / admin / registrar, school-matched
--
-- A "super admin" is in neither list. The page SELECTs the draft (permitted:
-- the select policy admits any authenticated user), finds none, then INSERTs a
-- blank draft -> RLS rejects the INSERT -> PostgREST returns 403.
--
-- Super admin belongs in branch (a), not (b): on login AuthGuard.tsx replaces a
-- super admin's school_id with their persisted ACTIVE SCHOOL OVERRIDE, so the
-- school they are acting for routinely differs from their sms_users.school_id.
-- A school-matched branch would keep failing whenever the override is in play.
-- This is the same fix 094 applied to landing-hero uploads, and matches how
-- 088/089 treat ('division_admin', 'super admin') as full-access authors.
--
-- NOT widened to 'librarian': the SRC is a school head accountability document
-- that a librarian has no reason to author. AppSidebar showed them the link
-- (hasSchoolManagementAccess includes librarian) — the link is what was wrong,
-- and it is removed in the same change as this migration.
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.can_write_src(p_submission_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM procurements.sms_src_submissions s
    JOIN procurements.sms_users u ON u.user_id = auth.uid()
    WHERE s.id = p_submission_id
      AND u.is_active
      AND (
        u.type IN ('division_admin', 'division_type', 'super admin')
        OR (
          u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar')
          AND u.school_id = s.school_id
          AND s.status <> 'locked'
        )
      )
  );
$$;

-- INSERT cannot call can_write_src (no row id yet): gate on the target school.
DROP POLICY IF EXISTS "src_submissions_insert" ON procurements.sms_src_submissions;
CREATE POLICY "src_submissions_insert"
  ON procurements.sms_src_submissions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND (
          u.type IN ('division_admin', 'division_type', 'super admin')
          OR (
            u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar')
            AND u.school_id = sms_src_submissions.school_id
          )
        )
    )
  );

-- Only division admins and super admins may delete a published SRC.
DROP POLICY IF EXISTS "src_submissions_delete" ON procurements.sms_src_submissions;
CREATE POLICY "src_submissions_delete"
  ON procurements.sms_src_submissions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND u.type IN ('division_admin', 'division_type', 'super admin')
    )
  );

-- <<< END 113_fix_src_superadmin_access.sql

-- ============================================================================
-- >>> BEGIN 114_student_ethnicity_and_4ps.sql
-- ============================================================================

-- ============================================================================
-- 114: Learner profile — ethnicity + 4Ps recipient
-- ============================================================================
-- DepEd SF1 captures whether a learner's household is a 4Ps (Pantawid
-- Pamilyang Pilipino Program) beneficiary, and the learner's ethnicity.
--
-- `ethnicity` is intentionally SEPARATE from the existing `ip_ethnic_group`:
-- that column is the Indigenous Peoples group (blank for non-IP learners),
-- while `ethnicity` applies to every learner.
-- ============================================================================

ALTER TABLE procurements.sms_students
  ADD COLUMN IF NOT EXISTS ethnicity TEXT,
  ADD COLUMN IF NOT EXISTS is_4ps BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN procurements.sms_students.ethnicity IS
  'Learner ethnicity (all learners). Distinct from ip_ethnic_group, which is the Indigenous Peoples group.';

COMMENT ON COLUMN procurements.sms_students.is_4ps IS
  '4Ps (Pantawid Pamilyang Pilipino Program) recipient. Defaults to FALSE for existing rows.';

-- <<< END 114_student_ethnicity_and_4ps.sql

-- ============================================================================
-- >>> BEGIN 115_fix_subjects_superadmin_access.sql
-- ============================================================================

-- ============================================================================
-- FIX: /subjects fails with "new row violates row-level security policy for
--      table sms_subjects" for super admins.
-- ============================================================================
-- Migration 037 wrote the sms_subjects / sms_subject_schedules write policies
-- with two branches, and 095 recreated them to add 'assistant_school_head':
--   (a) division_admin                                  -> any school
--   (b) school_head / assistant_school_head / admin /
--       registrar, school-matched (u.school_id = school_id)
--
-- 'super admin' is in neither list, so every INSERT/UPDATE/DELETE it attempts
-- is rejected. The SELECT policies have the same hole in a quieter form: a
-- super admin only sees rows whose school_id equals their sms_users.school_id.
--
-- Super admin belongs in branch (a), not (b): AuthGuard.tsx (line 56) replaces
-- a super admin's school_id with their persisted ACTIVE SCHOOL OVERRIDE, so the
-- school they are acting for routinely differs from sms_users.school_id — a
-- school-matched branch would keep failing whenever the override is in play.
-- This is the same fix 113 applied to the School Report Card and 094 applied to
-- landing-hero uploads, and matches how 088/089 treat ('division_admin',
-- 'super admin') as full-access authors.
--
-- SECURITY FIX, found while testing the above: in 037/095 the school match was
-- written as an UNQUALIFIED `u.school_id = school_id` inside a subquery over
-- sms_users. Postgres resolves an unqualified name to the innermost scope, so
-- `school_id` bound to sms_users.school_id, not to the row being written —
-- pg_get_expr reports the live policy as `(u.school_id = u.school_id)`, which
-- is always true. School isolation on these two tables has therefore been a
-- no-op since 037: any school_head/admin/registrar could insert, update, or
-- delete ANOTHER school's subjects and schedules. Qualifying the outer table
-- (as 113 does) restores it. Expect this to start rejecting cross-school writes
-- that previously succeeded; that is the intended behaviour per invariant 1.
--
-- The bug concealed itself: `u.school_id = u.school_id` is bigint = bigint and
-- so type-checks fine. No casts are involved anywhere here — 013 converted
-- sms_users.school_id from TEXT to BIGINT and added sms_subjects.school_id as
-- BIGINT, and 016 added sms_subject_schedules.school_id as BIGINT, so all three
-- sides of every comparison below are BIGINT. (Invariant 11's ::TEXT cast is
-- for sms_school_settings.school_id, which is not touched here — adding it to
-- these policies raises "operator does not exist: text = bigint" at CREATE
-- POLICY time, since policy expressions are type-checked on creation.)
--
-- NOT widened to 'librarian' or 'teacher': neither authors subjects. Teachers
-- read subjects through the existing SELECT policy, which is unchanged for them.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. sms_subjects
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Subjects are viewable by school members" ON procurements.sms_subjects;
CREATE POLICY "Subjects are viewable by school members"
  ON procurements.sms_subjects FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      school_id IS NULL
      OR school_id IN (
        SELECT u.school_id FROM procurements.sms_users u WHERE u.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM procurements.sms_users u
        WHERE u.user_id = auth.uid()
          AND u.type IN ('division_admin', 'super admin')
      )
    )
  );

DROP POLICY IF EXISTS "Subjects are insertable by authorized roles" ON procurements.sms_subjects;
CREATE POLICY "Subjects are insertable by authorized roles"
  ON procurements.sms_subjects FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar', 'division_admin', 'super admin')
        AND (u.type IN ('division_admin', 'super admin') OR u.school_id = sms_subjects.school_id)
    )
  );

DROP POLICY IF EXISTS "Subjects are updatable by authorized roles" ON procurements.sms_subjects;
CREATE POLICY "Subjects are updatable by authorized roles"
  ON procurements.sms_subjects FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar', 'division_admin', 'super admin')
        AND (u.type IN ('division_admin', 'super admin') OR u.school_id = sms_subjects.school_id)
    )
  );

DROP POLICY IF EXISTS "Subjects are deletable by authorized roles" ON procurements.sms_subjects;
CREATE POLICY "Subjects are deletable by authorized roles"
  ON procurements.sms_subjects FOR DELETE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'assistant_school_head', 'admin', 'division_admin', 'super admin')
        AND (u.type IN ('division_admin', 'super admin') OR u.school_id = sms_subjects.school_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 2. sms_subject_schedules
-- ----------------------------------------------------------------------------
-- A super admin able to create a subject but not schedule it is a half-fix:
-- deleting a subject cascades its schedules, and the /subjects delete guard
-- counts them, so both tables must admit the same authors.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Subject schedules are viewable by school members" ON procurements.sms_subject_schedules;
CREATE POLICY "Subject schedules are viewable by school members"
  ON procurements.sms_subject_schedules FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      school_id IS NULL
      OR school_id IN (
        SELECT u.school_id FROM procurements.sms_users u WHERE u.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM procurements.sms_users u
        WHERE u.user_id = auth.uid()
          AND u.type IN ('division_admin', 'super admin')
      )
    )
  );

DROP POLICY IF EXISTS "Subject schedules are insertable by authorized roles" ON procurements.sms_subject_schedules;
CREATE POLICY "Subject schedules are insertable by authorized roles"
  ON procurements.sms_subject_schedules FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar', 'division_admin', 'super admin')
        AND (u.type IN ('division_admin', 'super admin') OR u.school_id = sms_subject_schedules.school_id)
    )
  );

DROP POLICY IF EXISTS "Subject schedules are updatable by authorized roles" ON procurements.sms_subject_schedules;
CREATE POLICY "Subject schedules are updatable by authorized roles"
  ON procurements.sms_subject_schedules FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar', 'division_admin', 'super admin')
        AND (u.type IN ('division_admin', 'super admin') OR u.school_id = sms_subject_schedules.school_id)
    )
  );

DROP POLICY IF EXISTS "Subject schedules are deletable by authorized roles" ON procurements.sms_subject_schedules;
CREATE POLICY "Subject schedules are deletable by authorized roles"
  ON procurements.sms_subject_schedules FOR DELETE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'assistant_school_head', 'admin', 'division_admin', 'super admin')
        AND (u.type IN ('division_admin', 'super admin') OR u.school_id = sms_subject_schedules.school_id)
    )
  );

-- <<< END 115_fix_subjects_superadmin_access.sql

-- ============================================================================
-- >>> BEGIN 116_fix_subject_fk_delete_rules.sql
-- ============================================================================

-- ============================================================================
-- FIX: deleting a subject fails with 23503 "Key is still referenced from table
--      sms_subject_schedules", even though every migration declares the FK as
--      ON DELETE CASCADE.
-- ============================================================================
-- 004 created sms_subject_schedules with
--   subject_id BIGINT NOT NULL REFERENCES procurements.sms_subjects(id) ON DELETE CASCADE
-- but wrapped it in CREATE TABLE **IF NOT EXISTS**. The table already existed in
-- this database, so the whole statement was skipped and the pre-existing FK — no
-- delete rule, i.e. NO ACTION — survived. Nothing since has altered it (the only
-- later change is 016, which adds a school_id column), so the declared CASCADE
-- has never actually been in effect. The migration files and the live schema
-- have disagreed here since 004.
--
-- This is why /subjects could not delete anything: with NO ACTION the delete is
-- rejected outright rather than taking the 988 schedule rows with it.
--
-- Every other FK into sms_subjects was declared the same way inside a
-- CREATE TABLE IF NOT EXISTS (001 sms_grades, 034 sms_student_subjects,
-- 070 sms_mps, 080 sms_class_records, 096 sms_tos), so any of them may carry the
-- same drift. Postgres reports only the first constraint that blocks a delete,
-- so fixing them one error at a time would take as many rounds as there are
-- broken constraints. This repairs all of them in one pass.
--
-- Rather than name constraints (names vary when a table was created outside a
-- migration), the block below discovers every single-column FK that references
-- sms_subjects and re-creates any whose delete rule is wrong. It is idempotent:
-- a constraint already carrying the intended rule is left untouched.
--
-- Intended rules:
--   sms_tos.subject_id  -> SET NULL. Per 096 this is an optional link on a
--                          teacher-authored Table of Specification; the TOS (and
--                          its exams/competencies/items) must outlive the
--                          subject, and the column is nullable.
--   everything else     -> CASCADE. These columns are all NOT NULL, so SET NULL
--                          is not available, and the rows are meaningless
--                          without their subject.
--
-- Safe to cascade: nothing references sms_subject_schedules, and its only
-- triggers are updated_at and check_schedule_conflicts_before_insert_update
-- (BEFORE INSERT OR UPDATE — see 004), so neither fires on a cascaded delete.
--
-- NOTE ON sms_section_subjects: this legacy junction table exists in the
-- database but in no migration, and no application code reads or writes it (it
-- is debris alongside sms_section_students, dropped in 051). It is empty, so it
-- cannot be blocking anything today, but it is repaired here too so it cannot
-- start blocking subject deletes if anything ever writes to it. Dropping it
-- outright is the better cleanup and is left as a separate decision.
--
-- This changes DELETE semantics, which is the point: deleting a subject now
-- destroys its schedules, grades, class records, MPS entries and Madrasah
-- subject enrollments. The /subjects UI already gates that behind a super-admin
-- force-delete that requires typing the subject code (see List.tsx), and blocks
-- the delete for every other role in favour of deactivation.
-- ============================================================================

SET search_path TO procurements, public;

DO $$
DECLARE
  fk           RECORD;
  wanted       TEXT;
  wanted_code  "char";
BEGIN
  FOR fk IN
    SELECT c.oid          AS constraint_oid,
           c.conname      AS constraint_name,
           c.confdeltype  AS delete_code,
           tn.nspname     AS table_schema,
           t.relname      AS table_name,
           a.attname      AS column_name
    FROM pg_constraint c
    JOIN pg_class     t  ON t.oid  = c.conrelid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
    JOIN pg_class     r  ON r.oid  = c.confrelid
    JOIN pg_namespace rn ON rn.oid = r.relnamespace
    JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND rn.nspname = 'procurements'
      AND r.relname  = 'sms_subjects'
      AND array_length(c.conkey, 1) = 1
  LOOP
    IF fk.table_name = 'sms_tos' THEN
      wanted := 'SET NULL';
      wanted_code := 'n';
    ELSE
      wanted := 'CASCADE';
      wanted_code := 'c';
    END IF;

    IF fk.delete_code = wanted_code THEN
      RAISE NOTICE 'ok: %.% (%) already ON DELETE %',
        fk.table_schema, fk.table_name, fk.constraint_name, wanted;
      CONTINUE;
    END IF;

    RAISE NOTICE 'repairing: %.% (%) confdeltype % -> ON DELETE %',
      fk.table_schema, fk.table_name, fk.constraint_name, fk.delete_code, wanted;

    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      fk.table_schema, fk.table_name, fk.constraint_name
    );
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) '
      'REFERENCES procurements.sms_subjects(id) ON DELETE %s',
      fk.table_schema, fk.table_name, fk.constraint_name, fk.column_name, wanted
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Verification: every row should read CASCADE, except sms_tos -> SET NULL.
-- ----------------------------------------------------------------------------
SELECT t.relname  AS referencing_table,
       a.attname  AS column_name,
       c.conname  AS constraint_name,
       CASE c.confdeltype
         WHEN 'c' THEN 'CASCADE'
         WHEN 'n' THEN 'SET NULL'
         WHEN 'a' THEN 'NO ACTION'
         WHEN 'r' THEN 'RESTRICT'
         WHEN 'd' THEN 'SET DEFAULT'
       END AS on_delete
FROM pg_constraint c
JOIN pg_class     t  ON t.oid  = c.conrelid
JOIN pg_class     r  ON r.oid  = c.confrelid
JOIN pg_namespace rn ON rn.oid = r.relnamespace
JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
WHERE c.contype = 'f'
  AND rn.nspname = 'procurements'
  AND r.relname  = 'sms_subjects'
ORDER BY t.relname;

-- <<< END 116_fix_subject_fk_delete_rules.sql

-- ============================================================================
-- >>> BEGIN 117_optional_schedule_teacher.sql
-- ============================================================================

-- ============================================================================
-- OPTIONAL TEACHER ON SUBJECT SCHEDULES ("Temporary" schedules)
-- ============================================================================
-- Schools build next year's timetable before teacher assignments are settled.
-- This allows a schedule row to be created with no teacher; the UI badges such
-- rows as "Temporary" (tooltip: "No teacher specified").
--
-- Three things have to change together, because any one of them alone still
-- blocks the insert:
--
--   1. teacher_id NOT NULL  -> nullable.
--
--   2. The BEFORE INSERT OR UPDATE trigger from 004
--      (check_schedule_conflicts_before_insert_update) RAISEs an exception on
--      room / teacher / section double-booking. Conflict handling for a
--      teacher-less row is now split by check:
--
--        room    -> STILL ENFORCED. A room is physically occupied for a given
--                   day and time span whether or not a teacher has been named,
--                   so a Temporary schedule both takes a room claim and is
--                   blocked by one. Enforced in both directions.
--        teacher -> skipped. Nobody to clash with. (This one was already a
--                   no-op, since teacher_id = NULL never matches.)
--        section -> skipped, and existing Temporary rows are ignored by the
--                   section scan. The section's timetable is not settled until
--                   teachers are assigned, so provisional rows are allowed to
--                   overlap there; the "Temporary" badge surfaces them for
--                   cleanup.
--
--   3. The FK teacher_id -> sms_users was declared ON DELETE CASCADE. That was
--      defensible while a schedule could not exist without a teacher. Now that
--      teacher-less schedules are legal, deleting a user must NOT destroy the
--      timetable slot -- it should fall back to Temporary. Changed to SET NULL.
--
-- Per the lesson recorded in 116, the FK is rediscovered from pg_constraint
-- rather than addressed by name: 004 declared it inside a
-- CREATE TABLE IF NOT EXISTS, so the live delete rule may never have matched
-- what the migration file says. The block below is idempotent and repairs
-- whatever is actually there.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. Allow NULL teacher
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_subject_schedules
  ALTER COLUMN teacher_id DROP NOT NULL;

COMMENT ON COLUMN procurements.sms_subject_schedules.teacher_id IS
  'Assigned teacher. NULL = "Temporary" schedule with no teacher yet; such rows bypass conflict detection entirely.';

-- ----------------------------------------------------------------------------
-- 2. Narrow conflict detection for teacher-less schedules to the room check
-- ----------------------------------------------------------------------------
-- The trigger itself is unchanged from 004 and always runs; which checks apply
-- to a Temporary row is decided inside check_schedule_conflicts below.
CREATE OR REPLACE FUNCTION public.check_schedule_conflicts_trigger()
RETURNS TRIGGER AS $$
DECLARE
  conflict_record RECORD;
  conflict_messages TEXT[] := ARRAY[]::TEXT[];
BEGIN
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

-- Room clashes apply to Temporary rows in both directions; teacher and section
-- clashes ignore them on both sides.
CREATE OR REPLACE FUNCTION public.check_schedule_conflicts(
  p_room_id BIGINT,
  p_teacher_id BIGINT,
  p_section_id BIGINT,
  p_days_of_week INTEGER[],
  p_start_time TIME,
  p_end_time TIME,
  p_school_year TEXT,
  p_id BIGINT DEFAULT NULL -- For updates, exclude current record
) RETURNS TABLE(
  conflict_type TEXT,
  conflict_message TEXT
) AS $$
DECLARE
  conflict_count INTEGER;
BEGIN
  -- Check room conflicts. Applies to Temporary rows too: a room is occupied
  -- for that day and time span whether or not a teacher has been named.
  SELECT COUNT(*) INTO conflict_count
  FROM procurements.sms_subject_schedules
  WHERE room_id = p_room_id
    AND school_year = p_school_year
    AND (p_id IS NULL OR id != p_id)
    AND public.days_overlap(days_of_week, p_days_of_week)
    AND public.times_overlap(start_time, end_time, p_start_time, p_end_time);

  IF conflict_count > 0 THEN
    RETURN QUERY SELECT
      'room'::TEXT,
      'Room is already scheduled at this time on one or more selected days'::TEXT;
  END IF;

  -- Teacher and section checks do not apply to a Temporary schedule
  IF p_teacher_id IS NULL THEN
    RETURN;
  END IF;

  -- Check teacher conflicts
  SELECT COUNT(*) INTO conflict_count
  FROM procurements.sms_subject_schedules
  WHERE teacher_id = p_teacher_id
    AND school_year = p_school_year
    AND (p_id IS NULL OR id != p_id)
    AND public.days_overlap(days_of_week, p_days_of_week)
    AND public.times_overlap(start_time, end_time, p_start_time, p_end_time);

  IF conflict_count > 0 THEN
    RETURN QUERY SELECT
      'teacher'::TEXT,
      'Teacher is already scheduled at this time on one or more selected days'::TEXT;
  END IF;

  -- Check section conflicts. Existing Temporary rows are ignored here: the
  -- section timetable is not settled until their teachers are assigned.
  SELECT COUNT(*) INTO conflict_count
  FROM procurements.sms_subject_schedules
  WHERE section_id = p_section_id
    AND school_year = p_school_year
    AND (p_id IS NULL OR id != p_id)
    AND teacher_id IS NOT NULL
    AND public.days_overlap(days_of_week, p_days_of_week)
    AND public.times_overlap(start_time, end_time, p_start_time, p_end_time);

  IF conflict_count > 0 THEN
    RETURN QUERY SELECT
      'section'::TEXT,
      'Section is already scheduled at this time on one or more selected days'::TEXT;
  END IF;

  -- No conflicts found
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 3. teacher_id FK: ON DELETE CASCADE -> SET NULL
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT c.conname  AS constraint_name,
           c.confdeltype AS delete_code,
           tn.nspname AS table_schema,
           t.relname  AS table_name,
           a.attname  AS column_name
    FROM pg_constraint c
    JOIN pg_class     t  ON t.oid  = c.conrelid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
    JOIN pg_class     r  ON r.oid  = c.confrelid
    JOIN pg_namespace rn ON rn.oid = r.relnamespace
    JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND tn.nspname = 'procurements'
      AND t.relname  = 'sms_subject_schedules'
      AND a.attname  = 'teacher_id'
      AND rn.nspname = 'procurements'
      AND r.relname  = 'sms_users'
      AND array_length(c.conkey, 1) = 1
  LOOP
    IF fk.delete_code = 'n' THEN
      RAISE NOTICE 'ok: % already ON DELETE SET NULL', fk.constraint_name;
      CONTINUE;
    END IF;

    RAISE NOTICE 'repairing: % confdeltype % -> ON DELETE SET NULL',
      fk.constraint_name, fk.delete_code;

    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      fk.table_schema, fk.table_name, fk.constraint_name
    );
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) '
      'REFERENCES procurements.sms_users(id) ON DELETE SET NULL',
      fk.table_schema, fk.table_name, fk.constraint_name, fk.column_name
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Verification
-- ----------------------------------------------------------------------------
-- teacher_id should read is_nullable = YES
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'procurements'
  AND table_name   = 'sms_subject_schedules'
  AND column_name  = 'teacher_id';

-- teacher_id FK should read SET NULL
SELECT c.conname AS constraint_name,
       CASE c.confdeltype
         WHEN 'c' THEN 'CASCADE'
         WHEN 'n' THEN 'SET NULL'
         WHEN 'a' THEN 'NO ACTION'
         WHEN 'r' THEN 'RESTRICT'
         WHEN 'd' THEN 'SET DEFAULT'
       END AS on_delete
FROM pg_constraint c
JOIN pg_class     t  ON t.oid  = c.conrelid
JOIN pg_namespace tn ON tn.oid = t.relnamespace
JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
WHERE c.contype = 'f'
  AND tn.nspname = 'procurements'
  AND t.relname  = 'sms_subject_schedules'
  AND a.attname  = 'teacher_id';

-- <<< END 117_optional_schedule_teacher.sql

-- ============================================================================
-- >>> BEGIN 118_key_performance_indicators.sql
-- ============================================================================

-- ============================================================================
-- KEY PERFORMANCE INDICATORS (KPI)
-- ============================================================================
-- Backs the KPI module, which implements the DepEd Memorandum of 12 October
-- 2022, "Guide in Computing Key Performance Indicators" (PS-EMISD, July 2022).
--
-- The memo splits the indicators three ways:
--   * Access     — GER, NER, GIR, NIR, Transition Rate. Every one of these
--                  divides by PSA PROJECTED POPULATION, which is published per
--                  division, not per school. The memo marks all five as NOT
--                  computable at school level for exactly that reason.
--   * Efficiency — Promotion/Graduation, Repetition, School Leaver, Cohort
--                  Survival, Completion, Coefficient of Efficiency, Years Input
--                  per Graduate, Simple Dropout. All derivable from enrollment
--                  in two consecutive school years plus repeaters and EOSY
--                  outcomes, which this system already records.
--   * Ratios     — Teacher/Classroom/Seat/Toilet-bowl-Learner, GPI, IQR.
--
-- WHAT IS STORED HERE vs DERIVED:
--   Everything the system already knows (enrollment, repeaters, promotes,
--   graduates, dropouts, teachers, classrooms) is DERIVED live by the two RPCs
--   below — nothing is snapshot, because a KPI report is a monitoring view, not
--   a signed document like the SRC (migration 112).
--   What the system cannot know is stored in sms_kpi_reference: the PSA
--   projected population, and the seat / toilet-bowl inventory. sms_rooms
--   models neither seats nor toilets (sms_rooms.capacity is a room's seating
--   capacity, a different quantity from seat INVENTORY), so those are typed in.
--
-- SCOPE: both RPCs take p_school_id, and a NULL means "every school" — the
-- division-wide roll-up. That is deliberate: the access and efficiency
-- indicators are division-level statistics in the memo, and the IQR is only
-- meaningful across schools (the memo requires at least eight).
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- 1. sms_kpi_reference — the figures the system cannot derive
-- ============================================================================
-- One row per (school, school_year). school_id NULL = the division-wide row,
-- following migration 106's convention for division- vs school-owned data.
-- Population bands mirror the memo's official school ages (RA 10533, K-6-4-2):
-- Kinder = age 5, elementary = 6-11, JHS = 12-15, SHS = 16-17.
CREATE TABLE IF NOT EXISTS procurements.sms_kpi_reference (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,

  -- PSA projected population per official school-age band. Every access
  -- indicator denominator the memo names has a column here and no other.
  population_age_5       INT CHECK (population_age_5 >= 0),
  population_age_6       INT CHECK (population_age_6 >= 0),
  population_ages_6_11   INT CHECK (population_ages_6_11 >= 0),
  population_ages_5_11   INT CHECK (population_ages_5_11 >= 0),
  population_ages_12_15  INT CHECK (population_ages_12_15 >= 0),
  population_ages_16_17  INT CHECK (population_ages_16_17 >= 0),
  population_ages_12_17  INT CHECK (population_ages_12_17 >= 0),
  population_ages_5_17   INT CHECK (population_ages_5_17 >= 0),

  -- Seat inventory. The memo's seat total is
  --   kinder seats + arm chairs + (school desks x 2) + (2-seater desks x 2),
  -- so the components are stored, never the total: the multipliers belong to
  -- the formula, and storing a pre-multiplied total would hide them.
  seats_kindergarten     INT CHECK (seats_kindergarten >= 0),
  seats_arm_chairs       INT CHECK (seats_arm_chairs >= 0),
  seats_school_desks     INT CHECK (seats_school_desks >= 0),
  seats_two_seater_desks INT CHECK (seats_two_seater_desks >= 0),

  -- Functional toilet bowls only, per the memo's wording.
  toilet_bowls_functional INT CHECK (toilet_bowls_functional >= 0),

  -- Teachers and instructional rooms ARE derivable (sms_users, sms_rooms), so
  -- these stay NULL unless a school head has to reconcile against an official
  -- personnel/building release. NULL = use the derived count.
  teacher_count_override   INT CHECK (teacher_count_override >= 0),
  classroom_count_override INT CHECK (classroom_count_override >= 0),

  notes TEXT,
  updated_by_user_id BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_kpi_reference IS
  'Denominators the KPI module cannot derive: PSA projected population by '
  'official school-age band, plus seat and toilet-bowl inventory. One row per '
  '(school, school_year); school_id NULL is the division-wide row.';

-- UNIQUE (school_id, school_year) cannot be a plain constraint: NULL school_id
-- would not collide with itself, allowing duplicate division rows. Two partial
-- indexes give the intended uniqueness on both branches.
CREATE UNIQUE INDEX IF NOT EXISTS uq_kpi_reference_school_year
  ON procurements.sms_kpi_reference (school_id, school_year)
  WHERE school_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_kpi_reference_division_year
  ON procurements.sms_kpi_reference (school_year)
  WHERE school_id IS NULL;

DROP TRIGGER IF EXISTS update_sms_kpi_reference_updated_at
  ON procurements.sms_kpi_reference;
CREATE TRIGGER update_sms_kpi_reference_updated_at
  BEFORE UPDATE ON procurements.sms_kpi_reference
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 2. RLS
-- ============================================================================
-- Readable by any authenticated user (KPIs are monitoring figures every role
-- may see). Writable by the owning school's leadership, and by division admins
-- anywhere — including the division-wide row, which only they own.
--
-- 'super admin' is in the full-access branch, not the school-matched one:
-- AuthGuard swaps their school_id for the active-school override, so matching
-- on it would deny writes. Same treatment as migrations 113 and 115.
ALTER TABLE procurements.sms_kpi_reference ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kpi_reference_select" ON procurements.sms_kpi_reference;
CREATE POLICY "kpi_reference_select"
  ON procurements.sms_kpi_reference FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "kpi_reference_insert" ON procurements.sms_kpi_reference;
CREATE POLICY "kpi_reference_insert"
  ON procurements.sms_kpi_reference FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND (
          u.type IN ('division_admin', 'division_type', 'super admin')
          OR (
            u.type IN ('school_head', 'assistant_school_head', 'admin')
            AND sms_kpi_reference.school_id IS NOT NULL
            AND u.school_id = sms_kpi_reference.school_id
          )
        )
    )
  );

DROP POLICY IF EXISTS "kpi_reference_update" ON procurements.sms_kpi_reference;
CREATE POLICY "kpi_reference_update"
  ON procurements.sms_kpi_reference FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND (
          u.type IN ('division_admin', 'division_type', 'super admin')
          OR (
            u.type IN ('school_head', 'assistant_school_head', 'admin')
            AND sms_kpi_reference.school_id IS NOT NULL
            AND u.school_id = sms_kpi_reference.school_id
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND (
          u.type IN ('division_admin', 'division_type', 'super admin')
          OR (
            u.type IN ('school_head', 'assistant_school_head', 'admin')
            AND sms_kpi_reference.school_id IS NOT NULL
            AND u.school_id = sms_kpi_reference.school_id
          )
        )
    )
  );

DROP POLICY IF EXISTS "kpi_reference_delete" ON procurements.sms_kpi_reference;
CREATE POLICY "kpi_reference_delete"
  ON procurements.sms_kpi_reference FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND u.type IN ('division_admin', 'division_type', 'super admin')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON procurements.sms_kpi_reference TO authenticated;
GRANT USAGE, SELECT
  ON SEQUENCE procurements.sms_kpi_reference_id_seq TO authenticated;

-- ============================================================================
-- 3. RPC: kpi_enrollment_facts
-- ============================================================================
-- The single source of numerators for the access and efficiency indicators:
-- enrollment, repeaters and EOSY outcomes for ONE school year, broken down by
-- grade level, sex and age.
--
-- WHY BY AGE, not by pre-computed age band: NER and NIR need enrollment
-- restricted to the official school age of the LEVEL being reported, and the
-- levels overlap (Grades 1-6 uses ages 6-11 while Kinder-to-Grade-6 uses 5-11).
-- Returning the age distribution lets the caller build any band the memo names
-- without a round trip per band. Sex is returned for the same reason — the GPI
-- is defined as the female-to-male ratio of ANY indicator.
--
-- AGE REFERENCE DATE: age is counted as of 30 June of the school year's opening
-- year unless p_age_as_of overrides it. The memo cites the official school ages
-- but not the cut-off date used to apply them; 30 June is the school year
-- opening. Callers that must match an official LIS release pass their own date.
--
-- REPEATER: a learner enrolled in grade X this school year who was also
-- enrolled in grade X the previous school year, WITHIN THE SAME SCOPE. At
-- school scope that means the same school, so a learner who repeats after
-- transferring in is not counted (the previous year's row belongs to another
-- school); the division-wide scope catches those.
--
-- SEMESTERS: SHS learners hold one enrollment row per semester (migration 028).
-- Rows are collapsed to one per (learner, grade level) so Grades 11-12 are not
-- double counted; the EOSY outcome is taken from the LATEST semester, which is
-- the one carrying the year's final status.
--
-- SECURITY INVOKER: reads stay under existing RLS — this exposes nothing the
-- caller could not already select.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.kpi_enrollment_facts(
  p_school_id   BIGINT,
  p_school_year TEXT,
  p_age_as_of   DATE DEFAULT NULL
)
RETURNS TABLE (
  grade_level INT,
  sex         TEXT,
  age         INT,
  enrollment  INT,
  repeaters   INT,
  promotes    INT,
  graduates   INT,
  dropouts    INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO procurements, public
AS $$
  WITH params AS (
    SELECT
      COALESCE(
        p_age_as_of,
        MAKE_DATE(SPLIT_PART(p_school_year, '-', 1)::INT, 6, 30)
      ) AS as_of,
      (SPLIT_PART(p_school_year, '-', 1)::INT - 1)::TEXT
        || '-' || SPLIT_PART(p_school_year, '-', 1) AS prev_sy
  ),
  -- One row per learner per grade level for the reference year. status is the
  -- APPROVAL flag; enrollment_status is the lifecycle (migration 109's trap).
  -- Every lifecycle value is kept: BOSY enrollment must include the learners
  -- who later dropped or transferred out.
  cur AS (
    SELECT
      e.student_id,
      e.grade_level::INT AS grade_level,
      (ARRAY_AGG(e.enrollment_status ORDER BY e.semester DESC NULLS LAST))[1]
        AS final_status
    FROM procurements.sms_enrollments e
    WHERE e.school_year = p_school_year
      AND e.status = 'approved'
      AND (p_school_id IS NULL OR e.school_id = p_school_id)
    GROUP BY e.student_id, e.grade_level
  ),
  prev AS (
    SELECT DISTINCT e.student_id, e.grade_level::INT AS grade_level
    FROM procurements.sms_enrollments e, params
    WHERE e.school_year = params.prev_sy
      AND e.status = 'approved'
      AND (p_school_id IS NULL OR e.school_id = p_school_id)
  ),
  facts AS (
    SELECT
      c.grade_level,
      s.gender AS sex,
      GREATEST(
        0,
        DATE_PART('year', AGE(params.as_of, s.date_of_birth))::INT
      ) AS age,
      (p.student_id IS NOT NULL) AS is_repeater,
      c.final_status
    FROM cur c
    JOIN procurements.sms_students s ON s.id = c.student_id
    CROSS JOIN params
    LEFT JOIN prev p
      ON p.student_id = c.student_id
     AND p.grade_level = c.grade_level
  )
  SELECT
    f.grade_level,
    f.sex,
    f.age,
    COUNT(*)::INT                                                   AS enrollment,
    COUNT(*) FILTER (WHERE f.is_repeater)::INT                      AS repeaters,
    -- EOSY promotes. 'completed' and 'promoted' both mean the learner finished
    -- the grade and moves up; 'graduated' is counted separately because the
    -- memo's graduation rate is a distinct indicator for Grades 6 and 12.
    COUNT(*) FILTER (
      WHERE f.final_status IN ('promoted', 'completed')
    )::INT                                                          AS promotes,
    COUNT(*) FILTER (WHERE f.final_status = 'graduated')::INT        AS graduates,
    COUNT(*) FILTER (WHERE f.final_status = 'dropped')::INT          AS dropouts
  FROM facts f
  GROUP BY f.grade_level, f.sex, f.age
  ORDER BY f.grade_level, f.sex, f.age;
$$;

COMMENT ON FUNCTION procurements.kpi_enrollment_facts(BIGINT, TEXT, DATE) IS
  'Enrollment, repeaters and EOSY outcomes for one school year by grade level, '
  'sex and age. p_school_id NULL rolls up every school. Numerators for the '
  'DepEd access and efficiency KPIs; age is as of 30 June of the opening year '
  'unless overridden.';

-- ============================================================================
-- 4. RPC: kpi_resource_facts
-- ============================================================================
-- Per-school enrollment, teacher and instructional-room counts — the ratio
-- denominators, and the input to the Inter-Quartile Ratio.
--
-- The IQR is why this returns ONE ROW PER SCHOOL rather than a scope total:
-- the memo computes it from school-level data at any level of governance, over
-- at least eight schools. Callers reporting a single school just read row one.
--
-- Teachers are counted by type, not staff_category_code — the latter is NULL on
-- rows predating migration 071, so counting by it would undercount (same
-- reasoning as src_autofill in migration 112).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.kpi_resource_facts(
  p_school_id   BIGINT,
  p_school_year TEXT
)
RETURNS TABLE (
  school_id   BIGINT,
  school_name TEXT,
  enrollment  INT,
  teachers    INT,
  classrooms  INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO procurements, public
AS $$
  WITH scoped_schools AS (
    SELECT sc.id, sc.name
    FROM procurements.sms_schools sc
    WHERE sc.is_active
      AND (p_school_id IS NULL OR sc.id = p_school_id)
  ),
  enrolled AS (
    -- Learners are counted where they actually are that year
    -- (sms_enrollments.school_id), never sms_students.school_id, which
    -- diverges for transferees — migration 109.
    SELECT e.school_id, COUNT(DISTINCT e.student_id)::INT AS n
    FROM procurements.sms_enrollments e
    WHERE e.school_year = p_school_year
      AND e.status = 'approved'
    GROUP BY e.school_id
  ),
  staff AS (
    SELECT u.school_id, COUNT(*)::INT AS n
    FROM procurements.sms_users u
    WHERE u.is_active
      AND u.type = 'teacher'
    GROUP BY u.school_id
  ),
  rooms AS (
    SELECT r.school_id, COUNT(*)::INT AS n
    FROM procurements.sms_rooms r
    WHERE r.is_active
      AND r.room_type = 'classroom'
    GROUP BY r.school_id
  )
  SELECT
    s.id                      AS school_id,
    s.name                    AS school_name,
    COALESCE(e.n, 0)          AS enrollment,
    COALESCE(t.n, 0)          AS teachers,
    COALESCE(rm.n, 0)         AS classrooms
  FROM scoped_schools s
  LEFT JOIN enrolled e ON e.school_id = s.id
  LEFT JOIN staff    t ON t.school_id = s.id
  LEFT JOIN rooms    rm ON rm.school_id = s.id
  ORDER BY s.name;
$$;

COMMENT ON FUNCTION procurements.kpi_resource_facts(BIGINT, TEXT) IS
  'Per-school enrollment, active teachers and active classrooms for a school '
  'year. Denominators for the learner ratios and the input rows for the IQR '
  '(which needs at least eight schools). p_school_id NULL returns every school.';

GRANT EXECUTE ON FUNCTION
  procurements.kpi_enrollment_facts(BIGINT, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION
  procurements.kpi_resource_facts(BIGINT, TEXT) TO authenticated;

-- Supports the two enrollment CTEs above, which filter by school year and
-- group by school / student / grade level.
CREATE INDEX IF NOT EXISTS idx_enrollments_sy_school_grade
  ON procurements.sms_enrollments (school_year, school_id, grade_level);

-- <<< END 118_key_performance_indicators.sql

-- ============================================================================
-- >>> BEGIN 119_learner_manifestation_tagging.sql
-- ============================================================================

-- ============================================================================
-- LEARNER MANIFESTATION TAGGING (SNED referral pipeline)
-- ============================================================================
-- Implements the class-adviser side of the DepEd LIS "Tagging of Learners with
-- Special Educational Needs (SPED)" procedure — Division Memorandum No. 263,
-- s. 2024 (Kabankalan City), Enclosure No. 1, which itself operationalizes
-- DepEd Order No. 21, s. 2019 for Learners With Disabilities (LWDs).
--
-- The memo directs schools to tag LWDs in the LIS both WITH MANIFESTATIONS
-- (adviser-observed functional difficulty, no medical diagnosis yet) and WITH
-- MEDICAL DIAGNOSIS (confirmed by a licensed medical specialist). This module
-- is the school-side working record that FEEDS that LIS tagging — it does not
-- replace the LIS. `lis_tagged` records that the adviser has since mirrored the
-- tag into the LIS, which is the only place DepEd counts it.
--
-- THE PIPELINE (one row per learner per school year, in sms_manifestation_tags):
--
--   1. TAG        — adviser records one or more manifestations / diagnoses
--                   (sms_manifestation_tag_items) plus the class type. The
--                   non-graded branch of the LIS form asks for a program
--                   (Kinder / Primary Level I–III / Transition); the graded
--                   branch does not, hence non_graded_program is nullable.
--
--   2. CONSENT    — a parent/guardian consent form is printed and returned.
--                   The three options are exactly the ones on the DepEd SNED
--                   Parent/Guardian Consent Form: agree to LIS tagging AND
--                   medical assessment, agree to LIS tagging ONLY, or refuse
--                   (with a reason). 'pending' = form issued, not yet returned.
--
--   3. INTERVENTION — the adviser designs an intervention per tag
--                   (sms_manifestation_interventions).
--
--   4. TECHNICAL ASSISTANCE — the School Head may render TA on any intervention.
--                   TA lives on the intervention row (ta_notes / ta_by / ta_date)
--                   rather than in its own table because it is a response to one
--                   specific intervention, and there is at most one standing TA
--                   note per intervention (re-rendering TA overwrites it).
--
--   5. SNED       — learners that are tagged AND consented are IDENTIFIED for
--                   SNED enrollment. "Identified" is DERIVED, never stored:
--                   it is (has >= 1 tag item) AND (consent_status is an agree).
--                   Only the outcome — actual enrollment — is stored, because
--                   the system cannot infer it.
--
-- CONSENT IS NOT A GATE ON TAGGING. The adviser tags first and seeks consent
-- after (that is the order in the memo), so a tag with consent_status 'pending'
-- or even 'disagree' is a valid, expected state. A refusal is retained on the
-- record: the school still needs to show it sought consent.
--
-- SCOPE: rows carry school_id + school_year and are keyed on the STUDENT, so a
-- learner re-tagged next school year gets a new row and the previous year's
-- record (with its consent and interventions) stays intact. UNIQUE on
-- (student_id, school_year) — a learner has ONE tagging record per year, and
-- multiple manifestations hang off it as items.
--
-- RLS = authenticated, with roster scoping enforced in the app layer, matching
-- the sibling class-adviser tools in migration 105 (anecdotal / cardex).
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. TAGGING RECORD — one row per learner per school year
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_manifestation_tags (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,

  -- LIS branch: a graded class tags the classification only; a non-graded /
  -- SPED class additionally selects the program.
  class_type TEXT NOT NULL DEFAULT 'graded'
    CHECK (class_type IN ('graded', 'non_graded')),
  non_graded_program TEXT
    CHECK (non_graded_program IS NULL OR non_graded_program IN (
      'kinder', 'primary_1', 'primary_2', 'primary_3', 'transition'
    )),

  tagged_date DATE NOT NULL DEFAULT CURRENT_DATE,
  observation TEXT,                   -- the OBSERVATION line on the consent form
  remarks TEXT,

  -- Parent/guardian consent (DepEd SNED Parent/Guardian Consent Form)
  consent_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (consent_status IN (
      'pending',                -- form issued, not yet returned
      'agree_lis_and_medical',  -- agrees to LIS tagging AND medical assessment
      'agree_lis_only',         -- agrees to LIS tagging only, no medical assessment
      'disagree'                -- refuses both
    )),
  consent_date DATE,                  -- date the signed form was returned
  consent_signatory TEXT,             -- printed name of the parent/guardian who signed
  consent_relationship TEXT,          -- relationship to the learner
  disagree_reason TEXT,               -- required by the form when refusing

  -- LIS mirror + SNED outcome
  lis_tagged BOOLEAN NOT NULL DEFAULT FALSE,
  lis_tagged_date DATE,
  sned_enrolled BOOLEAN NOT NULL DEFAULT FALSE,
  sned_enrolled_date DATE,

  created_by BIGINT REFERENCES procurements.sms_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sms_manifestation_tags_student_year_uniq
    UNIQUE (student_id, school_year)
);

COMMENT ON TABLE procurements.sms_manifestation_tags IS
  'Learner manifestation tagging: one row per learner per school year, carrying parent consent and the SNED enrollment outcome. Feeds the DepEd LIS SPED tagging.';
COMMENT ON COLUMN procurements.sms_manifestation_tags.lis_tagged IS
  'TRUE once the adviser has mirrored this tag into the DepEd LIS. The LIS remains the system of record for DepEd counts.';
COMMENT ON COLUMN procurements.sms_manifestation_tags.consent_status IS
  'pending until the signed form is returned. Tagging does NOT require consent — the adviser tags first, then seeks consent.';

CREATE INDEX IF NOT EXISTS idx_sms_manifestation_tags_scope
  ON procurements.sms_manifestation_tags(school_id, school_year);
CREATE INDEX IF NOT EXISTS idx_sms_manifestation_tags_student
  ON procurements.sms_manifestation_tags(student_id, school_year);

CREATE TRIGGER update_sms_manifestation_tags_updated_at
  BEFORE UPDATE ON procurements.sms_manifestation_tags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. TAG ITEMS — the manifestation/s themselves ("tags learners with its
--    manifestation/s" — a learner may carry several)
--
--    `category` mirrors the three option groups of the LIS
--    "Classification/Type of Learner Special Educational Needs (LSEN)" select.
--    `code` is validated in the app against lib/constants/manifestation.ts
--    rather than by a CHECK constraint: DepEd revises the LSEN list between
--    memoranda, and a CHECK would turn each revision into a migration that
--    invalidates existing rows.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_manifestation_tag_items (
  id BIGSERIAL PRIMARY KEY,
  tag_id BIGINT NOT NULL REFERENCES procurements.sms_manifestation_tags(id) ON DELETE CASCADE,
  category TEXT NOT NULL
    CHECK (category IN ('gifted', 'diagnosed', 'manifestation')),
  code TEXT NOT NULL,                 -- LSEN code, see lib/constants/manifestation.ts
  notes TEXT,                         -- what the adviser actually observed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sms_manifestation_tag_items_uniq UNIQUE (tag_id, code)
);

COMMENT ON TABLE procurements.sms_manifestation_tag_items IS
  'One row per manifestation / diagnosis / giftedness carried by a tagged learner. Codes are app-validated (lib/constants/manifestation.ts), not CHECK-constrained, so DepEd list revisions do not invalidate history.';

CREATE INDEX IF NOT EXISTS idx_sms_manifestation_tag_items_tag
  ON procurements.sms_manifestation_tag_items(tag_id);

-- ----------------------------------------------------------------------------
-- 3. INTERVENTIONS — designed by the adviser, optionally given technical
--    assistance (TA) by the School Head
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_manifestation_interventions (
  id BIGSERIAL PRIMARY KEY,
  tag_id BIGINT NOT NULL REFERENCES procurements.sms_manifestation_tags(id) ON DELETE CASCADE,

  intervention_date DATE NOT NULL,
  focus_area TEXT,                    -- manifestation / need the plan addresses
  strategy TEXT NOT NULL,             -- the designed intervention itself
  resources TEXT,                     -- materials, personnel, referrals needed
  expected_outcome TEXT,
  progress TEXT,                      -- observed progress so far
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'ongoing', 'completed', 'discontinued')),

  -- Technical assistance rendered by the School Head on THIS intervention.
  ta_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ta_notes TEXT,
  ta_by BIGINT REFERENCES procurements.sms_users(id),
  ta_date DATE,

  created_by BIGINT REFERENCES procurements.sms_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_manifestation_interventions IS
  'Adviser-designed interventions for a tagged learner. ta_* columns hold the School Head technical assistance rendered on that intervention.';
COMMENT ON COLUMN procurements.sms_manifestation_interventions.ta_requested IS
  'Adviser flags an intervention as needing School Head technical assistance; the School Head answers by filling ta_notes / ta_by / ta_date.';

CREATE INDEX IF NOT EXISTS idx_sms_manifestation_interventions_tag
  ON procurements.sms_manifestation_interventions(tag_id);

CREATE TRIGGER update_sms_manifestation_interventions_updated_at
  BEFORE UPDATE ON procurements.sms_manifestation_interventions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 4. SNED COORDINATOR — signatory on the consent form
--
--    The DepEd SNED Parent/Guardian Consent Form is signed by the Class Adviser
--    and the SNED School Coordinator, and noted by the Principal. The first two
--    are already known (session user / principal settings from migration 053);
--    the coordinator is not, so it joins the same per-school settings row.
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_school_settings
  ADD COLUMN IF NOT EXISTS sned_coordinator_name TEXT DEFAULT NULL;

COMMENT ON COLUMN procurements.sms_school_settings.sned_coordinator_name IS
  'SNED School Coordinator; signatory on the printed SNED parent/guardian consent form.';

-- ----------------------------------------------------------------------------
-- RLS + GRANTS (roster scoping enforced in the app layer, per migration 105)
-- ----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sms_manifestation_tags',
    'sms_manifestation_tag_items',
    'sms_manifestation_interventions'
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

-- <<< END 119_learner_manifestation_tagging.sql

COMMIT;
