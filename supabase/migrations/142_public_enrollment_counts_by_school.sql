-- ============================================================================
-- 142. public_enrollment_counts — optional single-school scope
-- ============================================================================
--
-- WHY
-- ---
-- 141 excludes the two Dev schools (ids 9, 10) unconditionally, which is right
-- for anything that lists or totals schools — the landing home page, /learners,
-- the school list — but wrong for `/schools/[slug]`, where someone has named
-- one school and asked for its figures. Since 141 those two pages render zero
-- enrolment, which makes the Dev schools useless for testing the public pages.
--
-- The distinction is aggregate vs. lookup, not public vs. private: a test
-- school must never inflate a division figure or appear in a list it was not
-- asked for, but a page reached by its own slug is already a deliberate
-- request for that one school. So the exclusion now applies only when no
-- school was named.
--
-- WHY A DROP
-- ----------
-- `p_school_id` cannot simply be added with a DEFAULT: Postgres would then
-- hold two overloads, `(TEXT)` and `(TEXT, BIGINT)`, and a one-argument call
-- would be ambiguous and fail. The one-arg form has to go first. This is the
-- same drop-then-create shape migration 075 used on division_enrollment_summary.
--
-- WHAT THIS DROP AFFECTS: one function created by migration 141, holding no
-- data. No table, column, policy or row is touched. If 141 has not been
-- applied, the DROP is a no-op and this migration still lands correctly.
--
-- Callers passing only p_school_year are unaffected — same name, same result
-- shape, same exclusion.
-- ============================================================================

DROP FUNCTION IF EXISTS procurements.public_enrollment_counts(TEXT);

CREATE OR REPLACE FUNCTION procurements.public_enrollment_counts(
  p_school_year TEXT,
  p_school_id BIGINT DEFAULT NULL
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
    -- Named school: return it, whatever it is.
    AND (p_school_id IS NULL OR s.id = p_school_id)
    -- No school named: this is an aggregate, so the test schools stay out.
    AND (p_school_id IS NOT NULL OR s.id NOT IN (9, 10))
  GROUP BY l.school_id, l.grade_level
  ORDER BY l.school_id, l.grade_level;
$$;

GRANT EXECUTE ON FUNCTION procurements.public_enrollment_counts(TEXT, BIGINT)
  TO anon, authenticated;

COMMENT ON FUNCTION procurements.public_enrollment_counts(TEXT, BIGINT) IS
  'Per-school, per-grade learner counts by sex for the public landing pages. '
  'Aggregated server-side so the response is not subject to the PostgREST row '
  'cap; filters on enrollment_status (lifecycle), collapses SHS semester rows, '
  'and excludes inactive schools. Test schools are excluded only when '
  'p_school_id is NULL, i.e. from aggregates and listings but not from a '
  'school''s own page.';
