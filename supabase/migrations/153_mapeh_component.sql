-- MAPEH is one learning area, not four subjects.
--
-- DepEd prints MAPEH as a single subject line carrying one grade, with Music,
-- Arts, Physical Education and Health indented beneath it as the breakdown,
-- and it counts ONCE toward the general average. The system had no way to say
-- which subjects were components, so three surfaces each guessed, and all
-- three guessed differently:
--
--   * report card (generateReportCard.ts) and SF9 (generateSf9.ts) printed the
--     four flat and counted each as a full subject — MAPEH weighted 4x
--     against Mathematics;
--   * SF10 (generateSf10.ts) grouped them by running a regex over the subject
--     NAME, then excluded both the header and the components from its general
--     average — MAPEH weighted 0x;
--   * students_gpa_for_grade (128), which is what actually places and promotes
--     a learner, averages every grade row flat — 4x again.
--
-- This makes it a stored fact instead of a guess, and fixes the weighting to
-- 1x on the card, on SF9, and in the GPA function.
--
-- ---------------------------------------------------------------------------
-- WHAT MOVES WHEN THIS IS APPLIED
-- ---------------------------------------------------------------------------
-- Nothing, until a school tags a subject. `mapeh_component` defaults to NULL,
-- which means "not part of MAPEH", so every existing subject keeps the
-- behaviour the app already assumed and no stored grade, GPA or printed form
-- changes on apply. That is the same load-bearing default as 152's
-- question_count and 133's program backfill.
--
-- Once components ARE tagged, the general average on the report card and SF9
-- changes for every learner taking them, and so does the GPA behind section
-- placement and promotion. That is the point of the change, but it means a
-- card reprinted after tagging will not match one already signed on paper.
--
-- WHEN TO CHECK, AND HOW TO BACK OUT
--
-- The impact query below reads `mapeh_component`, so it cannot run before this
-- migration creates that column. The sequencing that makes that safe is:
--
--   1. Apply this migration. Nothing moves — no subject is tagged yet, so
--      every GPA, card and form is byte-identical to the day before.
--   2. Tag the components on /subjects, one grade level at a time.
--   3. Run the query below to see exactly what step 2 moved.
--
-- Backing out needs no migration and drops nothing. Clearing the tags —
--
--   UPDATE procurements.sms_subjects
--      SET mapeh_component = NULL
--    WHERE mapeh_component IS NOT NULL
--      AND school_id = <school>;
--
-- — returns every GPA, report card and SF9 to its previous value exactly,
-- because the tag is the only thing the new behaviour keys on. The column and
-- the function can stay in place; untagged is the old behaviour.
--
-- The audit query. Read-only; returns no rows while nothing is tagged:
--
--   WITH tagged AS (
--     SELECT id FROM procurements.sms_subjects WHERE mapeh_component IS NOT NULL
--   ), rows AS (
--     SELECT g.student_id, g.section_id, g.school_year, g.grading_period,
--            CASE WHEN t.id IS NOT NULL THEN 'mapeh'
--                 ELSE 'subj:' || g.subject_id::text END AS bucket,
--            g.grade
--     FROM procurements.sms_grades g
--     JOIN procurements.sms_subjects s ON s.id = g.subject_id
--     LEFT JOIN tagged t ON t.id = g.subject_id
--     WHERE COALESCE(s.is_madrasah, false) = false AND g.grade > 0
--   )
--   SELECT COUNT(*) AS learners_affected,
--          ROUND(AVG(ABS(new_gpa - old_gpa)), 3) AS avg_shift,
--          MAX(ABS(new_gpa - old_gpa))           AS worst_shift,
--          COUNT(*) FILTER (WHERE (old_gpa >= 75) <> (new_gpa >= 75))
--            AS crosses_passing_mark
--   FROM (
--     SELECT student_id, section_id, school_year,
--            ROUND(AVG(grade)::numeric, 2)     AS old_gpa,
--            ROUND(AVG(collapsed)::numeric, 2) AS new_gpa
--     FROM (
--       SELECT student_id, section_id, school_year, grading_period, bucket,
--              grade, AVG(grade) OVER (
--                PARTITION BY student_id, section_id, school_year,
--                             grading_period, bucket
--              ) AS collapsed
--       FROM rows
--     ) c
--     GROUP BY student_id, section_id, school_year
--   ) cmp
--   WHERE old_gpa IS DISTINCT FROM new_gpa;
--
-- No DML. One ADD COLUMN and one CREATE OR REPLACE FUNCTION; no row is
-- rewritten and no object is dropped.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
-- CHECK-constrained rather than free app-validated TEXT. 119 (LSEN codes) and
-- 132 (answer keys) left their vocabularies open because DepEd revises those
-- lists and a CHECK would invalidate signed history. These four do not move —
-- a fifth component would change the acronym — and each value carries
-- application behaviour (it fixes the print order, which is what the acronym
-- spells). That is 133's `program` case, so this follows 133.

ALTER TABLE procurements.sms_subjects
  ADD COLUMN IF NOT EXISTS mapeh_component TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sms_subjects_mapeh_component_check'
      AND conrelid = 'procurements.sms_subjects'::regclass
  ) THEN
    ALTER TABLE procurements.sms_subjects
      ADD CONSTRAINT sms_subjects_mapeh_component_check
      CHECK (mapeh_component IS NULL
             OR mapeh_component IN ('music', 'arts', 'pe', 'health'));
  END IF;
END $$;

COMMENT ON COLUMN procurements.sms_subjects.mapeh_component IS
  'Which MAPEH component this subject is (music/arts/pe/health), or NULL when it is not part of MAPEH. Tagged subjects are folded into one computed MAPEH row on the report card and SF9, counting once toward the general average. There is deliberately no MAPEH row in this table: the parent is derived at print time, so no teacher can encode a MAPEH grade contradicting its components.';

-- Mirrors 034's is_madrasah index and 133's program index: the interesting
-- rows are the rare tagged ones, so the index is partial.
CREATE INDEX IF NOT EXISTS idx_subjects_mapeh_component
  ON procurements.sms_subjects (mapeh_component)
  WHERE mapeh_component IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The GPA function counts MAPEH once
-- ---------------------------------------------------------------------------
-- 128 made this the single source of truth for section placement and
-- promotion, and it averages every (subject, quarter) grade row equally. With
-- four components tagged, MAPEH contributed four rows per quarter where
-- Mathematics contributed one.
--
-- The fix collapses the tagged components to a single value per quarter before
-- averaging. Everything 128 established is unchanged: madrasah/ALS subjects
-- still excluded, un-encoded zero grades still excluded, same signature, same
-- STABLE volatility, NULL when the learner has no usable grades.
--
-- Rounding stays where 128 put it — once, at the end, to 2 decimals. The
-- per-quarter collapse is deliberately not rounded: this function reports a
-- placement figure to 2dp, where the printed card rounds each level to a whole
-- number because a teacher reproduces those by hand from the page.

CREATE OR REPLACE FUNCTION procurements.students_gpa_for_grade(
  p_student_ids BIGINT[],
  p_grade_level INTEGER,
  p_school_year TEXT DEFAULT NULL,
  p_school_id   BIGINT DEFAULT NULL
)
RETURNS TABLE (student_id BIGINT, gpa NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT ids.sid, avg_row.value
  FROM unnest(COALESCE(p_student_ids, ARRAY[]::BIGINT[])) AS ids(sid)
  -- The enrollment that grade level was taken in …
  LEFT JOIN LATERAL (
    SELECT e.section_id, e.school_year
    FROM procurements.sms_enrollments e
    WHERE e.student_id = ids.sid
      AND e.grade_level = p_grade_level
      AND e.status = 'approved'
      AND (p_school_year IS NULL OR e.school_year = p_school_year)
      AND (p_school_id IS NULL OR e.school_id = p_school_id)
    ORDER BY e.school_year DESC, e.created_at DESC
    LIMIT 1
  ) src ON TRUE
  -- … and its average, excluding MEP/ALS subjects and un-encoded zeros, with
  -- the MAPEH components folded into one value per quarter so the learning
  -- area weighs the same as any other subject.
  LEFT JOIN LATERAL (
    SELECT ROUND(AVG(collapsed.grade)::numeric, 2) AS value
    FROM (
      SELECT AVG(g.grade) AS grade
      FROM procurements.sms_grades g
      JOIN procurements.sms_subjects s ON s.id = g.subject_id
      WHERE g.student_id  = ids.sid
        AND g.section_id  = src.section_id
        AND g.school_year = src.school_year
        AND COALESCE(s.is_madrasah, false) = false
        AND g.grade > 0
      GROUP BY
        g.grading_period,
        -- One bucket for all tagged components, one per subject otherwise.
        CASE WHEN s.mapeh_component IS NOT NULL
             THEN 'mapeh'
             ELSE 'subj:' || s.id::text END
    ) collapsed
  ) avg_row ON TRUE;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION procurements.students_gpa_for_grade IS
  'Average grade per learner for a given grade level, excluding madrasah/ALS subjects and un-encoded (0) grades, with MAPEH components collapsed to one value per quarter so the learning area counts once. The single source of truth for section placement — both the enrollment wizard and Auto Enroll go through it.';

GRANT EXECUTE ON FUNCTION procurements.students_gpa_for_grade(BIGINT[], INTEGER, TEXT, BIGINT)
  TO authenticated;

-- get_student_previous_gpa (076, reduced to a wrapper by 128) is unchanged and
-- picks the new behaviour up through this function.
