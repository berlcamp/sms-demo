-- ============================================================================
-- 141. Public landing pages — server-side enrollment aggregate
-- ============================================================================
--
-- WHY
-- ---
-- `/learners` and the landing home page both aggregate enrollment in the
-- browser: they `select` every approved enrollment row in the division for a
-- school year and count them in JavaScript. Three things are wrong with that,
-- and together they are why the published figures drift from reality:
--
--   1. STALE / TRUNCATED. PostgREST caps a collection response (Supabase's
--      default `max-rows` is 1000). Past that cap the pages count only the
--      first page of rows and show no error, so every learner enrolled after
--      the cap is invisible — the numbers stop moving while enrolment carries
--      on. Aggregating in SQL makes the response one row per school+grade.
--
--   2. WRONG POPULATION. Both pages filter `status = 'approved'` — the
--      *approval workflow* — and never look at `enrollment_status`, the
--      *lifecycle*. A learner who transferred out, dropped or is mid-transfer
--      keeps their approved row and is still counted. This is migration 109's
--      bug in the opposite direction, and it only ever inflates.
--
--   3. SHS DOUBLE COUNT. Grades 11-12 carry one enrollment row per semester
--      (EnrollmentWizard sets 1/2 for SHS, NULL below), so an SHS learner is
--      counted twice. Collapsed here per (school, grade, learner), as
--      migration 118 does for the KPIs.
--
-- The lifecycle roster is copied verbatim from 072's `enrollment_autofill`
-- ('active','completed','promoted','retained','graduated') so the public
-- figure, the school's own autofill and 140's division report all agree.
--
-- ALSO
-- ----
-- Migration 015's header claims "Enrollment stats use a SECURITY DEFINER
-- function to avoid exposing raw data" — no such function was ever written,
-- and the landing pages read raw `sms_enrollments` and `sms_students` rows
-- instead. This is that function, ~14 months late. Note it does not by itself
-- close the hole: 015's `sms_students` anon policy is still `USING (true)`,
-- i.e. the whole learner table is readable by anyone holding the anon key.
-- Narrowing it is a separate, deliberate change — the student portal and the
-- public request forms read that table too.
--
-- Test schools 9 and 10 are excluded here, matching the client-side exclusion
-- in `lib/constants/landing.ts`. Two places state the same fact; the honest
-- fix is an `is_test` flag on `sms_schools`, which needs an UPDATE against
-- production and so is left for you to decide on.
--
-- Additive: one new function, no DML, no schema change, no policy touched.
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.public_enrollment_counts(
  p_school_year TEXT
)
RETURNS TABLE (
  school_id BIGINT,
  grade_level INT,
  male INT,
  female INT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = procurements, public
AS $$
  -- DISTINCT collapses an SHS learner's two semester rows into one head.
  WITH learners AS (
    SELECT DISTINCT
      e.school_id,
      e.grade_level,
      e.student_id,
      st.gender
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_students st ON st.id = e.student_id
    WHERE e.school_year = p_school_year
      AND e.school_id IS NOT NULL
      AND e.enrollment_status IN (
        'active', 'completed', 'promoted', 'retained', 'graduated'
      )
  )
  SELECT
    l.school_id,
    l.grade_level,
    COUNT(*) FILTER (WHERE l.gender = 'male')::int   AS male,
    COUNT(*) FILTER (WHERE l.gender = 'female')::int AS female
  FROM learners l
  JOIN procurements.sms_schools s ON s.id = l.school_id
  WHERE s.is_active
    AND s.id NOT IN (9, 10)   -- test schools, never shown publicly
  GROUP BY l.school_id, l.grade_level
  ORDER BY l.school_id, l.grade_level;
$$;

GRANT EXECUTE ON FUNCTION procurements.public_enrollment_counts(TEXT)
  TO anon, authenticated;

COMMENT ON FUNCTION procurements.public_enrollment_counts(TEXT) IS
  'Per-school, per-grade learner counts by sex for the public landing pages. '
  'Aggregated server-side so the response is not subject to the PostgREST row '
  'cap; filters on enrollment_status (lifecycle), collapses SHS semester rows, '
  'and excludes inactive and test schools.';
