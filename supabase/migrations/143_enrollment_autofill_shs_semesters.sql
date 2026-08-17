-- ============================================================================
-- 143. enrollment_autofill — stop dropping every SHS learner
-- ============================================================================
--
-- WHY
-- ---
-- 072's autofill matches the semester like this:
--
--     AND ((p_semester IS NULL AND e.semester IS NULL) OR e.semester = p_semester)
--
-- and the school-side submission page calls it with `p_semester: null` in
-- every case. EnrollmentWizard writes a semester (1 or 2) for grades 11-12 and
-- NULL below, so `e.semester IS NULL` is false for every SHS row and the
-- clause silently discards them. A senior high school pressing "Autofill"
-- gets zeroes on the only two grades it teaches, with no error — and the
-- submission form has had rows for grades 11 and 12 the whole time.
--
-- Passing an explicit p_semester was never a workaround either: no caller
-- does, and it would then report one semester's roll rather than the school's
-- enrolment.
--
-- WHAT CHANGES
-- ------------
-- `p_semester IS NULL` now means "every semester" rather than "only rows with
-- no semester", and a learner is collapsed per (grade, learner) so someone
-- enrolled in both semesters is counted once — the same collapse migration 118
-- applies to the KPIs and 140/141 apply to the division and public figures.
-- Passing a specific p_semester still selects exactly that semester.
--
-- This is the third and last place the SHS drop had to be fixed; 140 and 141
-- worked around it rather than through it, because those functions are new and
-- this one is called from a page schools use.
--
-- EFFECT ON EXISTING DATA: none. This function only ever prefills a draft form
-- in the browser; it writes nothing. Submissions already filed keep whatever
-- figures the school typed, including any SHS numbers entered by hand — this
-- does not revisit or rewrite them. What changes is that the next press of
-- "Autofill" returns grades 11-12 instead of nothing.
--
-- Signature and result shape are unchanged, so this is a plain CREATE OR
-- REPLACE with no DROP and no dependent object to rebuild.
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.enrollment_autofill(
  p_school_id BIGINT,
  p_school_year TEXT,
  p_semester SMALLINT
)
RETURNS TABLE (
  grade_level INT,
  male INT,
  female INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  -- DISTINCT collapses an SHS learner's two semester rows into one head.
  WITH learners AS (
    SELECT DISTINCT
      e.grade_level,
      e.student_id,
      s.gender
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_students s ON s.id = e.student_id
    WHERE e.school_id = p_school_id
      AND e.school_year = p_school_year
      AND (p_semester IS NULL OR e.semester = p_semester)
      AND e.enrollment_status IN (
        'active', 'completed', 'promoted', 'retained', 'graduated'
      )
  )
  SELECT
    l.grade_level,
    COUNT(*) FILTER (WHERE l.gender = 'male')::int   AS male,
    COUNT(*) FILTER (WHERE l.gender = 'female')::int AS female
  FROM learners l
  GROUP BY l.grade_level
  ORDER BY l.grade_level;
$$;

COMMENT ON FUNCTION procurements.enrollment_autofill(BIGINT, TEXT, SMALLINT) IS
  'Live per-grade learner counts by sex for one school, used to prefill a '
  'division report submission draft and to render the division school page. '
  'A NULL p_semester means every semester, with SHS learners collapsed so a '
  'learner enrolled in both is counted once.';
