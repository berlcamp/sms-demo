-- ============================================================================
-- 148. Balik-Aral on the enrolment — the last derivable division category
-- ============================================================================
--
-- WHY THE ENROLMENT, NOT THE LEARNER
-- ----------------------------------
-- Balik-Aral describes how a learner ARRIVED in a given school year: someone
-- returning to formal school after a year or more out. It is true of one
-- enrolment, not of a person. Put it on `sms_students` and the learner stays
-- flagged for life, so next year's report would count them again — wrong, and
-- silently so. `origin_school_id` sits on the enrolment for the same reason.
--
-- WHY NOT DERIVE IT
-- -----------------
-- It is *nearly* derivable — a learner enrolled this year with no enrolment
-- last year but with history in an earlier year is by definition returning.
-- Two things make that a guess rather than a fact here: SY 2025-2026 holds
-- 1,809 enrolment rows against this year's ~11,900, so the history is far too
-- thin to read an absence as meaningful; and a learner returning from a school
-- outside this system is indistinguishable from one who was simply never
-- encoded. A recorded field is honest where that inference would not be.
--
-- DEFAULT FALSE, DELIBERATELY — AND THE LIMIT OF THAT
-- --------------------------------------------------
-- Unlike modality, where any value is plausible, the overwhelming majority of
-- enrolments genuinely are not Balik-Aral, so FALSE is a true default rather
-- than a stand-in for "not asked". Note this is exactly the trap migration
-- 114's `is_4ps` fell into: it defaults FALSE and only 287 of 12,224 learners
-- are flagged, because the default made "no" and "nobody asked" identical.
-- The difference is that the wizard now puts this question in front of the
-- enroller at the moment of enrolment, which is the fix 114 never got.
--
-- Additive: one nullable-safe column with a default, plus the RPC gaining the
-- category. No row is modified and no existing count moves — nothing reads
-- this column until a school ticks it.
-- ============================================================================

ALTER TABLE procurements.sms_enrollments
  ADD COLUMN IF NOT EXISTS is_balik_aral BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN procurements.sms_enrollments.is_balik_aral IS
  'Learner returned to formal school after a year or more out, for THIS '
  'enrolment. Per enrolment, not per learner: the same learner is an ordinary '
  'enrolment the following year.';

CREATE INDEX IF NOT EXISTS idx_sms_enrollments_balik_aral
  ON procurements.sms_enrollments (school_year, school_id)
  WHERE is_balik_aral;

-- ---------------------------------------------------------------------------
-- division_enrollment_actual — add 'balik_aral'
-- ---------------------------------------------------------------------------
-- Full redefinition of 147's function with one more CASE branch. Same
-- signature, so a plain CREATE OR REPLACE; the guarded DROP of 140's
-- three-argument form is repeated so this lands whether or not 144/147 were
-- applied first. Apply 144 -> 147 -> 148 in order.
--
-- After this, `modality` is the ONLY thing on the enrollment report with no
-- operational source. Nothing anywhere records a learning modality, and
-- whether that is worth capturing is a question about whether the division
-- still acts on it, not a technical one.
-- ---------------------------------------------------------------------------

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
            WHEN 'balik_aral'   THEN e.is_balik_aral AND e.enrollment_status IN (
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
  'repeater, fourps, balik_aral. Definitions match generateSf4.ts, except '
  'repeater (migration 118), fourps (sms_students.is_4ps, 114) and balik_aral '
  '(sms_enrollments.is_balik_aral, 148). Only per-modality figures have no '
  'operational source and remain school-submitted.';
