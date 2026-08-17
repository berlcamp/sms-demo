-- ============================================================================
-- 144. division_enrollment_actual — derive five more categories
-- ============================================================================
--
-- WHY
-- ---
-- 140 derived only "Enrollment (Total)". Five of the remaining seven categories
-- are equally derivable from data the system already keeps, so schools were
-- typing numbers the database could have answered:
--
--   Transfer In   origin_school_id IS NOT NULL
--   Transfer Out  enrollment_status = 'transferred_out'
--   Dropout       enrollment_status = 'dropped'
--   Promotee      enrollment_status = 'promoted'
--   Repeater      same learner, same grade, previous school year
--
-- The first four are lifted verbatim from `lib/pdf/generateSf4.ts`, which has
-- counted them this way since long before the division module existed. That is
-- deliberate: SF4 is the official form the school files for the same figures,
-- so matching it means the division report and the school's own SF4 cannot
-- disagree. Inventing a cleaner definition here would have been the wrong kind
-- of correct.
--
-- Repeater follows migration 118's definition, not SF4's (SF4 has none): a
-- learner enrolled in grade X this year who was also in grade X last year,
-- WITHIN THE SAME SCHOOL. Per 118, a learner repeating after transferring in
-- is therefore not counted here — the previous year's row belongs to another
-- school. That is the correct reading at school scope; the division-wide KPI
-- page catches those.
--
-- STILL NOT DERIVABLE, and left on the submission path:
--   Balik-Aral   no such field on any learner record
--   4Ps          no such field on any learner record
--   any specific modality — learning modality is not stored anywhere
-- The page keeps reading division_enrollment_summary for those three.
--
-- WHY A DROP
-- ----------
-- `p_category` cannot be added with a DEFAULT beside the existing function:
-- Postgres would hold `(TEXT, SMALLINT, TEXT)` and `(TEXT, SMALLINT, TEXT,
-- TEXT)`, and the three-argument call the page already makes would be
-- ambiguous. Same reasoning, and the same shape, as 142 and 075.
--
-- WHAT THIS DROP AFFECTS: one function created by migration 140, holding no
-- data. No table, column, policy or row is touched. Callers that omit
-- p_category still get "Enrollment (Total)" exactly as before.
--
-- Nothing here writes. Submissions already filed are untouched and still
-- readable through division_enrollment_summary.
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
  -- Every category except repeater is a straight predicate on this year's
  -- rows. DISTINCT collapses an SHS learner's two semester rows into one head.
  picked AS (
    SELECT DISTINCT e.school_id, e.grade_level, e.student_id
    FROM procurements.sms_enrollments e
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
            ELSE FALSE
          END
  ),
  -- Repeater needs last year's roll, so it cannot be a predicate on one row.
  repeaters AS (
    SELECT DISTINCT cur.school_id, cur.grade_level, cur.student_id
    FROM (
      SELECT DISTINCT e.school_id, e.grade_level, e.student_id
      FROM procurements.sms_enrollments e
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
    SELECT p.school_id, p.grade_level, p.student_id
    FROM picked p
    WHERE p_category <> 'repeater'
    UNION ALL
    SELECT r.school_id, r.grade_level, r.student_id
    FROM repeaters r
    WHERE p_category = 'repeater'
  ),
  agg AS (
    SELECT
      sel.school_id,
      sel.grade_level,
      COUNT(*) FILTER (WHERE st.gender = 'male')::int   AS male,
      COUNT(*) FILTER (WHERE st.gender = 'female')::int AS female
    FROM selected sel
    JOIN procurements.sms_students st ON st.id = sel.student_id
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
  'repeater. Definitions match generateSf4.ts, except repeater which follows '
  'migration 118. Balik-Aral, 4Ps and per-modality figures have no operational '
  'source and remain school-submitted.';
