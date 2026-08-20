-- ============================================================================
-- 155. Learner profile columns — the block that was never in a migration
-- ============================================================================
--
-- WHY THIS EXISTS
-- ---------------
-- `procurements.sms_students` carries a DepEd SF1 learner-profile block —
-- mother tongue, IP ethnic group, religion, the purok/barangay/municipality/
-- province address, and the father / mother / guardian name triples. The app
-- has written and read all sixteen of these columns for a long time (the
-- Enrollment Wizard, Students → Add/Edit, the Teacher edit modal, SF1, the
-- ECCD card, Form 137) and `types/database.ts` declares every one of them.
--
-- **None of them was ever created by a migration.** They were added by hand on
-- the original database, so migration history and live schema disagreed — the
-- same class of drift migration 116 documented for FK delete rules. Migration
-- 114's header even refers to "the existing `ip_ethnic_group`" while adding
-- `ethnicity` beside it; the column it refers to has no `CREATE`/`ALTER`
-- anywhere in `supabase/migrations/`.
--
-- The drift is invisible on a database that received the manual change and
-- fatal on one that did not: migration 149's `iped_program_facts` fails with
--
--     ERROR: 42703: column st.ip_ethnic_group does not exist
--
-- which is what this migration fixes. 149, 150 and 151 all read
-- `ip_ethnic_group`; apply this one **before** them.
--
-- WHAT IT DOES
-- ------------
-- Sixteen `ADD COLUMN IF NOT EXISTS`, all nullable TEXT, no default, no CHECK,
-- no index, no backfill. Purely additive, per RULE 0:
--
--   * On a database that already has the columns (the one they were typed
--     into), every statement is a no-op — no row is touched, no type changes,
--     nothing is re-validated.
--   * On a database that lacks them, existing learner rows get NULL, which is
--     exactly what every consumer already handles: an unfilled profile field
--     prints blank, and `NULLIF(TRIM(ip_ethnic_group), '') IS NOT NULL`
--     (149/150) / `is_ip_learner()` (151) reads a NULL as Non-IP.
--
-- TYPES — free TEXT, deliberately
-- -------------------------------
-- `ip_ethnic_group` is picked from `lib/constants/ethnicGroups.ts` and
-- `mother_tongue` / `religion` are typed freely; none of them is
-- CHECK-constrained, per the 119/132 precedent — a DepEd list revision must
-- not invalidate learner rows already encoded. `ethnicity` (114) stays where it
-- is and stays deprecated: it is kept so existing values are not lost, and
-- `ip_ethnic_group` is the sole input to the IPEd report's IP / Non-IP split.
-- ============================================================================

ALTER TABLE procurements.sms_students
  ADD COLUMN IF NOT EXISTS mother_tongue         TEXT,
  ADD COLUMN IF NOT EXISTS ip_ethnic_group       TEXT,
  ADD COLUMN IF NOT EXISTS religion              TEXT,
  ADD COLUMN IF NOT EXISTS purok                 TEXT,
  ADD COLUMN IF NOT EXISTS barangay              TEXT,
  ADD COLUMN IF NOT EXISTS municipality_city     TEXT,
  ADD COLUMN IF NOT EXISTS province              TEXT,
  ADD COLUMN IF NOT EXISTS father_last_name      TEXT,
  ADD COLUMN IF NOT EXISTS father_first_name     TEXT,
  ADD COLUMN IF NOT EXISTS father_middle_name    TEXT,
  ADD COLUMN IF NOT EXISTS mother_last_name      TEXT,
  ADD COLUMN IF NOT EXISTS mother_first_name     TEXT,
  ADD COLUMN IF NOT EXISTS mother_middle_name    TEXT,
  ADD COLUMN IF NOT EXISTS guardian_last_name    TEXT,
  ADD COLUMN IF NOT EXISTS guardian_first_name   TEXT,
  ADD COLUMN IF NOT EXISTS guardian_middle_name  TEXT;

COMMENT ON COLUMN procurements.sms_students.mother_tongue IS
  'SF1 mother tongue. Free text.';

COMMENT ON COLUMN procurements.sms_students.ip_ethnic_group IS
  'Indigenous Peoples group; NULL/blank for a non-IP learner. Picked from '
  'lib/constants/ethnicGroups.ts (free TEXT, app-validated, per 119/132) and '
  'the sole input to the IPEd report''s IPs / Non-IPs split (149/151). '
  'Distinct from 114''s deprecated ethnicity.';

COMMENT ON COLUMN procurements.sms_students.religion IS
  'SF1 religion. Free text.';

COMMENT ON COLUMN procurements.sms_students.purok IS
  'Learner address — purok / sitio.';

COMMENT ON COLUMN procurements.sms_students.barangay IS
  'Learner address — barangay.';

COMMENT ON COLUMN procurements.sms_students.municipality_city IS
  'Learner address — municipality or city.';

COMMENT ON COLUMN procurements.sms_students.province IS
  'Learner address — province.';
