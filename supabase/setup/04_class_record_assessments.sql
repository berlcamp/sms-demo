-- ============================================================================
-- SCHOOL MANAGEMENT SYSTEM — FRESH INSTALL, PART 4 OF 7
-- Class record, CRLA / Phil-IRI / RMA assessments, TOS, exam creator
-- ============================================================================
-- GENERATED FILE — do not edit by hand; run supabase/setup/generate.sh instead.
-- A byte-for-byte concatenation of the 24 migrations listed below, in the
-- exact order a migration runner would apply them.
--
-- FOR NEW / EMPTY DATABASES ONLY. Never run this against a database that already
-- has the migration history applied — use supabase/migrations/ for that.
--
-- Run the seven parts strictly in order: 01 -> 07. Each part is one transaction,
-- so a failure rolls the whole part back and leaves nothing half-applied.
--
-- Migrations merged into this part:
--   080_class_record.sql
--   081_class_record_fixed_summative.sql
--   082_class_record_reset_legacy_summative.sql
--   083_crla_assessment.sql
--   084_philiri_assessment.sql
--   085_rma_assessment.sql
--   086_crla_record_form.sql
--   087_crla_material_phases.sql
--   088_crla_task_material_file.sql
--   089_philiri_file_material_and_screening.sql
--   090_philiri_individual_record_form.sql
--   091_crla_three_task_flow.sql
--   091_philiri_grade_aware_screening.sql
--   091_rma_ks1_seed.sql
--   092_pabasa_assessment.sql
--   092_philiri_screening_reading_levels.sql
--   093_student_portal_code.sql
--   094_fix_landing_hero_storage_superadmin.sql
--   095_assistant_school_head_role.sql
--   096_table_of_specification.sql
--   097_aral_intervention.sql
--   098_aral_suggested_start_grade.sql
--   098_tos_total_days.sql
--   099_exam_creator.sql
-- ============================================================================

BEGIN;

SET search_path TO procurements, public;

-- ============================================================================
-- >>> BEGIN 080_class_record.sql
-- ============================================================================

-- ============================================================================
-- CLASS RECORD (DepEd 2026-2027 MATATAG, 3-term grading)
--
-- A teacher's working grade book for one subject + section + term + school year.
-- Three components (editable weights per record):
--   WW = Written / Oral Works
--   PT = Product / Performance Tasks
--   ST = Summative Tests & Term Exams
-- Teachers define dynamic columns (items) per component, enter raw scores, and
-- the computed Term Grade is posted into procurements.sms_grades (auto-populate).
--
-- Coexistence: terms 1-3 reuse sms_grades.grading_period (CHECK 1-4 already
-- covers 1-3); term-vs-quarter is derived from the school year in the app layer.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. CLASS RECORDS (one per subject/section/term/school-year)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_class_records (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  teacher_id BIGINT NOT NULL REFERENCES procurements.sms_users(id) ON DELETE RESTRICT,
  subject_id BIGINT NOT NULL REFERENCES procurements.sms_subjects(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  grading_period INTEGER NOT NULL CHECK (grading_period BETWEEN 1 AND 3), -- 1st/2nd/3rd Term
  term_start DATE,
  term_end DATE,
  ww_weight NUMERIC(5,2) NOT NULL DEFAULT 20 CHECK (ww_weight >= 0 AND ww_weight <= 100),
  pt_weight NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (pt_weight >= 0 AND pt_weight <= 100),
  st_weight NUMERIC(5,2) NOT NULL DEFAULT 30 CHECK (st_weight >= 0 AND st_weight <= 100),
  use_transmutation BOOLEAN NOT NULL DEFAULT false,
  is_posted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subject_id, section_id, school_year, grading_period)
);

COMMENT ON TABLE procurements.sms_class_records IS
  'DepEd 3-term class record header: weights + term dates per subject/section/term/school-year.';

CREATE INDEX IF NOT EXISTS idx_sms_class_records_school   ON procurements.sms_class_records(school_id);
CREATE INDEX IF NOT EXISTS idx_sms_class_records_teacher  ON procurements.sms_class_records(teacher_id);
CREATE INDEX IF NOT EXISTS idx_sms_class_records_section  ON procurements.sms_class_records(section_id);
CREATE INDEX IF NOT EXISTS idx_sms_class_records_sy_term  ON procurements.sms_class_records(school_year, grading_period);

CREATE TRIGGER update_sms_class_records_updated_at
  BEFORE UPDATE ON procurements.sms_class_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. CLASS RECORD ITEMS (teacher-defined columns per component)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_class_record_items (
  id BIGSERIAL PRIMARY KEY,
  class_record_id BIGINT NOT NULL REFERENCES procurements.sms_class_records(id) ON DELETE CASCADE,
  component TEXT NOT NULL CHECK (component IN ('WW', 'PT', 'ST')),
  label TEXT,                                  -- activity title ("click to edit")
  max_score NUMERIC(7,2) NOT NULL DEFAULT 100 CHECK (max_score > 0),
  position INTEGER NOT NULL DEFAULT 0,          -- column order within component
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_class_record_items IS
  'Dynamic assessment columns (WW1, PT1, ST1...) belonging to a class record.';

CREATE INDEX IF NOT EXISTS idx_sms_class_record_items_record
  ON procurements.sms_class_record_items(class_record_id, component, position);

CREATE TRIGGER update_sms_class_record_items_updated_at
  BEFORE UPDATE ON procurements.sms_class_record_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 3. CLASS RECORD SCORES (one raw score per item per learner)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_class_record_scores (
  id BIGSERIAL PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES procurements.sms_class_record_items(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  raw_score NUMERIC(7,2) CHECK (raw_score >= 0), -- NULL = not yet entered
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, student_id)
);

COMMENT ON TABLE procurements.sms_class_record_scores IS
  'Raw score per learner per assessment column. NULL means not yet entered.';

CREATE INDEX IF NOT EXISTS idx_sms_class_record_scores_item    ON procurements.sms_class_record_scores(item_id);
CREATE INDEX IF NOT EXISTS idx_sms_class_record_scores_student ON procurements.sms_class_record_scores(student_id);

CREATE TRIGGER update_sms_class_record_scores_updated_at
  BEFORE UPDATE ON procurements.sms_class_record_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 4. DepEd transmutation (DO 8, s.2015 table). Used only when
--    use_transmutation = true; otherwise the rounded Initial Grade is final.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.sms_transmute_grade(p_initial NUMERIC)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_initial IS NULL          THEN NULL
    WHEN p_initial >= 100           THEN 100
    WHEN p_initial >= 98.40         THEN 99
    WHEN p_initial >= 96.80         THEN 98
    WHEN p_initial >= 95.20         THEN 97
    WHEN p_initial >= 93.60         THEN 96
    WHEN p_initial >= 92.00         THEN 95
    WHEN p_initial >= 90.40         THEN 94
    WHEN p_initial >= 88.80         THEN 93
    WHEN p_initial >= 87.20         THEN 92
    WHEN p_initial >= 85.60         THEN 91
    WHEN p_initial >= 84.00         THEN 90
    WHEN p_initial >= 82.40         THEN 89
    WHEN p_initial >= 80.80         THEN 88
    WHEN p_initial >= 79.20         THEN 87
    WHEN p_initial >= 77.60         THEN 86
    WHEN p_initial >= 76.00         THEN 85
    WHEN p_initial >= 74.40         THEN 84
    WHEN p_initial >= 72.80         THEN 83
    WHEN p_initial >= 71.20         THEN 82
    WHEN p_initial >= 69.60         THEN 81
    WHEN p_initial >= 68.00         THEN 80
    WHEN p_initial >= 66.40         THEN 79
    WHEN p_initial >= 64.80         THEN 78
    WHEN p_initial >= 63.20         THEN 77
    WHEN p_initial >= 61.60         THEN 76
    WHEN p_initial >= 60.00         THEN 75
    WHEN p_initial >= 56.00         THEN 74
    WHEN p_initial >= 52.00         THEN 73
    WHEN p_initial >= 48.00         THEN 72
    WHEN p_initial >= 44.00         THEN 71
    WHEN p_initial >= 40.00         THEN 70
    WHEN p_initial >= 36.00         THEN 69
    WHEN p_initial >= 32.00         THEN 68
    WHEN p_initial >= 28.00         THEN 67
    WHEN p_initial >= 24.00         THEN 66
    WHEN p_initial >= 20.00         THEN 65
    WHEN p_initial >= 16.00         THEN 64
    WHEN p_initial >= 12.00         THEN 63
    WHEN p_initial >= 8.00          THEN 62
    WHEN p_initial >= 4.00          THEN 61
    ELSE 60
  END;
$$;

-- ----------------------------------------------------------------------------
-- 5. POST CLASS RECORD GRADES -> sms_grades
--    Computes each enrolled learner's term grade and upserts into sms_grades.
--    Learners with no scores entered are skipped (no 0-grade noise).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.post_class_record_grades(p_class_record_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO procurements, public
AS $$
DECLARE
  rec          procurements.sms_class_records%ROWTYPE;
  v_student_id BIGINT;
  v_ww         NUMERIC;
  v_pt         NUMERIC;
  v_st         NUMERIC;
  v_initial    NUMERIC;
  v_term       INTEGER;
  v_posted     INTEGER := 0;
  v_has_score  BOOLEAN;
BEGIN
  SELECT * INTO rec FROM procurements.sms_class_records WHERE id = p_class_record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Class record % not found', p_class_record_id;
  END IF;

  FOR v_student_id IN
    SELECT e.student_id
    FROM procurements.sms_enrollments e
    WHERE e.section_id = rec.section_id
      AND e.school_year = rec.school_year
      AND e.status = 'approved'
      AND e.enrollment_status IN ('active', 'promoted', 'graduated', 'retained', 'completed')
  LOOP
    -- Skip learners with no score entered anywhere in this record.
    SELECT EXISTS (
      SELECT 1
      FROM procurements.sms_class_record_scores s
      JOIN procurements.sms_class_record_items i ON i.id = s.item_id
      WHERE i.class_record_id = rec.id
        AND s.student_id = v_student_id
        AND s.raw_score IS NOT NULL
    ) INTO v_has_score;

    IF NOT v_has_score THEN
      CONTINUE;
    END IF;

    -- Per-component percentage score (missing scores count as 0 on post).
    v_ww := procurements.sms_class_record_component_ps(rec.id, v_student_id, 'WW');
    v_pt := procurements.sms_class_record_component_ps(rec.id, v_student_id, 'PT');
    v_st := procurements.sms_class_record_component_ps(rec.id, v_student_id, 'ST');

    v_initial := COALESCE(v_ww, 0) * rec.ww_weight / 100.0
               + COALESCE(v_pt, 0) * rec.pt_weight / 100.0
               + COALESCE(v_st, 0) * rec.st_weight / 100.0;

    IF rec.use_transmutation THEN
      v_term := procurements.sms_transmute_grade(v_initial);
    ELSE
      v_term := ROUND(v_initial);
    END IF;

    INSERT INTO procurements.sms_grades (
      student_id, subject_id, section_id, grading_period, school_year,
      grade, remarks, teacher_id
    ) VALUES (
      v_student_id, rec.subject_id, rec.section_id, rec.grading_period, rec.school_year,
      v_term, CASE WHEN v_term >= 75 THEN 'Passed' ELSE 'Failed' END, rec.teacher_id
    )
    ON CONFLICT (student_id, subject_id, section_id, grading_period, school_year)
    DO UPDATE SET
      grade = EXCLUDED.grade,
      remarks = EXCLUDED.remarks,
      teacher_id = EXCLUDED.teacher_id,
      updated_at = NOW();

    v_posted := v_posted + 1;
  END LOOP;

  UPDATE procurements.sms_class_records SET is_posted = true, updated_at = NOW()
  WHERE id = rec.id;

  RETURN v_posted;
END;
$$;

-- Percentage score for one component: SUM(raw) / SUM(max) * 100 over all the
-- component's columns (missing scores treated as 0). NULL if no columns exist.
CREATE OR REPLACE FUNCTION procurements.sms_class_record_component_ps(
  p_class_record_id BIGINT,
  p_student_id BIGINT,
  p_component TEXT
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN SUM(i.max_score) IS NULL OR SUM(i.max_score) = 0 THEN NULL
    ELSE ROUND(SUM(COALESCE(s.raw_score, 0)) / SUM(i.max_score) * 100, 2)
  END
  FROM procurements.sms_class_record_items i
  LEFT JOIN procurements.sms_class_record_scores s
    ON s.item_id = i.id AND s.student_id = p_student_id
  WHERE i.class_record_id = p_class_record_id
    AND i.component = p_component;
$$;

-- ----------------------------------------------------------------------------
-- 6. RLS + GRANTS (school/teacher scoping enforced in the app layer, matching
--    the sms_grades / sms_mps convention).
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_class_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_class_record_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_class_record_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Class records: select" ON procurements.sms_class_records
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Class records: insert" ON procurements.sms_class_records
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Class records: update" ON procurements.sms_class_records
  FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Class records: delete" ON procurements.sms_class_records
  FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "Class record items: select" ON procurements.sms_class_record_items
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Class record items: insert" ON procurements.sms_class_record_items
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Class record items: update" ON procurements.sms_class_record_items
  FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Class record items: delete" ON procurements.sms_class_record_items
  FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "Class record scores: select" ON procurements.sms_class_record_scores
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Class record scores: insert" ON procurements.sms_class_record_scores
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Class record scores: update" ON procurements.sms_class_record_scores
  FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Class record scores: delete" ON procurements.sms_class_record_scores
  FOR DELETE USING (auth.role() = 'authenticated');

GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_class_records       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_class_record_items  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_class_record_scores TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE procurements.sms_class_records_id_seq       TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_class_record_items_id_seq  TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_class_record_scores_id_seq TO authenticated;

GRANT EXECUTE ON FUNCTION procurements.sms_transmute_grade(NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.sms_class_record_component_ps(BIGINT, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.post_class_record_grades(BIGINT) TO authenticated;

-- <<< END 080_class_record.sql

-- ============================================================================
-- >>> BEGIN 081_class_record_fixed_summative.sql
-- ============================================================================

-- ============================================================================
-- CLASS RECORD — FIXED SUMMATIVE ITEMS (ST1 / ST2 / TE) WITH PER-ITEM WEIGHTS
--
-- The "Summative Tests & Term Exams" (ST) component is no longer a free-form
-- set of teacher-added columns. It now has three fixed items:
--   ST1 (default 30%), ST2 (default 30%), TE (default 40%)
-- Each item carries its own editable weight. The ST component percentage score
-- becomes the weighted average of each item's own percentage score:
--
--   ST PS = SUM( (raw_i / max_i * 100) * weight_i ) / SUM(weight_i)
--
-- WW and PT keep the original SUM(raw)/SUM(max) model (weight stays NULL there).
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. Per-item weight (used only by ST items; NULL for WW/PT)
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_class_record_items
  ADD COLUMN IF NOT EXISTS weight NUMERIC(5,2) CHECK (weight IS NULL OR (weight >= 0 AND weight <= 100));

COMMENT ON COLUMN procurements.sms_class_record_items.weight IS
  'Per-item weight (percent) within its component. Used by fixed ST items (ST1/ST2/TE); NULL for dynamic WW/PT columns.';

-- ----------------------------------------------------------------------------
-- 2. Seed the three fixed ST items for every existing class record that has
--    none yet (idempotent).
-- ----------------------------------------------------------------------------
INSERT INTO procurements.sms_class_record_items
  (class_record_id, component, label, max_score, weight, position)
SELECT cr.id, 'ST', v.label, 100, v.weight, v.position
FROM procurements.sms_class_records cr
CROSS JOIN (VALUES
  ('ST1', 30, 0),
  ('ST2', 30, 1),
  ('TE',  40, 2)
) AS v(label, weight, position)
WHERE NOT EXISTS (
  SELECT 1 FROM procurements.sms_class_record_items i
  WHERE i.class_record_id = cr.id AND i.component = 'ST'
);

-- ----------------------------------------------------------------------------
-- 3. Component percentage score: ST is now a weighted average of per-item PS;
--    WW/PT keep SUM(raw)/SUM(max)*100. Missing scores count as 0.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.sms_class_record_component_ps(
  p_class_record_id BIGINT,
  p_student_id BIGINT,
  p_component TEXT
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_component = 'ST' THEN (
      SELECT CASE
        WHEN SUM(i.weight) IS NULL OR SUM(i.weight) = 0 THEN NULL
        ELSE ROUND(
          SUM( (COALESCE(s.raw_score, 0) / i.max_score * 100) * i.weight )
          / SUM(i.weight), 2)
      END
      FROM procurements.sms_class_record_items i
      LEFT JOIN procurements.sms_class_record_scores s
        ON s.item_id = i.id AND s.student_id = p_student_id
      WHERE i.class_record_id = p_class_record_id
        AND i.component = 'ST'
    )
    ELSE (
      SELECT CASE
        WHEN SUM(i.max_score) IS NULL OR SUM(i.max_score) = 0 THEN NULL
        ELSE ROUND(SUM(COALESCE(s.raw_score, 0)) / SUM(i.max_score) * 100, 2)
      END
      FROM procurements.sms_class_record_items i
      LEFT JOIN procurements.sms_class_record_scores s
        ON s.item_id = i.id AND s.student_id = p_student_id
      WHERE i.class_record_id = p_class_record_id
        AND i.component = p_component
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION procurements.sms_class_record_component_ps(BIGINT, BIGINT, TEXT) TO authenticated;

-- <<< END 081_class_record_fixed_summative.sql

-- ============================================================================
-- >>> BEGIN 082_class_record_reset_legacy_summative.sql
-- ============================================================================

-- ============================================================================
-- CLASS RECORD — RESET LEGACY SUMMATIVE ITEMS TO FIXED ST1 / ST2 / TE
--
-- Migration 081 seeded the fixed ST items (ST1/ST2/TE) only for class records
-- that had NO summative columns yet. Records where a teacher had already added
-- free-form ST columns were skipped, so they still show the old columns — which
-- carry no per-item weight and therefore can't produce an ST score under the
-- new weighted model, and offer no add/remove controls.
--
-- Legacy ST items are identified by weight IS NULL (the new fixed items always
-- carry a weight). This migration drops those legacy columns (their scores go
-- with them via ON DELETE CASCADE — they don't map to the new model) and seeds
-- the fixed ST1 (30%) / ST2 (30%) / TE (40%) set wherever it is now missing.
-- Idempotent and safe to re-run.
-- ============================================================================

SET search_path TO procurements, public;

-- 1. Remove legacy free-form ST columns (and their scores, via cascade).
DELETE FROM procurements.sms_class_record_items
WHERE component = 'ST'
  AND weight IS NULL;

-- 2. Seed the fixed ST items for every class record that now lacks them.
INSERT INTO procurements.sms_class_record_items
  (class_record_id, component, label, max_score, weight, position)
SELECT cr.id, 'ST', v.label, 100, v.weight, v.position
FROM procurements.sms_class_records cr
CROSS JOIN (VALUES
  ('ST1', 30, 0),
  ('ST2', 30, 1),
  ('TE',  40, 2)
) AS v(label, weight, position)
WHERE NOT EXISTS (
  SELECT 1 FROM procurements.sms_class_record_items i
  WHERE i.class_record_id = cr.id AND i.component = 'ST'
);

-- <<< END 082_class_record_reset_legacy_summative.sql

-- ============================================================================
-- >>> BEGIN 083_crla_assessment.sql
-- ============================================================================

-- ============================================================================
-- CRLA — Comprehensive Rapid Literacy Assessment (DepEd, Grades 1-3)
--
-- Division admins author a "material" per grade level + language (English /
-- Filipino / Mother Tongue): the learner-sheet tasks (word/letter lists), a
-- reading-profile passage, and the reading-profile score bands.
--
-- Section advisers print the learner sheet + a roster scoresheet, administer it
-- per learner, and record raw scores per task. The learner's TOTAL is the sum
-- of task raw scores; the READING PROFILE is the band whose [min,max] contains
-- that total (e.g. 0 = Full Refresher ... 17-20 = Grade Ready).
--
-- Assessed up to three times a year: BoSY / MoSY / EoSY (record.phase).
--
-- Materials are DIVISION-LEVEL (shared, no school_id). Records carry school_id.
-- Scoping is enforced in the app layer (matching sms_grades / sms_class_record).
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. CRLA MATERIALS (authored by division admin, one per grade + language)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_crla_materials (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  grade_level INTEGER NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('English', 'Filipino', 'Mother Tongue')),
  phase TEXT CHECK (phase IS NULL OR phase IN ('BoSY', 'MoSY', 'EoSY')), -- NULL = any phase
  instructions TEXT,
  passage_title TEXT,
  passage_text TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_crla_materials IS
  'Division-authored CRLA instrument per grade level + language (Grades 1-3).';

CREATE INDEX IF NOT EXISTS idx_sms_crla_materials_grade_lang
  ON procurements.sms_crla_materials(grade_level, language);

CREATE TRIGGER update_sms_crla_materials_updated_at
  BEFORE UPDATE ON procurements.sms_crla_materials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. CRLA MATERIAL TASKS (scoresheet columns + printable learner-sheet content)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_crla_material_tasks (
  id BIGSERIAL PRIMARY KEY,
  material_id BIGINT NOT NULL REFERENCES procurements.sms_crla_materials(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'words' CHECK (task_type IN ('letters', 'words', 'sentences', 'passage')),
  items TEXT,                                    -- newline/comma-separated content to print
  max_score NUMERIC(7,2) NOT NULL DEFAULT 10 CHECK (max_score > 0),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_crla_material_tasks IS
  'CRLA scoring columns; `items` holds the word/letter list printed on the learner sheet.';

CREATE INDEX IF NOT EXISTS idx_sms_crla_tasks_material
  ON procurements.sms_crla_material_tasks(material_id, position);

CREATE TRIGGER update_sms_crla_material_tasks_updated_at
  BEFORE UPDATE ON procurements.sms_crla_material_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 3. CRLA BANDS (reading-profile score bands; lookup on raw total)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_crla_bands (
  id BIGSERIAL PRIMARY KEY,
  material_id BIGINT NOT NULL REFERENCES procurements.sms_crla_materials(id) ON DELETE CASCADE,
  min_score NUMERIC(7,2) NOT NULL,
  max_score NUMERIC(7,2) NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_crla_bands IS
  'CRLA reading-profile bands (e.g. Full/Moderate/Light Refresher, Grade Ready).';

CREATE INDEX IF NOT EXISTS idx_sms_crla_bands_material
  ON procurements.sms_crla_bands(material_id, position);

CREATE TRIGGER update_sms_crla_bands_updated_at
  BEFORE UPDATE ON procurements.sms_crla_bands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 4. CRLA RECORDS (one per learner per phase per school year)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_crla_records (
  id BIGSERIAL PRIMARY KEY,
  material_id BIGINT NOT NULL REFERENCES procurements.sms_crla_materials(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  teacher_id BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  phase TEXT NOT NULL CHECK (phase IN ('BoSY', 'MoSY', 'EoSY')),
  school_year TEXT NOT NULL,
  date_assessed DATE,
  total_score NUMERIC(7,2),
  profile_label TEXT,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (material_id, student_id, phase, school_year)
);

COMMENT ON TABLE procurements.sms_crla_records IS
  'Per-learner CRLA result for one phase/school-year; total + reading profile computed by the app.';

CREATE INDEX IF NOT EXISTS idx_sms_crla_records_school   ON procurements.sms_crla_records(school_id);
CREATE INDEX IF NOT EXISTS idx_sms_crla_records_section  ON procurements.sms_crla_records(section_id);
CREATE INDEX IF NOT EXISTS idx_sms_crla_records_student  ON procurements.sms_crla_records(student_id);
CREATE INDEX IF NOT EXISTS idx_sms_crla_records_sy_phase ON procurements.sms_crla_records(school_year, phase);

CREATE TRIGGER update_sms_crla_records_updated_at
  BEFORE UPDATE ON procurements.sms_crla_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 5. CRLA RECORD SCORES (one raw score per task per record)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_crla_record_scores (
  id BIGSERIAL PRIMARY KEY,
  record_id BIGINT NOT NULL REFERENCES procurements.sms_crla_records(id) ON DELETE CASCADE,
  task_id BIGINT NOT NULL REFERENCES procurements.sms_crla_material_tasks(id) ON DELETE CASCADE,
  raw_score NUMERIC(7,2) CHECK (raw_score >= 0),  -- NULL = not yet entered
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (record_id, task_id)
);

COMMENT ON TABLE procurements.sms_crla_record_scores IS
  'Raw score per learner per CRLA task. NULL means not yet entered.';

CREATE INDEX IF NOT EXISTS idx_sms_crla_record_scores_record ON procurements.sms_crla_record_scores(record_id);
CREATE INDEX IF NOT EXISTS idx_sms_crla_record_scores_task   ON procurements.sms_crla_record_scores(task_id);

CREATE TRIGGER update_sms_crla_record_scores_updated_at
  BEFORE UPDATE ON procurements.sms_crla_record_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 6. RLS + GRANTS (scoping enforced in the app layer)
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_crla_materials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_crla_material_tasks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_crla_bands           ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_crla_records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_crla_record_scores   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sms_crla_materials', 'sms_crla_material_tasks', 'sms_crla_bands',
    'sms_crla_records', 'sms_crla_record_scores'
  ] LOOP
    EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
  END LOOP;
END $$;

-- <<< END 083_crla_assessment.sql

-- ============================================================================
-- >>> BEGIN 084_philiri_assessment.sql
-- ============================================================================

-- ============================================================================
-- Phil-IRI — Philippine Informal Reading Inventory (DepEd, Grades 3-10)
--
-- Division admins author a "material" per grade level + language (English /
-- Filipino): a graded reading passage (with word count) and its comprehension
-- questions. Section advisers administer it per learner and record:
--   - miscues  → word-reading score % = (word_count - miscues)/word_count*100
--   - correct comprehension answers → comprehension score %
-- Reading levels (Phil-IRI Manual 2018) are derived in the app:
--   word reading:  >=97 Independent, 90-96 Instructional, <=89 Frustration
--   comprehension: >=80 Independent, 59-79 Instructional, <=58 Frustration
--   overall = the more severe (lower) of the two.
--
-- Assessed up to three times a year: BoSY / MoSY / EoSY (record.phase).
-- Materials are DIVISION-LEVEL; records carry school_id. App-layer scoping.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. MATERIALS (passage + word count, one per grade + language + set)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_philiri_materials (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  grade_level INTEGER NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('English', 'Filipino')),
  set_label TEXT,                                -- e.g. Set A / Set B (pre/post forms)
  passage_title TEXT,
  passage_text TEXT,
  word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  instructions TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_philiri_materials IS
  'Division-authored Phil-IRI graded passage per grade level + language (Grades 3-10).';

CREATE INDEX IF NOT EXISTS idx_sms_philiri_materials_grade_lang
  ON procurements.sms_philiri_materials(grade_level, language);

CREATE TRIGGER update_sms_philiri_materials_updated_at
  BEFORE UPDATE ON procurements.sms_philiri_materials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. QUESTIONS (comprehension questions for a passage)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_philiri_questions (
  id BIGSERIAL PRIMARY KEY,
  material_id BIGINT NOT NULL REFERENCES procurements.sms_philiri_materials(id) ON DELETE CASCADE,
  question_no INTEGER NOT NULL DEFAULT 1,
  question_text TEXT NOT NULL,
  correct_answer TEXT,
  question_type TEXT NOT NULL DEFAULT 'literal' CHECK (question_type IN ('literal', 'inferential', 'critical')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_philiri_questions IS
  'Comprehension questions belonging to a Phil-IRI passage.';

CREATE INDEX IF NOT EXISTS idx_sms_philiri_questions_material
  ON procurements.sms_philiri_questions(material_id, position);

CREATE TRIGGER update_sms_philiri_questions_updated_at
  BEFORE UPDATE ON procurements.sms_philiri_questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 3. RECORDS (one per learner per phase per school year)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_philiri_records (
  id BIGSERIAL PRIMARY KEY,
  material_id BIGINT NOT NULL REFERENCES procurements.sms_philiri_materials(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  teacher_id BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  phase TEXT NOT NULL CHECK (phase IN ('BoSY', 'MoSY', 'EoSY')),
  school_year TEXT NOT NULL,
  date_assessed DATE,
  miscues INTEGER CHECK (miscues IS NULL OR miscues >= 0),
  word_reading_score NUMERIC(6,2),
  comprehension_score NUMERIC(6,2),
  word_reading_level TEXT,
  comprehension_level TEXT,
  overall_reading_level TEXT,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (material_id, student_id, phase, school_year)
);

COMMENT ON TABLE procurements.sms_philiri_records IS
  'Per-learner Phil-IRI result for one phase/school-year; scores + levels computed by the app.';

CREATE INDEX IF NOT EXISTS idx_sms_philiri_records_school   ON procurements.sms_philiri_records(school_id);
CREATE INDEX IF NOT EXISTS idx_sms_philiri_records_section  ON procurements.sms_philiri_records(section_id);
CREATE INDEX IF NOT EXISTS idx_sms_philiri_records_student  ON procurements.sms_philiri_records(student_id);
CREATE INDEX IF NOT EXISTS idx_sms_philiri_records_sy_phase ON procurements.sms_philiri_records(school_year, phase);

CREATE TRIGGER update_sms_philiri_records_updated_at
  BEFORE UPDATE ON procurements.sms_philiri_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 4. ANSWERS (per-question correctness for a record)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_philiri_answers (
  id BIGSERIAL PRIMARY KEY,
  record_id BIGINT NOT NULL REFERENCES procurements.sms_philiri_records(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES procurements.sms_philiri_questions(id) ON DELETE CASCADE,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (record_id, question_id)
);

COMMENT ON TABLE procurements.sms_philiri_answers IS
  'Whether a learner answered a given comprehension question correctly.';

CREATE INDEX IF NOT EXISTS idx_sms_philiri_answers_record   ON procurements.sms_philiri_answers(record_id);
CREATE INDEX IF NOT EXISTS idx_sms_philiri_answers_question ON procurements.sms_philiri_answers(question_id);

CREATE TRIGGER update_sms_philiri_answers_updated_at
  BEFORE UPDATE ON procurements.sms_philiri_answers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 5. RLS + GRANTS
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_philiri_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_philiri_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_philiri_records   ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_philiri_answers   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sms_philiri_materials', 'sms_philiri_questions',
    'sms_philiri_records', 'sms_philiri_answers'
  ] LOOP
    EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
  END LOOP;
END $$;

-- <<< END 084_philiri_assessment.sql

-- ============================================================================
-- >>> BEGIN 085_rma_assessment.sql
-- ============================================================================

-- ============================================================================
-- RMA — Rapid Mathematics Assessment (DepEd, Grades 1-10)
--
-- Division admins author a "material" per grade level: a set of math items
-- (grouped by domain) with an answer key, plus mastery bands. Section advisers
-- record each learner's per-item results; the TOTAL is the sum of item raw
-- scores and the MASTERY band is looked up on the PERCENTAGE of the total
-- possible score (e.g. Not Proficient ... Proficient).
--
-- Assessed up to three times a year: BoSY / MoSY / EoSY (record.phase).
-- Materials are DIVISION-LEVEL; records carry school_id. App-layer scoping.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. MATERIALS (one per grade level)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_rma_materials (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  grade_level INTEGER NOT NULL,
  instructions TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_rma_materials IS
  'Division-authored RMA instrument per grade level (Grades 1-10).';

CREATE INDEX IF NOT EXISTS idx_sms_rma_materials_grade
  ON procurements.sms_rma_materials(grade_level);

CREATE TRIGGER update_sms_rma_materials_updated_at
  BEFORE UPDATE ON procurements.sms_rma_materials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. ITEMS (scoresheet columns, grouped by math domain)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_rma_items (
  id BIGSERIAL PRIMARY KEY,
  material_id BIGINT NOT NULL REFERENCES procurements.sms_rma_materials(id) ON DELETE CASCADE,
  item_no INTEGER NOT NULL DEFAULT 1,
  domain TEXT,
  question_text TEXT,
  correct_answer TEXT,
  max_score NUMERIC(7,2) NOT NULL DEFAULT 1 CHECK (max_score > 0),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_rma_items IS
  'RMA scoring items (per domain) belonging to a material.';

CREATE INDEX IF NOT EXISTS idx_sms_rma_items_material
  ON procurements.sms_rma_items(material_id, position);

CREATE TRIGGER update_sms_rma_items_updated_at
  BEFORE UPDATE ON procurements.sms_rma_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 3. BANDS (mastery bands; lookup on percentage of total possible)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_rma_bands (
  id BIGSERIAL PRIMARY KEY,
  material_id BIGINT NOT NULL REFERENCES procurements.sms_rma_materials(id) ON DELETE CASCADE,
  min_score NUMERIC(6,2) NOT NULL,               -- percentage 0-100
  max_score NUMERIC(6,2) NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_rma_bands IS
  'RMA mastery bands, matched against the learner''s percentage of total score.';

CREATE INDEX IF NOT EXISTS idx_sms_rma_bands_material
  ON procurements.sms_rma_bands(material_id, position);

CREATE TRIGGER update_sms_rma_bands_updated_at
  BEFORE UPDATE ON procurements.sms_rma_bands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 4. RECORDS (one per learner per phase per school year)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_rma_records (
  id BIGSERIAL PRIMARY KEY,
  material_id BIGINT NOT NULL REFERENCES procurements.sms_rma_materials(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  teacher_id BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  phase TEXT NOT NULL CHECK (phase IN ('BoSY', 'MoSY', 'EoSY')),
  school_year TEXT NOT NULL,
  date_assessed DATE,
  total_score NUMERIC(7,2),
  mastery_label TEXT,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (material_id, student_id, phase, school_year)
);

COMMENT ON TABLE procurements.sms_rma_records IS
  'Per-learner RMA result for one phase/school-year; total + mastery computed by the app.';

CREATE INDEX IF NOT EXISTS idx_sms_rma_records_school   ON procurements.sms_rma_records(school_id);
CREATE INDEX IF NOT EXISTS idx_sms_rma_records_section  ON procurements.sms_rma_records(section_id);
CREATE INDEX IF NOT EXISTS idx_sms_rma_records_student  ON procurements.sms_rma_records(student_id);
CREATE INDEX IF NOT EXISTS idx_sms_rma_records_sy_phase ON procurements.sms_rma_records(school_year, phase);

CREATE TRIGGER update_sms_rma_records_updated_at
  BEFORE UPDATE ON procurements.sms_rma_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 5. ITEM SCORES (one raw score per item per record)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_rma_item_scores (
  id BIGSERIAL PRIMARY KEY,
  record_id BIGINT NOT NULL REFERENCES procurements.sms_rma_records(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES procurements.sms_rma_items(id) ON DELETE CASCADE,
  raw_score NUMERIC(7,2) CHECK (raw_score >= 0),  -- NULL = not yet entered
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (record_id, item_id)
);

COMMENT ON TABLE procurements.sms_rma_item_scores IS
  'Raw score per learner per RMA item. NULL means not yet entered.';

CREATE INDEX IF NOT EXISTS idx_sms_rma_item_scores_record ON procurements.sms_rma_item_scores(record_id);
CREATE INDEX IF NOT EXISTS idx_sms_rma_item_scores_item   ON procurements.sms_rma_item_scores(item_id);

CREATE TRIGGER update_sms_rma_item_scores_updated_at
  BEFORE UPDATE ON procurements.sms_rma_item_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 6. RLS + GRANTS
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_rma_materials    ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_rma_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_rma_bands        ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_rma_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_rma_item_scores  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sms_rma_materials', 'sms_rma_items', 'sms_rma_bands',
    'sms_rma_records', 'sms_rma_item_scores'
  ] LOOP
    EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
  END LOOP;
END $$;

-- <<< END 085_rma_assessment.sql

-- ============================================================================
-- >>> BEGIN 086_crla_record_form.sql
-- ============================================================================

-- ============================================================================
-- CRLA — PART 2 RECORD FORM (Reading Fluency & Comprehension)
--
-- The CRLA-M "Record Form" (Part 2) is a graded story broken into passage lines,
-- each with a word count and optionally a comprehension question + answer key.
-- The section adviser records, per learner: per-line miscues, a ✓/✗/N/A mark for
-- each question, a fluency Observation level (1-4), and written notes.
--
-- Division admins author the record forms (a standalone settings CRUD, so a
-- grade+language can have several stories). Materials are DIVISION-LEVEL (no
-- school_id); records carry school_id. App-layer scoping (mirrors the rest of
-- the assessments feature).
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. RECORD FORMS (authored by division admin; one story per grade + language)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_crla_record_forms (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,                            -- e.g. "English Reading Fluency and Comprehension – Grade 3"
  grade_level INTEGER NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('English', 'Filipino', 'Mother Tongue')),
  story_title TEXT,                              -- e.g. "STORY 1 – PARA THE PARROT"
  instructions TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_crla_record_forms IS
  'Division-authored CRLA Part 2 record form (graded story) per grade + language.';

CREATE INDEX IF NOT EXISTS idx_sms_crla_rf_grade_lang
  ON procurements.sms_crla_record_forms(grade_level, language);

CREATE TRIGGER update_sms_crla_record_forms_updated_at
  BEFORE UPDATE ON procurements.sms_crla_record_forms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. RECORD FORM LINES (passage broken into lines; some carry a question)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_crla_record_form_lines (
  id BIGSERIAL PRIMARY KEY,
  record_form_id BIGINT NOT NULL REFERENCES procurements.sms_crla_record_forms(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  line_text TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  question TEXT,                                  -- NULL = no comprehension question on this line
  answer_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_crla_record_form_lines IS
  'Passage lines of a CRLA record form; word count + optional comprehension question.';

CREATE INDEX IF NOT EXISTS idx_sms_crla_rf_lines_form
  ON procurements.sms_crla_record_form_lines(record_form_id, position);

CREATE TRIGGER update_sms_crla_record_form_lines_updated_at
  BEFORE UPDATE ON procurements.sms_crla_record_form_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 3. RECORD FORM OBSERVATIONS (the Level 1-4 fluency rubric, editable text)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_crla_record_form_observations (
  id BIGSERIAL PRIMARY KEY,
  record_form_id BIGINT NOT NULL REFERENCES procurements.sms_crla_record_forms(id) ON DELETE CASCADE,
  level_no INTEGER NOT NULL CHECK (level_no BETWEEN 1 AND 4),
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (record_form_id, level_no)
);

COMMENT ON TABLE procurements.sms_crla_record_form_observations IS
  'Fluency observation rubric (Level 1-4) descriptions for a CRLA record form.';

CREATE TRIGGER update_sms_crla_record_form_observations_updated_at
  BEFORE UPDATE ON procurements.sms_crla_record_form_observations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 4. RECORD FORM RECORDS (one per learner per phase per school year)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_crla_record_form_records (
  id BIGSERIAL PRIMARY KEY,
  record_form_id BIGINT NOT NULL REFERENCES procurements.sms_crla_record_forms(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  teacher_id BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  phase TEXT NOT NULL CHECK (phase IN ('BoSY', 'MoSY', 'EoSY')),
  school_year TEXT NOT NULL,
  date_assessed DATE,
  total_miscues NUMERIC(7,2),
  comprehension_correct INTEGER,
  comprehension_total INTEGER,
  observation_level INTEGER CHECK (observation_level IS NULL OR observation_level BETWEEN 1 AND 4),
  observations_notes TEXT,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (record_form_id, student_id, phase, school_year)
);

COMMENT ON TABLE procurements.sms_crla_record_form_records IS
  'Per-learner CRLA Part 2 result for one phase/school-year; totals + observation level.';

CREATE INDEX IF NOT EXISTS idx_sms_crla_rf_records_school   ON procurements.sms_crla_record_form_records(school_id);
CREATE INDEX IF NOT EXISTS idx_sms_crla_rf_records_section  ON procurements.sms_crla_record_form_records(section_id);
CREATE INDEX IF NOT EXISTS idx_sms_crla_rf_records_student  ON procurements.sms_crla_record_form_records(student_id);
CREATE INDEX IF NOT EXISTS idx_sms_crla_rf_records_sy_phase ON procurements.sms_crla_record_form_records(school_year, phase);

CREATE TRIGGER update_sms_crla_record_form_records_updated_at
  BEFORE UPDATE ON procurements.sms_crla_record_form_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 5. RECORD FORM LINE SCORES (per learner per line: miscues + ✓/✗/N/A)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_crla_record_form_line_scores (
  id BIGSERIAL PRIMARY KEY,
  record_id BIGINT NOT NULL REFERENCES procurements.sms_crla_record_form_records(id) ON DELETE CASCADE,
  line_id BIGINT NOT NULL REFERENCES procurements.sms_crla_record_form_lines(id) ON DELETE CASCADE,
  miscues NUMERIC(7,2) CHECK (miscues IS NULL OR miscues >= 0),
  answer_status TEXT CHECK (answer_status IS NULL OR answer_status IN ('correct', 'wrong', 'na')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (record_id, line_id)
);

COMMENT ON TABLE procurements.sms_crla_record_form_line_scores IS
  'Per-learner per-line miscues and comprehension mark on a CRLA record form.';

CREATE INDEX IF NOT EXISTS idx_sms_crla_rf_line_scores_record ON procurements.sms_crla_record_form_line_scores(record_id);
CREATE INDEX IF NOT EXISTS idx_sms_crla_rf_line_scores_line   ON procurements.sms_crla_record_form_line_scores(line_id);

CREATE TRIGGER update_sms_crla_record_form_line_scores_updated_at
  BEFORE UPDATE ON procurements.sms_crla_record_form_line_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 6. RLS + GRANTS (scoping enforced in the app layer)
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_crla_record_forms              ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_crla_record_form_lines         ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_crla_record_form_observations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_crla_record_form_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_crla_record_form_line_scores   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sms_crla_record_forms', 'sms_crla_record_form_lines',
    'sms_crla_record_form_observations', 'sms_crla_record_form_records',
    'sms_crla_record_form_line_scores'
  ] LOOP
    EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
  END LOOP;
END $$;

-- <<< END 086_crla_record_form.sql

-- ============================================================================
-- >>> BEGIN 087_crla_material_phases.sql
-- ============================================================================

-- ============================================================================
-- CRLA MATERIALS — MULTIPLE PHASES
--
-- A CRLA material may now apply to several administration phases at once
-- (BoSY / MoSY / EoSY) instead of a single one. The single `phase` column is
-- replaced by a `phases TEXT[]` array. An empty array means "any phase".
-- ============================================================================

SET search_path TO procurements, public;

ALTER TABLE procurements.sms_crla_materials
  ADD COLUMN IF NOT EXISTS phases TEXT[] NOT NULL DEFAULT '{}';

-- Migrate the existing single phase into the array.
UPDATE procurements.sms_crla_materials
  SET phases = ARRAY[phase]
  WHERE phase IS NOT NULL
    AND (phases IS NULL OR phases = '{}');

-- Every element must be a valid phase.
ALTER TABLE procurements.sms_crla_materials
  DROP CONSTRAINT IF EXISTS sms_crla_materials_phases_valid;
ALTER TABLE procurements.sms_crla_materials
  ADD CONSTRAINT sms_crla_materials_phases_valid
  CHECK (phases <@ ARRAY['BoSY', 'MoSY', 'EoSY']::TEXT[]);

-- Drop the old single-phase column.
ALTER TABLE procurements.sms_crla_materials DROP COLUMN IF EXISTS phase;

COMMENT ON COLUMN procurements.sms_crla_materials.phases IS
  'Administration phases this material applies to (BoSY/MoSY/EoSY). Empty = any phase.';

-- <<< END 087_crla_material_phases.sql

-- ============================================================================
-- >>> BEGIN 088_crla_task_material_file.sql
-- ============================================================================

-- ============================================================================
-- CRLA scoring tasks: downloadable material file (image / PDF) per task
-- ============================================================================
-- The division authors a CRLA material and, per scoring task, attaches the
-- learner-facing material (image or PDF). Section advisers download it from
-- the teacher CRLA scoresheet. Files live in the public `school-management`
-- bucket under `crla-materials/{material_id}/...`.
-- ============================================================================

ALTER TABLE procurements.sms_crla_material_tasks
  ADD COLUMN IF NOT EXISTS file_url  TEXT,
  ADD COLUMN IF NOT EXISTS file_name TEXT;

COMMENT ON COLUMN procurements.sms_crla_material_tasks.file_url IS
  'Public URL of the uploaded task material (image/PDF) that section advisers download.';
COMMENT ON COLUMN procurements.sms_crla_material_tasks.file_name IS
  'Original filename of the uploaded task material, shown as the download label.';

-- Storage: authenticated read is already granted bucket-wide by migration 078,
-- so advisers can download. Grant division authors write access to the
-- crla-materials/ path (in addition to the landing-hero/ policies from 078).
DROP POLICY IF EXISTS "school_management crla insert" ON storage.objects;
DROP POLICY IF EXISTS "school_management crla update" ON storage.objects;
DROP POLICY IF EXISTS "school_management crla delete" ON storage.objects;

CREATE POLICY "school_management crla insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'school-management'
    AND split_part(name, '/', 1) = 'crla-materials'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('division_admin', 'super admin')
    )
  );

CREATE POLICY "school_management crla update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'school-management'
    AND split_part(name, '/', 1) = 'crla-materials'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('division_admin', 'super admin')
    )
  );

CREATE POLICY "school_management crla delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'school-management'
    AND split_part(name, '/', 1) = 'crla-materials'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('division_admin', 'super admin')
    )
  );

-- <<< END 088_crla_task_material_file.sql

-- ============================================================================
-- >>> BEGIN 089_philiri_file_material_and_screening.sql
-- ============================================================================

-- ============================================================================
-- Phil-IRI — rework to uploaded material + GST screening scoresheet
--
-- The division office no longer authors the passage/questions inside the app.
-- Instead they upload the ready DepEd material (image or PDF) and describe it
-- (title, grade, language, set label, passage word count, instructions).
--
-- Section advisers download that file and record the DepEd Group Screening Test
-- Class Reading Record (STCRR / Form 1B for English, TPPK / Form 1A for
-- Filipino) per learner:
--   - test_taken            (✓ / X)
--   - literal_correct       (out of 7)
--   - inferential_correct   (out of 7)
--   - critical_correct      (out of 6)
--   - total_score           (= sum, out of 20)
--   - screening_result      (≥14 → no need for Phil-IRI; <14 → for Phil-IRI)
--
-- Columns are ADDED (not dropped) so existing rows and the older passage/
-- comprehension columns remain intact. The sms_philiri_questions /
-- sms_philiri_answers tables are simply no longer written to.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- Materials: uploaded file (image / PDF)
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_philiri_materials
  ADD COLUMN IF NOT EXISTS file_url  TEXT,
  ADD COLUMN IF NOT EXISTS file_name TEXT;

-- ----------------------------------------------------------------------------
-- Records: GST screening scoresheet fields
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_philiri_records
  ADD COLUMN IF NOT EXISTS test_taken          BOOLEAN,
  ADD COLUMN IF NOT EXISTS literal_correct     INTEGER CHECK (literal_correct     IS NULL OR literal_correct     >= 0),
  ADD COLUMN IF NOT EXISTS inferential_correct INTEGER CHECK (inferential_correct IS NULL OR inferential_correct >= 0),
  ADD COLUMN IF NOT EXISTS critical_correct    INTEGER CHECK (critical_correct    IS NULL OR critical_correct    >= 0),
  ADD COLUMN IF NOT EXISTS total_score         INTEGER CHECK (total_score         IS NULL OR total_score         >= 0),
  ADD COLUMN IF NOT EXISTS screening_result    TEXT;

-- ----------------------------------------------------------------------------
-- Storage: grant division authors write access to the philiri-materials/ path
-- of the public `school-management` bucket. Authenticated read is already
-- granted bucket-wide by migration 078; the per-path INSERT/UPDATE/DELETE
-- policies from 078 (landing-hero) and 088 (crla-materials) do NOT cover this
-- prefix, so uploads here need their own policies (mirrors 088).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "school_management philiri insert" ON storage.objects;
DROP POLICY IF EXISTS "school_management philiri update" ON storage.objects;
DROP POLICY IF EXISTS "school_management philiri delete" ON storage.objects;

CREATE POLICY "school_management philiri insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'school-management'
    AND split_part(name, '/', 1) = 'philiri-materials'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('division_admin', 'super admin')
    )
  );

CREATE POLICY "school_management philiri update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'school-management'
    AND split_part(name, '/', 1) = 'philiri-materials'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('division_admin', 'super admin')
    )
  );

CREATE POLICY "school_management philiri delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'school-management'
    AND split_part(name, '/', 1) = 'philiri-materials'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('division_admin', 'super admin')
    )
  );

-- <<< END 089_philiri_file_material_and_screening.sql

-- ============================================================================
-- >>> BEGIN 090_philiri_individual_record_form.sql
-- ============================================================================

-- ============================================================================
-- Phil-IRI — Individual Record Form (Form 3A Filipino / Form 3B English)
--
-- In addition to the Group Screening Test class record (STCRR / TPPK), section
-- advisers can now record the per-learner ORAL READING test:
--   Part A (Comprehension): reading time, reading rate (wpm), raw score,
--     comprehension %, comprehension level, per-question answers.
--   Part B (Word Reading):  the 7 miscue-type counts, total miscues, word
--     reading score %, word reading level; overall reading level.
--
-- Both form types share sms_philiri_records, discriminated by `form_type`
-- ('screening' | 'individual'); the unique key gains form_type so a learner can
-- have one of each per material / phase / school year. The legacy
-- miscues / word_reading_* / comprehension_* / overall_reading_level columns
-- (dormant since the screening rework) are reused for the individual form.
-- ============================================================================

SET search_path TO procurements, public;

ALTER TABLE procurements.sms_philiri_records
  ADD COLUMN IF NOT EXISTS form_type            TEXT NOT NULL DEFAULT 'screening'
    CHECK (form_type IN ('screening', 'individual')),
  ADD COLUMN IF NOT EXISTS reading_time_seconds INTEGER CHECK (reading_time_seconds IS NULL OR reading_time_seconds >= 0),
  ADD COLUMN IF NOT EXISTS reading_rate         NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS comprehension_raw    INTEGER CHECK (comprehension_raw IS NULL OR comprehension_raw >= 0),
  ADD COLUMN IF NOT EXISTS comprehension_total  INTEGER,
  ADD COLUMN IF NOT EXISTS miscue_counts        JSONB,
  ADD COLUMN IF NOT EXISTS comprehension_answers JSONB;

-- Replace the old unique key so both a screening and an individual record can
-- coexist for the same learner / material / phase / school year.
ALTER TABLE procurements.sms_philiri_records
  DROP CONSTRAINT IF EXISTS sms_philiri_records_material_id_student_id_phase_school_yea_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sms_philiri_records_unique_form'
      AND conrelid = 'procurements.sms_philiri_records'::regclass
  ) THEN
    ALTER TABLE procurements.sms_philiri_records
      ADD CONSTRAINT sms_philiri_records_unique_form
      UNIQUE (material_id, student_id, phase, school_year, form_type);
  END IF;
END $$;

-- <<< END 090_philiri_individual_record_form.sql

-- ============================================================================
-- >>> BEGIN 091_crla_three_task_flow.sql
-- ============================================================================

-- ============================================================================
-- CRLA — THREE-TASK BRANCHING FLOW (30-point total)
--
-- DepEd CRLA is a 3-task branching screening:
--   • Task 1  (max 10)  — gates the second stage.
--       Task 1 0–6  → Task 2L is recorded; Task 2H is n/a.
--       Task 1 7–10 → Task 2L is auto-awarded full marks; Task 2H is recorded.
--   • Task 2H 7–10 → the learner's Part 2 Record Form should be filled.
-- The Reading Profile is auto-banded from the 0–30 total:
--       0–10 Full Refresher · 11–16 Moderate · 17–26 Light · 27–30 Grade Ready.
--
-- Earlier CRLA materials were seeded as a 2-task / 20-point instrument. This
-- migration normalizes EVERY existing division-authored material to the 3-task
-- shape and the new bands, and re-bands existing per-learner records.
--
-- NOTE: this intentionally overwrites task labels / max scores and replaces the
-- band rows for all CRLA materials (uniform DepEd rollout). Uploaded per-task
-- files (`file_url` / `file_name`) and printable `items` are preserved.
-- ============================================================================

SET search_path TO procurements, public;

DO $$
DECLARE
  mat        RECORD;
  task_ids   BIGINT[];
  n          INT;
BEGIN
  FOR mat IN SELECT id FROM procurements.sms_crla_materials LOOP
    -- Existing tasks for this material, in display order.
    SELECT array_agg(id ORDER BY position, id)
      INTO task_ids
      FROM procurements.sms_crla_material_tasks
     WHERE material_id = mat.id;
    n := COALESCE(array_length(task_ids, 1), 0);

    -- Task 1 (position 0)
    IF n >= 1 THEN
      UPDATE procurements.sms_crla_material_tasks
         SET label = 'Task 1', task_type = 'letters', max_score = 10, position = 0
       WHERE id = task_ids[1];
    ELSE
      INSERT INTO procurements.sms_crla_material_tasks
        (material_id, label, task_type, max_score, position)
      VALUES (mat.id, 'Task 1', 'letters', 10, 0);
    END IF;

    -- Task 2L (position 1)
    IF n >= 2 THEN
      UPDATE procurements.sms_crla_material_tasks
         SET label = 'Task 2L', task_type = 'words', max_score = 10, position = 1
       WHERE id = task_ids[2];
    ELSE
      INSERT INTO procurements.sms_crla_material_tasks
        (material_id, label, task_type, max_score, position)
      VALUES (mat.id, 'Task 2L', 'words', 10, 1);
    END IF;

    -- Task 2H (position 2)
    IF n >= 3 THEN
      UPDATE procurements.sms_crla_material_tasks
         SET label = 'Task 2H', task_type = 'sentences', max_score = 10, position = 2
       WHERE id = task_ids[3];
    ELSE
      INSERT INTO procurements.sms_crla_material_tasks
        (material_id, label, task_type, max_score, position)
      VALUES (mat.id, 'Task 2H', 'sentences', 10, 2);
    END IF;

    -- Any extra (4th+) legacy tasks are left in place but no longer used by the
    -- flow; remove them so the scoresheet shows exactly three columns.
    IF n > 3 THEN
      DELETE FROM procurements.sms_crla_material_tasks
       WHERE material_id = mat.id
         AND id = ANY(task_ids[4:n]);
    END IF;

    -- Replace the reading-profile bands with the new 0–30 set.
    DELETE FROM procurements.sms_crla_bands WHERE material_id = mat.id;
    INSERT INTO procurements.sms_crla_bands
      (material_id, min_score, max_score, label, position)
    VALUES
      (mat.id, 0,  10, 'Full Refresher',     0),
      (mat.id, 11, 16, 'Moderate Refresher', 1),
      (mat.id, 17, 26, 'Light Refresher',    2),
      (mat.id, 27, 30, 'Grade Ready',        3);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Re-band existing per-learner records against the new bands.
--
-- Stored `total_score` already reflects the old auto-fill (Task 1 + effective
-- Task 2). Under the new flow a legacy record has no Task 2H (contributes 0),
-- so the effective total is unchanged — only the band label needs updating.
-- Records get their totals recomputed from raw scores the next time a teacher
-- edits the scoresheet.
-- ----------------------------------------------------------------------------
UPDATE procurements.sms_crla_records
   SET profile_label = CASE
     WHEN total_score BETWEEN 0  AND 10 THEN 'Full Refresher'
     WHEN total_score BETWEEN 11 AND 16 THEN 'Moderate Refresher'
     WHEN total_score BETWEEN 17 AND 26 THEN 'Light Refresher'
     WHEN total_score BETWEEN 27 AND 30 THEN 'Grade Ready'
     ELSE profile_label
   END
 WHERE total_score IS NOT NULL;

-- <<< END 091_crla_three_task_flow.sql

-- ============================================================================
-- >>> BEGIN 091_philiri_grade_aware_screening.sql
-- ============================================================================

-- ============================================================================
-- Phil-IRI — grade-aware Group Screening Test + number-free result labels
--
-- The GST is now scaled by key stage:
--   - Grades 3-6:  20-item form (7 / 7 / 6),   pass threshold >= 14
--   - Grades 7-10: 40-item form (14 / 14 / 12), pass threshold >= 28
--
-- The stored `screening_result` label used to embed the elementary threshold
-- ("For Phil-IRI (<14)" / "No Phil-IRI (>=14)"). Those numbers are wrong for the
-- 40-item form, so the app now stores number-free labels ("For Phil-IRI" /
-- "No Phil-IRI") and the threshold lives in the (grade-aware) UI text instead.
--
-- Normalise any rows written before this change so the division assessment
-- rollup (which groups by the exact label) keeps counting them.
-- ============================================================================

SET search_path TO procurements, public;

UPDATE procurements.sms_philiri_records
   SET screening_result = 'For Phil-IRI'
 WHERE screening_result = 'For Phil-IRI (<14)';

UPDATE procurements.sms_philiri_records
   SET screening_result = 'No Phil-IRI'
 WHERE screening_result = 'No Phil-IRI (≥14)';

-- <<< END 091_philiri_grade_aware_screening.sql

-- ============================================================================
-- >>> BEGIN 091_rma_ks1_seed.sql
-- ============================================================================

-- ============================================================================
-- RMA — seed the DepEd KS1 levelling instrument (Grades 1-10)
--
-- The RMA scoresheet renders whatever division-authored material exists for a
-- section's grade level. This migration seeds ONE KS1 material per grade so the
-- grid works immediately after deploy, each with:
--   * 8 tasks (A-H) worth 2,1,2,3,3,2,3,4 = 20 points (the UI derives the A-H
--     letter from `position`; the human label is stored in `domain`).
--   * 3 levelling bands on the percentage of the total possible score:
--       Intervention < 75%, Consolidation 75-84%, Enhancement >= 85%.
--
-- No DDL / column changes — seed only. Idempotent: a grade is skipped if it
-- already has an active KS1 material (title 'RMA (KS1)'), so re-running is safe.
-- Division admins may edit task labels / max scores / bands afterwards.
-- ============================================================================

SET search_path TO procurements, public;

DO $$
DECLARE
  g INTEGER;
  mid BIGINT;
BEGIN
  FOR g IN 1..10 LOOP
    -- Skip grades that already have an active KS1 material.
    IF EXISTS (
      SELECT 1 FROM procurements.sms_rma_materials
      WHERE grade_level = g AND title = 'RMA (KS1)' AND is_active = true
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO procurements.sms_rma_materials (title, grade_level, instructions, is_active)
    VALUES (
      'RMA (KS1)',
      g,
      'Rapid Mathematics Assessment — KS1 three-level profile. Enter each task score; the system computes the percentage and levelling.',
      true
    )
    RETURNING id INTO mid;

    -- 8 tasks A-H (position 0-7). `domain` holds the printable task label.
    INSERT INTO procurements.sms_rma_items (material_id, item_no, domain, max_score, position)
    VALUES
      (mid, 1, 'Task A', 2, 0),
      (mid, 2, 'Task B', 1, 1),
      (mid, 3, 'Task C', 2, 2),
      (mid, 4, 'Task D', 3, 3),
      (mid, 5, 'Task E', 3, 4),
      (mid, 6, 'Task F', 2, 5),
      (mid, 7, 'Task G', 3, 6),
      (mid, 8, 'Task H', 4, 7);

    -- 3 KS1 levelling bands (percentage lookup). Max values sit just below the
    -- next threshold so the boundary lands on spec (75% -> Consolidation, 85% ->
    -- Enhancement).
    INSERT INTO procurements.sms_rma_bands (material_id, min_score, max_score, label, position)
    VALUES
      (mid, 0,     74.99, 'Intervention',  0),
      (mid, 75,    84.99, 'Consolidation', 1),
      (mid, 85,    100,   'Enhancement',   2);
  END LOOP;
END $$;

-- <<< END 091_rma_ks1_seed.sql

-- ============================================================================
-- >>> BEGIN 092_pabasa_assessment.sql
-- ============================================================================

-- ============================================================================
-- PABASA — Division Pabasa Reading Program (DepEd, Grades 11-12)
--
-- A division-initiated reading program for Senior High (Grades 11 & 12). Every
-- learner is tested in BOTH Filipino and English. While the learner reads, the
-- section adviser marks a single reading-readiness LEVEL — one of
-- Average / Fast / Spontaneous — plus free-text remarks.
--
-- Unlike CRLA / Phil-IRI / RMA there is NO numeric scoring, no materials, no
-- tasks and no bands: the reading level IS the result. So this is a single flat
-- records table. Assessed three times a year (BoSY / MoSY / EoSY, shown on the
-- screens & PDF as Pretest / Midtest / Posttest). Records carry school_id;
-- scoping is enforced in the app layer, matching the other assessment modules.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- RECORDS (one per learner per language per phase per school year)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_pabasa_records (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  teacher_id BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  grade_level INTEGER NOT NULL,                    -- 11 or 12; lets the division report filter without a material join
  language TEXT NOT NULL CHECK (language IN ('English', 'Filipino')),
  phase TEXT NOT NULL CHECK (phase IN ('BoSY', 'MoSY', 'EoSY')),
  school_year TEXT NOT NULL,
  reading_level TEXT CHECK (reading_level IN ('Average', 'Fast', 'Spontaneous')),  -- NULL = not yet assessed
  date_assessed DATE,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, language, phase, school_year)
);

COMMENT ON TABLE procurements.sms_pabasa_records IS
  'Per-learner PABASA reading-readiness result for one language/phase/school-year (Grades 11-12).';

CREATE INDEX IF NOT EXISTS idx_sms_pabasa_records_school   ON procurements.sms_pabasa_records(school_id);
CREATE INDEX IF NOT EXISTS idx_sms_pabasa_records_section  ON procurements.sms_pabasa_records(section_id);
CREATE INDEX IF NOT EXISTS idx_sms_pabasa_records_student  ON procurements.sms_pabasa_records(student_id);
CREATE INDEX IF NOT EXISTS idx_sms_pabasa_records_sy_phase ON procurements.sms_pabasa_records(school_year, phase);

CREATE TRIGGER update_sms_pabasa_records_updated_at
  BEFORE UPDATE ON procurements.sms_pabasa_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- RLS + GRANTS (uniform authenticated policy, matching the other assessments)
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_pabasa_records ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sms_pabasa_records'] LOOP
    EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
  END LOOP;
END $$;

-- <<< END 092_pabasa_assessment.sql

-- ============================================================================
-- >>> BEGIN 092_philiri_screening_reading_levels.sql
-- ============================================================================

-- ============================================================================
-- Phil-IRI — Group Screening Test result as a 4-level reading profile
--
-- The screening `result` column now reports a reading level instead of the old
-- binary "For Phil-IRI" / "No Phil-IRI". Cutoffs depend on the form size:
--
--   Grades 3-6 (20-item):  0 → Non-Reader · 1-13 Frustration ·
--                          14-17 Instructional · 18-20 Independent
--   Grades 7-10 (40-item): 0 → Non-Reader · 1-27 Frustration ·
--                          28-35 Instructional · 36-40 Independent
--
-- Instructional / Independent are "for enrichment" (no full Phil-IRI needed) —
-- i.e. the old "No Phil-IRI" bucket; Non-Reader / Frustration is the old
-- "For Phil-IRI" bucket. Recompute existing screening rows from total_score and
-- the material's grade level so the division rollup keeps counting them.
-- ============================================================================

SET search_path TO procurements, public;

UPDATE procurements.sms_philiri_records r
   SET screening_result = CASE
         WHEN r.total_score <= 0 THEN 'Non-Reader'
         WHEN m.grade_level >= 7 THEN
           CASE
             WHEN r.total_score < 28 THEN 'Frustration'
             WHEN r.total_score < 36 THEN 'Instructional'
             ELSE 'Independent'
           END
         ELSE
           CASE
             WHEN r.total_score < 14 THEN 'Frustration'
             WHEN r.total_score < 18 THEN 'Instructional'
             ELSE 'Independent'
           END
       END
  FROM procurements.sms_philiri_materials m
 WHERE r.material_id = m.id
   AND r.form_type = 'screening'
   AND r.screening_result IS NOT NULL
   AND r.total_score IS NOT NULL;

-- <<< END 092_philiri_screening_reading_levels.sql

-- ============================================================================
-- >>> BEGIN 093_student_portal_code.sql
-- ============================================================================

-- ============================================================================
-- Student Portal access code
-- ============================================================================
-- Students sign in to the Student Portal with their LRN + a portal code
-- (replacing date of birth). The code is system-generated when the section
-- adviser clicks "Generate Code" on the student details modal, and handed to
-- the learner. Stored in plaintext (same trust level as the previous DOB
-- check); LRN remains the unique identifier.
-- ============================================================================

ALTER TABLE procurements.sms_students
  ADD COLUMN IF NOT EXISTS portal_code TEXT;

COMMENT ON COLUMN procurements.sms_students.portal_code IS
  'System-generated Student Portal access code (LRN + code sign-in). Generated by the section adviser from the student details modal.';

-- <<< END 093_student_portal_code.sql

-- ============================================================================
-- >>> BEGIN 094_fix_landing_hero_storage_superadmin.sql
-- ============================================================================

-- ============================================================================
-- FIX: landing-hero banner upload fails with "new row violates row-level
-- security policy" for super admins.
-- ============================================================================
-- Migration 078 restricted landing-hero writes to either:
--   (a) users whose sms_users.school_id matches the path's school segment, or
--   (b) users with type = 'division_admin'.
--
-- A "super admin" is neither: on /settings the app uses the super admin's
-- ACTIVE school override (AuthGuard.tsx) as user.school_id, so the upload path
-- becomes landing-hero/{override_school}/... while their own sms_users.school_id
-- is null / a different home school. Branch (a) fails, and branch (b) excludes
-- super admin -> RLS denies the INSERT.
--
-- The newer CRLA/Phil-IRI storage policies (088, 089) already treat
-- ('division_admin', 'super admin') as full-access authors. Align the
-- landing-hero write policies with that pattern. Also re-assert the bucket so
-- this migration is self-sufficient if 078 was never applied.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('school-management', 'school-management', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "school_management staff insert" ON storage.objects;
DROP POLICY IF EXISTS "school_management staff update" ON storage.objects;
DROP POLICY IF EXISTS "school_management staff delete" ON storage.objects;

CREATE POLICY "school_management staff insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'school-management'
    AND split_part(name, '/', 1) = 'landing-hero'
    AND (
      EXISTS (
        SELECT 1 FROM procurements.sms_users u
        WHERE u.user_id = auth.uid()
          AND u.type IN ('division_admin', 'super admin')
      )
      OR split_part(name, '/', 2) = (
        SELECT u.school_id::text FROM procurements.sms_users u
        WHERE u.user_id = auth.uid() LIMIT 1
      )
    )
  );

CREATE POLICY "school_management staff update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'school-management'
    AND split_part(name, '/', 1) = 'landing-hero'
    AND (
      EXISTS (
        SELECT 1 FROM procurements.sms_users u
        WHERE u.user_id = auth.uid()
          AND u.type IN ('division_admin', 'super admin')
      )
      OR split_part(name, '/', 2) = (
        SELECT u.school_id::text FROM procurements.sms_users u
        WHERE u.user_id = auth.uid() LIMIT 1
      )
    )
  );

CREATE POLICY "school_management staff delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'school-management'
    AND split_part(name, '/', 1) = 'landing-hero'
    AND (
      EXISTS (
        SELECT 1 FROM procurements.sms_users u
        WHERE u.user_id = auth.uid()
          AND u.type IN ('division_admin', 'super admin')
      )
      OR split_part(name, '/', 2) = (
        SELECT u.school_id::text FROM procurements.sms_users u
        WHERE u.user_id = auth.uid() LIMIT 1
      )
    )
  );

-- <<< END 094_fix_landing_hero_storage_superadmin.sql

-- ============================================================================
-- >>> BEGIN 095_assistant_school_head_role.sql
-- ============================================================================

-- ============================================================================
-- ADD "assistant_school_head" ROLE
-- ============================================================================
-- New staff role "Assistant School Principal" with the SAME access as
-- "school_head". This migration:
--   1. Allows the value in the sms_users type CHECK constraint.
--   2. Recreates every RLS policy that gates on 'school_head' so the new
--      role is granted identical database-level access.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. Allow the new value on sms_users.type
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_users DROP CONSTRAINT IF EXISTS sms_users_type_check;
ALTER TABLE procurements.sms_users ADD CONSTRAINT sms_users_type_check
  CHECK (type IN (
    'school_head',
    'assistant_school_head',
    'teacher',
    'registrar',
    'admin',
    'super admin',
    'division_admin',
    'division_type',
    'librarian'
  ));

-- ----------------------------------------------------------------------------
-- 2. sms_subjects RLS (originally migration 037)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Subjects are insertable by authorized roles" ON procurements.sms_subjects;
CREATE POLICY "Subjects are insertable by authorized roles"
  ON procurements.sms_subjects FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar', 'division_admin')
        AND (u.type = 'division_admin' OR u.school_id = school_id)
    )
  );

DROP POLICY IF EXISTS "Subjects are updatable by authorized roles" ON procurements.sms_subjects;
CREATE POLICY "Subjects are updatable by authorized roles"
  ON procurements.sms_subjects FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar', 'division_admin')
        AND (u.type = 'division_admin' OR u.school_id = school_id)
    )
  );

DROP POLICY IF EXISTS "Subjects are deletable by authorized roles" ON procurements.sms_subjects;
CREATE POLICY "Subjects are deletable by authorized roles"
  ON procurements.sms_subjects FOR DELETE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'assistant_school_head', 'admin', 'division_admin')
        AND (u.type = 'division_admin' OR u.school_id = school_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 3. sms_subject_schedules RLS (originally migration 037)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Subject schedules are insertable by authorized roles" ON procurements.sms_subject_schedules;
CREATE POLICY "Subject schedules are insertable by authorized roles"
  ON procurements.sms_subject_schedules FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar', 'division_admin')
        AND (u.type = 'division_admin' OR u.school_id = school_id)
    )
  );

DROP POLICY IF EXISTS "Subject schedules are updatable by authorized roles" ON procurements.sms_subject_schedules;
CREATE POLICY "Subject schedules are updatable by authorized roles"
  ON procurements.sms_subject_schedules FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar', 'division_admin')
        AND (u.type = 'division_admin' OR u.school_id = school_id)
    )
  );

DROP POLICY IF EXISTS "Subject schedules are deletable by authorized roles" ON procurements.sms_subject_schedules;
CREATE POLICY "Subject schedules are deletable by authorized roles"
  ON procurements.sms_subject_schedules FOR DELETE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('school_head', 'assistant_school_head', 'admin', 'division_admin')
        AND (u.type = 'division_admin' OR u.school_id = school_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 4. sms_division_report_submissions RLS + helper (originally migration 072)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "submissions_insert" ON procurements.sms_division_report_submissions;
CREATE POLICY "submissions_insert"
  ON procurements.sms_division_report_submissions FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND (
          u.type IN ('division_admin','division_type')
          OR (
            u.type IN ('school_head','assistant_school_head','admin','registrar')
            AND u.school_id = sms_division_report_submissions.school_id
          )
        )
    )
  );

DROP POLICY IF EXISTS "submissions_update" ON procurements.sms_division_report_submissions;
CREATE POLICY "submissions_update"
  ON procurements.sms_division_report_submissions FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND (
          u.type IN ('division_admin','division_type')
          OR (
            u.type IN ('school_head','assistant_school_head','admin','registrar')
            AND u.school_id = sms_division_report_submissions.school_id
            AND sms_division_report_submissions.status <> 'locked'
          )
        )
    )
  );

CREATE OR REPLACE FUNCTION procurements.can_write_submission(p_submission_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM procurements.sms_division_report_submissions s
    JOIN procurements.sms_users u ON u.user_id = auth.uid()
    WHERE s.id = p_submission_id
      AND u.is_active
      AND (
        u.type IN ('division_admin','division_type')
        OR (
          u.type IN ('school_head','assistant_school_head','admin','registrar')
          AND u.school_id = s.school_id
          AND s.status <> 'locked'
        )
      )
  );
$$;

-- <<< END 095_assistant_school_head_role.sql

-- ============================================================================
-- >>> BEGIN 096_table_of_specification.sql
-- ============================================================================

-- ============================================================================
-- TOS — Table of Specification (DepEd quarterly/term examinations)
--
-- A TOS distributes exam items across the Most Essential Learning Competencies
-- (MELCs) and Bloom's cognitive levels, weighted by teaching time. One TOS is
-- targeted per subject + grade level + school year + grading period.
--
-- Authoring is dual-level (mirrors the assessment materials pattern, but with a
-- twist): `school_id` is NULLABLE.
--   * school_id IS NULL  -> DIVISION-authored, shared/visible to ALL teachers.
--   * school_id set       -> TEACHER-authored, private to `created_by`.
-- Visibility is enforced in the app layer (matching sms_crla_* / sms_mps).
--
-- Item placement (`sms_tos_items`) is stored per exam item number so the future
-- Exam Creator and Item Analysis modules can build on it without a redesign.
--
-- Grading period count/labels are derived from the school year in the app layer
-- (3 terms for SY >= 2026-2027, else 4 quarters); the column allows 1-4.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. TOS (header) — one per subject/grade/school-year/period
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_tos (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,                                    -- optional custom title; else generated in UI
  subject_name TEXT NOT NULL,                    -- e.g. "EPP" / "Mathematics" (matched across schools)
  grade_level INTEGER NOT NULL,                  -- K=0 .. 12
  subject_id BIGINT REFERENCES procurements.sms_subjects(id) ON DELETE SET NULL, -- optional link (teacher-authored)
  school_year TEXT NOT NULL,
  grading_period INTEGER NOT NULL CHECK (grading_period BETWEEN 1 AND 4),
  exam_type TEXT NOT NULL DEFAULT 'Quarterly Examination',
  total_items INTEGER NOT NULL DEFAULT 40 CHECK (total_items > 0),
  total_days NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK (total_days >= 0), -- instructional days for the term (drives item counts)
  school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE CASCADE, -- NULL = division-authored (shared)
  created_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  prepared_by_name TEXT,
  prepared_by_position TEXT,
  legend TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_tos IS
  'Table of Specification header. school_id NULL = division-authored (shared to all teachers); set = teacher-private.';

CREATE INDEX IF NOT EXISTS idx_sms_tos_school       ON procurements.sms_tos(school_id);
CREATE INDEX IF NOT EXISTS idx_sms_tos_created_by   ON procurements.sms_tos(created_by);
CREATE INDEX IF NOT EXISTS idx_sms_tos_subject      ON procurements.sms_tos(subject_name, grade_level);
CREATE INDEX IF NOT EXISTS idx_sms_tos_sy_period    ON procurements.sms_tos(school_year, grading_period);

CREATE TRIGGER update_sms_tos_updated_at
  BEFORE UPDATE ON procurements.sms_tos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. TOS COMPETENCIES (MELC rows) — days -> %/no_of_items (computed app-side)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_tos_competencies (
  id BIGSERIAL PRIMARY KEY,
  tos_id BIGINT NOT NULL REFERENCES procurements.sms_tos(id) ON DELETE CASCADE,
  competency_text TEXT NOT NULL,
  lc_code TEXT,
  no_of_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (no_of_days >= 0),
  no_of_items INTEGER NOT NULL DEFAULT 0 CHECK (no_of_items >= 0),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_tos_competencies IS
  'MELC rows of a TOS; no_of_items auto-computed from no_of_days (override-able).';

CREATE INDEX IF NOT EXISTS idx_sms_tos_competencies_tos
  ON procurements.sms_tos_competencies(tos_id, position);

CREATE TRIGGER update_sms_tos_competencies_updated_at
  BEFORE UPDATE ON procurements.sms_tos_competencies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 3. TOS ITEMS (item placement) — one row per exam item number
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_tos_items (
  id BIGSERIAL PRIMARY KEY,
  tos_id BIGINT NOT NULL REFERENCES procurements.sms_tos(id) ON DELETE CASCADE,
  competency_id BIGINT NOT NULL REFERENCES procurements.sms_tos_competencies(id) ON DELETE CASCADE,
  item_number INTEGER NOT NULL CHECK (item_number > 0),
  cognitive_level TEXT NOT NULL CHECK (cognitive_level IN (
    'remembering', 'understanding', 'applying', 'analyzing', 'evaluating', 'creating'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tos_id, item_number)
);

COMMENT ON TABLE procurements.sms_tos_items IS
  'Item-placement grid: each exam item number mapped to a competency + Bloom cognitive level.';

CREATE INDEX IF NOT EXISTS idx_sms_tos_items_tos        ON procurements.sms_tos_items(tos_id);
CREATE INDEX IF NOT EXISTS idx_sms_tos_items_competency ON procurements.sms_tos_items(competency_id);

CREATE TRIGGER update_sms_tos_items_updated_at
  BEFORE UPDATE ON procurements.sms_tos_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 4. RLS + GRANTS (permissive; scoping enforced in the app layer)
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_tos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_tos_competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_tos_items        ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sms_tos', 'sms_tos_competencies', 'sms_tos_items'
  ] LOOP
    EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
  END LOOP;
END $$;

-- <<< END 096_table_of_specification.sql

-- ============================================================================
-- >>> BEGIN 097_aral_intervention.sql
-- ============================================================================

-- ============================================================================
-- ARAL — Intervention Program (DepEd)
--
-- ARAL is a remediation program that helps learners catch up on foundational
-- subjects. It reuses the diagnostic RESULTS already recorded by the Assessments
-- module (CRLA, Phil-IRI, RMA, PABASA): learners whose reading/mastery level
-- falls in a program's priority/secondary target range are enrolled into an
-- ARAL program and tracked until they exit.
--
-- Programs:
--   reading      Grades 1-3   CRLA   · Grades 4-10 Phil-IRI · Grades 11-12 PABASA
--   mathematics  Grades 1-10  RMA
--   science      Grades 3-10  cross-tab: Phil-IRI (Frustration) ∩ RMA (Intervention)
--   summer       Grades 1-10  learners still Priority/Secondary in Reading/Math at EoSY
--
-- One flat table (no materials/tasks — nothing is authored here; eligibility is
-- read from the assessment records). Records carry school_id; scoping is enforced
-- in the app layer (matching every assessment table — RLS is `authenticated`).
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- ARAL ENROLLMENTS (one per learner per program per school year)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_aral_enrollments (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  section_id BIGINT REFERENCES procurements.sms_sections(id) ON DELETE SET NULL,
  grade_level INTEGER NOT NULL,
  school_year TEXT NOT NULL,
  program TEXT NOT NULL CHECK (program IN ('reading', 'mathematics', 'science', 'summer')),
  tier TEXT NOT NULL CHECK (tier IN ('priority', 'secondary')),
  source_assessment TEXT CHECK (
    source_assessment IN ('crla', 'philiri', 'rma', 'pabasa', 'cross_tab', 'manual')
  ),
  source_level TEXT,                              -- e.g. 'Frustration', 'Intervention'
  suggested_start_grade INTEGER,                  -- reading intervention entry grade
  basis_phase TEXT CHECK (basis_phase IN ('BoSY', 'MoSY', 'EoSY')),
  status TEXT NOT NULL DEFAULT 'enrolled'
    CHECK (status IN ('enrolled', 'ongoing', 'completed', 'dropped')),
  pre_note TEXT,                                  -- baseline note at entry
  post_note TEXT,                                 -- exit / outcome note
  exited_at TIMESTAMPTZ,
  teacher_id BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,   -- adviser
  enrolled_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, program, school_year)
);

COMMENT ON TABLE procurements.sms_aral_enrollments IS
  'ARAL intervention roster; one learner per program per school year, sourced from assessment results.';

CREATE INDEX IF NOT EXISTS idx_sms_aral_enrollments_school
  ON procurements.sms_aral_enrollments(school_id, school_year, program);
CREATE INDEX IF NOT EXISTS idx_sms_aral_enrollments_section
  ON procurements.sms_aral_enrollments(section_id);
CREATE INDEX IF NOT EXISTS idx_sms_aral_enrollments_student
  ON procurements.sms_aral_enrollments(student_id);

CREATE TRIGGER update_sms_aral_enrollments_updated_at
  BEFORE UPDATE ON procurements.sms_aral_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- RLS + GRANTS (scoping enforced in the app layer)
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_aral_enrollments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sms_aral_enrollments'] LOOP
    EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
  END LOOP;
END $$;

-- <<< END 097_aral_intervention.sql

-- ============================================================================
-- >>> BEGIN 098_aral_suggested_start_grade.sql
-- ============================================================================

-- ============================================================================
-- ARAL — add suggested_start_grade
--
-- The instructional entry grade for a learner's reading intervention (a few
-- grade levels below their grade for struggling readers). Computed by the app
-- at enrollment (Phil-IRI: GST-based "2-3 levels down"; CRLA: Refresher
-- severity). Idempotent so it is safe whether or not 097 already added it.
-- ============================================================================

SET search_path TO procurements, public;

ALTER TABLE procurements.sms_aral_enrollments
  ADD COLUMN IF NOT EXISTS suggested_start_grade INTEGER;

-- <<< END 098_aral_suggested_start_grade.sql

-- ============================================================================
-- >>> BEGIN 098_tos_total_days.sql
-- ============================================================================

-- ============================================================================
-- TOS — add total_days (instructional days for the whole term).
--
-- Total days is now a single document-level field (entered once, not per row).
-- Each competency's item count is derived as:
--   no_of_items = round( (competency no_of_days / total_days) * total_items )
-- (Idempotent ADD COLUMN for databases that applied 096 before this column.)
-- ============================================================================

SET search_path TO procurements, public;

ALTER TABLE procurements.sms_tos
  ADD COLUMN IF NOT EXISTS total_days NUMERIC(7,2) NOT NULL DEFAULT 0
    CHECK (total_days >= 0);

COMMENT ON COLUMN procurements.sms_tos.total_days IS
  'Total instructional days for the term; divides each competency''s days to size its item count.';

-- <<< END 098_tos_total_days.sql

-- ============================================================================
-- >>> BEGIN 099_exam_creator.sql
-- ============================================================================

-- ============================================================================
-- EXAM CREATOR — build an actual exam from a Table of Specification (TOS).
--
-- A TOS defines N items, each mapped to a competency + Bloom cognitive level.
-- An exam realises a TOS into real questions. Multiple named versions (e.g.
-- Set A / Set B) may be built from one TOS.
--
-- Authoring mirrors the TOS sharing model: `school_id` is NULLABLE.
--   * school_id IS NULL -> DIVISION-authored, visible to ALL teachers.
--   * school_id set      -> TEACHER-authored, private to `created_by`.
--
-- Question types: multiple_choice, true_false, modified_true_false, matching,
-- short_answer, completion, essay. A single question may span several TOS
-- item numbers (item_count) — e.g. a matching block or multi-blank completion.
--
--   sms_exams             one version per row (tos_id + version_label)
--   sms_exam_questions    one per question (carries item_number + item_count)
--   sms_exam_options      MC choices AND matching Column-B responses
--   sms_exam_subitems     matching Column-A premises / completion blanks
--
-- Correct answers live on the rows (option.is_correct, subitem.correct_answer,
-- question.answer_key) so the Item Analysis module can score per item. RLS is
-- permissive `authenticated`; scoping is enforced in the app layer.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. EXAMS (one version built from a TOS)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_exams (
  id BIGSERIAL PRIMARY KEY,
  tos_id BIGINT NOT NULL REFERENCES procurements.sms_tos(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL DEFAULT 'Set A',  -- e.g. "Set A" / "Set B"
  title TEXT,                                    -- optional; else derived from the TOS
  instructions TEXT,                             -- general test directions
  school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE CASCADE, -- NULL = division (shared)
  created_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_exams IS
  'An exam version built from a TOS. school_id NULL = division-authored (shared); set = teacher-private.';

CREATE INDEX IF NOT EXISTS idx_sms_exams_tos        ON procurements.sms_exams(tos_id);
CREATE INDEX IF NOT EXISTS idx_sms_exams_school     ON procurements.sms_exams(school_id);
CREATE INDEX IF NOT EXISTS idx_sms_exams_created_by ON procurements.sms_exams(created_by);

CREATE TRIGGER update_sms_exams_updated_at
  BEFORE UPDATE ON procurements.sms_exams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. EXAM QUESTIONS (one per question; may span several item numbers)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_exam_questions (
  id BIGSERIAL PRIMARY KEY,
  exam_id BIGINT NOT NULL REFERENCES procurements.sms_exams(id) ON DELETE CASCADE,
  tos_item_id BIGINT REFERENCES procurements.sms_tos_items(id) ON DELETE SET NULL, -- first TOS item covered
  item_number INTEGER NOT NULL,                  -- starting exam item number
  item_count INTEGER NOT NULL DEFAULT 1 CHECK (item_count >= 1), -- items covered (matching/completion)
  question_type TEXT NOT NULL DEFAULT 'multiple_choice' CHECK (question_type IN (
    'multiple_choice', 'true_false', 'modified_true_false',
    'matching', 'short_answer', 'completion', 'essay'
  )),
  question_text TEXT,
  answer_key TEXT,                               -- TF / modified TF / identification / essay notes
  points NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (points >= 0),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_exam_questions IS
  'One exam question; item_count > 1 for grouped types (matching / multi-blank completion).';

CREATE INDEX IF NOT EXISTS idx_sms_exam_questions_exam
  ON procurements.sms_exam_questions(exam_id, position);
CREATE INDEX IF NOT EXISTS idx_sms_exam_questions_tos_item
  ON procurements.sms_exam_questions(tos_item_id);

CREATE TRIGGER update_sms_exam_questions_updated_at
  BEFORE UPDATE ON procurements.sms_exam_questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 3. EXAM OPTIONS (MC choices + matching Column-B responses)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_exam_options (
  id BIGSERIAL PRIMARY KEY,
  question_id BIGINT NOT NULL REFERENCES procurements.sms_exam_questions(id) ON DELETE CASCADE,
  label TEXT,                                    -- A / B / C … (display letter)
  choice_text TEXT,
  is_correct BOOLEAN NOT NULL DEFAULT false,     -- MC: the correct choice
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_exam_options IS
  'Choices for multiple-choice questions and the Column-B response pool for matching questions.';

CREATE INDEX IF NOT EXISTS idx_sms_exam_options_question
  ON procurements.sms_exam_options(question_id, position);

CREATE TRIGGER update_sms_exam_options_updated_at
  BEFORE UPDATE ON procurements.sms_exam_options
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 4. EXAM SUBITEMS (matching Column-A premises / completion blanks)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_exam_subitems (
  id BIGSERIAL PRIMARY KEY,
  question_id BIGINT NOT NULL REFERENCES procurements.sms_exam_questions(id) ON DELETE CASCADE,
  prompt_text TEXT,                              -- Column-A premise / blank label
  correct_answer TEXT,                           -- matching: correct Column-B label; completion: answer
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_exam_subitems IS
  'Sub-parts of a grouped question: matching premises (Column A) or completion blanks.';

CREATE INDEX IF NOT EXISTS idx_sms_exam_subitems_question
  ON procurements.sms_exam_subitems(question_id, position);

CREATE TRIGGER update_sms_exam_subitems_updated_at
  BEFORE UPDATE ON procurements.sms_exam_subitems
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 5. RLS + GRANTS (permissive; scoping enforced in the app layer)
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_exams          ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_exam_options   ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_exam_subitems  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sms_exams', 'sms_exam_questions', 'sms_exam_options', 'sms_exam_subitems'
  ] LOOP
    EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
  END LOOP;
END $$;

-- <<< END 099_exam_creator.sql

COMMIT;
