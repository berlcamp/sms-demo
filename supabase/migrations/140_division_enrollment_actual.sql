-- ============================================================================
-- 140. Division Enrollment report — live figures, no submission required
-- ============================================================================
--
-- WHY
-- ---
-- `/division/reports/enrollment` reads `division_enrollment_summary` (072/075),
-- which LEFT JOINs `sms_report_enrollment_rows` through a
-- `sms_division_report_submissions` header. Every school with no submission
-- therefore renders a single -99 row of zeroes — the division office sees a
-- wall of "Not submitted / 0 / 0 / 0" even though the learners are already
-- enrolled and countable in `sms_enrollments`.
--
-- This adds a sibling RPC that derives the same shape straight from the
-- operational tables, so the division sees real male/female figures the moment
-- a school enrols, and the submission becomes a formality rather than a
-- precondition for seeing the data.
--
-- WHAT IT IS *NOT*
-- ----------------
-- Only the "Enrollment (Total)" category at modality "All" is derivable — that
-- is exactly the one combination 072's `enrollment_autofill` supports on the
-- school side, because nothing in the operational schema records learning
-- modality, 4Ps membership, or balik-aral. Transfer in/out, dropout, promotee,
-- repeater, balik-aral and 4Ps are still school-keyed numbers and keep going
-- through `division_enrollment_summary`. The page picks the RPC per category.
--
-- The submission `status` is still returned, so the division can see who has
-- and has not filed the DepEd form alongside the live count. Nothing here
-- writes to a submission, and nothing is snapshot.
--
-- MATCHING THE SCHOOL SIDE
-- ------------------------
-- The lifecycle roster is copied verbatim from `enrollment_autofill`
-- ('active','completed','promoted','retained','graduated') and, per migration
-- 109's lesson, filters on `enrollment_status` (lifecycle) and NOT on `status`
-- (the approval workflow). If the two ever diverge, a school's own autofill
-- would disagree with what the division sees for that same school, which is
-- worse than either roster on its own.
--
-- ONE DIFFERENCE, DELIBERATE: SHS semesters.
-- `enrollment_autofill` matches `p_semester IS NULL AND e.semester IS NULL`,
-- and the page passes NULL — so SHS rows, which always carry a semester
-- (EnrollmentWizard sets 1/2 for grades 11-12 and NULL below), are dropped
-- entirely. A division-wide report that silently omits every Grade 11-12
-- learner is not usable, so here `p_semester IS NULL` means *all semesters*,
-- with the learner collapsed per (school, grade) so a learner enrolled in both
-- semesters is counted once. Same collapse migration 118 applies for the KPIs.
--
-- Additive: one new function, no DML, no schema change, existing RPC untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.division_enrollment_actual(
  p_school_year TEXT,
  p_semester SMALLINT DEFAULT NULL,
  p_school_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  school_type TEXT,
  grade_level INT,
  male INT,
  female INT,
  total INT,
  status TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  WITH scoped AS (
    SELECT
      s.id            AS school_id,
      s.name          AS school_name,
      s.school_type,
      COALESCE(sub.status, 'missing') AS status
    FROM procurements.sms_schools s
    LEFT JOIN procurements.sms_division_report_submissions sub
      ON sub.school_id = s.id
      AND sub.school_year = p_school_year
      AND sub.report_type = 'enrollment'
      AND (
        (p_semester IS NULL AND sub.semester IS NULL)
        OR sub.semester = p_semester
      )
    WHERE s.is_active
      AND (p_school_type IS NULL OR s.school_type = p_school_type)
  ),
  -- DISTINCT collapses the two SHS semester rows of one learner into one head.
  learners AS (
    SELECT DISTINCT
      e.school_id,
      e.grade_level,
      e.student_id,
      st.gender
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_students st ON st.id = e.student_id
    WHERE e.school_year = p_school_year
      AND (p_semester IS NULL OR e.semester = p_semester)
      AND e.enrollment_status IN (
        'active', 'completed', 'promoted', 'retained', 'graduated'
      )
  ),
  live AS (
    SELECT
      l.school_id,
      l.grade_level,
      COUNT(*) FILTER (WHERE l.gender = 'male')::int   AS male,
      COUNT(*) FILTER (WHERE l.gender = 'female')::int AS female
    FROM learners l
    GROUP BY l.school_id, l.grade_level
  )
  SELECT
    sc.school_id,
    sc.school_name,
    sc.school_type,
    -- -99 is 072's "this school has no rows" sentinel; the UI skips it.
    COALESCE(live.grade_level, -99)                        AS grade_level,
    COALESCE(live.male, 0)                                 AS male,
    COALESCE(live.female, 0)                               AS female,
    COALESCE(live.male, 0) + COALESCE(live.female, 0)      AS total,
    sc.status
  FROM scoped sc
  LEFT JOIN live ON live.school_id = sc.school_id
  -- Ordinal, not the name: `grade_level` is also a RETURNS TABLE parameter.
  ORDER BY sc.school_name, 4;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_enrollment_actual(TEXT, SMALLINT, TEXT)
  TO authenticated;

COMMENT ON FUNCTION procurements.division_enrollment_actual(TEXT, SMALLINT, TEXT) IS
  'Live per-school/per-grade enrollment by sex, derived from sms_enrollments. '
  'Same result shape as division_enrollment_summary but needs no school '
  'submission; status still reports the DepEd form submission state.';
