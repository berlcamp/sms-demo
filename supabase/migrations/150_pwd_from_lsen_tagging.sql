-- ============================================================================
-- 150. PWD is read from LSEN tagging, not only from the SNED enrolment branch
-- ============================================================================
--
-- WHY
-- ---
-- 149 derived the PWD column of the PWD / 4Ps Beneficiary Data Set from
-- `sms_student_disabilities` (048) alone, and its own header called that out as
-- thin. It is worse than thin: the ONLY writer of that table is
-- `saveSnedDisabilities` in the enrolment wizard, and all three of its call
-- sites sit behind `isSNED`, which is `gradeLevel === -1`. The wizard's step 3
-- renders only for Kindergarten (ECCD) and SNED. There is no screen anywhere in
-- the system on which a Grade 4 learner's disability can be recorded, so the
-- report's PWD column was effectively each school's SNED headcount and read 0
-- for every regular grade.
--
-- Migration 119 already captures exactly this for learners in ordinary
-- sections: the adviser tags the learner's Classification / Type of LSEN at
-- /teacher/anecdotal/manifestation, mirroring the DepEd LIS select from
-- Division Memorandum No. 263, s. 2024. That is the roster the PWD figure
-- should be counted from.
--
-- THE RULE
-- --------
-- A learner is PWD if they carry ANY LSEN tag item whose category is NOT
-- `gifted`. The LIS select has three option groups (119, and
-- lib/constants/manifestation.ts):
--
--   gifted         Gifted, Talented                      → NOT a disability
--   diagnosed      With Diagnosis from a Licensed Medical Specialist  → PWD
--   manifestation  With Manifestation (observed, undiagnosed)         → PWD
--
-- EXCLUDING THE CATEGORY, NOT THE CODES, is the load-bearing choice here.
-- 119 stores `code` as free TEXT on purpose so a DepEd list revision is a
-- constants change rather than a migration that invalidates history — writing
-- `code NOT IN ('gifted','talented')` into SQL would put a second, silently
-- drifting copy of that list in the database, which is the exact thing 119 set
-- out to avoid. `sms_manifestation_tag_items.category` is CHECK-constrained to
-- the three group names, so it is a stable contract: a new gifted code added to
-- the constants file still arrives carrying category 'gifted' and is still
-- excluded, with nothing here to update.
--
-- ANY SCHOOL YEAR, not the reference year. 119 keys a tag on
-- (student_id, school_year), but a disability does not lapse because the
-- adviser has not re-tagged this year. PWD is therefore read as a property of
-- the LEARNER, matching how 147 reads `is_4ps`, how 149 already reads
-- `ip_ethnic_group` and `sms_student_disabilities`, and how the learner is then
-- counted at the grade level they are actually enrolled in for the reference
-- year.
--
-- CONSENT IS NOT A GATE. 119 is explicit that the adviser tags first and seeks
-- parent consent after, and that consent governs SNED ENROLMENT rather than
-- whether the learner has a disability. A tag with `consent_status = 'pending'`
-- is a real record and is counted. `sned_enrolled` is likewise not consulted:
-- this form asks how many learners with a disability the school has, not how
-- many it has placed in a SNED programme.
--
-- 048 IS KEPT ALONGSIDE, NOT REPLACED. A learner already recorded through the
-- SNED enrolment branch has a genuine disability record; dropping that source
-- would lose them from the count. The two are OR'd and a learner in both is
-- counted once. If the division wants the figure to rest on LSEN tagging
-- alone, delete the second EXISTS below in a further migration — nothing else
-- depends on it.
--
-- WHAT IS NOT CHANGED
-- -------------------
-- Same function, same signature `(BIGINT, TEXT)`, same result columns, so both
-- report pages call it unchanged and no client code moves. 4Ps and IP are
-- untouched. `iped_program_facts` does not read PWD at all and is untouched.
-- One function replaced; no table, column, policy or row is altered, and no
-- DML runs.
--
-- WHAT THIS MOVES
-- ---------------
-- The PWD column only, and only upwards: every learner counted before is still
-- counted, plus every learner carrying a non-gifted LSEN tag. To see the size
-- of the change before applying:
--
--   SELECT COUNT(DISTINCT t.student_id) AS lsen_pwd
--   FROM procurements.sms_manifestation_tags t
--   JOIN procurements.sms_manifestation_tag_items i ON i.tag_id = t.id
--   WHERE i.category <> 'gifted';
--
--   SELECT COUNT(DISTINCT student_id) AS sned_pwd
--   FROM procurements.sms_student_disabilities;
-- ============================================================================

SET search_path TO procurements, public;

CREATE OR REPLACE FUNCTION procurements.pwd_fourps_facts(
  p_school_id   BIGINT,
  p_school_year TEXT
)
RETURNS TABLE (
  school_id     BIGINT,
  school_name   TEXT,
  district      TEXT,
  school_type   TEXT,
  grade_level   INT,
  enrolment     INT,
  pwd_male      INT,
  pwd_female    INT,
  fourps_male   INT,
  fourps_female INT,
  ip_male       INT,
  ip_female     INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO procurements, public
AS $$
  WITH scoped_schools AS (
    SELECT sc.id, sc.name, sc.district, sc.school_type
    FROM procurements.sms_schools sc
    WHERE sc.is_active
      AND (p_school_id IS NULL OR sc.id = p_school_id)
  ),
  learners AS (
    SELECT
      e.school_id,
      e.student_id,
      (ARRAY_AGG(e.grade_level ORDER BY e.semester DESC NULLS LAST))[1]::INT
        AS grade_level
    FROM procurements.sms_enrollments e
    WHERE e.school_year = p_school_year
      AND e.status = 'approved'
      AND e.enrollment_status IN (
        'active', 'completed', 'promoted', 'retained', 'graduated'
      )
      AND (p_school_id IS NULL OR e.school_id = p_school_id)
    GROUP BY e.school_id, e.student_id
  ),
  flagged AS (
    SELECT
      l.school_id,
      l.grade_level,
      st.gender,
      -- PWD: any LSEN tag item outside the Gifted Learner group (119), or a
      -- SNED disability record (048). See the header for why the exclusion is
      -- on `category` and not on the code list.
      (
        EXISTS (
          SELECT 1
          FROM procurements.sms_manifestation_tags t
          JOIN procurements.sms_manifestation_tag_items i ON i.tag_id = t.id
          WHERE t.student_id = st.id
            AND i.category <> 'gifted'
        )
        OR EXISTS (
          SELECT 1 FROM procurements.sms_student_disabilities d
          WHERE d.student_id = st.id
        )
      )                                                          AS is_pwd,
      COALESCE(st.is_4ps, FALSE)                                 AS is_fourps,
      NULLIF(TRIM(st.ip_ethnic_group), '') IS NOT NULL           AS is_ip
    FROM learners l
    JOIN scoped_schools s ON s.id = l.school_id
    JOIN procurements.sms_students st ON st.id = l.student_id
  )
  -- LEFT JOIN, so a school with no enrolment this year still returns one row
  -- and still prints on sheet 2. That row carries grade_level NULL and zeroes;
  -- sheet 3 drops the NULL rung. COUNT(f.school_id) rather than COUNT(*), which
  -- would score the empty row as one learner.
  SELECT
    s.id        AS school_id,
    s.name      AS school_name,
    s.district  AS district,
    s.school_type,
    f.grade_level,
    COUNT(f.school_id)::INT                                              AS enrolment,
    COUNT(*) FILTER (WHERE f.is_pwd    AND f.gender = 'male')::INT       AS pwd_male,
    COUNT(*) FILTER (WHERE f.is_pwd    AND f.gender = 'female')::INT     AS pwd_female,
    COUNT(*) FILTER (WHERE f.is_fourps AND f.gender = 'male')::INT       AS fourps_male,
    COUNT(*) FILTER (WHERE f.is_fourps AND f.gender = 'female')::INT     AS fourps_female,
    COUNT(*) FILTER (WHERE f.is_ip     AND f.gender = 'male')::INT       AS ip_male,
    COUNT(*) FILTER (WHERE f.is_ip     AND f.gender = 'female')::INT     AS ip_female
  FROM scoped_schools s
  LEFT JOIN flagged f ON f.school_id = s.id
  GROUP BY s.id, s.name, s.district, s.school_type, f.grade_level
  ORDER BY s.name, f.grade_level;
$$;

COMMENT ON FUNCTION procurements.pwd_fourps_facts(BIGINT, TEXT) IS
  'PWD / 4Ps / IP learner counts by sex for one school year, per (school, '
  'grade level) — sheet 2 of the form sums these by school and sheet 3 by '
  'grade level. p_school_id NULL returns every school. PWD = any LSEN tag '
  'item outside the Gifted Learner group (119), or a SNED disability record '
  '(048); the exclusion is on tag category, never on the code list, so a '
  'DepEd revision of lib/constants/manifestation.ts needs no migration.';

GRANT EXECUTE ON FUNCTION
  procurements.pwd_fourps_facts(BIGINT, TEXT) TO authenticated;
