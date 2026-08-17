-- ============================================================================
-- 145. SHS strand on the section — Track & Strand and SHS Specialization
--      stop being typed reports
-- ============================================================================
--
-- WHY
-- ---
-- `lib/constants/shs.ts` has held the full DepEd SHS taxonomy since the
-- division module was built — four tracks, thirteen strands, specialization
-- suggestions per strand — but nothing in the operational schema ever recorded
-- which strand a learner is in. `strand` appears in exactly two places: the
-- report row tables, and one free-text column on historical transcripts. The
-- constant is used only BY the report forms. So a school types "STEM: 40 male,
-- 35 female" and the system has no idea which of its learners are STEM.
--
-- This puts the strand where it is actually decided.
--
-- WHY THE SECTION, NOT THE ENROLMENT
-- ----------------------------------
-- A strand is a curriculum, not a label: two strands mean two different subject
-- sets, which mean two different section schedules. An SHS section therefore
-- follows exactly one strand by construction — the same reasoning migration 136
-- used to pair an ALS subject to an ALS section, and for the same reason
-- (schedules are the only place a subject meets a section; there is no
-- section-subject table).
--
-- The live data agrees: across 13 schools teaching SHS, Grade 11-12 learners
-- sit in far more sections than capacity alone would need — one school runs 19
-- sections for 370 learners, averaging 19.5 each. That is strand separation.
--
-- Recording it on the section means a school sets it ONCE per section instead
-- of once per learner, and every learner enrolled into that section inherits
-- it through `sms_enrollments.section_id`, which is NOT NULL.
--
-- TEXT, NOT AN ENUM OR A CHECK, per the 119/132/133 precedent: DepEd revises
-- the strand and specialization lists, and a revision must not invalidate rows
-- already reported. `lib/constants/shs.ts` stays the only place the taxonomy is
-- written down and the app validates against it. TVL specializations in
-- particular are legion and schools may enter their own.
--
-- TRACK IS NOT STORED. It is a function of the strand
-- (`getTrackForStrand` in the same constants file), so storing it would be a
-- second copy that can disagree. The RPC returns the strand; the page resolves
-- the track. A DepEd revision that moves a strand between tracks is then a
-- constants change, not a data migration.
--
-- The CHECK only stops a Grade 7 section carrying a strand; it says nothing
-- about which strand values are legal. No existing row can violate it, since
-- neither column existed before this.
--
-- Additive: two nullable columns, one guard, two new functions. Nothing is
-- backfilled — every existing section reads as "no strand recorded" and the
-- reports fall back to the submitted figures until schools fill it in.
-- ============================================================================

ALTER TABLE procurements.sms_sections
  ADD COLUMN IF NOT EXISTS strand TEXT;

ALTER TABLE procurements.sms_sections
  ADD COLUMN IF NOT EXISTS specialization TEXT;

ALTER TABLE procurements.sms_sections
  DROP CONSTRAINT IF EXISTS sms_sections_strand_shs_only;
ALTER TABLE procurements.sms_sections
  ADD CONSTRAINT sms_sections_strand_shs_only CHECK (
    (strand IS NULL AND specialization IS NULL)
    OR grade_level IN (11, 12)
  );

COMMENT ON COLUMN procurements.sms_sections.strand IS
  'DepEd SHS strand code, validated in lib/constants/shs.ts. Grades 11-12 only. '
  'The track is derived from this, never stored.';
COMMENT ON COLUMN procurements.sms_sections.specialization IS
  'SHS specialization within the strand (mainly TVL). Free text: the DepEd list '
  'is long and schools legitimately add their own.';

-- ---------------------------------------------------------------------------
-- division_track_strand_actual
-- ---------------------------------------------------------------------------
-- Same result shape as division_track_strand_summary (075) MINUS `track`,
-- which the caller resolves from the strand. Sections with no strand recorded
-- are excluded rather than bucketed as "unknown": a school that has not filled
-- them in should read as no live data, not as a strand called blank.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.division_track_strand_actual(
  p_school_year TEXT,
  p_semester    SMALLINT DEFAULT NULL,
  p_grade_level INT      DEFAULT NULL
)
RETURNS TABLE (
  school_id   BIGINT,
  school_name TEXT,
  school_type TEXT,
  strand      TEXT,
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
  WITH scoped AS (
    SELECT
      s.id   AS school_id,
      s.name AS school_name,
      s.school_type,
      COALESCE(sub.status, 'missing') AS status
    FROM procurements.sms_schools s
    LEFT JOIN procurements.sms_division_report_submissions sub
      ON sub.school_id = s.id
      AND sub.school_year = p_school_year
      AND sub.report_type = 'track_strand'
      AND sub.semester = p_semester
    WHERE s.is_active
  ),
  -- DISTINCT collapses an SHS learner's two semester rows into one head.
  learners AS (
    SELECT DISTINCT
      e.school_id,
      sec.strand,
      e.grade_level,
      e.student_id,
      st.gender
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_sections sec ON sec.id = e.section_id
    JOIN procurements.sms_students st  ON st.id = e.student_id
    WHERE e.school_year = p_school_year
      AND e.school_id IS NOT NULL
      AND sec.strand IS NOT NULL
      AND e.grade_level IN (11, 12)
      AND (p_grade_level IS NULL OR e.grade_level = p_grade_level)
      AND (p_semester IS NULL OR e.semester = p_semester)
      AND e.enrollment_status IN (
        'active', 'completed', 'promoted', 'retained', 'graduated'
      )
  ),
  agg AS (
    SELECT
      l.school_id,
      l.strand,
      l.grade_level,
      COUNT(*) FILTER (WHERE l.gender = 'male')::int   AS male,
      COUNT(*) FILTER (WHERE l.gender = 'female')::int AS female
    FROM learners l
    GROUP BY l.school_id, l.strand, l.grade_level
  )
  SELECT
    sc.school_id,
    sc.school_name,
    sc.school_type,
    agg.strand,
    agg.grade_level,
    agg.male,
    agg.female,
    agg.male + agg.female AS total,
    sc.status
  FROM scoped sc
  JOIN agg ON agg.school_id = sc.school_id
  ORDER BY sc.school_name, 4, 5;
$$;

GRANT EXECUTE ON FUNCTION
  procurements.division_track_strand_actual(TEXT, SMALLINT, INT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- division_shs_specialization_actual
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.division_shs_specialization_actual(
  p_school_year TEXT,
  p_semester    SMALLINT DEFAULT NULL,
  p_grade_level INT      DEFAULT NULL,
  p_strand      TEXT     DEFAULT NULL
)
RETURNS TABLE (
  school_id      BIGINT,
  school_name    TEXT,
  school_type    TEXT,
  strand         TEXT,
  specialization TEXT,
  grade_level    INT,
  male           INT,
  female         INT,
  total          INT,
  status         TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = procurements, public
AS $$
  WITH scoped AS (
    SELECT
      s.id   AS school_id,
      s.name AS school_name,
      s.school_type,
      COALESCE(sub.status, 'missing') AS status
    FROM procurements.sms_schools s
    LEFT JOIN procurements.sms_division_report_submissions sub
      ON sub.school_id = s.id
      AND sub.school_year = p_school_year
      AND sub.report_type = 'shs_specialization'
      AND sub.semester = p_semester
    WHERE s.is_active
  ),
  learners AS (
    SELECT DISTINCT
      e.school_id,
      sec.strand,
      sec.specialization,
      e.grade_level,
      e.student_id,
      st.gender
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_sections sec ON sec.id = e.section_id
    JOIN procurements.sms_students st  ON st.id = e.student_id
    WHERE e.school_year = p_school_year
      AND e.school_id IS NOT NULL
      AND sec.strand IS NOT NULL
      AND sec.specialization IS NOT NULL
      AND e.grade_level IN (11, 12)
      AND (p_grade_level IS NULL OR e.grade_level = p_grade_level)
      AND (p_strand IS NULL OR sec.strand = p_strand)
      AND (p_semester IS NULL OR e.semester = p_semester)
      AND e.enrollment_status IN (
        'active', 'completed', 'promoted', 'retained', 'graduated'
      )
  ),
  agg AS (
    SELECT
      l.school_id,
      l.strand,
      l.specialization,
      l.grade_level,
      COUNT(*) FILTER (WHERE l.gender = 'male')::int   AS male,
      COUNT(*) FILTER (WHERE l.gender = 'female')::int AS female
    FROM learners l
    GROUP BY l.school_id, l.strand, l.specialization, l.grade_level
  )
  SELECT
    sc.school_id,
    sc.school_name,
    sc.school_type,
    agg.strand,
    agg.specialization,
    agg.grade_level,
    agg.male,
    agg.female,
    agg.male + agg.female AS total,
    sc.status
  FROM scoped sc
  JOIN agg ON agg.school_id = sc.school_id
  ORDER BY sc.school_name, 4, 5, 6;
$$;

GRANT EXECUTE ON FUNCTION
  procurements.division_shs_specialization_actual(TEXT, SMALLINT, INT, TEXT)
  TO authenticated;
