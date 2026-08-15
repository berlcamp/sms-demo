-- ============================================================================
-- SCHOOL MANAGEMENT SYSTEM — FRESH INSTALL, PART 2 OF 7
-- Multi-school support, transfers, settings, ECCD, evaluations, report cards
-- ============================================================================
-- GENERATED FILE — do not edit by hand; run supabase/setup/generate.sh instead.
-- A byte-for-byte concatenation of the 30 migrations listed below, in the
-- exact order a migration runner would apply them.
--
-- FOR NEW / EMPTY DATABASES ONLY. Never run this against a database that already
-- has the migration history applied — use supabase/migrations/ for that.
--
-- Run the seven parts strictly in order: 01 -> 07. Each part is one transaction,
-- so a failure rolls the whole part back and leaves nothing half-applied.
--
-- Migrations merged into this part:
--   030_subjects_is_graded.sql
--   031_librarian_and_book_allocations.sql
--   032_sms_book_issuances_returned_to_manager.sql
--   033_sms_historical_grades.sql
--   034_madrasah_support.sql
--   035_sned_grade_level.sql
--   036_fn_student_previous_gpa.sql
--   037_subjects_security_and_performance.sql
--   038_multi_school_transfers.sql
--   039_fix_enrollment_unique_constraint.sql
--   040_fix_sections_unique_constraint.sql
--   041_fix_subjects_select_rls.sql
--   042_fix_lookup_student_fallback_school.sql
--   043_school_settings.sql
--   044_attendance_am_pm.sql
--   045_retain_nlis.sql
--   046_promotion_deadline.sql
--   047_eccd_checklist.sql
--   048_sned_disabilities.sql
--   049_requests_rebuild.sql
--   050_promotion_graduated_status.sql
--   051_drop_sms_section_students.sql
--   052_transfer_out_metadata.sql
--   053_school_principal.sql
--   054_evaluations.sql
--   055_report_card_core_values.sql
--   056_sync_student_enrollment_status_trigger.sql
--   057_transfer_two_stage_approval.sql
--   058_allow_edit_promoted_student_grades.sql
--   059_eccd_refactor.sql
-- ============================================================================

BEGIN;

SET search_path TO procurements, public;

-- ============================================================================
-- >>> BEGIN 030_subjects_is_graded.sql
-- ============================================================================

-- ============================================================================
-- ADD is_graded COLUMN TO sms_subjects
-- ============================================================================
-- When false, subject does not require grading and will not appear in Grade Entry
-- Default true for backward compatibility with existing subjects
-- ============================================================================

SET search_path TO procurements, public;

ALTER TABLE procurements.sms_subjects
  ADD COLUMN IF NOT EXISTS is_graded BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN procurements.sms_subjects.is_graded IS 'When false, subject does not require grading and will not appear in Grade Entry module';

-- <<< END 030_subjects_is_graded.sql

-- ============================================================================
-- >>> BEGIN 031_librarian_and_book_allocations.sql
-- ============================================================================

-- ============================================================================
-- LIBRARIAN ROLE AND SMS_BOOK_ALLOCATIONS
-- ============================================================================
-- Adds librarian (book manager) user type and book allocation table.
-- Book managers allocate book quantities to teachers/advisers who then issue to students.
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- ADD librarian TO sms_users TYPE
-- ============================================================================
ALTER TABLE procurements.sms_users DROP CONSTRAINT IF EXISTS sms_users_type_check;
ALTER TABLE procurements.sms_users ADD CONSTRAINT sms_users_type_check
  CHECK (type IN ('school_head', 'teacher', 'registrar', 'admin', 'super admin', 'division_admin', 'librarian'));

-- ============================================================================
-- SMS_BOOK_ALLOCATIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_book_allocations (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  teacher_id BIGINT NOT NULL REFERENCES procurements.sms_users(id) ON DELETE CASCADE,
  book_id BIGINT NOT NULL REFERENCES procurements.sms_books(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  school_year TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(teacher_id, book_id, school_year)
);

CREATE INDEX IF NOT EXISTS idx_sms_book_allocations_school_id ON procurements.sms_book_allocations(school_id);
CREATE INDEX IF NOT EXISTS idx_sms_book_allocations_teacher_id ON procurements.sms_book_allocations(teacher_id);
CREATE INDEX IF NOT EXISTS idx_sms_book_allocations_book_id ON procurements.sms_book_allocations(book_id);
CREATE INDEX IF NOT EXISTS idx_sms_book_allocations_school_year ON procurements.sms_book_allocations(school_year);

CREATE TRIGGER update_sms_book_allocations_updated_at
  BEFORE UPDATE ON procurements.sms_book_allocations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE procurements.sms_book_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Book allocations are viewable by authenticated users"
  ON procurements.sms_book_allocations FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Book allocations are insertable by authenticated users"
  ON procurements.sms_book_allocations FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Book allocations are updatable by authenticated users"
  ON procurements.sms_book_allocations FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Book allocations are deletable by authenticated users"
  ON procurements.sms_book_allocations FOR DELETE
  USING (auth.role() = 'authenticated');

GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_book_allocations TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_book_allocations_id_seq TO authenticated;

COMMENT ON TABLE procurements.sms_book_allocations IS 'Book quantity allocated by book manager to teachers/advisers per school year';

-- <<< END 031_librarian_and_book_allocations.sql

-- ============================================================================
-- >>> BEGIN 032_sms_book_issuances_returned_to_manager.sql
-- ============================================================================

-- ============================================================================
-- SMS_BOOK_ISSUANCES: TWO-STEP RETURN (TEACHER → BOOK MANAGER)
-- ============================================================================
-- Adds returned_to_manager_at for when teacher/adviser turns books in to book manager.
-- Flow: date_returned = student returned to teacher; returned_to_manager_at = teacher returned to manager.
-- ============================================================================

SET search_path TO procurements, public;

ALTER TABLE procurements.sms_book_issuances
  ADD COLUMN IF NOT EXISTS returned_to_manager_at TIMESTAMPTZ;

COMMENT ON COLUMN procurements.sms_book_issuances.returned_to_manager_at IS 'When teacher/adviser returned this copy to the book manager (back to central stock)';

-- <<< END 032_sms_book_issuances_returned_to_manager.sql

-- ============================================================================
-- >>> BEGIN 033_sms_historical_grades.sql
-- ============================================================================

-- ============================================================================
-- SMS_HISTORICAL_GRADES TABLE
-- ============================================================================
-- Stores manually encoded historical academic records for SF10 generation.
-- Used for grade levels where no system-generated grades exist (e.g., prior
-- years/schools before SMS deployment). Denormalized to avoid FK violations
-- on schools, subjects, sections, and teachers that don't exist in the system.
-- ============================================================================

SET search_path TO procurements, public;

CREATE TABLE IF NOT EXISTS procurements.sms_historical_grades (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL,
  grade_level INTEGER NOT NULL CHECK (grade_level >= 0 AND grade_level <= 12),
  school_year TEXT NOT NULL,
  section_name TEXT,
  school_name TEXT,
  school_id_code TEXT,
  district TEXT,
  division TEXT,
  region TEXT,
  adviser_name TEXT,
  semester INTEGER,
  track TEXT,
  strand TEXT,
  grades JSONB NOT NULL DEFAULT '{}'::jsonb,
  general_average NUMERIC(5,2),
  encoded_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One record per grade level per student; for SHS (11-12), per semester
  UNIQUE(student_id, grade_level, semester),

  -- SHS (11-12) must have semester 1 or 2; K-10 must have null semester
  CHECK (
    (grade_level >= 11 AND semester IN (1, 2))
    OR (grade_level < 11 AND semester IS NULL)
  )
);

-- Use a unique index with COALESCE for the null-safe unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_historical_grades_unique
  ON procurements.sms_historical_grades(student_id, grade_level, COALESCE(semester, 0));

CREATE INDEX IF NOT EXISTS idx_sms_historical_grades_student ON procurements.sms_historical_grades(student_id);
CREATE INDEX IF NOT EXISTS idx_sms_historical_grades_school ON procurements.sms_historical_grades(school_id);

CREATE TRIGGER update_sms_historical_grades_updated_at
  BEFORE UPDATE ON procurements.sms_historical_grades
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE procurements.sms_historical_grades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Historical grades viewable by authenticated users"
  ON procurements.sms_historical_grades FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Historical grades insertable by authenticated users"
  ON procurements.sms_historical_grades FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Historical grades updatable by authenticated users"
  ON procurements.sms_historical_grades FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Historical grades deletable by authenticated users"
  ON procurements.sms_historical_grades FOR DELETE
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE procurements.sms_historical_grades IS 'Manually encoded historical academic records for SF10 generation';

-- <<< END 033_sms_historical_grades.sql

-- ============================================================================
-- >>> BEGIN 034_madrasah_support.sql
-- ============================================================================

-- ============================================================================
-- MADRASAH EDUCATION PROGRAM (MEP) SUPPORT
-- ============================================================================
-- 1. Add is_madrasah flag to sms_subjects
-- 2. Create sms_student_subjects pivot table for selective subject enrollment
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- ADD is_madrasah COLUMN TO sms_subjects
-- ============================================================================
-- Default false ensures all existing subjects remain unaffected.
-- When true, only students explicitly enrolled via sms_student_subjects
-- take this subject (instead of all students in the section).
ALTER TABLE procurements.sms_subjects
  ADD COLUMN IF NOT EXISTS is_madrasah BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- SMS_STUDENT_SUBJECTS PIVOT TABLE
-- ============================================================================
-- Selective enrollment: links individual students to specific subjects
-- within a section. Used for Madrasah subjects where not all section
-- students participate.
CREATE TABLE IF NOT EXISTS procurements.sms_student_subjects (
  id            BIGSERIAL PRIMARY KEY,
  student_id    BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  subject_id    BIGINT NOT NULL REFERENCES procurements.sms_subjects(id) ON DELETE CASCADE,
  section_id    BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  school_id     BIGINT NOT NULL REFERENCES procurements.sms_schools(id),
  school_year   TEXT NOT NULL,
  enrolled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enrolled_by   BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, subject_id, section_id, school_year)
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_student_subjects_student
  ON procurements.sms_student_subjects(student_id);
CREATE INDEX IF NOT EXISTS idx_student_subjects_subject
  ON procurements.sms_student_subjects(subject_id);
CREATE INDEX IF NOT EXISTS idx_student_subjects_section
  ON procurements.sms_student_subjects(section_id);
CREATE INDEX IF NOT EXISTS idx_student_subjects_school_id
  ON procurements.sms_student_subjects(school_id);
CREATE INDEX IF NOT EXISTS idx_student_subjects_school_year
  ON procurements.sms_student_subjects(school_year);

-- Partial index for quick Madrasah subject filtering
CREATE INDEX IF NOT EXISTS idx_subjects_is_madrasah
  ON procurements.sms_subjects(is_madrasah) WHERE is_madrasah = true;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================
GRANT ALL ON procurements.sms_student_subjects TO authenticated;
GRANT ALL ON procurements.sms_student_subjects TO anon;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_student_subjects_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_student_subjects_id_seq TO anon;

-- <<< END 034_madrasah_support.sql

-- ============================================================================
-- >>> BEGIN 035_sned_grade_level.sql
-- ============================================================================

-- ============================================================================
-- ADD SNED (SPECIAL NEEDS EDUCATION) GRADE LEVEL SUPPORT
-- ============================================================================
-- Extends grade_level from 0-12 to -1-12 (-1 = SNED)
-- SNED behaves like Kindergarten; students promote to Grade 1.
-- ============================================================================

SET search_path TO procurements, public;

-- sms_subjects: Drop and recreate grade_level check
ALTER TABLE procurements.sms_subjects
  DROP CONSTRAINT IF EXISTS sms_subjects_grade_level_check;
ALTER TABLE procurements.sms_subjects
  ADD CONSTRAINT sms_subjects_grade_level_check CHECK ((grade_level::integer) >= -1 AND (grade_level::integer) <= 12);

-- sms_sections: Drop and recreate grade_level check
ALTER TABLE procurements.sms_sections
  DROP CONSTRAINT IF EXISTS sms_sections_grade_level_check;
ALTER TABLE procurements.sms_sections
  ADD CONSTRAINT sms_sections_grade_level_check CHECK ((grade_level::integer) >= -1 AND (grade_level::integer) <= 12);

-- sms_enrollments: Drop and recreate grade_level check
ALTER TABLE procurements.sms_enrollments
  DROP CONSTRAINT IF EXISTS sms_enrollments_grade_level_check;
ALTER TABLE procurements.sms_enrollments
  ADD CONSTRAINT sms_enrollments_grade_level_check CHECK ((grade_level::integer) >= -1 AND (grade_level::integer) <= 12);

-- sms_students: Drop and recreate grade_level check
ALTER TABLE procurements.sms_students
  DROP CONSTRAINT IF EXISTS sms_students_grade_level_check;
ALTER TABLE procurements.sms_students
  ADD CONSTRAINT sms_students_grade_level_check CHECK ((grade_level::integer) >= -1 AND (grade_level::integer) <= 12);

COMMENT ON COLUMN procurements.sms_students.grade_level IS 'Current grade level (-1 = SNED, 0 = Kindergarten, 1-12 = Grade 1-12)';

-- <<< END 035_sned_grade_level.sql

-- ============================================================================
-- >>> BEGIN 036_fn_student_previous_gpa.sql
-- ============================================================================

-- ============================================================================
-- FUNCTION: get_student_previous_gpa
-- Returns the average grade for a student's most recent approved enrollment
-- in the grade level immediately below the given one.
-- Returns NULL when no previous enrollment or grades exist.
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.get_student_previous_gpa(
  p_student_id BIGINT,
  p_grade_level INTEGER,
  p_school_id BIGINT DEFAULT NULL
)
RETURNS NUMERIC AS $$
DECLARE
  v_section_id BIGINT;
  v_school_year TEXT;
  v_gpa NUMERIC;
BEGIN
  -- Find the most recent approved enrollment at the previous grade level
  SELECT e.section_id, e.school_year
    INTO v_section_id, v_school_year
    FROM procurements.sms_enrollments e
   WHERE e.student_id = p_student_id
     AND e.grade_level = p_grade_level - 1
     AND e.status = 'approved'
     AND (p_school_id IS NULL OR e.school_id = p_school_id)
   ORDER BY e.school_year DESC
   LIMIT 1;

  IF v_section_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Compute average grade
  SELECT ROUND(AVG(g.grade)::numeric, 2)
    INTO v_gpa
    FROM procurements.sms_grades g
   WHERE g.student_id = p_student_id
     AND g.section_id = v_section_id
     AND g.school_year = v_school_year;

  RETURN v_gpa;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION procurements.get_student_previous_gpa IS
  'Returns the average grade from a student''s most recent approved enrollment at (grade_level - 1). NULL if no data.';

-- <<< END 036_fn_student_previous_gpa.sql

-- ============================================================================
-- >>> BEGIN 037_subjects_security_and_performance.sql
-- ============================================================================

-- ============================================================================
-- SUBJECTS MODULE: SECURITY & PERFORMANCE FIXES
-- ============================================================================
-- 1. RLS policies: restrict write access to authorized roles only
-- 2. RLS policies: enforce school_id isolation
-- 3. Unique constraint: per-school subject code uniqueness
-- 4. Composite index for schedule queries
-- 5. Optimized single-pass conflict detection function
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- HELPER: Get current user's SMS role and school_id from sms_users
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_sms_user_info()
RETURNS TABLE(user_type TEXT, user_school_id TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT u.type, u.school_id
  FROM procurements.sms_users u
  WHERE u.user_id = auth.uid()
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================================
-- 1. FIX RLS POLICIES FOR sms_subjects
-- ============================================================================

-- Drop existing overly-permissive policies
DROP POLICY IF EXISTS "Subjects are viewable by authenticated users" ON procurements.sms_subjects;
DROP POLICY IF EXISTS "Subjects are insertable by admins" ON procurements.sms_subjects;
DROP POLICY IF EXISTS "Subjects are updatable by admins" ON procurements.sms_subjects;
DROP POLICY IF EXISTS "Subjects are deletable by admins" ON procurements.sms_subjects;

-- SELECT: authenticated users can only see subjects from their own school
-- division_admin (school_id IS NULL) can see all subjects
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
        WHERE u.user_id = auth.uid() AND u.type = 'division_admin'
      )
    )
  );

-- INSERT: only school_head, admin, registrar, division_admin can create subjects
-- and only for their own school (or any school for division_admin)
CREATE POLICY "Subjects are insertable by authorized roles"
  ON procurements.sms_subjects FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'admin', 'registrar', 'division_admin')
        AND (u.type = 'division_admin' OR u.school_id = school_id)
    )
  );

-- UPDATE: only school_head, admin, registrar, division_admin can update subjects
-- and only for their own school
CREATE POLICY "Subjects are updatable by authorized roles"
  ON procurements.sms_subjects FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'admin', 'registrar', 'division_admin')
        AND (u.type = 'division_admin' OR u.school_id = school_id)
    )
  );

-- DELETE: only school_head, admin, division_admin can delete subjects
CREATE POLICY "Subjects are deletable by authorized roles"
  ON procurements.sms_subjects FOR DELETE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'admin', 'division_admin')
        AND (u.type = 'division_admin' OR u.school_id = school_id)
    )
  );

-- ============================================================================
-- 2. FIX RLS POLICIES FOR sms_subject_schedules
-- ============================================================================

DROP POLICY IF EXISTS "Subject schedules are viewable by authenticated users" ON procurements.sms_subject_schedules;
DROP POLICY IF EXISTS "Subject schedules are insertable by admins" ON procurements.sms_subject_schedules;
DROP POLICY IF EXISTS "Subject schedules are updatable by admins" ON procurements.sms_subject_schedules;
DROP POLICY IF EXISTS "Subject schedules are deletable by admins" ON procurements.sms_subject_schedules;

-- SELECT: school members + division_admin
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
        WHERE u.user_id = auth.uid() AND u.type = 'division_admin'
      )
    )
  );

-- INSERT/UPDATE/DELETE: authorized roles only, school-scoped
CREATE POLICY "Subject schedules are insertable by authorized roles"
  ON procurements.sms_subject_schedules FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'admin', 'registrar', 'division_admin')
        AND (u.type = 'division_admin' OR u.school_id = school_id)
    )
  );

CREATE POLICY "Subject schedules are updatable by authorized roles"
  ON procurements.sms_subject_schedules FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'admin', 'registrar', 'division_admin')
        AND (u.type = 'division_admin' OR u.school_id = school_id)
    )
  );

CREATE POLICY "Subject schedules are deletable by authorized roles"
  ON procurements.sms_subject_schedules FOR DELETE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'admin', 'division_admin')
        AND (u.type = 'division_admin' OR u.school_id = school_id)
    )
  );

-- ============================================================================
-- 3. PER-SCHOOL UNIQUE SUBJECT CODE
-- ============================================================================

-- Drop the global unique constraint on code
ALTER TABLE procurements.sms_subjects DROP CONSTRAINT IF EXISTS sms_subjects_code_key;

-- Add per-school unique constraint (school_id + code)
-- Uses COALESCE to handle NULL school_id (legacy/division-level subjects)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_subjects_school_code
  ON procurements.sms_subjects (COALESCE(school_id, '0'), code);

-- ============================================================================
-- 4. COMPOSITE INDEX FOR SCHEDULE QUERIES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_subject_schedules_subject_school_year
  ON procurements.sms_subject_schedules (subject_id, school_id, school_year);

-- ============================================================================
-- 5. OPTIMIZED SINGLE-PASS CONFLICT DETECTION
-- ============================================================================
-- Replaces 3 sequential COUNT queries with a single scan that checks
-- room, teacher, and section conflicts in one pass.

CREATE OR REPLACE FUNCTION public.check_schedule_conflicts(
  p_room_id BIGINT,
  p_teacher_id BIGINT,
  p_section_id BIGINT,
  p_days_of_week INTEGER[],
  p_start_time TIME,
  p_end_time TIME,
  p_school_year TEXT,
  p_id BIGINT DEFAULT NULL
) RETURNS TABLE(
  conflict_type TEXT,
  conflict_message TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    CASE
      WHEN s.room_id = p_room_id THEN 'room'
      WHEN s.teacher_id = p_teacher_id THEN 'teacher'
      WHEN s.section_id = p_section_id THEN 'section'
    END::TEXT AS ctype,
    CASE
      WHEN s.room_id = p_room_id THEN 'Room is already scheduled at this time on one or more selected days'
      WHEN s.teacher_id = p_teacher_id THEN 'Teacher is already scheduled at this time on one or more selected days'
      WHEN s.section_id = p_section_id THEN 'Section is already scheduled at this time on one or more selected days'
    END::TEXT AS cmsg
  FROM procurements.sms_subject_schedules s
  WHERE s.school_year = p_school_year
    AND (p_id IS NULL OR s.id != p_id)
    AND public.days_overlap(s.days_of_week, p_days_of_week)
    AND public.times_overlap(s.start_time, s.end_time, p_start_time, p_end_time)
    AND (s.room_id = p_room_id OR s.teacher_id = p_teacher_id OR s.section_id = p_section_id);
END;
$$ LANGUAGE plpgsql;

-- <<< END 037_subjects_security_and_performance.sql

-- ============================================================================
-- >>> BEGIN 038_multi_school_transfers.sql
-- ============================================================================

-- ============================================================================
-- 038: Multi-School Student Records & Transfer System
-- ============================================================================
-- Adds enrollment lifecycle status, record requests table, cross-school
-- LRN lookup, and atomic transfer enrollment RPCs.
-- This migration is fully additive — no existing columns or tables are dropped.
-- ============================================================================

-- ============================================================================
-- 1A. Add columns to sms_enrollments
-- ============================================================================

ALTER TABLE procurements.sms_enrollments
  ADD COLUMN IF NOT EXISTS enrollment_status TEXT NOT NULL DEFAULT 'active'
  CHECK (enrollment_status IN ('active', 'completed', 'transferred_out', 'dropped', 'pending_transfer'));

ALTER TABLE procurements.sms_enrollments
  ADD COLUMN IF NOT EXISTS origin_school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE SET NULL;

ALTER TABLE procurements.sms_enrollments
  ADD COLUMN IF NOT EXISTS record_request_id BIGINT;

-- ============================================================================
-- 1B. Create sms_record_requests table
-- ============================================================================

CREATE TABLE IF NOT EXISTS procurements.sms_record_requests (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  student_lrn TEXT NOT NULL,
  requesting_school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  origin_school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  target_grade_level INTEGER CHECK (target_grade_level >= 0 AND target_grade_level <= 12),
  target_school_year TEXT,
  requested_by BIGINT NOT NULL REFERENCES procurements.sms_users(id),
  approved_by BIGINT REFERENCES procurements.sms_users(id),
  remarks TEXT,
  rejection_reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate pending requests for same student between same schools
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_record_requests_pending_unique
  ON procurements.sms_record_requests(student_id, requesting_school_id, origin_school_id)
  WHERE status = 'pending';

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_sms_record_requests_student ON procurements.sms_record_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_sms_record_requests_requesting_school ON procurements.sms_record_requests(requesting_school_id);
CREATE INDEX IF NOT EXISTS idx_sms_record_requests_origin_school ON procurements.sms_record_requests(origin_school_id);
CREATE INDEX IF NOT EXISTS idx_sms_record_requests_status ON procurements.sms_record_requests(status);
CREATE INDEX IF NOT EXISTS idx_sms_record_requests_lrn ON procurements.sms_record_requests(student_lrn);

-- FK from enrollments → record_requests
ALTER TABLE procurements.sms_enrollments
  ADD CONSTRAINT fk_enrollments_record_request
  FOREIGN KEY (record_request_id) REFERENCES procurements.sms_record_requests(id) ON DELETE SET NULL;

-- Updated_at trigger
CREATE TRIGGER update_sms_record_requests_updated_at
  BEFORE UPDATE ON procurements.sms_record_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE procurements.sms_record_requests ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 1C. Enrollment indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sms_enrollments_enrollment_status
  ON procurements.sms_enrollments(enrollment_status);

CREATE INDEX IF NOT EXISTS idx_sms_enrollments_active_school
  ON procurements.sms_enrollments(school_id, enrollment_status)
  WHERE enrollment_status = 'active';

CREATE INDEX IF NOT EXISTS idx_sms_enrollments_school_active_student
  ON procurements.sms_enrollments(school_id, student_id)
  WHERE status = 'approved' AND enrollment_status = 'active';

-- ============================================================================
-- 1D. Backfill existing data
-- ============================================================================

-- Transferred students: latest enrollment → 'transferred_out'
UPDATE procurements.sms_enrollments e
SET enrollment_status = 'transferred_out'
FROM procurements.sms_students s
WHERE e.student_id = s.id
  AND s.enrollment_status = 'transferred'
  AND e.status = 'approved'
  AND e.id = (
    SELECT e2.id FROM procurements.sms_enrollments e2
    WHERE e2.student_id = s.id AND e2.status = 'approved'
    ORDER BY e2.school_year DESC, e2.created_at DESC LIMIT 1
  );

-- Graduated students: latest enrollment → 'completed'
UPDATE procurements.sms_enrollments e
SET enrollment_status = 'completed'
FROM procurements.sms_students s
WHERE e.student_id = s.id
  AND s.enrollment_status = 'graduated'
  AND e.status = 'approved'
  AND e.id = (
    SELECT e2.id FROM procurements.sms_enrollments e2
    WHERE e2.student_id = s.id AND e2.status = 'approved'
    ORDER BY e2.school_year DESC, e2.created_at DESC LIMIT 1
  );

-- Dropped students: latest enrollment → 'dropped'
UPDATE procurements.sms_enrollments e
SET enrollment_status = 'dropped'
FROM procurements.sms_students s
WHERE e.student_id = s.id
  AND s.enrollment_status = 'dropped'
  AND e.status = 'approved'
  AND e.id = (
    SELECT e2.id FROM procurements.sms_enrollments e2
    WHERE e2.student_id = s.id AND e2.status = 'approved'
    ORDER BY e2.school_year DESC, e2.created_at DESC LIMIT 1
  );

-- Backfill origin_school_id from the enrollment's own school_id
UPDATE procurements.sms_enrollments
SET origin_school_id = school_id
WHERE origin_school_id IS NULL AND school_id IS NOT NULL;

-- ============================================================================
-- 1E. RLS Policies on sms_record_requests
-- ============================================================================

CREATE POLICY "Record requests viewable by involved schools"
  ON procurements.sms_record_requests FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      requesting_school_id = (SELECT school_id FROM procurements.sms_users WHERE user_id = auth.uid() LIMIT 1)
      OR origin_school_id = (SELECT school_id FROM procurements.sms_users WHERE user_id = auth.uid() LIMIT 1)
      OR (SELECT type FROM procurements.sms_users WHERE user_id = auth.uid() LIMIT 1) = 'division_admin'
    )
  );

CREATE POLICY "Record requests insertable by school staff"
  ON procurements.sms_record_requests FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND requesting_school_id = (SELECT school_id FROM procurements.sms_users WHERE user_id = auth.uid() LIMIT 1)
  );

CREATE POLICY "Record requests updatable by origin school"
  ON procurements.sms_record_requests FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND (
      origin_school_id = (SELECT school_id FROM procurements.sms_users WHERE user_id = auth.uid() LIMIT 1)
      OR (SELECT type FROM procurements.sms_users WHERE user_id = auth.uid() LIMIT 1) = 'division_admin'
    )
  );

CREATE POLICY "Record requests deletable by division admin"
  ON procurements.sms_record_requests FOR DELETE
  USING (
    (SELECT type FROM procurements.sms_users WHERE user_id = auth.uid() LIMIT 1) = 'division_admin'
  );

-- ============================================================================
-- 1F. RPC Functions
-- ============================================================================

-- Cross-school LRN lookup (limited preview)
CREATE OR REPLACE FUNCTION procurements.lookup_student_by_lrn(p_lrn TEXT)
RETURNS TABLE (
  student_id BIGINT, lrn TEXT, first_name TEXT, last_name TEXT,
  middle_name TEXT, suffix TEXT, date_of_birth DATE, gender TEXT,
  current_school_id BIGINT, current_school_name TEXT,
  current_grade_level INTEGER, current_school_year TEXT, enrollment_status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.lrn, s.first_name, s.last_name, s.middle_name, s.suffix,
    s.date_of_birth, s.gender, e.school_id, sch.name,
    e.grade_level, e.school_year, e.enrollment_status
  FROM procurements.sms_students s
  LEFT JOIN LATERAL (
    SELECT e2.school_id, e2.grade_level, e2.school_year, e2.enrollment_status
    FROM procurements.sms_enrollments e2
    WHERE e2.student_id = s.id AND e2.status = 'approved'
    ORDER BY e2.school_year DESC, e2.created_at DESC LIMIT 1
  ) e ON TRUE
  LEFT JOIN procurements.sms_schools sch ON sch.id = e.school_id
  WHERE s.lrn = p_lrn;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Atomic: enroll transferee + create record request in one transaction
CREATE OR REPLACE FUNCTION procurements.enroll_student_with_record_request(
  p_student_id BIGINT, p_requesting_school_id BIGINT, p_requested_by BIGINT,
  p_section_id BIGINT, p_grade_level INTEGER, p_school_year TEXT,
  p_semester INTEGER DEFAULT NULL, p_remarks TEXT DEFAULT NULL
) RETURNS TABLE (enrollment_id BIGINT, request_id BIGINT) AS $$
DECLARE
  v_origin_school_id BIGINT; v_student_lrn TEXT;
  v_enrollment_id BIGINT; v_request_id BIGINT;
BEGIN
  SELECT s.lrn INTO v_student_lrn FROM procurements.sms_students s WHERE s.id = p_student_id;
  IF v_student_lrn IS NULL THEN RAISE EXCEPTION 'Student not found'; END IF;

  SELECT e.school_id INTO v_origin_school_id
  FROM procurements.sms_enrollments e
  WHERE e.student_id = p_student_id AND e.status = 'approved'
    AND e.enrollment_status IN ('active', 'completed')
  ORDER BY e.school_year DESC, e.created_at DESC LIMIT 1;

  IF v_origin_school_id IS NULL THEN RAISE EXCEPTION 'Student has no active enrollment'; END IF;
  IF v_origin_school_id = p_requesting_school_id THEN RAISE EXCEPTION 'Student already at this school'; END IF;

  -- Create record request
  INSERT INTO procurements.sms_record_requests (
    student_id, student_lrn, requesting_school_id, origin_school_id,
    requested_by, target_grade_level, target_school_year, remarks
  ) VALUES (
    p_student_id, v_student_lrn, p_requesting_school_id, v_origin_school_id,
    p_requested_by, p_grade_level, p_school_year, p_remarks
  ) RETURNING id INTO v_request_id;

  -- Mark origin enrollment as pending_transfer
  UPDATE procurements.sms_enrollments
  SET enrollment_status = 'pending_transfer'
  WHERE student_id = p_student_id AND school_id = v_origin_school_id
    AND status = 'approved' AND enrollment_status = 'active';

  -- Create new enrollment at requesting school (status = 'pending' until record approved)
  INSERT INTO procurements.sms_enrollments (
    student_id, school_id, section_id, grade_level, school_year, semester,
    status, enrollment_status, origin_school_id, record_request_id, enrolled_by
  ) VALUES (
    p_student_id, p_requesting_school_id, p_section_id, p_grade_level, p_school_year,
    p_semester, 'pending', 'active', v_origin_school_id, v_request_id, p_requested_by
  ) RETURNING id INTO v_enrollment_id;

  -- Update student school_id for backward compat
  UPDATE procurements.sms_students
  SET school_id = p_requesting_school_id, enrollment_status = 'enrolled',
      grade_level = p_grade_level, current_section_id = p_section_id
  WHERE id = p_student_id;

  RETURN QUERY SELECT v_enrollment_id, v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create record request (standalone)
CREATE OR REPLACE FUNCTION procurements.create_record_request(
  p_student_id BIGINT, p_requesting_school_id BIGINT, p_requested_by BIGINT,
  p_target_grade_level INTEGER DEFAULT NULL, p_target_school_year TEXT DEFAULT NULL,
  p_remarks TEXT DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
  v_origin_school_id BIGINT; v_student_lrn TEXT; v_request_id BIGINT;
BEGIN
  SELECT s.lrn INTO v_student_lrn FROM procurements.sms_students s WHERE s.id = p_student_id;
  IF v_student_lrn IS NULL THEN RAISE EXCEPTION 'Student not found'; END IF;

  SELECT e.school_id INTO v_origin_school_id
  FROM procurements.sms_enrollments e
  WHERE e.student_id = p_student_id AND e.status = 'approved'
    AND e.enrollment_status IN ('active', 'completed')
  ORDER BY e.school_year DESC, e.created_at DESC LIMIT 1;

  IF v_origin_school_id IS NULL THEN RAISE EXCEPTION 'Student has no active enrollment'; END IF;
  IF v_origin_school_id = p_requesting_school_id THEN RAISE EXCEPTION 'Cannot request from same school'; END IF;

  INSERT INTO procurements.sms_record_requests (
    student_id, student_lrn, requesting_school_id, origin_school_id,
    requested_by, target_grade_level, target_school_year, remarks
  ) VALUES (
    p_student_id, v_student_lrn, p_requesting_school_id, v_origin_school_id,
    p_requested_by, p_target_grade_level, p_target_school_year, p_remarks
  ) RETURNING id INTO v_request_id;

  UPDATE procurements.sms_enrollments
  SET enrollment_status = 'pending_transfer'
  WHERE student_id = p_student_id AND school_id = v_origin_school_id
    AND status = 'approved' AND enrollment_status = 'active';

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Approve or reject record request
CREATE OR REPLACE FUNCTION procurements.respond_to_record_request(
  p_request_id BIGINT, p_action TEXT, p_responder_id BIGINT,
  p_rejection_reason TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE v_request RECORD;
BEGIN
  IF p_action NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Invalid action'; END IF;

  SELECT * INTO v_request FROM procurements.sms_record_requests
  WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  UPDATE procurements.sms_record_requests
  SET status = p_action, approved_by = p_responder_id, responded_at = NOW(),
      rejection_reason = CASE WHEN p_action = 'rejected' THEN p_rejection_reason ELSE NULL END
  WHERE id = p_request_id;

  IF p_action = 'approved' THEN
    -- Mark origin enrollment as transferred_out
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'transferred_out', updated_at = NOW()
    WHERE student_id = v_request.student_id AND school_id = v_request.origin_school_id
      AND status = 'approved' AND enrollment_status IN ('active', 'pending_transfer');

    -- Approve the pending enrollment at the requesting school
    UPDATE procurements.sms_enrollments
    SET status = 'approved', updated_at = NOW()
    WHERE record_request_id = p_request_id AND status = 'pending';

  ELSIF p_action = 'rejected' THEN
    -- Revert origin enrollment to active
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'active', updated_at = NOW()
    WHERE student_id = v_request.student_id AND school_id = v_request.origin_school_id
      AND status = 'approved' AND enrollment_status = 'pending_transfer';

    -- Remove the pending enrollment at the requesting school
    DELETE FROM procurements.sms_enrollments
    WHERE record_request_id = p_request_id AND status = 'pending';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Cancel record request (by requesting school)
CREATE OR REPLACE FUNCTION procurements.cancel_record_request(
  p_request_id BIGINT, p_user_id BIGINT
) RETURNS VOID AS $$
DECLARE v_request RECORD;
BEGIN
  SELECT * INTO v_request FROM procurements.sms_record_requests
  WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  UPDATE procurements.sms_record_requests SET status = 'cancelled' WHERE id = p_request_id;

  -- Revert origin enrollment to active
  UPDATE procurements.sms_enrollments
  SET enrollment_status = 'active', updated_at = NOW()
  WHERE student_id = v_request.student_id AND school_id = v_request.origin_school_id
    AND status = 'approved' AND enrollment_status = 'pending_transfer';

  -- Remove the pending enrollment at the requesting school
  DELETE FROM procurements.sms_enrollments
  WHERE record_request_id = p_request_id AND status = 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get current school for a student
CREATE OR REPLACE FUNCTION procurements.get_student_current_school(p_student_id BIGINT)
RETURNS BIGINT AS $$
  SELECT e.school_id FROM procurements.sms_enrollments e
  WHERE e.student_id = p_student_id AND e.status = 'approved' AND e.enrollment_status = 'active'
  ORDER BY e.school_year DESC, e.created_at DESC LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- 1G. Deprecate sms_students.school_id (comment only, column kept)
-- ============================================================================

COMMENT ON COLUMN procurements.sms_students.school_id
  IS 'DEPRECATED - Use sms_enrollments for school relationship. Kept for backward compatibility.';

COMMENT ON TABLE procurements.sms_record_requests
  IS 'Inter-school student record transfer requests. Created when a school enrolls a transferee.';

-- ============================================================================
-- 1H. Grant permissions
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_record_requests TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_record_requests_id_seq TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.lookup_student_by_lrn TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.enroll_student_with_record_request TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.create_record_request TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.respond_to_record_request TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.cancel_record_request TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.get_student_current_school TO authenticated;

-- <<< END 038_multi_school_transfers.sql

-- ============================================================================
-- >>> BEGIN 039_fix_enrollment_unique_constraint.sql
-- ============================================================================

-- Fix: include school_id in enrollment uniqueness constraint
-- so a student can have enrollments at different schools for the same school_year/semester
-- (required for the transfer workflow)

DROP INDEX IF EXISTS procurements.uq_enrollments_student_school_year_semester;

CREATE UNIQUE INDEX uq_enrollments_student_school_year_semester
  ON procurements.sms_enrollments (student_id, school_id, school_year, COALESCE(semester, 0));

-- <<< END 039_fix_enrollment_unique_constraint.sql

-- ============================================================================
-- >>> BEGIN 040_fix_sections_unique_constraint.sql
-- ============================================================================

-- Fix sections unique constraint to include school_id
-- The original constraint UNIQUE(name, school_year, grade_level) doesn't account
-- for different schools having sections with the same name/grade/year

ALTER TABLE procurements.sms_sections
  DROP CONSTRAINT IF EXISTS sms_sections_name_school_year_grade_level_key;

ALTER TABLE procurements.sms_sections
  ADD CONSTRAINT sms_sections_name_school_year_grade_level_school_id_key
  UNIQUE (name, school_year, grade_level, school_id);

-- <<< END 040_fix_sections_unique_constraint.sql

-- ============================================================================
-- >>> BEGIN 041_fix_subjects_select_rls.sql
-- ============================================================================

-- ============================================================================
-- FIX: Relax SELECT RLS on sms_subjects and sms_subject_schedules
-- ============================================================================
-- The policies from migration 037 require a matching sms_users.user_id row
-- to resolve school_id. If a user's auth UID is not linked in sms_users,
-- the subquery returns nothing and they see zero subjects/schedules —
-- even though they can see sections (which use a simple authenticated check).
--
-- Fix: match the sms_sections pattern — any authenticated user can SELECT.
-- The app already filters by school_id client-side. Write policies remain
-- role-restricted.
-- ============================================================================

-- 1. sms_subjects: replace strict SELECT policy with simple authenticated check
DROP POLICY IF EXISTS "Subjects are viewable by school members" ON procurements.sms_subjects;

CREATE POLICY "Subjects are viewable by authenticated users"
  ON procurements.sms_subjects FOR SELECT
  USING (auth.role() = 'authenticated');

-- 2. sms_subject_schedules: same fix
DROP POLICY IF EXISTS "Subject schedules are viewable by school members" ON procurements.sms_subject_schedules;

CREATE POLICY "Subject schedules are viewable by authenticated users"
  ON procurements.sms_subject_schedules FOR SELECT
  USING (auth.role() = 'authenticated');

-- <<< END 041_fix_subjects_select_rls.sql

-- ============================================================================
-- >>> BEGIN 042_fix_lookup_student_fallback_school.sql
-- ============================================================================

-- Fix: lookup_student_by_lrn should fall back to sms_students.school_id
-- when no enrollment exists. Previously, students added to a school but
-- not yet enrolled would show current_school_id = NULL, causing the
-- enrollment wizard to incorrectly flag them as transferees.

CREATE OR REPLACE FUNCTION procurements.lookup_student_by_lrn(p_lrn TEXT)
RETURNS TABLE (
  student_id BIGINT, lrn TEXT, first_name TEXT, last_name TEXT,
  middle_name TEXT, suffix TEXT, date_of_birth DATE, gender TEXT,
  current_school_id BIGINT, current_school_name TEXT,
  current_grade_level INTEGER, current_school_year TEXT, enrollment_status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.lrn, s.first_name, s.last_name, s.middle_name, s.suffix,
    s.date_of_birth, s.gender,
    COALESCE(e.school_id, s.school_id),
    COALESCE(sch_e.name, sch_s.name),
    e.grade_level, e.school_year, e.enrollment_status
  FROM procurements.sms_students s
  LEFT JOIN LATERAL (
    SELECT e2.school_id, e2.grade_level, e2.school_year, e2.enrollment_status
    FROM procurements.sms_enrollments e2
    WHERE e2.student_id = s.id AND e2.status = 'approved'
    ORDER BY e2.school_year DESC, e2.created_at DESC LIMIT 1
  ) e ON TRUE
  LEFT JOIN procurements.sms_schools sch_e ON sch_e.id = e.school_id
  LEFT JOIN procurements.sms_schools sch_s ON sch_s.id = s.school_id
  WHERE s.lrn = p_lrn;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- <<< END 042_fix_lookup_student_fallback_school.sql

-- ============================================================================
-- >>> BEGIN 043_school_settings.sql
-- ============================================================================

-- ============================================================================
-- SCHOOL SETTINGS TABLE
-- ============================================================================
-- Per-school system settings. Single row per school stores the config.
-- All authenticated users can read; authenticated users can update.
-- ============================================================================

CREATE TABLE IF NOT EXISTS procurements.sms_school_settings (
  id BIGSERIAL PRIMARY KEY,
  school_id TEXT,
  allow_edit_previous_school_year BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed a default global row (school_id = NULL) if table is empty
INSERT INTO procurements.sms_school_settings (school_id, allow_edit_previous_school_year)
SELECT NULL, false
WHERE NOT EXISTS (SELECT 1 FROM procurements.sms_school_settings LIMIT 1);

-- Updated_at trigger
CREATE TRIGGER update_sms_school_settings_updated_at
  BEFORE UPDATE ON procurements.sms_school_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE procurements.sms_school_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "School settings are viewable by authenticated users"
  ON procurements.sms_school_settings FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "School settings are updatable by authenticated users"
  ON procurements.sms_school_settings FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "School settings are insertable by authenticated users"
  ON procurements.sms_school_settings FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

COMMENT ON TABLE procurements.sms_school_settings IS 'Per-school system settings (e.g. editing controls for previous school years)';

-- Grant permissions for authenticated users
GRANT SELECT, INSERT, UPDATE ON procurements.sms_school_settings TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_school_settings_id_seq TO authenticated;

-- <<< END 043_school_settings.sql

-- ============================================================================
-- >>> BEGIN 044_attendance_am_pm.sql
-- ============================================================================

-- ============================================================================
-- ATTENDANCE AM/PM REFACTOR
-- ============================================================================
-- Adds am_present and pm_present boolean columns to sms_attendance.
-- Auto-computes the legacy `status` column via trigger for backward compat.
-- ============================================================================

SET search_path TO procurements, public;

-- 1. Add AM/PM columns (NULL = not yet recorded)
ALTER TABLE procurements.sms_attendance
  ADD COLUMN IF NOT EXISTS am_present BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pm_present BOOLEAN DEFAULT NULL;

-- 2. Drop the CHECK constraint on status and make it nullable
ALTER TABLE procurements.sms_attendance DROP CONSTRAINT IF EXISTS sms_attendance_status_check;
ALTER TABLE procurements.sms_attendance ALTER COLUMN status DROP NOT NULL;

-- 3. Backfill existing records
UPDATE procurements.sms_attendance
SET am_present = true, pm_present = true
WHERE status = 'present' AND am_present IS NULL;

UPDATE procurements.sms_attendance
SET am_present = false, pm_present = false
WHERE status = 'absent' AND am_present IS NULL;

UPDATE procurements.sms_attendance
SET am_present = true, pm_present = false
WHERE status = 'tardy' AND am_present IS NULL;

-- 4. Trigger to auto-compute status from am_present / pm_present
CREATE OR REPLACE FUNCTION procurements.compute_attendance_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.am_present IS NULL AND NEW.pm_present IS NULL THEN
    NEW.status := NULL;
  ELSIF NEW.am_present = true AND NEW.pm_present = true THEN
    NEW.status := 'present';
  ELSIF NEW.am_present = false AND NEW.pm_present = false THEN
    NEW.status := 'absent';
  ELSE
    NEW.status := 'tardy';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_compute_attendance_status
  BEFORE INSERT OR UPDATE ON procurements.sms_attendance
  FOR EACH ROW EXECUTE FUNCTION procurements.compute_attendance_status();

-- <<< END 044_attendance_am_pm.sql

-- ============================================================================
-- >>> BEGIN 045_retain_nlis.sql
-- ============================================================================

-- Add date_dropped column to sms_enrollments
ALTER TABLE procurements.sms_enrollments
  ADD COLUMN IF NOT EXISTS date_dropped DATE;

-- Drop the existing enrollment_status CHECK constraint and recreate with 'retained'
ALTER TABLE procurements.sms_enrollments
  DROP CONSTRAINT IF EXISTS sms_enrollments_enrollment_status_check;

ALTER TABLE procurements.sms_enrollments
  ADD CONSTRAINT sms_enrollments_enrollment_status_check
  CHECK (enrollment_status IN ('active', 'completed', 'transferred_out', 'dropped', 'pending_transfer', 'retained'));

-- <<< END 045_retain_nlis.sql

-- ============================================================================
-- >>> BEGIN 046_promotion_deadline.sql
-- ============================================================================

-- Add promotion_deadline column to school settings
ALTER TABLE procurements.sms_school_settings
ADD COLUMN IF NOT EXISTS promotion_deadline DATE;

-- <<< END 046_promotion_deadline.sql

-- ============================================================================
-- >>> BEGIN 047_eccd_checklist.sql
-- ============================================================================

-- ============================================================================
-- ECCD CHECKLIST TABLES
-- ============================================================================
-- Revised Philippine Early Childhood Development (ECCD) Checklist for
-- Kindergarten students. Assesses child development across 7 domains with
-- competency items rated 1-3 at three periods: BOSY, MOSY, EOSY.
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- SMS_ECCD_DOMAINS (Reference Table)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_eccd_domains (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_sms_eccd_domains_updated_at
  BEFORE UPDATE ON procurements.sms_eccd_domains
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE procurements.sms_eccd_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ECCD domains viewable by authenticated"
  ON procurements.sms_eccd_domains FOR SELECT
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE procurements.sms_eccd_domains IS 'ECCD Checklist development domains (Gross Motor, Fine Motor, etc.)';

-- ============================================================================
-- SMS_ECCD_COMPETENCIES (Reference Table)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_eccd_competencies (
  id BIGSERIAL PRIMARY KEY,
  domain_id BIGINT NOT NULL REFERENCES procurements.sms_eccd_domains(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eccd_competencies_domain
  ON procurements.sms_eccd_competencies(domain_id);

CREATE TRIGGER update_sms_eccd_competencies_updated_at
  BEFORE UPDATE ON procurements.sms_eccd_competencies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE procurements.sms_eccd_competencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ECCD competencies viewable by authenticated"
  ON procurements.sms_eccd_competencies FOR SELECT
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE procurements.sms_eccd_competencies IS 'Individual competency items under each ECCD domain';

-- ============================================================================
-- SMS_ECCD_ASSESSMENTS (Data Table)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_eccd_assessments (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  competency_id BIGINT NOT NULL REFERENCES procurements.sms_eccd_competencies(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('BOSY', 'MOSY', 'EOSY')),
  rating INTEGER CHECK (rating >= 1 AND rating <= 3),
  assessed_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  school_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, competency_id, section_id, school_year, period)
);

CREATE INDEX IF NOT EXISTS idx_eccd_assessments_student ON procurements.sms_eccd_assessments(student_id);
CREATE INDEX IF NOT EXISTS idx_eccd_assessments_section ON procurements.sms_eccd_assessments(section_id);
CREATE INDEX IF NOT EXISTS idx_eccd_assessments_school_year ON procurements.sms_eccd_assessments(school_year);
CREATE INDEX IF NOT EXISTS idx_eccd_assessments_period ON procurements.sms_eccd_assessments(period);
CREATE INDEX IF NOT EXISTS idx_eccd_assessments_school_id ON procurements.sms_eccd_assessments(school_id);

CREATE TRIGGER update_sms_eccd_assessments_updated_at
  BEFORE UPDATE ON procurements.sms_eccd_assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE procurements.sms_eccd_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ECCD assessments viewable by authenticated"
  ON procurements.sms_eccd_assessments FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "ECCD assessments insertable by authenticated"
  ON procurements.sms_eccd_assessments FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "ECCD assessments updatable by authenticated"
  ON procurements.sms_eccd_assessments FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "ECCD assessments deletable by authenticated"
  ON procurements.sms_eccd_assessments FOR DELETE
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE procurements.sms_eccd_assessments IS 'Student ECCD assessment ratings per competency per period (BOSY/MOSY/EOSY)';

-- ============================================================================
-- SEED DATA: ECCD DOMAINS
-- ============================================================================
INSERT INTO procurements.sms_eccd_domains (code, name, description, sort_order) VALUES
  ('GM',  'Gross Motor Skills',    'Large muscle movements such as running, jumping, balancing, and climbing', 1),
  ('FM',  'Fine Motor Skills',     'Small muscle control such as drawing, cutting, writing, and buttoning', 2),
  ('SH',  'Self-Help / Adaptive',  'Daily living skills such as eating, dressing, toileting, and hygiene', 3),
  ('RL',  'Receptive Language',    'Understanding spoken language such as following directions and identifying objects', 4),
  ('EL',  'Expressive Language',   'Using spoken language such as naming, describing, and asking questions', 5),
  ('COG', 'Cognitive',             'Thinking skills such as sorting, counting, problem-solving, and memory', 6),
  ('SE',  'Socio-Emotional',       'Social skills and emotional regulation such as sharing, cooperation, and expressing feelings', 7)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- SEED DATA: ECCD COMPETENCIES
-- ============================================================================

-- Gross Motor Skills
INSERT INTO procurements.sms_eccd_competencies (domain_id, code, description, sort_order) VALUES
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 'GM-01', 'Walks on a straight line without losing balance', 1),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 'GM-02', 'Runs without falling', 2),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 'GM-03', 'Jumps with both feet together', 3),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 'GM-04', 'Hops on one foot', 4),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 'GM-05', 'Climbs up and down stairs alternating feet', 5),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 'GM-06', 'Catches a ball with both hands', 6),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 'GM-07', 'Throws a ball overhand towards a target', 7),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 'GM-08', 'Kicks a ball forward', 8)
ON CONFLICT (code) DO NOTHING;

-- Fine Motor Skills
INSERT INTO procurements.sms_eccd_competencies (domain_id, code, description, sort_order) VALUES
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 'FM-01', 'Holds pencil/crayon with proper grip', 1),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 'FM-02', 'Draws basic shapes (circle, square, triangle)', 2),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 'FM-03', 'Copies letters and numbers', 3),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 'FM-04', 'Cuts along a straight line with scissors', 4),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 'FM-05', 'Cuts along a curved line with scissors', 5),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 'FM-06', 'Buttons and unbuttons clothing', 6),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 'FM-07', 'Strings beads or laces through holes', 7),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 'FM-08', 'Colors within boundaries', 8)
ON CONFLICT (code) DO NOTHING;

-- Self-Help / Adaptive
INSERT INTO procurements.sms_eccd_competencies (domain_id, code, description, sort_order) VALUES
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 'SH-01', 'Feeds self using spoon and fork properly', 1),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 'SH-02', 'Drinks from a cup without spilling', 2),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 'SH-03', 'Puts on and removes clothing independently', 3),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 'SH-04', 'Uses the toilet independently', 4),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 'SH-05', 'Washes and dries hands properly', 5),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 'SH-06', 'Brushes teeth with minimal assistance', 6),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 'SH-07', 'Puts away personal belongings after use', 7)
ON CONFLICT (code) DO NOTHING;

-- Receptive Language
INSERT INTO procurements.sms_eccd_competencies (domain_id, code, description, sort_order) VALUES
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 'RL-01', 'Follows simple one-step directions', 1),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 'RL-02', 'Follows two-step directions in sequence', 2),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 'RL-03', 'Identifies common objects when named', 3),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 'RL-04', 'Points to body parts when asked', 4),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 'RL-05', 'Understands simple questions (who, what, where)', 5),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 'RL-06', 'Listens to a short story and answers questions about it', 6),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 'RL-07', 'Understands basic concepts (big/small, up/down, in/out)', 7)
ON CONFLICT (code) DO NOTHING;

-- Expressive Language
INSERT INTO procurements.sms_eccd_competencies (domain_id, code, description, sort_order) VALUES
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 'EL-01', 'Says own first and last name', 1),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 'EL-02', 'Speaks in complete sentences of 4-5 words', 2),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 'EL-03', 'Names common objects and pictures', 3),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 'EL-04', 'Describes events or experiences in sequence', 4),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 'EL-05', 'Asks questions to seek information', 5),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 'EL-06', 'Recites simple rhymes or songs', 6),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 'EL-07', 'Uses words to express needs and feelings', 7)
ON CONFLICT (code) DO NOTHING;

-- Cognitive
INSERT INTO procurements.sms_eccd_competencies (domain_id, code, description, sort_order) VALUES
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 'COG-01', 'Sorts objects by color, shape, or size', 1),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 'COG-02', 'Counts objects from 1 to 10', 2),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 'COG-03', 'Recognizes and names basic colors', 3),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 'COG-04', 'Recognizes and names basic shapes', 4),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 'COG-05', 'Matches identical objects or pictures', 5),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 'COG-06', 'Arranges objects in order by size', 6),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 'COG-07', 'Identifies own written first name', 7),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 'COG-08', 'Completes simple puzzles (6-8 pieces)', 8),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 'COG-09', 'Understands concept of same and different', 9)
ON CONFLICT (code) DO NOTHING;

-- Socio-Emotional
INSERT INTO procurements.sms_eccd_competencies (domain_id, code, description, sort_order) VALUES
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 'SE-01', 'Separates from parent/caregiver without excessive distress', 1),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 'SE-02', 'Plays cooperatively with other children', 2),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 'SE-03', 'Takes turns and shares materials', 3),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 'SE-04', 'Follows classroom rules and routines', 4),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 'SE-05', 'Expresses emotions appropriately', 5),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 'SE-06', 'Shows empathy towards others', 6),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 'SE-07', 'Respects the rights and belongings of others', 7),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 'SE-08', 'Demonstrates confidence in attempting new tasks', 8)
ON CONFLICT (code) DO NOTHING;

-- <<< END 047_eccd_checklist.sql

-- ============================================================================
-- >>> BEGIN 048_sned_disabilities.sql
-- ============================================================================

-- ============================================================================
-- SNED DISABILITY / IMPAIRMENT INFORMATION
-- ============================================================================
-- Stores disability types for SNED (grade_level = -1) enrolled students.
-- A student may have multiple disabilities (multi-select).
-- ============================================================================

SET search_path TO procurements, public;

CREATE TABLE IF NOT EXISTS procurements.sms_student_disabilities (
  id            bigserial PRIMARY KEY,
  student_id    bigint NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  enrollment_id bigint NOT NULL REFERENCES procurements.sms_enrollments(id) ON DELETE CASCADE,
  disability    text NOT NULL,
  school_id     bigint,
  created_at    timestamptz DEFAULT now(),

  CONSTRAINT uq_student_enrollment_disability UNIQUE (student_id, enrollment_id, disability)
);

CREATE INDEX idx_sms_student_disabilities_student ON procurements.sms_student_disabilities(student_id);
CREATE INDEX idx_sms_student_disabilities_enrollment ON procurements.sms_student_disabilities(enrollment_id);

COMMENT ON TABLE procurements.sms_student_disabilities IS 'Disability/impairment types for SNED students (DepEd-aligned categories)';

-- <<< END 048_sned_disabilities.sql

-- ============================================================================
-- >>> BEGIN 049_requests_rebuild.sql
-- ============================================================================

-- ============================================================================
-- Migration 049: Requests Module Rebuild
-- Replaces sms_form_requests with a clean, scalable request system.
-- Old table is preserved (NOT dropped) for safe rollback.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Create sms_requests (main table)
-- ----------------------------------------------------------------------------
CREATE TABLE procurements.sms_requests (
  id                   BIGSERIAL PRIMARY KEY,
  tracking_number      TEXT NOT NULL UNIQUE,
  school_id            BIGINT REFERENCES procurements.sms_schools(id),
  request_type         TEXT NOT NULL DEFAULT 'form137',
  requester_type       TEXT NOT NULL DEFAULT 'student',
  requester_name       TEXT NOT NULL,
  requester_contact    TEXT NOT NULL,
  requester_email      TEXT,
  requester_relationship TEXT NOT NULL,
  student_name         TEXT NOT NULL,
  student_lrn          TEXT NOT NULL,
  student_id           BIGINT REFERENCES procurements.sms_students(id),
  last_school_attended TEXT,
  year_graduated       TEXT,
  purpose              TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending',
  rejection_reason     TEXT,
  delivery_file_path   TEXT,
  reviewed_by          BIGINT REFERENCES procurements.sms_users(id),
  reviewed_at          TIMESTAMPTZ,
  approved_by          BIGINT REFERENCES procurements.sms_users(id),
  approved_at          TIMESTAMPTZ,
  completed_by         BIGINT REFERENCES procurements.sms_users(id),
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sms_requests_request_type_check
    CHECK (request_type IN ('form137', 'diploma')),
  CONSTRAINT sms_requests_requester_type_check
    CHECK (requester_type IN ('school', 'parent', 'student')),
  CONSTRAINT sms_requests_status_check
    CHECK (status IN ('pending', 'under_review', 'approved', 'rejected', 'completed'))
);

-- ----------------------------------------------------------------------------
-- 2. Create sms_request_attachments
-- ----------------------------------------------------------------------------
CREATE TABLE procurements.sms_request_attachments (
  id           BIGSERIAL PRIMARY KEY,
  request_id   BIGINT NOT NULL REFERENCES procurements.sms_requests(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  file_type    TEXT NOT NULL,
  file_size    BIGINT,
  uploaded_by  TEXT,
  category     TEXT NOT NULL DEFAULT 'attachment',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sms_request_attachments_category_check
    CHECK (category IN ('attachment', 'sf10_delivery'))
);

-- ----------------------------------------------------------------------------
-- 3. Create sms_request_logs (audit trail)
-- ----------------------------------------------------------------------------
CREATE TABLE procurements.sms_request_logs (
  id              BIGSERIAL PRIMARY KEY,
  request_id      BIGINT NOT NULL REFERENCES procurements.sms_requests(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  actor_name      TEXT,
  actor_id        BIGINT REFERENCES procurements.sms_users(id),
  previous_status TEXT,
  new_status      TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sms_request_logs_action_check
    CHECK (action IN ('created', 'under_review', 'approved', 'rejected', 'completed', 'attachment_added'))
);

-- ----------------------------------------------------------------------------
-- 4. Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX idx_sms_requests_tracking_number ON procurements.sms_requests(tracking_number);
CREATE INDEX idx_sms_requests_school_id        ON procurements.sms_requests(school_id);
CREATE INDEX idx_sms_requests_status           ON procurements.sms_requests(status);
CREATE INDEX idx_sms_requests_student_lrn      ON procurements.sms_requests(student_lrn);
CREATE INDEX idx_sms_requests_created_at       ON procurements.sms_requests(created_at);
CREATE INDEX idx_sms_request_logs_request_id   ON procurements.sms_request_logs(request_id);
CREATE INDEX idx_sms_request_attachments_req   ON procurements.sms_request_attachments(request_id);

-- ----------------------------------------------------------------------------
-- 5. Migrate data from sms_form_requests
--    - Generates tracking numbers from old IDs
--    - Sets requester_type = 'student' for all migrated rows
--    - Builds student_name from joined sms_students
-- ----------------------------------------------------------------------------
INSERT INTO procurements.sms_requests (
  tracking_number,
  school_id,
  request_type,
  requester_type,
  requester_name,
  requester_contact,
  requester_email,
  requester_relationship,
  student_name,
  student_lrn,
  student_id,
  purpose,
  status,
  rejection_reason,
  approved_by,
  approved_at,
  completed_at,
  created_at,
  updated_at
)
SELECT
  'REQ-' || TO_CHAR(COALESCE(fr.created_at, now()), 'YYYYMMDD') || '-' || LPAD(fr.id::TEXT, 5, '0'),
  fr.school_id,
  COALESCE(fr.request_type, 'form137'),
  'student',
  fr.requestor_name,
  fr.requestor_contact,
  NULL,
  fr.requestor_relationship,
  COALESCE(
    CASE WHEN s.last_name IS NOT NULL AND s.first_name IS NOT NULL
      THEN s.last_name || ', ' || s.first_name
      ELSE NULL
    END,
    'Unknown'
  ),
  fr.student_lrn,
  fr.student_id,
  fr.purpose,
  fr.status,
  fr.remarks,
  fr.approved_by,
  fr.approved_at,
  fr.completed_at,
  COALESCE(fr.created_at, now()),
  COALESCE(fr.updated_at, now())
FROM procurements.sms_form_requests fr
LEFT JOIN procurements.sms_students s ON s.id = fr.student_id;

-- Insert 'created' log entries for every migrated request
INSERT INTO procurements.sms_request_logs (
  request_id,
  action,
  actor_name,
  previous_status,
  new_status,
  notes,
  created_at
)
SELECT
  r.id,
  'created',
  'Migrated',
  NULL,
  r.status,
  'Migrated from legacy sms_form_requests (id=' || fr.id || ')',
  r.created_at
FROM procurements.sms_requests r
JOIN procurements.sms_form_requests fr
  ON r.tracking_number = 'REQ-' || TO_CHAR(COALESCE(fr.created_at, now()), 'YYYYMMDD') || '-' || LPAD(fr.id::TEXT, 5, '0');

-- ----------------------------------------------------------------------------
-- 6. RLS Policies
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_requests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_request_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_request_logs        ENABLE ROW LEVEL SECURITY;

-- Allow anon/authenticated to read their own requests by tracking number (public portal)
CREATE POLICY "sms_requests_public_read"
  ON procurements.sms_requests FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "sms_requests_public_insert"
  ON procurements.sms_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "sms_requests_authenticated_update"
  ON procurements.sms_requests FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "sms_request_attachments_all"
  ON procurements.sms_request_attachments FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "sms_request_logs_all"
  ON procurements.sms_request_logs FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- NOTE: sms_form_requests is intentionally NOT dropped.
-- It is kept as a deprecated backup table for safe rollback.
-- Do not use it in new code -- use sms_requests instead.
-- ----------------------------------------------------------------------------

-- <<< END 049_requests_rebuild.sql

-- ============================================================================
-- >>> BEGIN 050_promotion_graduated_status.sql
-- ============================================================================

-- Add 'promoted' and 'graduated' to enrollment_status lifecycle values.
-- Previously, promotion was tracked as 'completed'. Now 'promoted' and 'graduated'
-- are explicit statuses used before a new enrollment is created.

ALTER TABLE procurements.sms_enrollments
  DROP CONSTRAINT IF EXISTS sms_enrollments_enrollment_status_check;

ALTER TABLE procurements.sms_enrollments
  ADD CONSTRAINT sms_enrollments_enrollment_status_check
  CHECK (enrollment_status IN ('active', 'completed', 'transferred_out', 'dropped', 'pending_transfer', 'retained', 'promoted', 'graduated'));

-- <<< END 050_promotion_graduated_status.sql

-- ============================================================================
-- >>> BEGIN 051_drop_sms_section_students.sql
-- ============================================================================

-- ============================================================================
-- DROP sms_section_students
-- ============================================================================
-- Section-student relationships are now based on sms_enrollments.
-- This migration removes the deprecated sms_section_students table.
-- ============================================================================

SET search_path TO procurements, public;

DROP TABLE IF EXISTS procurements.sms_section_students CASCADE;

-- <<< END 051_drop_sms_section_students.sql

-- ============================================================================
-- >>> BEGIN 052_transfer_out_metadata.sql
-- ============================================================================

-- Add transfer metadata columns to sms_enrollments
-- Supports the proactive "Transfer Out" workflow where origin school
-- pre-releases a student before the destination school requests records.

ALTER TABLE procurements.sms_enrollments
  ADD COLUMN IF NOT EXISTS transfer_destination_school_id BIGINT
    REFERENCES procurements.sms_schools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transfer_date DATE;

-- Index for querying transferred-out students by destination
CREATE INDEX IF NOT EXISTS idx_enrollments_transfer_destination
  ON procurements.sms_enrollments (transfer_destination_school_id)
  WHERE transfer_destination_school_id IS NOT NULL;

COMMENT ON COLUMN procurements.sms_enrollments.transfer_destination_school_id
  IS 'Optional destination school when a student is proactively transferred out';

COMMENT ON COLUMN procurements.sms_enrollments.transfer_date
  IS 'Effective date of the transfer out';

-- <<< END 052_transfer_out_metadata.sql

-- ============================================================================
-- >>> BEGIN 053_school_principal.sql
-- ============================================================================

-- Add principal name and title to school settings
ALTER TABLE procurements.sms_school_settings
  ADD COLUMN IF NOT EXISTS principal_name TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS principal_title TEXT DEFAULT 'Principal';

-- <<< END 053_school_principal.sql

-- ============================================================================
-- >>> BEGIN 054_evaluations.sql
-- ============================================================================

-- ============================================================================
-- EVALUATIONS (Teacher & Principal evaluation system)
-- ============================================================================

SET search_path TO procurements, public;

-- Evaluation questionnaire metadata
CREATE TABLE IF NOT EXISTS procurements.sms_evaluations (
  id BIGSERIAL PRIMARY KEY,
  school_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  school_year TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('student_to_teacher', 'teacher_to_principal')),
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_evaluations IS 'Evaluation questionnaires — student-to-teacher or teacher-to-principal';

CREATE INDEX idx_evaluations_school_id ON procurements.sms_evaluations(school_id);
CREATE INDEX idx_evaluations_school_year ON procurements.sms_evaluations(school_year);
CREATE INDEX idx_evaluations_type ON procurements.sms_evaluations(type);
CREATE INDEX idx_evaluations_active ON procurements.sms_evaluations(is_active) WHERE is_active = true;

CREATE TRIGGER update_sms_evaluations_updated_at
  BEFORE UPDATE ON procurements.sms_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Evaluation questions (ordered)
CREATE TABLE IF NOT EXISTS procurements.sms_evaluation_questions (
  id BIGSERIAL PRIMARY KEY,
  evaluation_id BIGINT NOT NULL REFERENCES procurements.sms_evaluations(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  order_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_evaluation_questions IS 'Questions belonging to an evaluation questionnaire';

CREATE INDEX idx_eval_questions_evaluation ON procurements.sms_evaluation_questions(evaluation_id);

CREATE TRIGGER update_sms_evaluation_questions_updated_at
  BEFORE UPDATE ON procurements.sms_evaluation_questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Evaluation responses (one row per question per respondent per evaluatee)
CREATE TABLE IF NOT EXISTS procurements.sms_evaluation_responses (
  id BIGSERIAL PRIMARY KEY,
  evaluation_id BIGINT NOT NULL REFERENCES procurements.sms_evaluations(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES procurements.sms_evaluation_questions(id) ON DELETE CASCADE,
  respondent_type TEXT NOT NULL CHECK (respondent_type IN ('student', 'teacher')),
  respondent_id BIGINT NOT NULL,
  evaluatee_id BIGINT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  school_year TEXT NOT NULL,
  school_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_evaluation_responses IS 'Individual rating responses — respondent_id is polymorphic (student or user)';

CREATE INDEX idx_eval_responses_evaluation ON procurements.sms_evaluation_responses(evaluation_id);
CREATE INDEX idx_eval_responses_question ON procurements.sms_evaluation_responses(question_id);
CREATE INDEX idx_eval_responses_respondent ON procurements.sms_evaluation_responses(respondent_type, respondent_id);
CREATE INDEX idx_eval_responses_evaluatee ON procurements.sms_evaluation_responses(evaluatee_id);
CREATE INDEX idx_eval_responses_school ON procurements.sms_evaluation_responses(school_id);

-- Prevent duplicate submissions
CREATE UNIQUE INDEX idx_eval_responses_unique
  ON procurements.sms_evaluation_responses(evaluation_id, question_id, respondent_type, respondent_id, evaluatee_id);

CREATE TRIGGER update_sms_evaluation_responses_updated_at
  BEFORE UPDATE ON procurements.sms_evaluation_responses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE procurements.sms_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_evaluation_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_evaluation_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Evaluations viewable by authenticated" ON procurements.sms_evaluations FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Evaluations insertable by authenticated" ON procurements.sms_evaluations FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Evaluations updatable by authenticated" ON procurements.sms_evaluations FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Evaluations deletable by authenticated" ON procurements.sms_evaluations FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "Eval questions viewable by authenticated" ON procurements.sms_evaluation_questions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Eval questions insertable by authenticated" ON procurements.sms_evaluation_questions FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Eval questions updatable by authenticated" ON procurements.sms_evaluation_questions FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Eval questions deletable by authenticated" ON procurements.sms_evaluation_questions FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "Eval responses viewable by authenticated" ON procurements.sms_evaluation_responses FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Eval responses insertable by authenticated" ON procurements.sms_evaluation_responses FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_evaluations TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_evaluations_id_seq TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_evaluation_questions TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_evaluation_questions_id_seq TO authenticated;
GRANT SELECT, INSERT ON procurements.sms_evaluation_responses TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_evaluation_responses_id_seq TO authenticated;

-- <<< END 054_evaluations.sql

-- ============================================================================
-- >>> BEGIN 055_report_card_core_values.sql
-- ============================================================================

-- ============================================================================
-- REPORT CARD CORE VALUES
-- Persists observed core value ratings per student per school year for printing
-- ============================================================================

SET search_path TO procurements, public;

CREATE TABLE IF NOT EXISTS procurements.sms_report_card_core_values (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL,
  school_year TEXT NOT NULL,
  core_values JSONB NOT NULL DEFAULT '{}',
  card_design TEXT NOT NULL DEFAULT '3-fold',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, school_year)
);

COMMENT ON TABLE procurements.sms_report_card_core_values IS 'Saved core value ratings per student per school year for report card printing';

CREATE INDEX idx_rc_core_values_student ON procurements.sms_report_card_core_values(student_id);
CREATE INDEX idx_rc_core_values_school ON procurements.sms_report_card_core_values(school_id, school_year);

CREATE TRIGGER update_sms_report_card_core_values_updated_at
  BEFORE UPDATE ON procurements.sms_report_card_core_values
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE procurements.sms_report_card_core_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "RC core values viewable by authenticated" ON procurements.sms_report_card_core_values FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "RC core values insertable by authenticated" ON procurements.sms_report_card_core_values FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "RC core values updatable by authenticated" ON procurements.sms_report_card_core_values FOR UPDATE USING (auth.role() = 'authenticated');

-- Grants
GRANT SELECT, INSERT, UPDATE ON procurements.sms_report_card_core_values TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_report_card_core_values_id_seq TO authenticated;

-- <<< END 055_report_card_core_values.sql

-- ============================================================================
-- >>> BEGIN 056_sync_student_enrollment_status_trigger.sql
-- ============================================================================

-- Trigger: automatically sync sms_students.enrollment_status from sms_enrollments.
--
-- Problem solved: previously, every piece of application code that updated
-- sms_enrollments.enrollment_status also had to manually update
-- sms_students.enrollment_status. This was fragile — a missed update silently
-- left the student record stale.
--
-- This trigger fires after any INSERT, UPDATE, or DELETE on sms_enrollments.
-- It finds the most recent approved enrollment for the affected student and
-- maps its lifecycle status to the student-level enrollment status.
--
-- Lifecycle → student status mapping:
--   active, promoted, retained, completed  → enrolled
--   graduated                              → graduated
--   transferred_out, pending_transfer      → transferred
--   dropped                                → dropped

CREATE OR REPLACE FUNCTION procurements.sync_student_enrollment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_student_id BIGINT;
  v_lifecycle_status TEXT;
  v_student_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_student_id := OLD.student_id;
  ELSE
    v_student_id := NEW.student_id;
  END IF;

  -- Derive status from the most recent approved enrollment
  SELECT enrollment_status INTO v_lifecycle_status
  FROM procurements.sms_enrollments
  WHERE student_id = v_student_id
    AND status = 'approved'
  ORDER BY school_year DESC, created_at DESC
  LIMIT 1;

  IF v_lifecycle_status IS NULL THEN
    -- No approved enrollment exists; leave student record unchanged
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  v_student_status := CASE v_lifecycle_status
    WHEN 'active'           THEN 'enrolled'
    WHEN 'promoted'         THEN 'enrolled'
    WHEN 'retained'         THEN 'enrolled'
    WHEN 'completed'        THEN 'enrolled'
    WHEN 'graduated'        THEN 'graduated'
    WHEN 'transferred_out'  THEN 'transferred'
    WHEN 'pending_transfer' THEN 'transferred'
    WHEN 'dropped'          THEN 'dropped'
    ELSE 'enrolled'
  END;

  UPDATE procurements.sms_students
  SET enrollment_status = v_student_status
  WHERE id = v_student_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_student_enrollment_status ON procurements.sms_enrollments;

CREATE TRIGGER trg_sync_student_enrollment_status
AFTER INSERT OR UPDATE OR DELETE
ON procurements.sms_enrollments
FOR EACH ROW
EXECUTE FUNCTION procurements.sync_student_enrollment_status();

-- <<< END 056_sync_student_enrollment_status_trigger.sql

-- ============================================================================
-- >>> BEGIN 057_transfer_two_stage_approval.sql
-- ============================================================================

-- ============================================================================
-- 057: Two-Stage Transfer Approval & Cross-School Data Access
-- ============================================================================
-- 1. Add 'pending_review' to enrollment_status allowed values
-- 2. Add record_access_granted + access_granted_at to sms_record_requests
-- 3. Update enroll_student_with_record_request to handle pre-released students
-- 4. Update respond_to_record_request: origin approval → pending_review (not auto-approve)
-- 5. New RPC: review_transfer_enrollment (destination school approve/reject)
-- 6. RLS policies for cross-school data access when record_access_granted = true
-- ============================================================================

-- ============================================================================
-- 1. Add 'pending_review' to enrollment_status CHECK constraint
-- ============================================================================

-- Drop and re-add the check constraint to include 'pending_review'
ALTER TABLE procurements.sms_enrollments
  DROP CONSTRAINT IF EXISTS sms_enrollments_enrollment_status_check;

ALTER TABLE procurements.sms_enrollments
  ADD CONSTRAINT sms_enrollments_enrollment_status_check
  CHECK (enrollment_status IN (
    'active', 'completed', 'transferred_out', 'dropped',
    'pending_transfer', 'retained', 'promoted', 'graduated',
    'pending_review'
  ));

-- ============================================================================
-- 2. Add record_access_granted columns to sms_record_requests
-- ============================================================================

ALTER TABLE procurements.sms_record_requests
  ADD COLUMN IF NOT EXISTS record_access_granted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE procurements.sms_record_requests
  ADD COLUMN IF NOT EXISTS access_granted_at TIMESTAMPTZ;

-- Index for quick RLS lookups
CREATE INDEX IF NOT EXISTS idx_sms_record_requests_access_granted
  ON procurements.sms_record_requests(student_id, requesting_school_id)
  WHERE record_access_granted = TRUE AND status = 'approved';

-- ============================================================================
-- 3. Update enroll_student_with_record_request to handle pre-released students
-- ============================================================================
-- Now handles students with enrollment_status 'transferred_out' or 'transferred'
-- instead of requiring a separate pre_released path in the frontend.

CREATE OR REPLACE FUNCTION procurements.enroll_student_with_record_request(
  p_student_id BIGINT, p_requesting_school_id BIGINT, p_requested_by BIGINT,
  p_section_id BIGINT, p_grade_level INTEGER, p_school_year TEXT,
  p_semester INTEGER DEFAULT NULL, p_remarks TEXT DEFAULT NULL
) RETURNS TABLE (enrollment_id BIGINT, request_id BIGINT) AS $$
DECLARE
  v_origin_school_id BIGINT; v_student_lrn TEXT;
  v_enrollment_id BIGINT; v_request_id BIGINT;
  v_origin_status TEXT;
BEGIN
  SELECT s.lrn INTO v_student_lrn FROM procurements.sms_students s WHERE s.id = p_student_id;
  IF v_student_lrn IS NULL THEN RAISE EXCEPTION 'Student not found'; END IF;

  -- Find the latest approved enrollment (now also accepts transferred_out/completed)
  SELECT e.school_id, e.enrollment_status INTO v_origin_school_id, v_origin_status
  FROM procurements.sms_enrollments e
  WHERE e.student_id = p_student_id AND e.status = 'approved'
    AND e.enrollment_status IN ('active', 'completed', 'transferred_out')
  ORDER BY e.school_year DESC, e.created_at DESC LIMIT 1;

  IF v_origin_school_id IS NULL THEN RAISE EXCEPTION 'Student has no active enrollment'; END IF;
  IF v_origin_school_id = p_requesting_school_id THEN RAISE EXCEPTION 'Student already at this school'; END IF;

  -- Create record request (always, even for pre-released students)
  INSERT INTO procurements.sms_record_requests (
    student_id, student_lrn, requesting_school_id, origin_school_id,
    requested_by, target_grade_level, target_school_year, remarks
  ) VALUES (
    p_student_id, v_student_lrn, p_requesting_school_id, v_origin_school_id,
    p_requested_by, p_grade_level, p_school_year, p_remarks
  ) RETURNING id INTO v_request_id;

  -- Mark origin enrollment as pending_transfer (only if still active)
  IF v_origin_status = 'active' THEN
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'pending_transfer'
    WHERE student_id = p_student_id AND school_id = v_origin_school_id
      AND status = 'approved' AND enrollment_status = 'active';
  END IF;

  -- Create new enrollment at requesting school (pending until full two-stage approval)
  INSERT INTO procurements.sms_enrollments (
    student_id, school_id, section_id, grade_level, school_year, semester,
    status, enrollment_status, origin_school_id, record_request_id, enrolled_by
  ) VALUES (
    p_student_id, p_requesting_school_id, p_section_id, p_grade_level, p_school_year,
    p_semester, 'pending', 'pending_transfer', v_origin_school_id, v_request_id, p_requested_by
  ) RETURNING id INTO v_enrollment_id;

  -- Update student school_id for backward compat
  UPDATE procurements.sms_students
  SET school_id = p_requesting_school_id, enrollment_status = 'enrolled',
      grade_level = p_grade_level, current_section_id = p_section_id
  WHERE id = p_student_id;

  RETURN QUERY SELECT v_enrollment_id, v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. Update respond_to_record_request: approval → pending_review (not active)
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.respond_to_record_request(
  p_request_id BIGINT, p_action TEXT, p_responder_id BIGINT,
  p_rejection_reason TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE v_request RECORD;
BEGIN
  IF p_action NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Invalid action'; END IF;

  SELECT * INTO v_request FROM procurements.sms_record_requests
  WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  UPDATE procurements.sms_record_requests
  SET status = p_action, approved_by = p_responder_id, responded_at = NOW(),
      rejection_reason = CASE WHEN p_action = 'rejected' THEN p_rejection_reason ELSE NULL END,
      -- Grant data access when approved
      record_access_granted = CASE WHEN p_action = 'approved' THEN TRUE ELSE FALSE END,
      access_granted_at = CASE WHEN p_action = 'approved' THEN NOW() ELSE NULL END
  WHERE id = p_request_id;

  IF p_action = 'approved' THEN
    -- Mark origin enrollment as transferred_out
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'transferred_out', updated_at = NOW()
    WHERE student_id = v_request.student_id AND school_id = v_request.origin_school_id
      AND status = 'approved' AND enrollment_status IN ('active', 'pending_transfer');

    -- Move enrollment to pending_review (NOT approved — destination school must review)
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'pending_review', updated_at = NOW()
    WHERE record_request_id = p_request_id AND status = 'pending';

  ELSIF p_action = 'rejected' THEN
    -- Revert origin enrollment to active
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'active', updated_at = NOW()
    WHERE student_id = v_request.student_id AND school_id = v_request.origin_school_id
      AND status = 'approved' AND enrollment_status = 'pending_transfer';

    -- Remove the pending enrollment at the requesting school
    DELETE FROM procurements.sms_enrollments
    WHERE record_request_id = p_request_id AND status = 'pending';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. New RPC: review_transfer_enrollment (destination school approve/reject)
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.review_transfer_enrollment(
  p_enrollment_id BIGINT, p_action TEXT, p_reviewer_id BIGINT,
  p_rejection_reason TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_enrollment RECORD;
  v_request RECORD;
BEGIN
  IF p_action NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Invalid action'; END IF;

  -- Get the enrollment that is pending review
  SELECT * INTO v_enrollment FROM procurements.sms_enrollments
  WHERE id = p_enrollment_id AND enrollment_status = 'pending_review' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enrollment not found or not pending review'; END IF;

  IF p_action = 'approved' THEN
    -- Approve the enrollment — student is now active
    UPDATE procurements.sms_enrollments
    SET status = 'approved', enrollment_status = 'active',
        approved_by = p_reviewer_id, updated_at = NOW()
    WHERE id = p_enrollment_id;

    -- Update student record
    UPDATE procurements.sms_students
    SET enrollment_status = 'enrolled',
        grade_level = v_enrollment.grade_level,
        current_section_id = v_enrollment.section_id,
        school_id = v_enrollment.school_id
    WHERE id = v_enrollment.student_id;

  ELSIF p_action = 'rejected' THEN
    -- Reject the enrollment
    UPDATE procurements.sms_enrollments
    SET status = 'rejected', enrollment_status = 'dropped',
        remarks = p_rejection_reason, updated_at = NOW()
    WHERE id = p_enrollment_id;

    -- Revoke data access on the record request
    IF v_enrollment.record_request_id IS NOT NULL THEN
      UPDATE procurements.sms_record_requests
      SET record_access_granted = FALSE
      WHERE id = v_enrollment.record_request_id;
    END IF;

    -- Update student — revert to previous state
    UPDATE procurements.sms_students
    SET enrollment_status = 'transferred',
        current_section_id = NULL
    WHERE id = v_enrollment.student_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. RLS policies for cross-school data access
-- ============================================================================
-- When a record request is approved and record_access_granted = true,
-- the requesting school can read the student's historical data from the
-- origin school. This enables the new school to generate DepEd forms.

-- Helper function: check if current user's school has granted access to a student
CREATE OR REPLACE FUNCTION procurements.has_record_access(p_student_id BIGINT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM procurements.sms_record_requests rr
    WHERE rr.student_id = p_student_id
      AND rr.record_access_granted = TRUE
      AND rr.status = 'approved'
      AND rr.requesting_school_id = (
        SELECT school_id FROM procurements.sms_users
        WHERE user_id = auth.uid() LIMIT 1
      )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Policy on sms_grades: allow requesting school to read transferee's grades
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Cross-school grade access via record request'
      AND tablename = 'sms_grades'
  ) THEN
    CREATE POLICY "Cross-school grade access via record request"
      ON procurements.sms_grades FOR SELECT
      USING (procurements.has_record_access(student_id));
  END IF;
END $$;

-- Policy on sms_attendance: allow requesting school to read transferee's attendance
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Cross-school attendance access via record request'
      AND tablename = 'sms_attendance'
  ) THEN
    CREATE POLICY "Cross-school attendance access via record request"
      ON procurements.sms_attendance FOR SELECT
      USING (procurements.has_record_access(student_id));
  END IF;
END $$;

-- Policy on sms_enrollments: allow requesting school to read transferee's enrollment history
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Cross-school enrollment access via record request'
      AND tablename = 'sms_enrollments'
  ) THEN
    CREATE POLICY "Cross-school enrollment access via record request"
      ON procurements.sms_enrollments FOR SELECT
      USING (procurements.has_record_access(student_id));
  END IF;
END $$;

-- Policy on sms_eccd_assessments: allow requesting school to read transferee's ECCD data
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Cross-school ECCD access via record request'
      AND tablename = 'sms_eccd_assessments'
  ) THEN
    CREATE POLICY "Cross-school ECCD access via record request"
      ON procurements.sms_eccd_assessments FOR SELECT
      USING (procurements.has_record_access(student_id));
  END IF;
END $$;

-- Policy on sms_learner_health: allow requesting school to read transferee's health data
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Cross-school health access via record request'
      AND tablename = 'sms_learner_health'
  ) THEN
    CREATE POLICY "Cross-school health access via record request"
      ON procurements.sms_learner_health FOR SELECT
      USING (procurements.has_record_access(student_id));
  END IF;
END $$;

-- ============================================================================
-- 7. Grant permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION procurements.review_transfer_enrollment TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.has_record_access TO authenticated;

-- <<< END 057_transfer_two_stage_approval.sql

-- ============================================================================
-- >>> BEGIN 058_allow_edit_promoted_student_grades.sql
-- ============================================================================

ALTER TABLE procurements.sms_school_settings
  ADD COLUMN IF NOT EXISTS allow_edit_promoted_student_grades BOOLEAN NOT NULL DEFAULT true;

-- <<< END 058_allow_edit_promoted_student_grades.sql

-- ============================================================================
-- >>> BEGIN 059_eccd_refactor.sql
-- ============================================================================

-- ============================================================================
-- ECCD CHECKLIST REFACTOR
-- ============================================================================
-- Changes the ECCD rating system from a 1-3 scale to checkbox (0/1),
-- switches periods from BOSY/MOSY/EOSY to 1ST_SEM/2ND_SEM,
-- adds scale score mappings per domain, and enables CRUD on reference tables.
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- 1. NEW TABLE: sms_eccd_scale_scores
-- Maps raw scores to scale scores per domain.
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_eccd_scale_scores (
  id BIGSERIAL PRIMARY KEY,
  domain_id BIGINT NOT NULL REFERENCES procurements.sms_eccd_domains(id) ON DELETE CASCADE,
  raw_score INTEGER NOT NULL CHECK (raw_score >= 0),
  scale_score NUMERIC(5,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(domain_id, raw_score)
);

CREATE INDEX IF NOT EXISTS idx_eccd_scale_scores_domain
  ON procurements.sms_eccd_scale_scores(domain_id);

CREATE TRIGGER update_sms_eccd_scale_scores_updated_at
  BEFORE UPDATE ON procurements.sms_eccd_scale_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE procurements.sms_eccd_scale_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ECCD scale scores viewable by authenticated"
  ON procurements.sms_eccd_scale_scores FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "ECCD scale scores insertable by authenticated"
  ON procurements.sms_eccd_scale_scores FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "ECCD scale scores updatable by authenticated"
  ON procurements.sms_eccd_scale_scores FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "ECCD scale scores deletable by authenticated"
  ON procurements.sms_eccd_scale_scores FOR DELETE
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE procurements.sms_eccd_scale_scores IS 'Raw score to scale score mapping per ECCD domain';

-- ============================================================================
-- 2. ADD CRUD POLICIES ON DOMAINS AND COMPETENCIES
-- (Currently SELECT-only; need INSERT/UPDATE/DELETE for admin CRUD page)
-- ============================================================================

-- Domains
CREATE POLICY "ECCD domains insertable by authenticated"
  ON procurements.sms_eccd_domains FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "ECCD domains updatable by authenticated"
  ON procurements.sms_eccd_domains FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "ECCD domains deletable by authenticated"
  ON procurements.sms_eccd_domains FOR DELETE
  USING (auth.role() = 'authenticated');

-- Competencies
CREATE POLICY "ECCD competencies insertable by authenticated"
  ON procurements.sms_eccd_competencies FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "ECCD competencies updatable by authenticated"
  ON procurements.sms_eccd_competencies FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "ECCD competencies deletable by authenticated"
  ON procurements.sms_eccd_competencies FOR DELETE
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- 3. DROP OLD CONSTRAINTS FIRST (before data migration)
-- ============================================================================

-- Drop ALL check constraints on sms_eccd_assessments (inline constraints have
-- auto-generated names that vary per database, so we drop them dynamically).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'procurements'
      AND rel.relname = 'sms_eccd_assessments'
      AND con.contype = 'c'  -- check constraints only
  LOOP
    EXECUTE format('ALTER TABLE procurements.sms_eccd_assessments DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- ============================================================================
-- 4. DATA MIGRATION: Convert existing assessment data
-- ============================================================================

-- Delete MOSY records (no equivalent in new 2-semester model)
DELETE FROM procurements.sms_eccd_assessments WHERE period = 'MOSY';

-- Convert ratings: 2 or 3 -> 1 (checked), 1 -> 0 (unchecked), null stays null
UPDATE procurements.sms_eccd_assessments
SET rating = CASE
  WHEN rating >= 2 THEN 1
  WHEN rating = 1 THEN 0
  ELSE rating
END
WHERE rating IS NOT NULL;

-- Convert periods: BOSY -> 1ST_SEM, EOSY -> 2ND_SEM
UPDATE procurements.sms_eccd_assessments SET period = '1ST_SEM' WHERE period = 'BOSY';
UPDATE procurements.sms_eccd_assessments SET period = '2ND_SEM' WHERE period = 'EOSY';

-- ============================================================================
-- 5. ADD NEW CONSTRAINTS (after data is migrated)
-- ============================================================================

ALTER TABLE procurements.sms_eccd_assessments
  ADD CONSTRAINT sms_eccd_assessments_period_check
  CHECK (period IN ('1ST_SEM', '2ND_SEM'));

ALTER TABLE procurements.sms_eccd_assessments
  ADD CONSTRAINT sms_eccd_assessments_rating_check
  CHECK (rating IN (0, 1));

-- ============================================================================
-- 5. PRE-SEED SCALE SCORE DEFAULTS
-- Standard DepEd ECCD scale score mappings per domain.
-- Domain item counts: GM=8, FM=8, SH=7, RL=7, EL=7, COG=9, SE=8
-- ============================================================================

-- Gross Motor Skills (8 items)
INSERT INTO procurements.sms_eccd_scale_scores (domain_id, raw_score, scale_score) VALUES
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 0, 1),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 1, 3),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 2, 5),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 3, 7),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 4, 9),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 5, 11),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 6, 13),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 7, 15),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'GM'), 8, 17)
ON CONFLICT (domain_id, raw_score) DO NOTHING;

-- Fine Motor Skills (8 items)
INSERT INTO procurements.sms_eccd_scale_scores (domain_id, raw_score, scale_score) VALUES
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 0, 1),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 1, 3),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 2, 5),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 3, 7),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 4, 9),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 5, 11),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 6, 13),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 7, 15),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'FM'), 8, 17)
ON CONFLICT (domain_id, raw_score) DO NOTHING;

-- Self-Help / Adaptive (7 items)
INSERT INTO procurements.sms_eccd_scale_scores (domain_id, raw_score, scale_score) VALUES
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 0, 1),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 1, 3),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 2, 5),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 3, 8),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 4, 10),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 5, 13),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 6, 15),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SH'), 7, 17)
ON CONFLICT (domain_id, raw_score) DO NOTHING;

-- Receptive Language (7 items)
INSERT INTO procurements.sms_eccd_scale_scores (domain_id, raw_score, scale_score) VALUES
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 0, 1),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 1, 3),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 2, 5),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 3, 8),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 4, 10),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 5, 13),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 6, 15),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'RL'), 7, 17)
ON CONFLICT (domain_id, raw_score) DO NOTHING;

-- Expressive Language (7 items)
INSERT INTO procurements.sms_eccd_scale_scores (domain_id, raw_score, scale_score) VALUES
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 0, 1),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 1, 3),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 2, 5),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 3, 8),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 4, 10),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 5, 13),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 6, 15),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'EL'), 7, 17)
ON CONFLICT (domain_id, raw_score) DO NOTHING;

-- Cognitive (9 items)
INSERT INTO procurements.sms_eccd_scale_scores (domain_id, raw_score, scale_score) VALUES
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 0, 1),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 1, 2),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 2, 4),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 3, 6),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 4, 8),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 5, 10),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 6, 12),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 7, 14),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 8, 16),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'COG'), 9, 17)
ON CONFLICT (domain_id, raw_score) DO NOTHING;

-- Socio-Emotional (8 items)
INSERT INTO procurements.sms_eccd_scale_scores (domain_id, raw_score, scale_score) VALUES
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 0, 1),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 1, 3),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 2, 5),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 3, 7),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 4, 9),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 5, 11),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 6, 13),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 7, 15),
  ((SELECT id FROM procurements.sms_eccd_domains WHERE code = 'SE'), 8, 17)
ON CONFLICT (domain_id, raw_score) DO NOTHING;

-- <<< END 059_eccd_refactor.sql

COMMIT;
