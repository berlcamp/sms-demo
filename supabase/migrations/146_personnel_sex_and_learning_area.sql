-- ============================================================================
-- 146. Sex and learning area on personnel — Teaching Specialization derives
-- ============================================================================
--
-- WHY
-- ---
-- `sms_report_teaching_specialization_rows` asks each school for a male/female
-- headcount per learning area. The system cannot answer either half:
--
--   * SEX. `gender` appears exactly once in the whole schema — on
--     `sms_students` (001). There is no sex on `sms_users`, so no staff figure
--     anywhere is or can be broken down by sex. 071's teaching and
--     non-teaching summaries, 112's SRC and 118's teacher-learner ratio are
--     all bare headcounts for this reason.
--   * LEARNING AREA. `sms_users` carries `position` (free text, "Teacher III")
--     and `staff_category_code` (the non-teaching bucket). Neither is a
--     teaching specialization, and `sms_subjects` has no learning-area
--     classification to infer one from.
--
-- So the report was typed because nothing else was possible. These two columns
-- are the missing capture.
--
-- NAMING: `gender`, not `sex`, to match `sms_students.gender` and its exact
-- 'male'/'female' values. One concept, one column name, one value domain —
-- the DepEd forms say "Sex" and the UI labels it so, but a second spelling in
-- the schema is how these things quietly diverge. A CHECK is used here rather
-- than app validation because, unlike a DepEd taxonomy (119/132/133), this
-- domain does not get revised.
--
-- `learning_area` is free TEXT validated against `lib/constants/learningAreas.ts`,
-- following that same precedent, and matching 074's own unconstrained
-- `learning_area TEXT` on the report rows.
--
-- WHAT IS *NOT* CHANGED
-- ---------------------
-- No existing personnel count moves. Both columns are nullable with no
-- backfill, and nothing that counts staff today reads them. Per migration 139,
-- the derived report counts the literal `type = 'teacher'` — a plantilla item,
-- which a `volunteer_teacher` is not — exactly as 071, 112 and 118 do. A
-- volunteer teacher is deliberately in none of these.
--
-- THE LIMITATION WORTH KNOWING
-- ----------------------------
-- `sms_users` has no school year: it holds who works here NOW. A derived
-- teaching specialization is therefore a snapshot of today's staff, not of the
-- staff as they stood in a past school year, and it cannot be otherwise
-- without a personnel history table. For any past school year the SUBMITTED
-- figures are the more truthful record, so the page only prefers the derived
-- ones for the current school year and keeps reading submissions for the rest.
-- The RPC ignores p_school_year for the counting and takes it only to report
-- the submission status alongside.
--
-- Additive: two nullable columns, one new function. No row is modified, no
-- policy widened, no existing function replaced.
-- ============================================================================

ALTER TABLE procurements.sms_users
  ADD COLUMN IF NOT EXISTS gender TEXT;

ALTER TABLE procurements.sms_users
  DROP CONSTRAINT IF EXISTS sms_users_gender_check;
ALTER TABLE procurements.sms_users
  ADD CONSTRAINT sms_users_gender_check
  CHECK (gender IS NULL OR gender IN ('male', 'female'));

ALTER TABLE procurements.sms_users
  ADD COLUMN IF NOT EXISTS learning_area TEXT;

COMMENT ON COLUMN procurements.sms_users.gender IS
  'Staff sex. Same column name and value domain as sms_students.gender. '
  'Nullable: not collected before migration 146.';
COMMENT ON COLUMN procurements.sms_users.learning_area IS
  'Teaching specialization, validated in lib/constants/learningAreas.ts. '
  'Meaningful for teaching staff only.';

-- ---------------------------------------------------------------------------
-- division_teaching_specialization_actual
-- ---------------------------------------------------------------------------
-- Same result shape as division_teaching_specialization_summary (075).
-- Teachers with no learning area recorded are excluded rather than bucketed
-- as '': a school that has not filled them in should read as no live data,
-- not as a specialization called blank. A school where NO teacher has one
-- therefore returns no rows at all, and the page falls back to its submission.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.division_teaching_specialization_actual(
  p_school_year TEXT
)
RETURNS TABLE (
  school_id     BIGINT,
  school_name   TEXT,
  school_type   TEXT,
  learning_area TEXT,
  male          INT,
  female        INT,
  total         INT,
  status        TEXT
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
      AND sub.semester IS NULL
      AND sub.report_type = 'teaching_specialization'
    WHERE s.is_active
  ),
  agg AS (
    SELECT
      u.school_id,
      u.learning_area,
      COUNT(*) FILTER (WHERE u.gender = 'male')::int   AS male,
      COUNT(*) FILTER (WHERE u.gender = 'female')::int AS female
    FROM procurements.sms_users u
    WHERE u.is_active
      AND u.school_id IS NOT NULL
      -- Literal 'teacher' per migration 139: a plantilla item, which a
      -- volunteer_teacher is not. Matches 071, 112 and 118.
      AND u.type = 'teacher'
      AND u.learning_area IS NOT NULL
    GROUP BY u.school_id, u.learning_area
  )
  SELECT
    sc.school_id,
    sc.school_name,
    sc.school_type,
    agg.learning_area,
    agg.male,
    agg.female,
    agg.male + agg.female AS total,
    sc.status
  FROM scoped sc
  JOIN agg ON agg.school_id = sc.school_id
  ORDER BY sc.school_name, 4;
$$;

GRANT EXECUTE ON FUNCTION
  procurements.division_teaching_specialization_actual(TEXT)
  TO authenticated;

COMMENT ON FUNCTION
  procurements.division_teaching_specialization_actual(TEXT) IS
  'Teaching personnel per school by learning area and sex, derived from '
  'sms_users. Counts CURRENT staff — sms_users has no school year — so callers '
  'should prefer it only for the current school year and read submissions for '
  'past ones.';
