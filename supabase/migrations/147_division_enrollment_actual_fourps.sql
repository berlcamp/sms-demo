-- ============================================================================
-- 147. division_enrollment_actual — 4Ps is derivable after all
-- ============================================================================
--
-- CORRECTION TO 144
-- -----------------
-- Migration 144's header states "4Ps — no such field on any learner record".
-- That is wrong. `sms_students.is_4ps` has existed since migration 114
-- (BOOLEAN NOT NULL DEFAULT FALSE, added for SF1), and both the Students form
-- and the teacher's edit modal have captured it ever since. 144 excluded the
-- category on a bad search, not on a real limitation.
--
-- So 4Ps joins the derived set and only two of the eight categories still have
-- no operational source:
--
--   Balik-Aral  — genuinely nothing: no returning-learner flag exists
--   modality    — genuinely nothing: learning modality is stored nowhere
--
-- Both re-checked directly against the schema this time.
--
-- WHAT A 4Ps ROW MEANS HERE
-- -------------------------
-- Of the learners on the roll, those whose household is a 4Ps recipient — the
-- enrolled lifecycle roster AND `is_4ps`. It is a property of the learner, not
-- of the enrolment, which is why this is the first category needing
-- `sms_students` in the predicate rather than only in the sex breakdown.
--
-- CAVEAT WORTH KNOWING: `is_4ps` defaults to FALSE and nothing backfills it, so
-- a school that has never ticked the box reports zero 4Ps learners rather than
-- "unknown". The two states are indistinguishable in the data. A school that
-- has been keeping SF1 properly will already have it; one that has not must
-- fill it in on the learner record before this figure means anything.
--
-- WHY NO DROP: same signature as 144, so this is a plain CREATE OR REPLACE.
-- The guarded DROP of 140's three-argument form is repeated from 144 so this
-- migration lands correctly whether or not 144 was applied first — applying
-- 144 afterwards would simply restore the version without 4Ps, so apply them
-- in order.
-- ============================================================================

DROP FUNCTION IF EXISTS procurements.division_enrollment_actual(
  TEXT, SMALLINT, TEXT
);

CREATE OR REPLACE FUNCTION procurements.division_enrollment_actual(
  p_school_year TEXT,
  p_semester    SMALLINT DEFAULT NULL,
  p_school_type TEXT     DEFAULT NULL,
  p_category    TEXT     DEFAULT 'enrollment'
)
RETURNS TABLE (
  school_id   BIGINT,
  school_name TEXT,
  school_type TEXT,
  grade_level INT,
  male        INT,
  female      INT,
  total       INT,
  status      TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = procurements, public
AS $$
  WITH params AS (
    SELECT
      (SPLIT_PART(p_school_year, '-', 1)::INT - 1)::TEXT
        || '-' || SPLIT_PART(p_school_year, '-', 1) AS prev_sy
  ),
  scoped AS (
    SELECT
      s.id   AS school_id,
      s.name AS school_name,
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
  -- Every category except repeater is a predicate on this year's rows.
  -- DISTINCT collapses an SHS learner's two semester rows into one head.
  -- sms_students is joined here, not only in the aggregate, because 4Ps is a
  -- property of the learner rather than of the enrolment.
  picked AS (
    SELECT DISTINCT e.school_id, e.grade_level, e.student_id, st.gender
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_students st ON st.id = e.student_id
    WHERE e.school_year = p_school_year
      AND e.school_id IS NOT NULL
      AND (p_semester IS NULL OR e.semester = p_semester)
      AND CASE p_category
            WHEN 'enrollment' THEN e.enrollment_status IN (
              'active', 'completed', 'promoted', 'retained', 'graduated'
            )
            WHEN 'transfer_in'  THEN e.origin_school_id IS NOT NULL
            WHEN 'transfer_out' THEN e.enrollment_status = 'transferred_out'
            WHEN 'dropout'      THEN e.enrollment_status = 'dropped'
            WHEN 'promotee'     THEN e.enrollment_status = 'promoted'
            WHEN 'fourps'       THEN st.is_4ps AND e.enrollment_status IN (
              'active', 'completed', 'promoted', 'retained', 'graduated'
            )
            ELSE FALSE
          END
  ),
  -- Repeater needs last year's roll, so it cannot be a predicate on one row.
  repeaters AS (
    SELECT DISTINCT cur.school_id, cur.grade_level, cur.student_id, cur.gender
    FROM (
      SELECT DISTINCT e.school_id, e.grade_level, e.student_id, st.gender
      FROM procurements.sms_enrollments e
      JOIN procurements.sms_students st ON st.id = e.student_id
      WHERE p_category = 'repeater'
        AND e.school_year = p_school_year
        AND e.school_id IS NOT NULL
        AND (p_semester IS NULL OR e.semester = p_semester)
        AND e.enrollment_status IN (
          'active', 'completed', 'promoted', 'retained', 'graduated'
        )
    ) cur
    JOIN (
      SELECT DISTINCT e.school_id, e.grade_level, e.student_id
      FROM procurements.sms_enrollments e, params
      WHERE p_category = 'repeater'
        AND e.school_year = params.prev_sy
        AND e.school_id IS NOT NULL
    ) prev
      ON  prev.student_id  = cur.student_id
      AND prev.grade_level = cur.grade_level
      AND prev.school_id   = cur.school_id
  ),
  selected AS (
    SELECT p.school_id, p.grade_level, p.gender
    FROM picked p
    WHERE p_category <> 'repeater'
    UNION ALL
    SELECT r.school_id, r.grade_level, r.gender
    FROM repeaters r
    WHERE p_category = 'repeater'
  ),
  agg AS (
    SELECT
      sel.school_id,
      sel.grade_level,
      COUNT(*) FILTER (WHERE sel.gender = 'male')::int   AS male,
      COUNT(*) FILTER (WHERE sel.gender = 'female')::int AS female
    FROM selected sel
    GROUP BY sel.school_id, sel.grade_level
  )
  SELECT
    sc.school_id,
    sc.school_name,
    sc.school_type,
    -- -99 is 072's "this school has no rows" sentinel; the UI skips it.
    COALESCE(agg.grade_level, -99)                    AS grade_level,
    COALESCE(agg.male, 0)                             AS male,
    COALESCE(agg.female, 0)                           AS female,
    COALESCE(agg.male, 0) + COALESCE(agg.female, 0)   AS total,
    sc.status
  FROM scoped sc
  LEFT JOIN agg ON agg.school_id = sc.school_id
  -- Ordinal, not the name: `grade_level` is also a RETURNS TABLE parameter.
  ORDER BY sc.school_name, 4;
$$;

GRANT EXECUTE ON FUNCTION
  procurements.division_enrollment_actual(TEXT, SMALLINT, TEXT, TEXT)
  TO authenticated;

COMMENT ON FUNCTION
  procurements.division_enrollment_actual(TEXT, SMALLINT, TEXT, TEXT) IS
  'Live per-school/per-grade counts by sex for the derivable division report '
  'categories: enrollment, transfer_in, transfer_out, dropout, promotee, '
  'repeater, fourps. Definitions match generateSf4.ts, except repeater which '
  'follows migration 118 and fourps which reads sms_students.is_4ps (114). '
  'Balik-Aral and per-modality figures have no operational source and remain '
  'school-submitted.';
