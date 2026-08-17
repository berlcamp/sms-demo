-- ============================================================================
-- Migration 140: the "volunteer_teacher" role
-- ============================================================================
--
-- APPLY AFTER 131 (can_write_enrollment), 135_allow_teacher_enrollment
-- (assert_enrollment_staff) and 135_guidance_nurse_accounting_roles (the
-- current sms_users_type_check).
--
-- ---------------------------------------------------------------------------
-- Why
-- ---------------------------------------------------------------------------
--
-- Several schools in the division are served by a volunteer teacher: a person
-- with no plantilla item — a parent, an LSB-funded helper, a retiree, a
-- para-teacher — who nonetheless advises a section, carries a teaching load and
-- encodes grades. Until now the school had two bad choices: record them as
-- `teacher`, which hands them the school's enrolment duty, or not record them at
-- all, in which case they cannot be named as a section adviser or a subject
-- teacher and their learners' grades have no author.
--
-- A volunteer teacher is therefore a `teacher` in every respect but one:
--
--   THEY MAY NOT ENROL LEARNERS.
--
-- Enrolment is the act that puts a learner on a school's official roll and, for
-- a transferee, opens a record request against another school's data. That
-- accountability stays with the school's own staff. Everything else the Teacher
-- Menu offers — sections, subjects, class record, grades, attendance, SF8,
-- assessments, examinations, books, anecdotal records, ECCD, supervision — is
-- unchanged, because none of it is gated on the literal role name: those pages
-- resolve the person through `section_adviser_id` / `teacher_id`, which this
-- role can hold like any other.
--
-- ---------------------------------------------------------------------------
-- What this migration changes
-- ---------------------------------------------------------------------------
--
--   1. widens sms_users_type_check so the value is storable at all;
--   2. can_write_enrollment (131) — refuses the role, so the RLS policies on
--      sms_enrollments reject an INSERT / UPDATE / DELETE from PostgREST;
--   3. assert_enrollment_staff (135) — refuses the role with a message that
--      names it, so the two enrolment RPCs and close_duplicate_enrollment stop
--      before doing anything.
--
-- Both layers are needed and neither is redundant: 131's policies guard the
-- wizard's direct INSERT, while the RPCs are SECURITY DEFINER and run past RLS
-- entirely. The app is a third layer (the sidebar drops the Enrollment entry,
-- /enrollment refuses to render, and the Promote / Retain / Transfer Out actions
-- on a teacher's section page are withheld) but it is the courtesy, not the
-- enforcement — the anon key ships in the browser bundle.
--
-- ---------------------------------------------------------------------------
-- What this migration deliberately does NOT change
-- ---------------------------------------------------------------------------
--
-- No DepEd personnel count. 071's division_teaching_personnel_summary, 071/075's
-- division_non_teaching_summary, 112's SRC teacher count and 118's teacher-
-- learner ratio all stay keyed to the literal 'teacher', which is a plantilla
-- teaching item — and a volunteer is not one. The app files a volunteer's staff
-- record under the `teacher` staff category (DEFAULT_STAFF_CATEGORY in
-- lib/constants/userTypes.ts), which is the category the Non-Teaching Personnel
-- matrix drops, so they are counted in neither report. That is the correct
-- reading of a volunteer and it is a reporting decision, not a technical one —
-- if the division later wants them counted, that is a separate migration that
-- says so out loud, not a side effect of adding a role.
--
-- No RLS policy is widened. Every policy in the schema enumerates the roles it
-- admits; none names this one, so a volunteer teacher lands with exactly the
-- access an unlisted school-level role has always had — which, for the teacher
-- pages, is the plain `authenticated` access their tables already grant (the
-- 105/119/121 pattern) plus the app-layer adviser scoping those pages apply.
--
-- ---------------------------------------------------------------------------
-- Blast radius
-- ---------------------------------------------------------------------------
--
-- Replaces 1 CHECK constraint and 2 functions. Creates no table, drops nothing,
-- and modifies NO ROWS — there is no DML in this file. Nobody currently holds
-- the new role (it was not a legal value before this), so no existing account
-- changes behaviour on apply. Idempotent; re-running is a no-op.
--
-- The constraint is re-validated against existing rows on ADD. It only ever
-- widens the legal set, so every current row still satisfies it. To confirm
-- before applying, expect 0 rows:
--
--   SELECT type, count(*) FROM procurements.sms_users
--   WHERE type IS NOT NULL AND type NOT IN (
--     'school_head','assistant_school_head','teacher','registrar','admin',
--     'super admin','division_admin','division_type','librarian','tutor',
--     'guidance_counselor','school_nurse','accounting'
--   ) GROUP BY type;
--
-- Reversible by re-running 135's constraint, 131's can_write_enrollment and
-- 135_allow_teacher_enrollment's assert_enrollment_staff verbatim.
-- ============================================================================

SET search_path TO procurements, public;

-- ---------------------------------------------------------------------------
-- 1. Make the value storable
-- ---------------------------------------------------------------------------

ALTER TABLE procurements.sms_users DROP CONSTRAINT IF EXISTS sms_users_type_check;
ALTER TABLE procurements.sms_users ADD CONSTRAINT sms_users_type_check
  CHECK (type IN (
    'school_head',
    'assistant_school_head',
    'teacher',
    'volunteer_teacher',
    'registrar',
    'admin',
    'super admin',
    'division_admin',
    'division_type',
    'librarian',
    'tutor',
    'guidance_counselor',
    'school_nurse',
    'accounting'
  ));

COMMENT ON COLUMN procurements.sms_users.type IS
  'Staff role. Legal values are fixed by sms_users_type_check; labels and login '
  'rules live in lib/constants/userTypes.ts. ''accounting'' is a personnel '
  'record only and is refused at sign-in by the app. ''volunteer_teacher'' is a '
  'teacher with no plantilla item: everything a teacher does except enrol '
  'learners, refused by can_write_enrollment and assert_enrollment_staff.';

-- ---------------------------------------------------------------------------
-- 2. RLS: refuse the role on the sms_enrollments write policies
-- ---------------------------------------------------------------------------
-- 131's policies call this function; replacing it re-points all three
-- (insert / update / delete) without touching the policies themselves.
--
-- The refusal is written as an explicit NOT IN rather than as an allow-list, so
-- that a role added later keeps 131's behaviour by default and only a role named
-- here is denied. That matches how the app reads it
-- (ENROLLMENT_BLOCKED_USER_TYPES, not an enrolment allow-list).

CREATE OR REPLACE FUNCTION procurements.can_write_enrollment(p_school_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM procurements.sms_users u
    WHERE u.user_id = auth.uid()
      AND u.is_active
      AND u.type IS DISTINCT FROM 'volunteer_teacher'
      AND (
        u.type IN ('division_admin', 'division_type', 'super admin')
        OR u.school_id = p_school_id
      )
  );
$$;

COMMENT ON FUNCTION procurements.can_write_enrollment IS
  'True when the signed-in staff member may write an enrollment row owned by p_school_id. Division-level roles write anywhere; everyone else only their own school. A volunteer_teacher (140) is refused outright. NULL p_school_id is division-only.';

GRANT EXECUTE ON FUNCTION procurements.can_write_enrollment(BIGINT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RPCs: refuse the role by name, so the error says why
-- ---------------------------------------------------------------------------
-- The role is already absent from the roster below and would be refused by the
-- generic branch. It is called out first anyway: "Your role (volunteer_teacher)
-- may not enrol learners" reads as a misconfiguration the school head should
-- fix, where this says the rule is deliberate.

CREATE OR REPLACE FUNCTION procurements.assert_enrollment_staff(p_school_id BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_staff procurements.sms_users;
BEGIN
  IF procurements.is_service_role() THEN
    RETURN NULL;
  END IF;

  v_staff := procurements.current_staff();

  IF v_staff.id IS NULL THEN
    RAISE EXCEPTION
      'Not signed in as an active staff member.'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF v_staff.type = 'volunteer_teacher' THEN
    RAISE EXCEPTION
      'A volunteer teacher may not enrol learners. Ask the registrar or school head to enrol this learner.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 130's roster plus 'teacher' (135). Tutors are still refused.
  IF v_staff.type NOT IN (
    'school_head', 'assistant_school_head', 'admin', 'registrar', 'librarian',
    'teacher',
    'super admin', 'division_admin', 'division_type'
  ) THEN
    RAISE EXCEPTION
      'Your role (%) may not enrol learners.', v_staff.type
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Division-level staff act across schools. A super admin is here rather than
  -- in the school-matched branch because AuthGuard replaces their school_id
  -- with their active-school override (the 113 precedent).
  IF v_staff.type IN ('division_admin', 'division_type', 'super admin') THEN
    RETURN v_staff.id;
  END IF;

  -- Teachers land here: school-scoped like every other school-level role.
  IF p_school_id IS NULL OR v_staff.school_id IS DISTINCT FROM p_school_id THEN
    RAISE EXCEPTION
      'You may only enrol learners at your own school (yours: %, requested: %).',
      COALESCE(v_staff.school_id::TEXT, 'none'),
      COALESCE(p_school_id::TEXT, 'none')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN v_staff.id;
END;
$$;

COMMENT ON FUNCTION procurements.assert_enrollment_staff IS
  'The signed-in staff member''s sms_users.id when they may enrol for p_school_id, else raises. Roster includes teacher (135); volunteer_teacher (140), tutors and deactivated accounts are refused. NULL for the service role, which authorises upstream.';

GRANT EXECUTE ON FUNCTION procurements.assert_enrollment_staff(BIGINT) TO authenticated, service_role;
