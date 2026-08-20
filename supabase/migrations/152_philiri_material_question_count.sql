-- ============================================================================
-- Phil-IRI — per-passage comprehension question count
--
-- The Individual Record Form (Form 3A Filipino / 3B English) was built against
-- a flat PHILIRI_COMPREHENSION_QUESTIONS = 7: seven response rows, "Score (of
-- 7)", and 7 fixed question columns on the Matrix of Reading Profile. DepEd's
-- graded passages do not all carry seven questions — the count varies by grade
-- level and by set — so a teacher scoring a 10-question passage had nowhere to
-- record questions 8-10, and the comprehension % was computed over the wrong
-- denominator.
--
-- The count is a fact about the PASSAGE, exactly like word_count already is, so
-- it belongs on the material and is authored on the same screen. It is NOT
-- derived from sms_philiri_questions (084): that table has no authoring UI and
-- no reader anywhere in the app, so deriving would read every existing material
-- as zero questions. Per the 132 answer-key precedent, if question authoring is
-- ever built it should PREFILL this count one-way, not replace it.
--
-- DEFAULT 7 is load-bearing: every existing material keeps the count the app has
-- been assuming, so no stored score, level or reading profile moves when this is
-- applied. Nothing is backfilled and nothing is recomputed.
--
-- Already-saved records keep their own denominator: sms_philiri_records.
-- comprehension_total (090) is written at save time and is what the form and the
-- printed 3A/3B read back, so editing a passage's question count later cannot
-- retroactively rescore a form that was already filled in on paper — the same
-- rule as career_stage / form_cycle_sy on the supervision COT forms (121).
--
-- Read-only check of what exists before applying:
--   SELECT count(*) FROM procurements.sms_philiri_materials;   -- all become 7
-- ============================================================================

SET search_path TO procurements, public;

ALTER TABLE procurements.sms_philiri_materials
  ADD COLUMN IF NOT EXISTS question_count INTEGER NOT NULL DEFAULT 7;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'procurements.sms_philiri_materials'::regclass
      AND conname  = 'sms_philiri_materials_question_count_check'
  ) THEN
    ALTER TABLE procurements.sms_philiri_materials
      ADD CONSTRAINT sms_philiri_materials_question_count_check
      CHECK (question_count BETWEEN 1 AND 20);
  END IF;
END $$;

COMMENT ON COLUMN procurements.sms_philiri_materials.question_count IS
  'Number of comprehension questions on this passage (Form 3A/3B Part A). Default 7 = the pre-152 assumption. Records snapshot it into comprehension_total at save time.';
