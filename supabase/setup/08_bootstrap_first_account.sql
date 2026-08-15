-- ============================================================================
-- SCHOOL MANAGEMENT SYSTEM — FRESH INSTALL, PART 8 OF 8 (SEED)
-- First super admin, first school
-- ============================================================================
-- Run this AFTER parts 01-07. Nothing else has to exist first.
--
-- You do NOT create the login by hand. This app signs in with GOOGLE OAUTH only
-- (components/LoginBox.tsx calls signInWithOAuth({provider:"google"}) — there is
-- no password form anywhere), so the auth.users row is created by Google the
-- first time you sign in. What has to exist BEFORE that first sign-in is the
-- sms_users row seeded here, because /auth/callback looks the caller up by
-- email and signs straight back out when it finds nothing.
--
-- So the order is: run this file -> enable Google auth -> sign in.
--
-- user_id is deliberately left NULL when the Google account has not been used
-- yet. AuthGuard backfills it on first sign-in ("user created by division admin
-- before first login"), which is exactly how staff added from /division/users
-- are handled. If the auth user already exists, this links it immediately.
--
-- Safe to re-run.
-- ============================================================================

BEGIN;

SET search_path TO procurements, public;

DO $seed$
DECLARE
  -- ==========================================================================
  -- >>> EDIT THESE <<<
  -- ==========================================================================
  -- Must match the address of the auth user created in the dashboard.
  v_email       TEXT := 'berlcamp@gmail.com';
  v_name        TEXT := 'Berl Campomanes';

  -- Division label. There is no divisions table — sms_users.division_id and
  -- sms_schools.division_id are plain TEXT.
  v_division    TEXT := 'Schools Division of Demo City';

  -- The first school. school_id is the DepEd school ID; slug must be unique and
  -- is what the public landing route /schools/[slug] uses.
  v_school_name TEXT := 'Demo Central Elementary School';
  v_school_code TEXT := '900001';
  v_school_slug TEXT := 'demo-central-es';
  -- ==========================================================================

  v_auth_uid  UUID;
  v_school_pk BIGINT;
  v_user_pk   BIGINT;
BEGIN
  v_email := lower(trim(v_email));

  -- --------------------------------------------------------------------------
  -- Link the Supabase Auth account if it happens to exist already.
  --
  -- Not an error when it does not: with Google OAuth the auth.users row does
  -- not exist until the first sign-in. NULL here is the normal case on a brand
  -- new project, and AuthGuard fills it in the moment you log in.
  -- --------------------------------------------------------------------------
  SELECT id INTO v_auth_uid
  FROM auth.users
  WHERE lower(email) = v_email
  LIMIT 1;

  -- --------------------------------------------------------------------------
  -- First school
  -- --------------------------------------------------------------------------
  INSERT INTO procurements.sms_schools (division_id, school_id, name, slug, is_active)
  VALUES (v_division, v_school_code, v_school_name, v_school_slug, true)
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_school_pk
  FROM procurements.sms_schools
  WHERE school_id = v_school_code
  LIMIT 1;

  -- --------------------------------------------------------------------------
  -- The super admin account
  --
  -- 'super admin' is the widest role in the system: migrations 094/113/115 put
  -- it in the FULL-ACCESS branch of every RLS policy, so it is not restricted
  -- to one school's rows the way school_head or registrar are. It is the right
  -- role for a demo — one login reaches every module of every school.
  --
  -- school_id is still set. SchoolIdGuard would allow NULL for this role, but
  -- the school-level modules read user.school_id to decide which school's data
  -- to show, so a NULL lands you in the app with nothing selected. Super admin
  -- can switch schools afterwards via SchoolSwitcher, which overrides this
  -- value in localStorage (lib/utils/activeSchool.ts).
  -- --------------------------------------------------------------------------
  INSERT INTO procurements.sms_users
    (user_id, division_id, school_id, name, email, type, is_active)
  VALUES
    (v_auth_uid, v_division, v_school_pk, v_name, v_email, 'super admin', true)
  ON CONFLICT (email) DO UPDATE
    -- COALESCE, never a bare assignment: re-running this after the first login
    -- must not wipe the user_id that AuthGuard backfilled.
    SET user_id     = COALESCE(EXCLUDED.user_id, procurements.sms_users.user_id),
        division_id = EXCLUDED.division_id,
        school_id   = EXCLUDED.school_id,
        name        = EXCLUDED.name,
        type        = EXCLUDED.type,
        is_active   = true
  RETURNING id INTO v_user_pk;

  -- --------------------------------------------------------------------------
  -- Multi-school assignment (migration 134)
  --
  -- sms_users.school_id is the school the person is working in RIGHT NOW;
  -- sms_user_schools is the set they may switch between. 134 backfilled the
  -- users that existed when it ran, so an account created afterwards needs its
  -- own row or sms_switch_active_school will reject the school.
  -- --------------------------------------------------------------------------
  INSERT INTO procurements.sms_user_schools (user_id, school_id)
  VALUES (v_user_pk, v_school_pk)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Seeded super admin % (sms_users.id=%) at school % (id=%)',
    v_email, v_user_pk, v_school_name, v_school_pk;

  IF v_auth_uid IS NULL THEN
    RAISE NOTICE 'No Google account has signed in as % yet. That is expected on a new project: enable the Google provider, then sign in — AuthGuard links the account automatically.', v_email;
  ELSE
    RAISE NOTICE 'Linked to existing auth user %.', v_auth_uid;
  END IF;
END
$seed$;

COMMIT;

-- ============================================================================
-- Verify — expect exactly one row, type = super admin, with a school
-- ============================================================================
SELECT u.id,
       u.name,
       u.email,
       u.type,
       u.user_id IS NOT NULL AS linked_to_auth,
       s.name  AS school,
       s.slug  AS school_slug
FROM procurements.sms_users u
LEFT JOIN procurements.sms_schools s ON s.id = u.school_id
ORDER BY u.id;
