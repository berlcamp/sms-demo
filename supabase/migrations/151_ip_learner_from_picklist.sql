-- ============================================================================
-- 151. "Is this learner IP?" becomes one rule, shared by the form and the report
-- ============================================================================
--
-- WHY
-- ---
-- 149 answered "is this learner IP?" with `ip_ethnic_group` being non-blank,
-- and that column was a free-text input sitting one box away from a second
-- free-text "Ethnicity" input. Two failure modes followed, both of which move
-- the division's IPEd return with nothing else in the system to catch them:
--
--   UNDERCOUNT  a registrar types "Manobo" into Ethnicity. The learner is IP
--               and is reported Non-IP. `ethnicity` was read by exactly one
--               screen — the learner View dialog — and by no report, no PDF and
--               no RPC, so nothing ever surfaced the mistake.
--   OVERCOUNT   someone types "N/A", "None", "-" or "Wala" into
--               IP (Ethnic Group) for a non-IP learner. That is non-blank, so
--               149 counted them as IP.
--
-- The forms are now fixed at source: `ethnicity` is dropped from every form
-- (Students, the teacher's edit modal and the enrolment wizard) and
-- IP (Ethnic Group) is a picklist of the Caraga Region groups from
-- lib/constants/ethnicGroups.ts. This migration is the other half — the reports
-- have to stop counting the placeholder answers already sitting in the column
-- from before the picklist existed.
--
-- WHAT IS AND IS NOT PUT IN SQL
-- -----------------------------
-- `is_ip_learner()` below rejects blanks and a short list of placeholder
-- answers. It does NOT hold the list of Caraga groups, and must not: 119's LSEN
-- codes and 133's subject programs established that a DepEd or NCIP taxonomy
-- lives in lib/constants/ and never in a CHECK or a function, so a revision is
-- a one-line change that cannot invalidate a learner record already carrying an
-- older value. Placeholders are a different kind of list — they are junk-value
-- detection, not a taxonomy, and they will not be revised by an agency — so
-- they are safe here. The same list is mirrored as NON_IP_SENTINELS in
-- lib/constants/ethnicGroups.ts, which is what `isIpLearner()` applies in the
-- UI, so the picklist, the learner View dialog and the report agree.
--
-- NOTHING IS REWRITTEN. No UPDATE runs. A learner whose column holds "N/A"
-- keeps holding it; they simply stop being counted as IP, and the next person
-- to open their record sees the picklist sitting on "Not IP". A learner whose
-- column holds a real group name outside the picklist keeps it, is still
-- counted as IP, and the form preserves it as its own option rather than
-- resetting it — see components/EthnicGroupSelect.tsx.
--
-- WHAT MOVES
-- ----------
-- The IP figures only, and only downwards, by exactly the number of learners
-- carrying a placeholder. Both RPCs are replaced in place — same names, same
-- signatures, same result columns — so no client code changes. This carries
-- 150's PWD definition forward unchanged, so 151 is safe to apply whether or
-- not 150 has been.
--
-- To see the size of the change before applying:
--
--   SELECT ip_ethnic_group, COUNT(*)
--   FROM procurements.sms_students
--   WHERE NULLIF(TRIM(ip_ethnic_group), '') IS NOT NULL
--     AND NOT procurements.is_ip_learner(ip_ethnic_group)
--   GROUP BY 1 ORDER BY 2 DESC;
--
-- And to find learners whose IP group was typed into the dead column instead —
-- the undercount half, which no migration can fix because it needs a human to
-- read the value:
--
--   SELECT id, lrn, last_name, first_name, ethnicity
--   FROM procurements.sms_students
--   WHERE NULLIF(TRIM(ethnicity), '') IS NOT NULL
--     AND NULLIF(TRIM(ip_ethnic_group), '') IS NULL;
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. is_ip_learner — the single definition, mirrored by isIpLearner() in
--    lib/constants/ethnicGroups.ts.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.is_ip_learner(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    LOWER(TRIM(p_value)) <> ''
      AND LOWER(TRIM(p_value)) NOT IN (
        'n/a', 'na', 'none', 'no', 'not ip', 'non-ip', 'non ip',
        'wala', '0', '-', '--'
      ),
    FALSE
  );
$$;

COMMENT ON FUNCTION procurements.is_ip_learner(TEXT) IS
  'Whether an sms_students.ip_ethnic_group value marks the learner as '
  'Indigenous Peoples: non-blank and not a placeholder. Deliberately holds no '
  'list of ethnic groups — that taxonomy lives in lib/constants/ethnicGroups.ts '
  'per the 119/133 precedent. Mirrors isIpLearner() there.';

GRANT EXECUTE ON FUNCTION procurements.is_ip_learner(TEXT) TO authenticated;

-- ============================================================================
-- 2. iped_program_facts — IP split now applies is_ip_learner
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.iped_program_facts(
  p_school_id   BIGINT,
  p_school_year TEXT
)
RETURNS TABLE (
  school_id        BIGINT,
  school_name      TEXT,
  district         TEXT,
  school_type      TEXT,
  has_ip_learners  BOOLEAN,
  teachers_male    INT,
  teachers_female  INT,
  enrolment_elem_ip     INT,
  enrolment_elem_non_ip INT,
  enrolment_is_ip       INT,
  enrolment_is_non_ip   INT,
  enrolment_jhs_ip      INT,
  enrolment_jhs_non_ip  INT,
  enrolment_shs_ip      INT,
  enrolment_shs_non_ip  INT
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
  banded AS (
    SELECT
      l.school_id,
      CASE
        WHEN s.school_type = 'integrated'      THEN 'is'
        WHEN l.grade_level BETWEEN 7  AND 10   THEN 'jhs'
        WHEN l.grade_level BETWEEN 11 AND 12   THEN 'shs'
        ELSE 'elem'
      END AS band,
      procurements.is_ip_learner(st.ip_ethnic_group) AS is_ip
    FROM learners l
    JOIN scoped_schools s ON s.id = l.school_id
    JOIN procurements.sms_students st ON st.id = l.student_id
  ),
  enrolment AS (
    SELECT
      b.school_id,
      COUNT(*) FILTER (WHERE b.band = 'elem' AND     b.is_ip)::INT AS elem_ip,
      COUNT(*) FILTER (WHERE b.band = 'elem' AND NOT b.is_ip)::INT AS elem_non_ip,
      COUNT(*) FILTER (WHERE b.band = 'is'   AND     b.is_ip)::INT AS is_ip,
      COUNT(*) FILTER (WHERE b.band = 'is'   AND NOT b.is_ip)::INT AS is_non_ip,
      COUNT(*) FILTER (WHERE b.band = 'jhs'  AND     b.is_ip)::INT AS jhs_ip,
      COUNT(*) FILTER (WHERE b.band = 'jhs'  AND NOT b.is_ip)::INT AS jhs_non_ip,
      COUNT(*) FILTER (WHERE b.band = 'shs'  AND     b.is_ip)::INT AS shs_ip,
      COUNT(*) FILTER (WHERE b.band = 'shs'  AND NOT b.is_ip)::INT AS shs_non_ip,
      BOOL_OR(b.is_ip) AS any_ip
    FROM banded b
    GROUP BY b.school_id
  ),
  staff AS (
    SELECT
      u.school_id,
      COUNT(*) FILTER (WHERE u.gender = 'male')::INT   AS male,
      COUNT(*) FILTER (WHERE u.gender = 'female')::INT AS female
    FROM procurements.sms_users u
    WHERE u.is_active
      AND u.type = 'teacher'
    GROUP BY u.school_id
  )
  SELECT
    s.id                              AS school_id,
    s.name                            AS school_name,
    s.district                        AS district,
    s.school_type                     AS school_type,
    COALESCE(e.any_ip, FALSE)         AS has_ip_learners,
    COALESCE(t.male, 0)               AS teachers_male,
    COALESCE(t.female, 0)             AS teachers_female,
    COALESCE(e.elem_ip, 0)            AS enrolment_elem_ip,
    COALESCE(e.elem_non_ip, 0)        AS enrolment_elem_non_ip,
    COALESCE(e.is_ip, 0)              AS enrolment_is_ip,
    COALESCE(e.is_non_ip, 0)          AS enrolment_is_non_ip,
    COALESCE(e.jhs_ip, 0)             AS enrolment_jhs_ip,
    COALESCE(e.jhs_non_ip, 0)         AS enrolment_jhs_non_ip,
    COALESCE(e.shs_ip, 0)             AS enrolment_shs_ip,
    COALESCE(e.shs_non_ip, 0)         AS enrolment_shs_non_ip
  FROM scoped_schools s
  LEFT JOIN enrolment e ON e.school_id = s.id
  LEFT JOIN staff     t ON t.school_id = s.id
  ORDER BY s.name;
$$;

COMMENT ON FUNCTION procurements.iped_program_facts(BIGINT, TEXT) IS
  'Derived half of the IPEd Program Data Set: per school, its district and '
  'type, whether it has IP learners, its teacher headcount by sex and its '
  'enrolment by band (Elem/IS/JHS/SHS) x IP/non-IP for one school year. IP is '
  'is_ip_learner(ip_ethnic_group). p_school_id NULL returns every school. The '
  'A/B split of the printed form follows '
  'sms_iped_report_entries.implementing_iped and is applied by the caller.';

-- ============================================================================
-- 3. pwd_fourps_facts — same IP rule; 150's PWD definition carried forward
-- ============================================================================
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
      -- PWD (migration 150): any LSEN tag item outside the Gifted Learner
      -- group (119), or a SNED disability record (048).
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
      )                                                AS is_pwd,
      COALESCE(st.is_4ps, FALSE)                       AS is_fourps,
      procurements.is_ip_learner(st.ip_ethnic_group)   AS is_ip
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
  'grade level). PWD = any LSEN tag item outside the Gifted Learner group '
  '(119) or a SNED disability record (048); IP = is_ip_learner(ip_ethnic_group). '
  'p_school_id NULL returns every school.';

GRANT EXECUTE ON FUNCTION
  procurements.iped_program_facts(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION
  procurements.pwd_fourps_facts(BIGINT, TEXT) TO authenticated;
