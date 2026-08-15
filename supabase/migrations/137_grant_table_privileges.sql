-- ============================================================================
-- 137 — Grant table privileges across the procurements schema
-- ============================================================================
-- Closes a gap that has been in the migration history since 001: table-level
-- privileges were only ever granted ad-hoc, table by table, in whichever
-- migration happened to remember. 21 live tables were never granted to anyone
-- at all -- including sms_users, sms_sections, sms_subjects, sms_grades,
-- sms_subject_schedules, sms_rooms, sms_learner_health, the ECCD tables, the
-- School Report Card tables, sms_kpi_reference and the division report rows.
--
-- This is invisible on the Bayugan production database, which evidently has
-- blanket grants from an out-of-band manual run -- the same class of drift the
-- setup README already documents for procurements.update_updated_at_column(),
-- sms_users.user_id being nullable, and the sms_users_email_key constraint.
-- It is fatal on a database built purely from the migration files: the very
-- first thing the app does after Google sign-in is read sms_users at
-- /auth/callback, which fails with 42501 permission denied for table sms_users
-- and the login can never complete.
--
-- Why blanket rather than a list of the 21: a per-table list puts the next
-- migration that forgets its GRANT straight back into the same failure. The
-- ALL TABLES grant fixes what exists and the DEFAULT PRIVILEGES clause covers
-- everything added later, which is what Supabase itself configures for the
-- public schema.
--
-- Additive and idempotent -- GRANT never revokes. Applying this to a database
-- that already has the privileges is a no-op.
--
-- ANON IS DELIBERATELY NOT WIDENED. Only the public surfaces already declared
-- by 005 (sms_form137_requests, since renamed to sms_form_requests by 027, and
-- sms_students), 015 (sms_schools, sms_enrollments) and 034
-- (sms_student_subjects) are reachable without a session, and that stays true.
-- 45 tables in this schema have no RLS policy at all, so a blanket anon grant
-- would publish learner health, grades and anecdotal records to the internet.
--
-- Note that `authenticated` is still a wide role: anyone who completes Google
-- OAuth holds it at the Postgres level, even though /auth/callback signs them
-- back out when no sms_users row matches. RLS -- not the grant -- is what
-- keeps those 45 tables safe, and on those tables there is nothing keeping
-- them safe. That is a pre-existing property of the schema, unchanged here.
-- ============================================================================

GRANT USAGE ON SCHEMA procurements TO anon, authenticated, service_role;

-- Existing objects.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA procurements
  TO authenticated, service_role;

GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA procurements
  TO authenticated, service_role;

-- Objects added after this migration. Applies to tables created by the role
-- running this file, which is the same role every migration runs as.
ALTER DEFAULT PRIVILEGES IN SCHEMA procurements
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA procurements
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
