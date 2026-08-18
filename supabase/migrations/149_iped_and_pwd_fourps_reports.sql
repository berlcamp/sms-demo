-- ============================================================================
-- 149. IPEd Program Data Set + PWD / 4Ps Beneficiary Data Set
-- ============================================================================
--
-- Backs two division-office reporting forms that until now were kept as a
-- workbook passed around by e-mail ("IPEd Data Set", 3 sheets):
--
--   Sheet 1  IPEd Program Data Set FY <year>     — one row per school
--   Sheet 2  PWD and 4P's Beneficiary Data Set   — one row per school
--   Sheet 3  ... the same three counts by GRADE LEVEL
--
-- WHAT IS DERIVED vs WHAT IS TYPED
-- --------------------------------
-- The PWD / 4Ps form (sheets 2-3) is derivable in full — every one of its six
-- counts already exists as a learner property, so `pwd_fourps_facts` computes
-- it live and NOTHING is stored. Nobody types that report.
--
-- The IPEd form (sheet 1) is half and half, and the split is not a design
-- choice — it is what the schema can and cannot answer:
--
--   DERIVED (iped_program_facts)   school, district, type of school, whether
--     the school has IP learners, and the whole Total Enrolment block by band
--     and IP / non-IP.
--   TYPED (sms_iped_report_entries)
--     * IMPLEMENTING IPEd (YES/NO) — a school program designation; nothing in
--       the system records it, and it is also what selects the A vs B half of
--       three of the form's matrices, so it cannot be defaulted.
--     * Total No. of TEACHERS, IPs / Non-IPs — migration 146 gave personnel a
--       `gender`, but `sms_users` has no ethnicity or IP column at all. The
--       sex split alone cannot fill a 2x2, so all four cells are typed.
--     * Teachers Oriented / School Heads Oriented (CUMULATIVE) — there is no
--       training, orientation or attendance record anywhere in the schema, and
--       CUMULATIVE means these span fiscal years, so they could not be derived
--       from one even if there were.
--     * Contextualized resources, major activities, division CAB officers and
--       major issues — narrative and inventory, never derivable.
--
-- This follows migration 118's division of labour exactly: derive what the
-- system knows, store only what it cannot, and keep the two apart so the
-- derived half can never go stale. Unlike 112's SRC these numbers are NOT a
-- signed snapshot — the derived half is recomputed on every open.
--
-- WHY A FISCAL YEAR, not a school year
-- ------------------------------------
-- The form is titled "FY <year>" and the DepEd fiscal year is the calendar
-- year, while its enrolment column is headed "Total Enrolment SY 2026-2027".
-- So the typed row is keyed by fiscal year and the derived half is read for
-- school year `<FY>-<FY+1>`, which is the pairing the printed form uses.
--
-- ROSTER
-- ------
-- Both RPCs count the enrolment lifecycle roster
-- ('active','completed','promoted','retained','graduated') copied verbatim
-- from 072's `enrollment_autofill`, as 141 did, so these figures agree with
-- the school's own autofill and with the division enrollment report. `status`
-- is the APPROVAL workflow and `enrollment_status` the lifecycle — migration
-- 109's trap. SHS learners hold one enrolment row per semester (028), so rows
-- are collapsed per learner before counting, as 118 does.
--
-- CAVEAT WORTH KNOWING — PWD COVERAGE
-- -----------------------------------
-- PWD is read from `sms_student_disabilities` (048). That table is only
-- written by the enrolment wizard's SNED branch (grade_level = -1), so a
-- learner with a disability enrolled in a regular grade has no row and is not
-- counted. This is the same shape of gap 147 documented for `is_4ps` and 148
-- for balik-aral: the column is right, the capture is thin. Disability is read
-- as a property of the LEARNER (any row, any enrolment) rather than of one
-- enrolment, so a learner flagged under a SNED enrolment is still counted at
-- the grade level they are actually enrolled in — otherwise the figure would
-- be zero for every regular grade. The UI states the caveat on the page.
--
-- IP LEARNER = `sms_students.ip_ethnic_group` non-blank. Migration 114 kept
-- `ethnicity` deliberately separate from `ip_ethnic_group` — the former is
-- every learner's, the latter is the Indigenous Peoples group — so only
-- `ip_ethnic_group` can answer an IPEd form.
--
-- TEACHERS = the literal `type = 'teacher'`, per 139/146: a plantilla item,
-- which a `volunteer_teacher` is not. No DepEd personnel count moves here.
--
-- SECURITY INVOKER on both RPCs, per 118: reads stay under existing RLS, so a
-- school-level caller sees their own school and the division office rolls up.
-- Neither exposes a row the caller could not already select.
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- 1. sms_iped_report_entries — the half of sheet 1 the system cannot derive
-- ============================================================================
-- One row per (school, fiscal year). Every column is nullable: a school that
-- has answered nothing has no row at all, and the form prints blank, which is
-- what the paper form does too.
--
-- The two 8-cell orientation matrices are explicit columns rather than JSONB
-- (112's SRC pattern) because this matrix is fixed by the printed form —
-- A/B x Elem/IS/JHS/SHS — and is not a DepEd taxonomy that gets revised the
-- way 119's LSEN codes or 132's answer letters are. Explicit columns keep the
-- `>= 0` CHECKs real and let a division total be summed in SQL.
CREATE TABLE IF NOT EXISTS procurements.sms_iped_report_entries (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL
    REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  fiscal_year INT NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),

  -- Column G/H. NULL = unanswered, which is NOT the same as NO: an unanswered
  -- school is reported under neither the A nor the B half of the matrices.
  implementing_iped BOOLEAN,

  -- Columns I-L. Total No. OF TEACHERS, sex x IP.
  teachers_ip_male       INT CHECK (teachers_ip_male       >= 0),
  teachers_non_ip_male   INT CHECK (teachers_non_ip_male   >= 0),
  teachers_ip_female     INT CHECK (teachers_ip_female     >= 0),
  teachers_non_ip_female INT CHECK (teachers_non_ip_female >= 0),

  -- Columns AE-AL. Teachers oriented on the IPEd program (CUMULATIVE).
  -- a_* = A. IPEd Implementing Schools; b_* = B. Schools Serving IP Learners.
  teachers_oriented_a_elem INT CHECK (teachers_oriented_a_elem >= 0),
  teachers_oriented_a_is   INT CHECK (teachers_oriented_a_is   >= 0),
  teachers_oriented_a_jhs  INT CHECK (teachers_oriented_a_jhs  >= 0),
  teachers_oriented_a_shs  INT CHECK (teachers_oriented_a_shs  >= 0),
  teachers_oriented_b_elem INT CHECK (teachers_oriented_b_elem >= 0),
  teachers_oriented_b_is   INT CHECK (teachers_oriented_b_is   >= 0),
  teachers_oriented_b_jhs  INT CHECK (teachers_oriented_b_jhs  >= 0),
  teachers_oriented_b_shs  INT CHECK (teachers_oriented_b_shs  >= 0),

  -- Columns AM-AT. School heads oriented on the IPEd program (CUMULATIVE).
  heads_oriented_a_elem INT CHECK (heads_oriented_a_elem >= 0),
  heads_oriented_a_is   INT CHECK (heads_oriented_a_is   >= 0),
  heads_oriented_a_jhs  INT CHECK (heads_oriented_a_jhs  >= 0),
  heads_oriented_a_shs  INT CHECK (heads_oriented_a_shs  >= 0),
  heads_oriented_b_elem INT CHECK (heads_oriented_b_elem >= 0),
  heads_oriented_b_is   INT CHECK (heads_oriented_b_is   >= 0),
  heads_oriented_b_jhs  INT CHECK (heads_oriented_b_jhs  >= 0),
  heads_oriented_b_shs  INT CHECK (heads_oriented_b_shs  >= 0),

  -- Columns AU-AX.
  contextualized_resources INT CHECK (contextualized_resources >= 0),
  major_activities TEXT,
  cab_officers     TEXT,
  major_issues     TEXT,

  updated_by_user_id BIGINT
    REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, fiscal_year)
);

COMMENT ON TABLE procurements.sms_iped_report_entries IS
  'The typed half of the IPEd Program Data Set (one row per school per fiscal '
  'year): the program designation, the teacher IP split, the two cumulative '
  'orientation matrices and the four narrative columns. Everything else on '
  'that form is derived live by iped_program_facts.';

COMMENT ON COLUMN procurements.sms_iped_report_entries.implementing_iped IS
  'Column G/H of the form. NULL = unanswered, reported under neither the A '
  '(IPEd Implementing Schools) nor the B (Schools Serving IP Learners) half.';

CREATE INDEX IF NOT EXISTS idx_iped_report_entries_fy
  ON procurements.sms_iped_report_entries (fiscal_year);

DROP TRIGGER IF EXISTS update_sms_iped_report_entries_updated_at
  ON procurements.sms_iped_report_entries;
CREATE TRIGGER update_sms_iped_report_entries_updated_at
  BEFORE UPDATE ON procurements.sms_iped_report_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- RLS. Mirrors 072's submission policies, with `super admin` in the
-- FULL-ACCESS branch rather than the school-matched one — per migration 113,
-- AuthGuard swaps that role's school_id for the active-school override, so a
-- school match would deny them exactly the rows they are looking at.
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_iped_report_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "iped_entries_select"
  ON procurements.sms_iped_report_entries;
CREATE POLICY "iped_entries_select"
  ON procurements.sms_iped_report_entries FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "iped_entries_insert"
  ON procurements.sms_iped_report_entries;
CREATE POLICY "iped_entries_insert"
  ON procurements.sms_iped_report_entries FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND (
          u.type IN ('division_admin', 'division_type', 'super admin')
          OR (
            u.type IN ('school_head', 'assistant_school_head', 'admin')
            AND u.school_id = sms_iped_report_entries.school_id
          )
        )
    )
  );

DROP POLICY IF EXISTS "iped_entries_update"
  ON procurements.sms_iped_report_entries;
CREATE POLICY "iped_entries_update"
  ON procurements.sms_iped_report_entries FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND (
          u.type IN ('division_admin', 'division_type', 'super admin')
          OR (
            u.type IN ('school_head', 'assistant_school_head', 'admin')
            AND u.school_id = sms_iped_report_entries.school_id
          )
        )
    )
  );

GRANT SELECT, INSERT, UPDATE
  ON procurements.sms_iped_report_entries TO authenticated;
GRANT USAGE, SELECT
  ON SEQUENCE procurements.sms_iped_report_entries_id_seq TO authenticated;

-- ============================================================================
-- 2. RPC: iped_program_facts
-- ============================================================================
-- The derived half of sheet 1 — one row per school, shaped so the caller can
-- lay it straight onto the printed row.
--
-- BAND (Elem / IS / JHS / SHS). The form's four bands are not four grade
-- ranges: IS is Integrated School, a school TYPE. So an integrated school's
-- whole enrolment lands in IS, and every other school splits by grade level
-- (SNED, Kinder and Grades 1-6 = Elem; 7-10 = JHS; 11-12 = SHS). This is the
-- only reading under which a complete-secondary school reports into both JHS
-- and SHS, which it must.
--
-- The A / B halves of the enrolment matrix are NOT decided here: they follow
-- `implementing_iped`, which is typed. The RPC returns the counts once and the
-- caller places them, so a school that flips its designation does not need the
-- figures recomputed.
-- ----------------------------------------------------------------------------
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
  -- One row per learner per school. SHS holds one enrolment row per semester
  -- (028), so the grade level is taken from the latest semester and the
  -- learner is counted once.
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
      NULLIF(TRIM(st.ip_ethnic_group), '') IS NOT NULL AS is_ip
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
  -- The literal 'teacher', per 139/146: a plantilla item, which a
  -- volunteer_teacher is not. `gender` is 146's column and is nullable, so a
  -- teacher whose sex was never captured falls into neither count.
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
  'enrolment by band (Elem/IS/JHS/SHS) x IP/non-IP for one school year. '
  'p_school_id NULL returns every school. The A/B split of the printed form '
  'follows sms_iped_report_entries.implementing_iped and is applied by the '
  'caller, not here.';

-- ============================================================================
-- 3. RPC: pwd_fourps_facts
-- ============================================================================
-- Sheets 2 and 3 in one call: one row per (school, grade level), which the
-- caller sums by school for sheet 2 and by grade level for sheet 3. Returning
-- the cross-product rather than two aggregates means the two sheets can never
-- disagree, and costs one pass.
--
-- All three flags are properties of the LEARNER, not of an enrolment:
--   PWD   any row in sms_student_disabilities (048) — see the header caveat
--   4Ps   sms_students.is_4ps (114), exactly as 147 reads it
--   IP    sms_students.ip_ethnic_group non-blank (114)
-- ----------------------------------------------------------------------------
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
      EXISTS (
        SELECT 1 FROM procurements.sms_student_disabilities d
        WHERE d.student_id = st.id
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
  'grade level. p_school_id NULL returns every school. PWD comes from '
  'sms_student_disabilities (048), which only the SNED enrolment branch '
  'writes, so its coverage is thin — see the migration header.';

GRANT EXECUTE ON FUNCTION
  procurements.iped_program_facts(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION
  procurements.pwd_fourps_facts(BIGINT, TEXT) TO authenticated;
