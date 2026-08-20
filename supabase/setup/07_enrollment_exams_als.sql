-- ============================================================================
-- SCHOOL MANAGEMENT SYSTEM — FRESH INSTALL, PART 7 OF 7
-- Enrollment identity & isolation, OMR exam scanning, ALS, multi-school users
-- ============================================================================
-- GENERATED FILE — do not edit by hand; run supabase/setup/generate.sh instead.
-- A byte-for-byte concatenation of the 25 migrations listed below, in the
-- exact order a migration runner would apply them.
--
-- FOR NEW / EMPTY DATABASES ONLY. Never run this against a database that already
-- has the migration history applied — use supabase/migrations/ for that.
--
-- Run the seven parts strictly in order: 01 -> 07. Each part is one transaction,
-- so a failure rolls the whole part back and leaves nothing half-applied.
--
-- Migrations merged into this part:
--   130_enrollment_rpc_caller_identity.sql
--   131_enrollment_write_isolation.sql
--   132_exam_answer_keys_and_scanning.sql
--   133_subject_program_als.sql
--   134_multi_school_user_assignment.sql
--   135_allow_teacher_enrollment.sql
--   135_guidance_nurse_accounting_roles.sql
--   136_als_section_type.sql
--   137_room_dimension_and_section_room.sql
--   138_cross_school_teacher_conflict.sql
--   139_volunteer_teacher_role.sql
--   140_division_enrollment_actual.sql
--   141_public_enrollment_counts.sql
--   142_public_enrollment_counts_by_school.sql
--   143_enrollment_autofill_shs_semesters.sql
--   144_division_enrollment_actual_categories.sql
--   145_shs_section_strand.sql
--   146_personnel_sex_and_learning_area.sql
--   147_division_enrollment_actual_fourps.sql
--   148_enrollment_balik_aral.sql
--   149_iped_and_pwd_fourps_reports.sql
--   150_pwd_from_lsen_tagging.sql
--   151_ip_learner_from_picklist.sql
--   152_philiri_material_question_count.sql
--   153_mapeh_component.sql
-- ============================================================================

BEGIN;

SET search_path TO procurements, public;

-- ============================================================================
-- >>> BEGIN 130_enrollment_rpc_caller_identity.sql
-- ============================================================================

-- ============================================================================
-- Migration 130: the enrollment RPCs stop trusting the caller's own claims
-- ============================================================================
--
-- APPLY AFTER 127 (which rewrote enroll_student_with_record_request) and
-- alongside 129, which closed the same hole for the three *record request*
-- RPCs. 129 names this migration as its follow-up:
--
--     "enroll_student_with_record_request is deliberately NOT revoked: the
--      enrollment wizard still calls it directly … It has the same
--      unchecked-caller shape and should get the same treatment in a follow-up."
--
-- ---------------------------------------------------------------------------
-- What is wrong today
-- ---------------------------------------------------------------------------
--
-- Two SECURITY DEFINER functions are granted to `authenticated` and take the
-- acting school and user as ARGUMENTS, with nothing checking either:
--
--   enroll_student_with_record_request(p_student_id, p_requesting_school_id,
--                                      p_requested_by, …)
--   enroll_students_atomic(p_records, p_source_ids, p_school_id)
--
-- A definer function runs as its owner, so RLS never applies inside it. The
-- anon key ships in the browser bundle, so any signed-in account — a teacher, a
-- librarian, a deactivated clerk at another school — can call these directly
-- and:
--
--   * enrol any learner, identified only by id, into any school and section,
--     which also rewrites sms_students.school_id and opens a record request
--     against the learner's real school;
--   * bulk-insert enrollments for another school. enroll_students_atomic even
--     documents a tenant guard — but it compares each record against the
--     p_school_id the CALLER supplied, so passing NULL disables it;
--   * write a false audit trail, since enrolled_by / approved_by are whatever
--     the caller put in the payload.
--
-- ---------------------------------------------------------------------------
-- What replaces it
-- ---------------------------------------------------------------------------
--
-- The acting staff member is resolved inside the function from auth.uid() —
-- the same source 037/038/071/112/113 use in policies, and the same identity
-- lib/requests/auth.ts resolves from the session cookie. The arguments are
-- then treated as assertions, never as facts:
--
--   * school-scoped roles may only act for their OWN school; a mismatched or
--     NULL p_school_id is refused rather than waved through;
--   * division_admin / division_type / super admin keep acting across schools
--     (AuthGuard swaps a super admin's school_id for their active-school
--     override, so a school match would break them — the 113 precedent);
--   * enrolled_by / approved_by are overwritten with the resolved caller, so
--     the audit trail records who actually did it;
--   * teachers, tutors, students and deactivated accounts are refused
--     outright. The permitted set matches STAFF_TYPES in lib/requests/auth.ts.
--
-- The service role is exempt: auth.uid() is NULL for it, and it is only
-- reachable from server code that has already authenticated the caller — the
-- arrangement 129 established. That keeps the door open to move these two
-- calls behind server actions later without touching the SQL again.
--
-- ---------------------------------------------------------------------------
-- Blast radius
-- ---------------------------------------------------------------------------
--
-- Creates 4 functions, replaces 3. Creates no table, drops nothing, and
-- modifies NO ROWS — there is no DML in this file.
--
-- One behavioural consequence worth stating plainly: if any account has been
-- enrolling learners for a school other than its own — a super admin whose
-- override is not set, a clerk covering for a neighbouring school — that stops
-- working and returns "You may only enrol learners at your own school". That
-- is the point of the migration, but it is the kind of thing that surfaces on
-- a Monday morning, so check before applying:
--
--   SELECT u.type, u.school_id AS user_school, e.school_id AS enrolled_into,
--          count(*)
--   FROM procurements.sms_enrollments e
--   JOIN procurements.sms_users u ON u.id = e.enrolled_by
--   WHERE e.created_at > NOW() - INTERVAL '1 year'
--     AND u.school_id IS DISTINCT FROM e.school_id
--     AND u.type NOT IN ('division_admin','division_type','super admin')
--   GROUP BY 1,2,3 ORDER BY 4 DESC;
--
-- Rows here are cross-school enrolments by school-scoped staff. Expect none.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Caller identity helpers
-- ---------------------------------------------------------------------------

-- True when the request carries the service-role JWT. Read from the request
-- claims rather than current_user, which inside a SECURITY DEFINER function is
-- the function's OWNER and says nothing about who called it.
CREATE OR REPLACE FUNCTION procurements.is_service_role()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role';
$$;

COMMENT ON FUNCTION procurements.is_service_role IS
  'True when the caller presented the service-role key. Server code that has already authenticated the acting user, per the lib/requests/auth.ts pattern.';

-- The signed-in staff member's sms_users row, or NULL.
CREATE OR REPLACE FUNCTION procurements.current_staff()
RETURNS procurements.sms_users
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT u.*
  FROM procurements.sms_users u
  WHERE u.user_id = auth.uid()
    AND u.is_active
  LIMIT 1;
$$;

COMMENT ON FUNCTION procurements.current_staff IS
  'The active sms_users row behind auth.uid(), or NULL. SECURITY DEFINER so it resolves regardless of how sms_users RLS is written.';

-- Any active staff member. Returns their sms_users.id, or NULL for the
-- service role (which authorises for itself upstream).
CREATE OR REPLACE FUNCTION procurements.assert_staff()
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

  RETURN v_staff.id;
END;
$$;

-- Staff who may enrol, for the school they are enrolling into.
-- Returns their sms_users.id, or NULL for the service role.
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

  -- Same roster as STAFF_TYPES in lib/requests/auth.ts. Teachers and tutors
  -- have their own workflows and never enrol.
  IF v_staff.type NOT IN (
    'school_head', 'assistant_school_head', 'admin', 'registrar', 'librarian',
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

GRANT EXECUTE ON FUNCTION procurements.is_service_role()               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION procurements.current_staff()                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION procurements.assert_staff()                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION procurements.assert_enrollment_staff(BIGINT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. enroll_students_atomic — derive the tenant guard, don't accept it
-- ---------------------------------------------------------------------------
-- Body is otherwise 061's, with 061's comments kept.

CREATE OR REPLACE FUNCTION procurements.enroll_students_atomic(
  p_records    jsonb,
  p_source_ids bigint[],
  p_school_id  bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_record         jsonb;
  v_inserted       int := 0;
  v_skipped        int := 0;
  v_record_school  bigint;
  v_caller_id      bigint;
BEGIN
  -- Refuses the caller outright unless they may enrol for p_school_id. A
  -- school-scoped caller passing NULL — the old way to switch the guard below
  -- off — is refused here.
  v_caller_id := procurements.assert_enrollment_staff(p_school_id);

  IF p_records IS NULL OR jsonb_array_length(p_records) = 0 THEN
    RETURN jsonb_build_object('inserted', 0, 'skipped', 0);
  END IF;

  -- Insert new enrollments one by one so a single duplicate doesn't abort
  -- the whole batch. Each iteration shares the same outer transaction, so
  -- the subsequent UPDATE below remains atomic with the inserts.
  FOR v_record IN SELECT * FROM jsonb_array_elements(p_records)
  LOOP
    -- Tenant guard: every record must belong to the caller's school
    -- (or have school_id NULL when caller is division-admin / NULL).
    v_record_school := NULLIF(v_record->>'school_id', '')::bigint;
    IF p_school_id IS NOT NULL AND v_record_school IS DISTINCT FROM p_school_id THEN
      RAISE EXCEPTION 'school_id mismatch in enrollment record (expected %, got %)',
        p_school_id, v_record_school;
    END IF;

    BEGIN
      INSERT INTO procurements.sms_enrollments (
        student_id, section_id, school_year, grade_level, semester,
        enrollment_date, status, enrollment_status,
        enrolled_by, approved_by, school_id
      )
      VALUES (
        (v_record->>'student_id')::bigint,
        (v_record->>'section_id')::bigint,
        v_record->>'school_year',
        (v_record->>'grade_level')::int,
        NULLIF(v_record->>'semester','')::int,
        (v_record->>'enrollment_date')::date,
        v_record->>'status',
        v_record->>'enrollment_status',
        -- Who did this is resolved from the session, not taken from the
        -- payload, so the audit trail cannot be forged. The payload value is
        -- the fallback only for service-role callers.
        COALESCE(v_caller_id, (v_record->>'enrolled_by')::bigint),
        COALESCE(v_caller_id, (v_record->>'approved_by')::bigint),
        v_record_school
      );
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN unique_violation THEN
      -- Already enrolled for the target school year — skip silently.
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  -- Mark the prior promoted/retained enrollments as completed. Constrained
  -- by school_id so a forged source id from another school cannot be
  -- mutated through this RPC.
  IF p_source_ids IS NOT NULL AND array_length(p_source_ids, 1) > 0 THEN
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'completed'
    WHERE id = ANY(p_source_ids)
      AND enrollment_status IN ('promoted', 'retained')
      AND (p_school_id IS NULL OR school_id = p_school_id);
  END IF;

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. enroll_student_with_record_request — same treatment
-- ---------------------------------------------------------------------------
-- Body is 127's, with 127's comments kept; p_requested_by becomes a fallback
-- for the service role rather than the source of truth.

CREATE OR REPLACE FUNCTION procurements.enroll_student_with_record_request(
  p_student_id BIGINT, p_requesting_school_id BIGINT, p_requested_by BIGINT,
  p_section_id BIGINT, p_grade_level INTEGER, p_school_year TEXT,
  p_semester INTEGER DEFAULT NULL, p_remarks TEXT DEFAULT NULL
) RETURNS TABLE (enrollment_id BIGINT, request_id BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_origin_school_id BIGINT; v_student_lrn TEXT;
  v_enrollment_id BIGINT; v_request_id BIGINT;
  v_origin_status TEXT;
  v_origin_enrollment_id BIGINT;
  v_existing_enrollment_id BIGINT;
  v_actor_id BIGINT;
BEGIN
  -- The learner is moved between schools and their sms_students.school_id is
  -- rewritten, so establish who is asking before anything else happens.
  v_actor_id := COALESCE(
    procurements.assert_enrollment_staff(p_requesting_school_id),
    p_requested_by
  );

  SELECT s.lrn INTO v_student_lrn FROM procurements.sms_students s WHERE s.id = p_student_id;
  IF v_student_lrn IS NULL THEN RAISE EXCEPTION 'Student not found'; END IF;

  -- The learner's latest approved enrollment IS the origin — capture its id,
  -- not just its school, so every later step acts on this one row.
  SELECT e.id, e.school_id, e.enrollment_status
    INTO v_origin_enrollment_id, v_origin_school_id, v_origin_status
  FROM procurements.sms_enrollments e
  WHERE e.student_id = p_student_id AND e.status = 'approved'
    AND e.enrollment_status IN ('active', 'completed', 'transferred_out', 'promoted', 'graduated', 'retained')
  ORDER BY e.school_year DESC, e.created_at DESC LIMIT 1;

  IF v_origin_school_id IS NULL THEN RAISE EXCEPTION 'Student has no active enrollment'; END IF;
  IF v_origin_school_id = p_requesting_school_id THEN RAISE EXCEPTION 'Student already at this school'; END IF;

  -- Create record request for data access
  INSERT INTO procurements.sms_record_requests (
    student_id, student_lrn, requesting_school_id, origin_school_id,
    origin_enrollment_id, requested_by, target_grade_level, target_school_year, remarks
  ) VALUES (
    p_student_id, v_student_lrn, p_requesting_school_id, v_origin_school_id,
    v_origin_enrollment_id, v_actor_id, p_grade_level, p_school_year, p_remarks
  ) RETURNING id INTO v_request_id;

  -- Mark THAT origin enrollment as pending_transfer (only if still active)
  IF v_origin_status = 'active' THEN
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'pending_transfer'
    WHERE id = v_origin_enrollment_id;
  END IF;

  -- Check if student already has an enrollment at this school for this school year
  -- (e.g., student transferred away and is now returning). Reactivate it instead of
  -- inserting a duplicate that would violate the unique constraint.
  SELECT id INTO v_existing_enrollment_id
  FROM procurements.sms_enrollments
  WHERE student_id = p_student_id
    AND school_id = p_requesting_school_id
    AND school_year = p_school_year
    AND COALESCE(semester, 0) = COALESCE(p_semester, 0)
  LIMIT 1;

  IF v_existing_enrollment_id IS NOT NULL THEN
    -- Reactivate the existing enrollment. A row that was left 'graduated' is
    -- refused by trg_enforce_graduation_lock (126), not silently revived.
    UPDATE procurements.sms_enrollments
    SET section_id = p_section_id, grade_level = p_grade_level,
        status = 'approved', enrollment_status = 'active',
        origin_school_id = v_origin_school_id, record_request_id = v_request_id,
        enrolled_by = v_actor_id, approved_by = v_actor_id,
        remarks = NULL, updated_at = NOW()
    WHERE id = v_existing_enrollment_id
    RETURNING id INTO v_enrollment_id;
  ELSE
    -- Create new enrollment — immediately approved & active
    INSERT INTO procurements.sms_enrollments (
      student_id, school_id, section_id, grade_level, school_year, semester,
      status, enrollment_status, origin_school_id, record_request_id,
      enrolled_by, approved_by
    ) VALUES (
      p_student_id, p_requesting_school_id, p_section_id, p_grade_level, p_school_year,
      p_semester, 'approved', 'active', v_origin_school_id, v_request_id,
      v_actor_id, v_actor_id
    ) RETURNING id INTO v_enrollment_id;
  END IF;

  -- Update student record
  UPDATE procurements.sms_students
  SET school_id = p_requesting_school_id, enrollment_status = 'enrolled',
      grade_level = p_grade_level, current_section_id = p_section_id
  WHERE id = p_student_id;

  RETURN QUERY SELECT v_enrollment_id, v_request_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. lookup_student_by_lrn — staff only
-- ---------------------------------------------------------------------------
-- Body is 042's. This one is a read, but a SECURITY DEFINER read that returns
-- a named learner's date of birth and school for any LRN in the division, to
-- anyone holding the anon key and any account at all. Cross-school visibility
-- is the point (it is how a transferee is recognised), so the check is only
-- that the caller is an active staff member, with no school match.

CREATE OR REPLACE FUNCTION procurements.lookup_student_by_lrn(p_lrn TEXT)
RETURNS TABLE (
  student_id BIGINT, lrn TEXT, first_name TEXT, last_name TEXT,
  middle_name TEXT, suffix TEXT, date_of_birth DATE, gender TEXT,
  current_school_id BIGINT, current_school_name TEXT,
  current_grade_level INTEGER, current_school_year TEXT, enrollment_status TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
BEGIN
  PERFORM procurements.assert_staff();

  RETURN QUERY
  SELECT s.id, s.lrn, s.first_name, s.last_name, s.middle_name, s.suffix,
    s.date_of_birth, s.gender,
    COALESCE(e.school_id, s.school_id),
    COALESCE(sch_e.name, sch_s.name),
    e.grade_level, e.school_year, e.enrollment_status
  FROM procurements.sms_students s
  LEFT JOIN LATERAL (
    SELECT e2.school_id, e2.grade_level, e2.school_year, e2.enrollment_status
    FROM procurements.sms_enrollments e2
    WHERE e2.student_id = s.id AND e2.status = 'approved'
    ORDER BY e2.school_year DESC, e2.created_at DESC LIMIT 1
  ) e ON TRUE
  LEFT JOIN procurements.sms_schools sch_e ON sch_e.id = e.school_id
  LEFT JOIN procurements.sms_schools sch_s ON sch_s.id = s.school_id
  WHERE s.lrn = p_lrn;
END;
$$;

-- Grants are preserved by CREATE OR REPLACE; restated so the intended reach of
-- each function is visible in one place.
GRANT EXECUTE ON FUNCTION procurements.enroll_students_atomic(jsonb, bigint[], bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION procurements.enroll_student_with_record_request(BIGINT, BIGINT, BIGINT, BIGINT, INTEGER, TEXT, INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION procurements.lookup_student_by_lrn(TEXT) TO authenticated, service_role;

-- <<< END 130_enrollment_rpc_caller_identity.sql

-- ============================================================================
-- >>> BEGIN 131_enrollment_write_isolation.sql
-- ============================================================================

-- ============================================================================
-- Migration 131: school isolation for enrollment WRITES
-- ============================================================================
--
-- APPLY AFTER 130 (it reuses assert_enrollment_staff).
--
-- ---------------------------------------------------------------------------
-- What is wrong today
-- ---------------------------------------------------------------------------
--
-- Migration 001 shipped sms_enrollments with four placeholder policies, under a
-- comment that says so: "Basic policies (adjust based on your security
-- requirements) — These are permissive policies".
--
--   Enrollments are viewable  by authenticated users  SELECT  USING (auth.role() = 'authenticated')
--   Enrollments are insertable by admins              INSERT  WITH CHECK (auth.role() = 'authenticated')
--   Enrollments are updatable  by admins              UPDATE  USING (auth.role() = 'authenticated')
--   Enrollments are deletable  by admins              DELETE  USING (auth.role() = 'authenticated')
--
-- Despite the names, none of them checks a role or a school: the only condition
-- is "is signed in". The anon key ships in the browser bundle, so any account in
-- the division — a teacher, a librarian, a clerk at another school — can insert,
-- rewrite or DELETE any enrollment row belonging to any school, straight through
-- PostgREST, without going near the application.
--
-- Migration 130 closed the RPC route into this table. This closes the table
-- itself, which is the larger of the two: the RPCs were a door, this is the wall
-- they were set in.
--
-- ---------------------------------------------------------------------------
-- Scope: writes only, deliberately
-- ---------------------------------------------------------------------------
--
-- SELECT is left exactly as it is. Read paths are numerous (dashboards, SF1-SF10,
-- KPI's SECURITY INVOKER RPCs, grade monitoring, the teacher pages, the transfer
-- record viewer via 057's has_record_access policy), and tightening reads without
-- auditing every one of them risks blanking a report rather than corrupting data.
-- Writes are where the damage is, and the app already filters them by school, so
-- this stage matches what the code does today. Reads are a follow-up.
--
-- ---------------------------------------------------------------------------
-- What still works
-- ---------------------------------------------------------------------------
--
--   * every school-scoped write the app makes — the wizard, ChangeStatusModal,
--     PromoteStudentModal, RetainNlisModal, TransferOutModal and the auto-enroll
--     rollback all act on rows of the caller's own school;
--   * the transfer RPCs, which are SECURITY DEFINER and run as the owner, so RLS
--     does not apply inside them (that is how a learner's row at the ORIGIN
--     school is still moved to transferred_out);
--   * the service-role client used by the server actions, which bypasses RLS;
--   * division_admin / division_type / super admin, who write across schools.
--     Super admin is in that branch rather than school-matched because AuthGuard
--     swaps their school_id for the active-school override (the 113 precedent).
--
-- The one client write this refuses is the enrollment wizard closing a duplicate
-- active enrollment at ANOTHER school. Section 3 below replaces it with a
-- definer function that authorises the caller first; the wizard is changed to
-- call it in the same commit.
--
-- ---------------------------------------------------------------------------
-- Blast radius
-- ---------------------------------------------------------------------------
--
-- Drops 3 policies, creates 3 policies, creates 2 functions. Creates no table,
-- drops no column, and modifies NO ROWS — there is no DML in this file.
-- Reversible by re-creating the three policies from 001.
--
-- Before applying, count enrollments with no school_id. Such a row can only be
-- written by division staff afterwards, because a school match against NULL is
-- never true:
--
--   SELECT count(*) FROM procurements.sms_enrollments WHERE school_id IS NULL;
--
-- Expect 0. If it is not 0, tell me before applying — those rows need an owner.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Who may write an enrollment belonging to a given school
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it resolves regardless of how sms_users' own RLS is
-- written, matching can_write_src (113) and current_staff (130).

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
      AND (
        u.type IN ('division_admin', 'division_type', 'super admin')
        OR u.school_id = p_school_id
      )
  );
$$;

COMMENT ON FUNCTION procurements.can_write_enrollment IS
  'True when the signed-in staff member may write an enrollment row owned by p_school_id. Division-level roles write anywhere; everyone else only their own school. NULL p_school_id is division-only.';

GRANT EXECUTE ON FUNCTION procurements.can_write_enrollment(BIGINT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Replace the placeholder write policies
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Enrollments are insertable by admins" ON procurements.sms_enrollments;
DROP POLICY IF EXISTS "Enrollments are updatable by admins"  ON procurements.sms_enrollments;
DROP POLICY IF EXISTS "Enrollments are deletable by admins"  ON procurements.sms_enrollments;

CREATE POLICY "enrollments_insert_own_school"
  ON procurements.sms_enrollments FOR INSERT
  TO authenticated
  WITH CHECK (procurements.can_write_enrollment(school_id));

-- USING gates which rows may be touched; WITH CHECK gates what they may become,
-- so a row cannot be updated and handed to another school in one statement.
CREATE POLICY "enrollments_update_own_school"
  ON procurements.sms_enrollments FOR UPDATE
  TO authenticated
  USING      (procurements.can_write_enrollment(school_id))
  WITH CHECK (procurements.can_write_enrollment(school_id));

CREATE POLICY "enrollments_delete_own_school"
  ON procurements.sms_enrollments FOR DELETE
  TO authenticated
  USING (procurements.can_write_enrollment(school_id));

-- ---------------------------------------------------------------------------
-- 3. The one legitimate cross-school write, made explicit
-- ---------------------------------------------------------------------------
-- When a learner is re-enrolled at this school for a school year in which they
-- still hold an active enrollment somewhere else, one of the two rows is stale —
-- nobody sits in two schools at once, and leaving both active double-counts the
-- learner in every enrolment figure in the division.
--
-- The wizard used to do this with a direct UPDATE, which the policies above now
-- refuse (correctly: it is a write to another school's row). It is narrow enough
-- to be worth keeping, so here it is as a function that says exactly what it
-- will touch and checks the caller first:
--
--   * the caller must be entitled to enrol at p_keep_school_id (130's rule);
--   * only rows for that ONE learner, that ONE school year, that are active and
--     approved, at a school other than p_keep_school_id;
--   * a remark records why, so the origin school can see what happened.
--
-- It is not a transfer and does not pretend to be: no record request is opened,
-- and the learner's data stays with the origin school. An actual transfer goes
-- through enroll_student_with_record_request.

CREATE OR REPLACE FUNCTION procurements.close_duplicate_enrollment(
  p_student_id     BIGINT,
  p_school_year    TEXT,
  p_keep_school_id BIGINT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_closed INTEGER;
BEGIN
  PERFORM procurements.assert_enrollment_staff(p_keep_school_id);

  IF p_student_id IS NULL OR p_school_year IS NULL OR p_keep_school_id IS NULL THEN
    RAISE EXCEPTION 'close_duplicate_enrollment requires a student, a school year and the school to keep.';
  END IF;

  UPDATE procurements.sms_enrollments
  SET enrollment_status = 'transferred_out',
      remarks = format(
        'Closed automatically — learner re-enrolled at school %s for SY %s.',
        p_keep_school_id, p_school_year),
      updated_at = NOW()
  WHERE student_id = p_student_id
    AND school_year = p_school_year
    AND school_id IS DISTINCT FROM p_keep_school_id
    AND status = 'approved'
    AND enrollment_status = 'active';

  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RETURN v_closed;
END;
$$;

COMMENT ON FUNCTION procurements.close_duplicate_enrollment IS
  'Marks a learner''s active enrollments at OTHER schools for one school year as transferred_out, after checking the caller may enrol at the school being kept. Returns how many rows were closed. Not a transfer — use enroll_student_with_record_request for that.';

GRANT EXECUTE ON FUNCTION procurements.close_duplicate_enrollment(BIGINT, TEXT, BIGINT)
  TO authenticated, service_role;

-- <<< END 131_enrollment_write_isolation.sql

-- ============================================================================
-- >>> BEGIN 132_exam_answer_keys_and_scanning.sql
-- ============================================================================

-- ============================================================================
-- Migration 132: exam answer keys + scanned answer sheets
-- ============================================================================
--
-- APPLY AFTER 101 (it extends sms_exam_result_students).
--
-- ---------------------------------------------------------------------------
-- What this adds
-- ---------------------------------------------------------------------------
--
-- The Examinations module can already author a TOS (096), realise it as an exam
-- (099/100) and analyse item difficulty from results (101). What it could not do
-- is get those results in without a teacher hand-ticking a checkbox grid, one
-- learner at a time, for every item.
--
-- This migration backs a scan pipeline:
--
--   1. ANSWER KEY   — a flat item_number -> correct_answer key per exam.
--   2. ANSWER SHEET — a pre-printed OMR bubble sheet per learner (no storage:
--                     the sheet is derived from the key + the roster, and the
--                     learner is identified by a bubble-encoded ID block).
--   3. SCAN         — the decoded sheet is stored as the learner's raw answers.
--   4. ANALYSIS     — 101's computations run unchanged off correct_items.
--
-- ---------------------------------------------------------------------------
-- Why the key is its own table and not just the authored questions
-- ---------------------------------------------------------------------------
--
-- 099 already stores correct answers on the questions (sms_exam_options.is_correct
-- and sms_exam_questions.answer_key). That is the right home for an exam typed
-- into the Exam Builder, and the app pulls from it to prefill this table.
--
-- It cannot be the only home. The common case in a school is an exam that exists
-- on paper — photocopied, inherited, downloaded — where the teacher wants to scan
-- answer sheets without first transcribing 50 questions and their choices into the
-- builder. A key of 50 letters takes a minute; the questions take an afternoon.
-- So the key is stored flat, keyed by item number, and prefilling from the
-- authored questions is a convenience, not the mechanism.
--
-- The key also pins what the sheet must look like: `choice_count` is how many
-- bubbles that row gets printed with (a True/False item gets 2, not 4), and it is
-- read back by the decoder. Changing it after sheets are printed invalidates the
-- printed sheets, not the stored scans — scans keep their own answers.
--
-- ---------------------------------------------------------------------------
-- Why answers[] sits beside correct_items and does not replace it
-- ---------------------------------------------------------------------------
--
-- 101 stores `correct_items INTEGER[]` — which item numbers a learner got right.
-- That is everything the difficulty/discrimination/MPS maths needs, and every
-- existing row has it, so it stays the input to the analysis.
--
-- It cannot answer "which wrong choice did they pick?", which is the question a
-- distractor analysis is made of, and it cannot reproduce a marked-up result slip
-- showing the learner their own answer beside the key. So scans additionally store
-- the raw response per item in `answers`, positionally: answers[i] is the response
-- to item i. An empty string is a blank, '?' is a multi-mark the teacher left
-- unresolved. Rows encoded by hand keep an empty array and lose nothing they had.
--
-- Nothing is destroyed and nothing is backfilled: existing hand-encoded results
-- keep working exactly as before.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. ANSWER KEYS (one row per exam per item number)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_exam_answer_keys (
  id BIGSERIAL PRIMARY KEY,
  exam_id BIGINT NOT NULL REFERENCES procurements.sms_exams(id) ON DELETE CASCADE,
  item_number INTEGER NOT NULL CHECK (item_number >= 1),
  -- The response that scores. For a bubbled item this is a choice letter
  -- ('A'..'E'); free TEXT rather than a CHECK so a future sheet style (numeric
  -- responses, TRUE/FALSE spelled out) does not need a migration, per the 119
  -- precedent. NULL = the item has no key yet and is not scored.
  correct_answer TEXT,
  -- How many bubbles this item is printed with, and how many the decoder reads.
  choice_count INTEGER NOT NULL DEFAULT 4 CHECK (choice_count BETWEEN 2 AND 5),
  points NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (points >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exam_id, item_number)
);

COMMENT ON TABLE procurements.sms_exam_answer_keys IS
  'Flat answer key for an exam: one row per item number. Prefilled from the authored questions when they exist, typed directly when they do not.';
COMMENT ON COLUMN procurements.sms_exam_answer_keys.choice_count IS
  'Bubbles printed and read for this item (2-5). Governs the answer sheet layout and the decoder.';

CREATE INDEX IF NOT EXISTS idx_sms_exam_answer_keys_exam
  ON procurements.sms_exam_answer_keys(exam_id, item_number);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'update_sms_exam_answer_keys_updated_at'
  ) THEN
    CREATE TRIGGER update_sms_exam_answer_keys_updated_at
      BEFORE UPDATE ON procurements.sms_exam_answer_keys
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. RAW RESPONSES ON THE PER-LEARNER RESULT ROW (additive)
-- ----------------------------------------------------------------------------
-- answers[i] = the learner's response to item i. '' = blank, '?' = unresolved
-- multi-mark. Empty array = hand-encoded (pre-132) row; correct_items still rules.
ALTER TABLE procurements.sms_exam_result_students
  ADD COLUMN IF NOT EXISTS answers TEXT[] NOT NULL DEFAULT '{}';

-- 'manual' = ticked in the item-analysis grid, 'scan' = decoded from a sheet.
ALTER TABLE procurements.sms_exam_result_students
  ADD COLUMN IF NOT EXISTS scan_source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE procurements.sms_exam_result_students
  ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sms_exam_result_students_scan_source_check'
      AND conrelid = 'procurements.sms_exam_result_students'::regclass
  ) THEN
    ALTER TABLE procurements.sms_exam_result_students
      ADD CONSTRAINT sms_exam_result_students_scan_source_check
      CHECK (scan_source IN ('manual', 'scan'));
  END IF;
END $$;

COMMENT ON COLUMN procurements.sms_exam_result_students.answers IS
  'Raw response per item, positionally (answers[i] -> item i). Empty string = blank, ? = unresolved multi-mark. Empty array = hand-encoded row.';

-- ----------------------------------------------------------------------------
-- 3. RLS + GRANTS (permissive authenticated; scoping enforced in the app layer,
--    matching 099/100/101 for this module)
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_exam_answer_keys ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT := 'sms_exam_answer_keys';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'procurements' AND tablename = t
  ) THEN
    EXECUTE format('CREATE POLICY "%1$s: select" ON procurements.%1$s FOR SELECT USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: insert" ON procurements.%1$s FOR INSERT WITH CHECK (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: update" ON procurements.%1$s FOR UPDATE USING (auth.role() = ''authenticated'')', t);
    EXECUTE format('CREATE POLICY "%1$s: delete" ON procurements.%1$s FOR DELETE USING (auth.role() = ''authenticated'')', t);
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.%1$s TO authenticated', t);
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE procurements.%1$s_id_seq TO authenticated', t);
END $$;

-- <<< END 132_exam_answer_keys_and_scanning.sql

-- ============================================================================
-- >>> BEGIN 133_subject_program_als.sql
-- ============================================================================

-- ============================================================================
-- SUBJECT PROGRAM — ADD ALS (ALTERNATIVE LEARNING SYSTEM)
-- ============================================================================
-- The Program dropdown on Subjects was a two-state boolean (034's is_madrasah),
-- so a third program could not be stored at all. This adds a real
-- `program` column (regular | madrasah | als) and makes it the source of truth.
--
-- `is_madrasah` is NOT dropped and NOT renamed. Since 034 it has meant two
-- concrete behaviours, both of which ALS shares:
--   1. selective enrolment — only learners listed in sms_student_subjects take
--      the subject, instead of every learner in the section;
--   2. exclusion from the general average (076, 128, SF9/SF10/Form 137/report
--      card).
-- Rather than re-point ~20 call sites and two RPCs at a new column — including
-- signed, already-printed forms — `is_madrasah` is kept as the *mechanism*
-- flag and is derived from `program` by a trigger. Every existing consumer
-- keeps working untouched, and ALS inherits both behaviours for free.
--
-- Nothing is deleted and nothing is re-derived: existing rows are mapped
-- 1:1 (is_madrasah = true → 'madrasah', false → 'regular'), so no subject
-- changes behaviour when this is applied.
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- ADD program COLUMN
-- ============================================================================
-- Added nullable first so the backfill below can be WHERE-scoped and counted;
-- the default and NOT NULL are set afterwards.
ALTER TABLE procurements.sms_subjects
  ADD COLUMN IF NOT EXISTS program TEXT;

-- Backfill from the existing flag. Touches only rows not yet mapped.
UPDATE procurements.sms_subjects
   SET program = 'madrasah'
 WHERE program IS NULL
   AND COALESCE(is_madrasah, false) = true;

UPDATE procurements.sms_subjects
   SET program = 'regular'
 WHERE program IS NULL;

ALTER TABLE procurements.sms_subjects
  ALTER COLUMN program SET DEFAULT 'regular';

ALTER TABLE procurements.sms_subjects
  ALTER COLUMN program SET NOT NULL;

-- Values are constrained here because, unlike the free-TEXT codes of 119/121,
-- this set is not a DepEd list that revises on its own — each value carries
-- application behaviour that has to be written in code anyway.
ALTER TABLE procurements.sms_subjects
  DROP CONSTRAINT IF EXISTS sms_subjects_program_check;

ALTER TABLE procurements.sms_subjects
  ADD CONSTRAINT sms_subjects_program_check
  CHECK (program IN ('regular', 'madrasah', 'als'));

COMMENT ON COLUMN procurements.sms_subjects.program IS
  'Program the subject belongs to: regular | madrasah (MEP) | als. Source of truth for the Program dropdown. is_madrasah is derived from this by sync_subject_program_trigger.';

COMMENT ON COLUMN procurements.sms_subjects.is_madrasah IS
  'Derived from program (true for madrasah and als). Means: selectively enrolled via sms_student_subjects, and excluded from the general average. Do not set directly — write program instead.';

-- ============================================================================
-- KEEP program AND is_madrasah IN SYNC
-- ============================================================================
-- Two-directional on purpose: a writer that only knows about the old boolean
-- (anything predating this migration) still lands on a consistent row, and a
-- writer that sets program wins when both change in the same statement.
CREATE OR REPLACE FUNCTION procurements.sync_subject_program()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A caller that supplied only the old boolean lands on 'regular' via the
    -- column default, which would silently downgrade it — so on insert the
    -- boolean wins whenever program says nothing more specific.
    IF COALESCE(NEW.program, 'regular') = 'regular'
       AND COALESCE(NEW.is_madrasah, false) = true THEN
      NEW.program := 'madrasah';
    ELSIF NEW.program IS NULL THEN
      NEW.program := 'regular';
    END IF;
    NEW.is_madrasah := NEW.program IN ('madrasah', 'als');
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.program IS DISTINCT FROM OLD.program THEN
    NEW.is_madrasah := NEW.program IN ('madrasah', 'als');
  ELSIF NEW.is_madrasah IS DISTINCT FROM OLD.is_madrasah THEN
    NEW.program := CASE WHEN NEW.is_madrasah THEN 'madrasah' ELSE 'regular' END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_subject_program_trigger ON procurements.sms_subjects;

CREATE TRIGGER sync_subject_program_trigger
  BEFORE INSERT OR UPDATE ON procurements.sms_subjects
  FOR EACH ROW
  EXECUTE FUNCTION procurements.sync_subject_program();

-- ============================================================================
-- INDEX
-- ============================================================================
-- Mirrors 034's partial index: the lookups are always "the non-regular ones".
CREATE INDEX IF NOT EXISTS idx_subjects_program
  ON procurements.sms_subjects(program) WHERE program <> 'regular';

-- <<< END 133_subject_program_als.sql

-- ============================================================================
-- >>> BEGIN 134_multi_school_user_assignment.sql
-- ============================================================================

-- ============================================================================
-- 134. Multi-school user assignment + active-school switching
--
-- A staff member can be assigned to more than one school (a teacher who serves
-- two barangay schools, a registrar covering an annex). Until now `sms_users`
-- carried exactly one `school_id`, so such a person needed two logins.
--
-- THE MODEL — and the one thing to get right when reading the rest of the app:
--
--   `sms_user_schools`   = the set of schools this user MAY work in
--   `sms_users.school_id` = the school they are working in RIGHT NOW
--
-- `school_id` keeps its meaning as "the school whose data I am acting on", so
-- every one of the ~50 client queries that filter on it, and every RLS policy
-- that binds to it (037/115 subjects, 038 record requests, 057 record access,
-- 078/094 storage, 123 supervision, 129 requests, 131 enrollments), keeps
-- working untouched. Switching schools rewrites that one column via the RPC
-- below; nothing else in the system has to learn about the join table.
--
-- The alternative — a client-side "active school" override like the super
-- admin's localStorage one (094/113/115) — was rejected here: that override
-- only works because super admin sits in the *full-access* branch of every
-- policy. A school_head with two schools has no such branch, so an override
-- the database cannot see would 403 them out of subjects, enrolment, requests,
-- supervision and storage the moment they switched.
--
-- Consequence worth stating plainly: while a two-school teacher is switched to
-- school B, school A's staff pickers (section adviser, subject teacher) do not
-- list them, because those read `sms_users.school_id`. Already-saved
-- assignments are unaffected — they hold the user's id, not their school.
--
-- Also closes a pre-existing hole: 001's blanket
-- `USING (auth.role() = 'authenticated')` UPDATE policy on `sms_users` let any
-- signed-in user set their own `school_id` to any school from the browser
-- console. The guard trigger here confines a self-service change to the user's
-- assigned set (division-level actors and service_role are unrestricted).
--
-- Additive and idempotent throughout: one new table, one trigger, one RPC.
-- No column is dropped and no existing row is rewritten — the backfill only
-- INSERTs, so every user keeps the school they have today.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- 1. The assignment table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurements.sms_user_schools (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  school_id  BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- FKs added separately, per 116's lesson: CREATE TABLE IF NOT EXISTS silently
-- skips constraint declarations when the table already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_sms_user_schools_user'
      AND conrelid = 'procurements.sms_user_schools'::regclass
  ) THEN
    ALTER TABLE procurements.sms_user_schools
      ADD CONSTRAINT fk_sms_user_schools_user
      FOREIGN KEY (user_id) REFERENCES procurements.sms_users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_sms_user_schools_school'
      AND conrelid = 'procurements.sms_user_schools'::regclass
  ) THEN
    ALTER TABLE procurements.sms_user_schools
      ADD CONSTRAINT fk_sms_user_schools_school
      FOREIGN KEY (school_id) REFERENCES procurements.sms_schools(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_sms_user_schools_user_school'
      AND conrelid = 'procurements.sms_user_schools'::regclass
  ) THEN
    ALTER TABLE procurements.sms_user_schools
      ADD CONSTRAINT uq_sms_user_schools_user_school UNIQUE (user_id, school_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sms_user_schools_user_id
  ON procurements.sms_user_schools(user_id);
CREATE INDEX IF NOT EXISTS idx_sms_user_schools_school_id
  ON procurements.sms_user_schools(school_id);

COMMENT ON TABLE procurements.sms_user_schools IS
  'Schools a user may work in. sms_users.school_id holds whichever of these is currently active.';

-- ----------------------------------------------------------------------------
-- 2. Backfill — every user keeps the school they have today
-- ----------------------------------------------------------------------------
INSERT INTO procurements.sms_user_schools (user_id, school_id)
SELECT u.id, u.school_id
FROM procurements.sms_users u
WHERE u.school_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM procurements.sms_schools s WHERE s.id = u.school_id)
ON CONFLICT (user_id, school_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Helpers
-- ----------------------------------------------------------------------------

/** The sms_users.id of the signed-in caller, or NULL outside a user session. */
CREATE OR REPLACE FUNCTION procurements.sms_current_user_row_id()
RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT id FROM procurements.sms_users WHERE user_id = auth.uid() LIMIT 1;
$$;

/**
 * Division-level actors, who may assign anyone to any school. Mirrors
 * `sms_actor_is_division` (123) but includes `division_type`, since the users
 * screen at /division/users is reached by that role family too.
 */
CREATE OR REPLACE FUNCTION procurements.sms_actor_manages_users()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT COALESCE(
    (SELECT u.type IN ('super admin', 'division_admin', 'division_type')
       FROM procurements.sms_users u
      WHERE u.user_id = auth.uid() AND u.is_active
      LIMIT 1),
    FALSE);
$$;

/** True when p_school_id is one of p_user_id's assigned schools. */
CREATE OR REPLACE FUNCTION procurements.sms_user_may_use_school(
  p_user_id BIGINT, p_school_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = procurements, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM procurements.sms_user_schools us
    WHERE us.user_id = p_user_id AND us.school_id = p_school_id
  );
$$;

GRANT EXECUTE ON FUNCTION procurements.sms_current_user_row_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION procurements.sms_actor_manages_users() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION procurements.sms_user_may_use_school(BIGINT, BIGINT) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. RLS on the assignment table
--
-- Readable by any signed-in user (the switcher has to list your own schools,
-- and /division/users lists everyone's). Writable only by the roles that
-- manage users — an assignment row grants access to a school's data, so 123's
-- lesson applies: it must not sit behind a blanket `authenticated` write.
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_user_schools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User schools are viewable by authenticated users" ON procurements.sms_user_schools;
CREATE POLICY "User schools are viewable by authenticated users"
  ON procurements.sms_user_schools FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "User schools are insertable by user managers" ON procurements.sms_user_schools;
CREATE POLICY "User schools are insertable by user managers"
  ON procurements.sms_user_schools FOR INSERT
  WITH CHECK (procurements.sms_actor_manages_users());

DROP POLICY IF EXISTS "User schools are updatable by user managers" ON procurements.sms_user_schools;
CREATE POLICY "User schools are updatable by user managers"
  ON procurements.sms_user_schools FOR UPDATE
  USING (procurements.sms_actor_manages_users())
  WITH CHECK (procurements.sms_actor_manages_users());

DROP POLICY IF EXISTS "User schools are deletable by user managers" ON procurements.sms_user_schools;
CREATE POLICY "User schools are deletable by user managers"
  ON procurements.sms_user_schools FOR DELETE
  USING (procurements.sms_actor_manages_users());

GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_user_schools TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_user_schools_id_seq TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Guard: a user may only move themselves between their assigned schools
--
-- Fires only when school_id actually changes. Division-level actors are
-- unrestricted (they are the ones who set assignments in the first place), and
-- so is service_role / SQL run outside a user session (auth.uid() IS NULL),
-- which is what migrations and the admin client use.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.sms_users_guard_school_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
BEGIN
  IF NEW.school_id IS NOT DISTINCT FROM OLD.school_id THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR procurements.sms_actor_manages_users() THEN
    RETURN NEW;
  END IF;

  -- Anyone else may only rewrite their OWN row, and only to a school they are
  -- assigned to.
  IF OLD.id IS DISTINCT FROM procurements.sms_current_user_row_id() THEN
    RAISE EXCEPTION 'You may not change another user''s school.';
  END IF;

  IF NEW.school_id IS NULL
     OR NOT procurements.sms_user_may_use_school(OLD.id, NEW.school_id) THEN
    RAISE EXCEPTION 'You are not assigned to that school.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sms_users_guard_school_change ON procurements.sms_users;
CREATE TRIGGER sms_users_guard_school_change
  BEFORE UPDATE OF school_id ON procurements.sms_users
  FOR EACH ROW EXECUTE FUNCTION procurements.sms_users_guard_school_change();

-- ----------------------------------------------------------------------------
-- 6. The switch itself
--
-- SECURITY DEFINER so the caller needs no UPDATE grant on their own row beyond
-- this one narrow path; it re-checks assignment itself rather than leaning on
-- the trigger, so the error message is the useful one.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.sms_switch_active_school(p_school_id BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_user_id BIGINT;
BEGIN
  v_user_id := procurements.sms_current_user_row_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;

  IF p_school_id IS NULL THEN
    RAISE EXCEPTION 'A school is required.';
  END IF;

  IF NOT procurements.sms_user_may_use_school(v_user_id, p_school_id) THEN
    RAISE EXCEPTION 'You are not assigned to that school.';
  END IF;

  UPDATE procurements.sms_users
     SET school_id = p_school_id
   WHERE id = v_user_id;

  RETURN p_school_id;
END;
$$;

COMMENT ON FUNCTION procurements.sms_switch_active_school(BIGINT) IS
  'Moves the signed-in user to one of their assigned schools by rewriting sms_users.school_id. Rejects any school not in sms_user_schools.';

GRANT EXECUTE ON FUNCTION procurements.sms_switch_active_school(BIGINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- Verification (read-only):
--
--   -- users assigned to more than one school
--   SELECT u.id, u.name, u.school_id AS active, count(*) AS assigned
--   FROM procurements.sms_users u
--   JOIN procurements.sms_user_schools us ON us.user_id = u.id
--   GROUP BY u.id, u.name, u.school_id HAVING count(*) > 1;
--
--   -- anyone whose active school is not in their assigned set (should be 0)
--   SELECT count(*) FROM procurements.sms_users u
--   WHERE u.school_id IS NOT NULL
--     AND NOT procurements.sms_user_may_use_school(u.id, u.school_id);
-- ----------------------------------------------------------------------------

-- <<< END 134_multi_school_user_assignment.sql

-- ============================================================================
-- >>> BEGIN 135_allow_teacher_enrollment.sql
-- ============================================================================

-- ============================================================================
-- Migration 135: teachers may enrol learners
-- ============================================================================
--
-- APPLY AFTER 130, which created assert_enrollment_staff().
--
-- ---------------------------------------------------------------------------
-- Why
-- ---------------------------------------------------------------------------
--
-- 130 locked the two enrollment RPCs to a roster copied from STAFF_TYPES in
-- lib/requests/auth.ts, on the stated assumption that "teachers and tutors have
-- their own workflows and never enrol". In this division they do enrol: the
-- Teacher Menu has carried an Enrollment entry to the full staff module since
-- the first commit (components/AppSidebar.tsx, `teacherItems`), the page has no
-- role gate, and migration 131's RLS already lets any active staff member —
-- teachers included — insert an enrollment row for their own school. So a
-- teacher could already enrol a brand-new or existing same-school learner
-- through the wizard's direct INSERT path, and was refused only on the two
-- paths that go through an RPC:
--
--   enroll_student_with_record_request  → transferee from another school
--   enroll_students_atomic              → bulk re-enrol of promoted/retained
--
-- The same page therefore worked for one kind of enrollment and raised
-- "Your role (teacher) may not enrol learners." for another. This aligns the
-- RPC roster with what RLS and the UI already permit.
--
-- ---------------------------------------------------------------------------
-- What this does NOT relax
-- ---------------------------------------------------------------------------
--
-- Only the role list changes. Everything else 130 established stands:
--
--   * the acting staff member is still resolved from auth.uid(), never from
--     the caller's arguments — a teacher cannot enrol as somebody else;
--   * a teacher is school-scoped, so the branch below still refuses a
--     mismatched or NULL p_school_id: they may enrol only at the school in
--     their own sms_users.school_id (which is the active school, per 134);
--   * enrolled_by / approved_by are still overwritten with the resolved
--     caller, so the audit trail records the teacher who actually did it;
--   * `tutor` stays out. A tutor is an ARAL volunteer with no enrolment duty,
--     and a staff member who also tutors carries `is_tutor` on their real
--     role rather than logging in as one.
--
-- STAFF_TYPES in lib/requests/auth.ts is deliberately left alone: that roster
-- governs who may work the *requests queue* (approving another school's record
-- request, document requests), which is registrar/school-head work. A teacher
-- enrolling a transferee still opens the outgoing record request — the RPC does
-- that internally — but acting on the queue remains staff-only.
--
-- ---------------------------------------------------------------------------
-- Blast radius
-- ---------------------------------------------------------------------------
--
-- Replaces 1 function. Creates no table, drops nothing, and modifies NO ROWS —
-- there is no DML in this file. Idempotent; re-running is a no-op.
--
-- Reversible by re-running 130's definition of this function verbatim.
-- ============================================================================

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

  -- 130's roster plus 'teacher' — see the header. Tutors are still refused.
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
  'The signed-in staff member''s sms_users.id when they may enrol for p_school_id, else raises. Roster includes teacher (135); tutors and deactivated accounts are refused. NULL for the service role, which authorises upstream.';

GRANT EXECUTE ON FUNCTION procurements.assert_enrollment_staff(BIGINT) TO authenticated, service_role;

-- <<< END 135_allow_teacher_enrollment.sql

-- ============================================================================
-- >>> BEGIN 135_guidance_nurse_accounting_roles.sql
-- ============================================================================

-- ============================================================================
-- ADD "guidance_counselor", "school_nurse" AND "accounting" STAFF ROLES
-- ============================================================================
-- Three non-teaching roles a school already staffs but could not record here,
-- because sms_users.type is CHECK-constrained (001 -> 011 -> 031 -> 067 -> 095
-- -> 102) and the constraint is the only place the legal set is written down.
--
-- This migration ONLY widens that constraint. It grants nothing: every RLS
-- policy in the schema enumerates the roles it admits, and none of them names
-- these three, so a new user lands with exactly the access an unlisted role has
-- always had. What each role sees is decided in the app:
--
--   guidance_counselor -> Anecdotal Record, Learner Cardex, Manifestation
--                         Tagging (AppSidebar + useAdvisoryLearners)
--   school_nurse       -> Learner Health / SF8, and may encode it —
--                         sms_learner_health RLS is plain `authenticated`
--                         (023), so the adviser-only rule is app-layer and is
--                         widened in HealthEntryTable, not here
--   accounting         -> NOTHING. See below.
--
-- ---------------------------------------------------------------------------
-- Accounting is a personnel record, not a login
-- ---------------------------------------------------------------------------
-- Accounting staff belong on the plantilla and in the Division Non-Teaching
-- Personnel report, but this system holds no financial module and learner
-- records are outside their function. The row therefore exists so the school
-- can count and report the person; it must never become an account.
--
-- That rule is enforced in the app (`lib/constants/userTypes.ts` ->
-- LOGIN_DISABLED_USER_TYPES, applied by the OAuth callback and AuthGuard, both
-- of which sign the session straight back out) rather than in SQL, for the same
-- reason the existing `is_active = false` block lives there: sign-in is Google
-- OAuth against Supabase Auth, which knows nothing of sms_users.type, so there
-- is no database seam to refuse it at. Widening this constraint is what makes
-- the value storable; it is not what makes it safe.
-- ============================================================================

SET search_path TO procurements, public;

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
    'librarian',
    'tutor',
    'guidance_counselor',
    'school_nurse',
    'accounting'
  ));

COMMENT ON COLUMN procurements.sms_users.type IS
  'Staff role. Legal values are fixed by sms_users_type_check; labels and login '
  'rules live in lib/constants/userTypes.ts. ''accounting'' is a personnel '
  'record only and is refused at sign-in by the app.';

-- <<< END 135_guidance_nurse_accounting_roles.sql

-- ============================================================================
-- >>> BEGIN 136_als_section_type.sql
-- ============================================================================

-- ============================================================================
-- ALS SECTION TYPE + ALS SUBJECT / ALS SECTION PAIRING
-- ============================================================================
-- 1. Widens 008's section_type CHECK to admit 'als'.
-- 2. Enforces the pairing an ALS class actually has on paper: an ALS subject
--    (133's program = 'als') belongs in an ALS section and nowhere else, and an
--    ALS section carries ALS subjects and nothing else.
--
-- The rule is enforced on sms_subject_schedules because that is the only place
-- a subject is attached to a section — there is no section↔subject table. It is
-- a trigger rather than a CHECK because the two sides live in different tables.
--
-- Nothing existing can violate it: 'als' is not a legal section_type before
-- this migration, so no section is one, and no schedule row can already pair
-- the two wrongly. Existing rows are neither rewritten nor re-validated.
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- WIDEN section_type
-- ============================================================================
-- Same constraint name and same drop-then-add shape as 008, so re-running is
-- safe. Nothing is normalised away this time: the set only grows.
ALTER TABLE procurements.sms_sections
  DROP CONSTRAINT IF EXISTS sms_sections_section_type_check;

ALTER TABLE procurements.sms_sections
  ADD CONSTRAINT sms_sections_section_type_check CHECK (
    section_type IS NULL OR section_type IN (
      'heterogeneous',
      'homogeneous_fast_learner',
      'homogeneous_crack_section',
      'homogeneous_random',
      'als'
    )
  );

COMMENT ON COLUMN procurements.sms_sections.section_type IS
  'Section type: heterogeneous, homogeneous_fast_learner, homogeneous_crack_section, homogeneous_random, or als. An als section may only be scheduled with subjects whose program is als (migration 136).';

-- ============================================================================
-- ALS SUBJECT ⟺ ALS SECTION
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.check_als_program_section_match()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_program      TEXT;
  v_subject      TEXT;
  v_section_type TEXT;
  v_section      TEXT;
BEGIN
  SELECT COALESCE(s.program, 'regular'), s.code || ' - ' || s.name
    INTO v_program, v_subject
    FROM procurements.sms_subjects s
   WHERE s.id = NEW.subject_id;

  SELECT sec.section_type, sec.name
    INTO v_section_type, v_section
    FROM procurements.sms_sections sec
   WHERE sec.id = NEW.section_id;

  -- Either side missing is not this trigger's business; the FKs cover it.
  IF v_program IS NULL OR v_section IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_program = 'als' AND COALESCE(v_section_type, '') <> 'als' THEN
    RAISE EXCEPTION
      'ALS subject "%" can only be scheduled in an ALS section; "%" is not one.',
      v_subject, v_section
      USING ERRCODE = '23514';
  END IF;

  IF v_program <> 'als' AND COALESCE(v_section_type, '') = 'als' THEN
    RAISE EXCEPTION
      'ALS section "%" can only be scheduled with ALS subjects; "%" is not one.',
      v_section, v_subject
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_als_program_section_match_trigger
  ON procurements.sms_subject_schedules;

CREATE TRIGGER check_als_program_section_match_trigger
  BEFORE INSERT OR UPDATE OF subject_id, section_id
  ON procurements.sms_subject_schedules
  FOR EACH ROW
  EXECUTE FUNCTION procurements.check_als_program_section_match();

-- <<< END 136_als_section_type.sql

-- ============================================================================
-- >>> BEGIN 137_room_dimension_and_section_room.sql
-- ============================================================================

-- ============================================================================
-- ROOM DIMENSION + SECTION CLASSROOM ASSIGNMENT
-- ============================================================================
-- Backs the "Classroom Enrollment and Size" report (/school-reports).
--
-- 1. sms_rooms.dimension — the physical size of the room in metres, written
--    the way a school writes it on paper ("40x30"). TEXT rather than two
--    numeric columns because the value is transcribed from the building
--    inventory as a single figure and is printed back verbatim; the app
--    normalises and validates the shape (lib/utils/roomDimension.ts), per the
--    119/132 precedent of app-validated free text.
--
-- 2. sms_sections.room_id — the classroom a section occupies. Sections had no
--    room until now: a room only ever appeared on a *schedule*
--    (sms_subject_schedules.room_id, migration 004), which answers "where does
--    this subject meet" and not "which classroom is this section's". The
--    report needs the latter, and a section that has no schedules yet still
--    has a classroom.
--
-- Both columns are nullable and nothing is backfilled — every existing room
-- and section keeps working untouched, and a section with no classroom simply
-- prints blank. ON DELETE SET NULL so retiring a room never takes a section
-- with it (the 116 lesson: the delete rule is the part that bites).
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- 1. ROOM DIMENSION
-- ============================================================================
ALTER TABLE procurements.sms_rooms
  ADD COLUMN IF NOT EXISTS dimension TEXT;

COMMENT ON COLUMN procurements.sms_rooms.dimension IS
  'Physical room size in metres as written on paper, e.g. "40 x 30". Free TEXT, shape validated in the app (lib/utils/roomDimension.ts); NULL = not measured. Printed as the Classroom Size column of the Classroom Enrollment and Size report (migration 137).';

-- ============================================================================
-- 2. SECTION → CLASSROOM
-- ============================================================================
ALTER TABLE procurements.sms_sections
  ADD COLUMN IF NOT EXISTS room_id BIGINT;

-- Added separately so re-running is safe whether or not the column already
-- carried the constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sms_sections_room_id_fkey'
      AND conrelid = 'procurements.sms_sections'::regclass
  ) THEN
    ALTER TABLE procurements.sms_sections
      ADD CONSTRAINT sms_sections_room_id_fkey
      FOREIGN KEY (room_id)
      REFERENCES procurements.sms_rooms(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sections_room ON procurements.sms_sections(room_id);

COMMENT ON COLUMN procurements.sms_sections.room_id IS
  'Classroom this section occupies (sms_rooms.id). NULL = none assigned. Distinct from sms_subject_schedules.room_id, which is where one subject meets. Source of the Classroom Size and Capacity columns of the Classroom Enrollment and Size report (migration 137).';

-- <<< END 137_room_dimension_and_section_room.sql

-- ============================================================================
-- >>> BEGIN 138_cross_school_teacher_conflict.sql
-- ============================================================================

-- ============================================================================
-- Migration 138: Make the teacher double-booking check see every school
-- ============================================================================
--
-- APPLY AFTER 134. Ships with the transfer-handling change in
-- /division/users, /sections and /schedules.
--
-- ---------------------------------------------------------------------------
-- What is wrong today
-- ---------------------------------------------------------------------------
--
-- Since 134 one person can hold posts at several schools, and since forever a
-- teacher who transfers leaves `sms_subject_schedules.teacher_id` rows behind
-- at the old school. Either way the same teacher_id can appear on two schools'
-- timetables in one school year.
--
-- check_schedule_conflicts() (004 -> 037 -> 117) is plain `LANGUAGE plpgsql`,
-- so it runs with the CALLER's rights and its scan of sms_subject_schedules is
-- filtered by 115's RLS. That makes the teacher check answer a different
-- question depending on who is saving:
--
--   school_head / registrar / admin  -> sees only their own school's rows, so
--                                       a genuine "this teacher is already in
--                                       a classroom at the other school at
--                                       10:00" is never detected.
--   division_admin / super admin     -> sits in the full-access branch, sees
--                                       everything, and gets refused with
--                                       "Teacher is already scheduled at this
--                                       time" naming a row that nobody at the
--                                       school can see or explain.
--
-- The room and section checks do not have this problem: a room and a section
-- each belong to exactly one school, so they can never match across schools.
-- Only teacher_id spans schools.
--
-- ---------------------------------------------------------------------------
-- What changes
-- ---------------------------------------------------------------------------
--
--   1. SECURITY DEFINER (with a pinned search_path), so the answer no longer
--      depends on the role of whoever pressed Save. A real double-booking is
--      caught for everyone, or for no one -- not "for division staff only".
--
--   2. When the clash is at another school the message SAYS so and names it,
--      because otherwise the encoder is being refused over a row they are not
--      permitted to look at. Deliberately semicolon-free: the client splits
--      the exception text on ';' (parseDbConflictError).
--
-- Nothing else moves. Room and section keep 117's wording and its Temporary
-- rules exactly: room applies to teacher-less rows in both directions, teacher
-- and section checks fall away when teacher_id IS NULL, and the section scan
-- still ignores Temporary rows. 124's conflict_override still exempts a row
-- before this function is ever called, so an intentional shared slot -- now
-- including a deliberately shared teacher -- remains possible.
--
-- ---------------------------------------------------------------------------
-- Blast radius
-- ---------------------------------------------------------------------------
--
-- Replaces ONE function. No table, column, policy, index or row is touched --
-- there is no DML in this file. Reversible by re-running 117's definition of
-- check_schedule_conflicts (124 replaced only the trigger wrapper, not this).
--
-- It does tighten what school staff may save: an insert/update naming a
-- teacher who already has an overlapping slot at another school in the same
-- school year now raises where it previously passed. That is the bug being
-- fixed, and the encoder can still accept it through the existing
-- "Save anyway" tick, which writes conflict_override. To see how many rows
-- would be affected before applying:
--
--   SELECT a.school_id, b.school_id, a.teacher_id, a.school_year, COUNT(*)
--   FROM procurements.sms_subject_schedules a
--   JOIN procurements.sms_subject_schedules b
--     ON b.teacher_id = a.teacher_id
--    AND b.school_year = a.school_year
--    AND b.id <> a.id
--    AND b.school_id IS DISTINCT FROM a.school_id
--    AND public.days_overlap(a.days_of_week, b.days_of_week)
--    AND public.times_overlap(a.start_time, a.end_time, b.start_time, b.end_time)
--   WHERE a.teacher_id IS NOT NULL
--   GROUP BY 1, 2, 3, 4;
--
-- Those rows are not rejected retroactively -- nothing re-validates existing
-- rows -- but editing one afterwards will surface the clash.
-- ============================================================================

SET search_path TO procurements, public;

CREATE OR REPLACE FUNCTION public.check_schedule_conflicts(
  p_room_id BIGINT,
  p_teacher_id BIGINT,
  p_section_id BIGINT,
  p_days_of_week INTEGER[],
  p_start_time TIME,
  p_end_time TIME,
  p_school_year TEXT,
  p_id BIGINT DEFAULT NULL -- For updates, exclude current record
) RETURNS TABLE(
  conflict_type TEXT,
  conflict_message TEXT
) AS $$
DECLARE
  conflict_count INTEGER;
  v_school_id BIGINT;
  v_other_schools TEXT;
  v_same_school INTEGER;
BEGIN
  -- Check room conflicts. Applies to Temporary rows too: a room is occupied
  -- for that day and time span whether or not a teacher has been named.
  SELECT COUNT(*) INTO conflict_count
  FROM procurements.sms_subject_schedules
  WHERE room_id = p_room_id
    AND school_year = p_school_year
    AND (p_id IS NULL OR id != p_id)
    AND public.days_overlap(days_of_week, p_days_of_week)
    AND public.times_overlap(start_time, end_time, p_start_time, p_end_time);

  IF conflict_count > 0 THEN
    RETURN QUERY SELECT
      'room'::TEXT,
      'Room is already scheduled at this time on one or more selected days'::TEXT;
  END IF;

  -- Teacher and section checks do not apply to a Temporary schedule
  IF p_teacher_id IS NULL THEN
    RETURN;
  END IF;

  -- The school this slot belongs to, read from its section. The row's own
  -- school_id is not a parameter of this function and the signature is kept
  -- as it is, since the trigger and the client both call it positionally.
  SELECT school_id INTO v_school_id
  FROM procurements.sms_sections
  WHERE id = p_section_id;

  -- Check teacher conflicts, split by where the clashing slot sits.
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE s.school_id IS NOT DISTINCT FROM v_school_id),
    string_agg(DISTINCT sc.name, ', ')
      FILTER (WHERE s.school_id IS DISTINCT FROM v_school_id)
  INTO conflict_count, v_same_school, v_other_schools
  FROM procurements.sms_subject_schedules s
  LEFT JOIN procurements.sms_schools sc ON sc.id = s.school_id
  WHERE s.teacher_id = p_teacher_id
    AND s.school_year = p_school_year
    AND (p_id IS NULL OR s.id != p_id)
    AND public.days_overlap(s.days_of_week, p_days_of_week)
    AND public.times_overlap(s.start_time, s.end_time, p_start_time, p_end_time);

  IF v_same_school > 0 THEN
    RETURN QUERY SELECT
      'teacher'::TEXT,
      'Teacher is already scheduled at this time on one or more selected days'::TEXT;
  END IF;

  -- Named, because the encoder cannot see the row they are being refused over
  IF conflict_count > v_same_school THEN
    RETURN QUERY SELECT
      'teacher'::TEXT,
      format(
        'Teacher is already scheduled at this time at another school (%s) on one or more selected days. They are assigned to more than one school -- confirm with that school before saving anyway',
        COALESCE(v_other_schools, 'unnamed school')
      )::TEXT;
  END IF;

  -- Check section conflicts. Existing Temporary rows are ignored here: the
  -- section timetable is not settled until their teachers are assigned.
  SELECT COUNT(*) INTO conflict_count
  FROM procurements.sms_subject_schedules
  WHERE section_id = p_section_id
    AND school_year = p_school_year
    AND (p_id IS NULL OR id != p_id)
    AND teacher_id IS NOT NULL
    AND public.days_overlap(days_of_week, p_days_of_week)
    AND public.times_overlap(start_time, end_time, p_start_time, p_end_time);

  IF conflict_count > 0 THEN
    RETURN QUERY SELECT
      'section'::TEXT,
      'Section is already scheduled at this time on one or more selected days'::TEXT;
  END IF;

  -- No conflicts found
  RETURN;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = procurements, public;

COMMENT ON FUNCTION public.check_schedule_conflicts(
  BIGINT, BIGINT, BIGINT, INTEGER[], TIME, TIME, TEXT, BIGINT
) IS
  'Reports room / teacher / section clashes for a candidate slot. SECURITY DEFINER since 138: a teacher can hold posts at several schools (134), and under the caller''s own RLS the teacher check saw only the caller''s school -- so the same slot was rejected for division staff and accepted for school staff. Room and section cannot cross schools. Enforcement lives in check_schedule_conflicts_trigger, which 124 exempts for conflict_override rows.';

-- ----------------------------------------------------------------------------
-- Verification
-- ----------------------------------------------------------------------------
-- Should report prosecdef = true and the pinned search_path
SELECT p.proname, p.prosecdef, p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'check_schedule_conflicts';

-- <<< END 138_cross_school_teacher_conflict.sql

-- ============================================================================
-- >>> BEGIN 139_volunteer_teacher_role.sql
-- ============================================================================

-- ============================================================================
-- Migration 139: the "volunteer_teacher" role
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
  'True when the signed-in staff member may write an enrollment row owned by p_school_id. Division-level roles write anywhere; everyone else only their own school. A volunteer_teacher (139) is refused outright. NULL p_school_id is division-only.';

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
  'The signed-in staff member''s sms_users.id when they may enrol for p_school_id, else raises. Roster includes teacher (135); volunteer_teacher (139), tutors and deactivated accounts are refused. NULL for the service role, which authorises upstream.';

GRANT EXECUTE ON FUNCTION procurements.assert_enrollment_staff(BIGINT) TO authenticated, service_role;

-- <<< END 139_volunteer_teacher_role.sql

-- ============================================================================
-- >>> BEGIN 140_division_enrollment_actual.sql
-- ============================================================================

-- ============================================================================
-- 140. Division Enrollment report — live figures, no submission required
-- ============================================================================
--
-- WHY
-- ---
-- `/division/reports/enrollment` reads `division_enrollment_summary` (072/075),
-- which LEFT JOINs `sms_report_enrollment_rows` through a
-- `sms_division_report_submissions` header. Every school with no submission
-- therefore renders a single -99 row of zeroes — the division office sees a
-- wall of "Not submitted / 0 / 0 / 0" even though the learners are already
-- enrolled and countable in `sms_enrollments`.
--
-- This adds a sibling RPC that derives the same shape straight from the
-- operational tables, so the division sees real male/female figures the moment
-- a school enrols, and the submission becomes a formality rather than a
-- precondition for seeing the data.
--
-- WHAT IT IS *NOT*
-- ----------------
-- Only the "Enrollment (Total)" category at modality "All" is derivable — that
-- is exactly the one combination 072's `enrollment_autofill` supports on the
-- school side, because nothing in the operational schema records learning
-- modality, 4Ps membership, or balik-aral. Transfer in/out, dropout, promotee,
-- repeater, balik-aral and 4Ps are still school-keyed numbers and keep going
-- through `division_enrollment_summary`. The page picks the RPC per category.
--
-- The submission `status` is still returned, so the division can see who has
-- and has not filed the DepEd form alongside the live count. Nothing here
-- writes to a submission, and nothing is snapshot.
--
-- MATCHING THE SCHOOL SIDE
-- ------------------------
-- The lifecycle roster is copied verbatim from `enrollment_autofill`
-- ('active','completed','promoted','retained','graduated') and, per migration
-- 109's lesson, filters on `enrollment_status` (lifecycle) and NOT on `status`
-- (the approval workflow). If the two ever diverge, a school's own autofill
-- would disagree with what the division sees for that same school, which is
-- worse than either roster on its own.
--
-- ONE DIFFERENCE, DELIBERATE: SHS semesters.
-- `enrollment_autofill` matches `p_semester IS NULL AND e.semester IS NULL`,
-- and the page passes NULL — so SHS rows, which always carry a semester
-- (EnrollmentWizard sets 1/2 for grades 11-12 and NULL below), are dropped
-- entirely. A division-wide report that silently omits every Grade 11-12
-- learner is not usable, so here `p_semester IS NULL` means *all semesters*,
-- with the learner collapsed per (school, grade) so a learner enrolled in both
-- semesters is counted once. Same collapse migration 118 applies for the KPIs.
--
-- Additive: one new function, no DML, no schema change, existing RPC untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.division_enrollment_actual(
  p_school_year TEXT,
  p_semester SMALLINT DEFAULT NULL,
  p_school_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  school_type TEXT,
  grade_level INT,
  male INT,
  female INT,
  total INT,
  status TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  WITH scoped AS (
    SELECT
      s.id            AS school_id,
      s.name          AS school_name,
      s.school_type,
      COALESCE(sub.status, 'missing') AS status
    FROM procurements.sms_schools s
    LEFT JOIN procurements.sms_division_report_submissions sub
      ON sub.school_id = s.id
      AND sub.school_year = p_school_year
      AND sub.report_type = 'enrollment'
      AND (
        (p_semester IS NULL AND sub.semester IS NULL)
        OR sub.semester = p_semester
      )
    WHERE s.is_active
      AND (p_school_type IS NULL OR s.school_type = p_school_type)
  ),
  -- DISTINCT collapses the two SHS semester rows of one learner into one head.
  learners AS (
    SELECT DISTINCT
      e.school_id,
      e.grade_level,
      e.student_id,
      st.gender
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_students st ON st.id = e.student_id
    WHERE e.school_year = p_school_year
      AND (p_semester IS NULL OR e.semester = p_semester)
      AND e.enrollment_status IN (
        'active', 'completed', 'promoted', 'retained', 'graduated'
      )
  ),
  live AS (
    SELECT
      l.school_id,
      l.grade_level,
      COUNT(*) FILTER (WHERE l.gender = 'male')::int   AS male,
      COUNT(*) FILTER (WHERE l.gender = 'female')::int AS female
    FROM learners l
    GROUP BY l.school_id, l.grade_level
  )
  SELECT
    sc.school_id,
    sc.school_name,
    sc.school_type,
    -- -99 is 072's "this school has no rows" sentinel; the UI skips it.
    COALESCE(live.grade_level, -99)                        AS grade_level,
    COALESCE(live.male, 0)                                 AS male,
    COALESCE(live.female, 0)                               AS female,
    COALESCE(live.male, 0) + COALESCE(live.female, 0)      AS total,
    sc.status
  FROM scoped sc
  LEFT JOIN live ON live.school_id = sc.school_id
  -- Ordinal, not the name: `grade_level` is also a RETURNS TABLE parameter.
  ORDER BY sc.school_name, 4;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_enrollment_actual(TEXT, SMALLINT, TEXT)
  TO authenticated;

COMMENT ON FUNCTION procurements.division_enrollment_actual(TEXT, SMALLINT, TEXT) IS
  'Live per-school/per-grade enrollment by sex, derived from sms_enrollments. '
  'Same result shape as division_enrollment_summary but needs no school '
  'submission; status still reports the DepEd form submission state.';

-- <<< END 140_division_enrollment_actual.sql

-- ============================================================================
-- >>> BEGIN 141_public_enrollment_counts.sql
-- ============================================================================

-- ============================================================================
-- 141. Public landing pages — server-side enrollment aggregate
-- ============================================================================
--
-- WHY
-- ---
-- `/learners` and the landing home page both aggregate enrollment in the
-- browser: they `select` every approved enrollment row in the division for a
-- school year and count them in JavaScript. Three things are wrong with that,
-- and together they are why the published figures drift from reality:
--
--   1. STALE / TRUNCATED. PostgREST caps a collection response (Supabase's
--      default `max-rows` is 1000). Past that cap the pages count only the
--      first page of rows and show no error, so every learner enrolled after
--      the cap is invisible — the numbers stop moving while enrolment carries
--      on. Aggregating in SQL makes the response one row per school+grade.
--
--   2. WRONG POPULATION. Both pages filter `status = 'approved'` — the
--      *approval workflow* — and never look at `enrollment_status`, the
--      *lifecycle*. A learner who transferred out, dropped or is mid-transfer
--      keeps their approved row and is still counted. This is migration 109's
--      bug in the opposite direction, and it only ever inflates.
--
--   3. SHS DOUBLE COUNT. Grades 11-12 carry one enrollment row per semester
--      (EnrollmentWizard sets 1/2 for SHS, NULL below), so an SHS learner is
--      counted twice. Collapsed here per (school, grade, learner), as
--      migration 118 does for the KPIs.
--
-- The lifecycle roster is copied verbatim from 072's `enrollment_autofill`
-- ('active','completed','promoted','retained','graduated') so the public
-- figure, the school's own autofill and 140's division report all agree.
--
-- ALSO
-- ----
-- Migration 015's header claims "Enrollment stats use a SECURITY DEFINER
-- function to avoid exposing raw data" — no such function was ever written,
-- and the landing pages read raw `sms_enrollments` and `sms_students` rows
-- instead. This is that function, ~14 months late. Note it does not by itself
-- close the hole: 015's `sms_students` anon policy is still `USING (true)`,
-- i.e. the whole learner table is readable by anyone holding the anon key.
-- Narrowing it is a separate, deliberate change — the student portal and the
-- public request forms read that table too.
--
-- Test schools 9 and 10 are excluded here, matching the client-side exclusion
-- in `lib/constants/landing.ts`. Two places state the same fact; the honest
-- fix is an `is_test` flag on `sms_schools`, which needs an UPDATE against
-- production and so is left for you to decide on.
--
-- Additive: one new function, no DML, no schema change, no policy touched.
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.public_enrollment_counts(
  p_school_year TEXT
)
RETURNS TABLE (
  school_id BIGINT,
  grade_level INT,
  male INT,
  female INT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = procurements, public
AS $$
  -- DISTINCT collapses an SHS learner's two semester rows into one head.
  WITH learners AS (
    SELECT DISTINCT
      e.school_id,
      e.grade_level,
      e.student_id,
      st.gender
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_students st ON st.id = e.student_id
    WHERE e.school_year = p_school_year
      AND e.school_id IS NOT NULL
      AND e.enrollment_status IN (
        'active', 'completed', 'promoted', 'retained', 'graduated'
      )
  )
  SELECT
    l.school_id,
    l.grade_level,
    COUNT(*) FILTER (WHERE l.gender = 'male')::int   AS male,
    COUNT(*) FILTER (WHERE l.gender = 'female')::int AS female
  FROM learners l
  JOIN procurements.sms_schools s ON s.id = l.school_id
  WHERE s.is_active
    AND s.id NOT IN (9, 10)   -- test schools, never shown publicly
  GROUP BY l.school_id, l.grade_level
  ORDER BY l.school_id, l.grade_level;
$$;

GRANT EXECUTE ON FUNCTION procurements.public_enrollment_counts(TEXT)
  TO anon, authenticated;

COMMENT ON FUNCTION procurements.public_enrollment_counts(TEXT) IS
  'Per-school, per-grade learner counts by sex for the public landing pages. '
  'Aggregated server-side so the response is not subject to the PostgREST row '
  'cap; filters on enrollment_status (lifecycle), collapses SHS semester rows, '
  'and excludes inactive and test schools.';

-- <<< END 141_public_enrollment_counts.sql

-- ============================================================================
-- >>> BEGIN 142_public_enrollment_counts_by_school.sql
-- ============================================================================

-- ============================================================================
-- 142. public_enrollment_counts — optional single-school scope
-- ============================================================================
--
-- WHY
-- ---
-- 141 excludes the two Dev schools (ids 9, 10) unconditionally, which is right
-- for anything that lists or totals schools — the landing home page, /learners,
-- the school list — but wrong for `/schools/[slug]`, where someone has named
-- one school and asked for its figures. Since 141 those two pages render zero
-- enrolment, which makes the Dev schools useless for testing the public pages.
--
-- The distinction is aggregate vs. lookup, not public vs. private: a test
-- school must never inflate a division figure or appear in a list it was not
-- asked for, but a page reached by its own slug is already a deliberate
-- request for that one school. So the exclusion now applies only when no
-- school was named.
--
-- WHY A DROP
-- ----------
-- `p_school_id` cannot simply be added with a DEFAULT: Postgres would then
-- hold two overloads, `(TEXT)` and `(TEXT, BIGINT)`, and a one-argument call
-- would be ambiguous and fail. The one-arg form has to go first. This is the
-- same drop-then-create shape migration 075 used on division_enrollment_summary.
--
-- WHAT THIS DROP AFFECTS: one function created by migration 141, holding no
-- data. No table, column, policy or row is touched. If 141 has not been
-- applied, the DROP is a no-op and this migration still lands correctly.
--
-- Callers passing only p_school_year are unaffected — same name, same result
-- shape, same exclusion.
-- ============================================================================

DROP FUNCTION IF EXISTS procurements.public_enrollment_counts(TEXT);

CREATE OR REPLACE FUNCTION procurements.public_enrollment_counts(
  p_school_year TEXT,
  p_school_id BIGINT DEFAULT NULL
)
RETURNS TABLE (
  school_id BIGINT,
  grade_level INT,
  male INT,
  female INT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = procurements, public
AS $$
  -- DISTINCT collapses an SHS learner's two semester rows into one head.
  WITH learners AS (
    SELECT DISTINCT
      e.school_id,
      e.grade_level,
      e.student_id,
      st.gender
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_students st ON st.id = e.student_id
    WHERE e.school_year = p_school_year
      AND e.school_id IS NOT NULL
      AND e.enrollment_status IN (
        'active', 'completed', 'promoted', 'retained', 'graduated'
      )
  )
  SELECT
    l.school_id,
    l.grade_level,
    COUNT(*) FILTER (WHERE l.gender = 'male')::int   AS male,
    COUNT(*) FILTER (WHERE l.gender = 'female')::int AS female
  FROM learners l
  JOIN procurements.sms_schools s ON s.id = l.school_id
  WHERE s.is_active
    -- Named school: return it, whatever it is.
    AND (p_school_id IS NULL OR s.id = p_school_id)
    -- No school named: this is an aggregate, so the test schools stay out.
    AND (p_school_id IS NOT NULL OR s.id NOT IN (9, 10))
  GROUP BY l.school_id, l.grade_level
  ORDER BY l.school_id, l.grade_level;
$$;

GRANT EXECUTE ON FUNCTION procurements.public_enrollment_counts(TEXT, BIGINT)
  TO anon, authenticated;

COMMENT ON FUNCTION procurements.public_enrollment_counts(TEXT, BIGINT) IS
  'Per-school, per-grade learner counts by sex for the public landing pages. '
  'Aggregated server-side so the response is not subject to the PostgREST row '
  'cap; filters on enrollment_status (lifecycle), collapses SHS semester rows, '
  'and excludes inactive schools. Test schools are excluded only when '
  'p_school_id is NULL, i.e. from aggregates and listings but not from a '
  'school''s own page.';

-- <<< END 142_public_enrollment_counts_by_school.sql

-- ============================================================================
-- >>> BEGIN 143_enrollment_autofill_shs_semesters.sql
-- ============================================================================

-- ============================================================================
-- 143. enrollment_autofill — stop dropping every SHS learner
-- ============================================================================
--
-- WHY
-- ---
-- 072's autofill matches the semester like this:
--
--     AND ((p_semester IS NULL AND e.semester IS NULL) OR e.semester = p_semester)
--
-- and the school-side submission page calls it with `p_semester: null` in
-- every case. EnrollmentWizard writes a semester (1 or 2) for grades 11-12 and
-- NULL below, so `e.semester IS NULL` is false for every SHS row and the
-- clause silently discards them. A senior high school pressing "Autofill"
-- gets zeroes on the only two grades it teaches, with no error — and the
-- submission form has had rows for grades 11 and 12 the whole time.
--
-- Passing an explicit p_semester was never a workaround either: no caller
-- does, and it would then report one semester's roll rather than the school's
-- enrolment.
--
-- WHAT CHANGES
-- ------------
-- `p_semester IS NULL` now means "every semester" rather than "only rows with
-- no semester", and a learner is collapsed per (grade, learner) so someone
-- enrolled in both semesters is counted once — the same collapse migration 118
-- applies to the KPIs and 140/141 apply to the division and public figures.
-- Passing a specific p_semester still selects exactly that semester.
--
-- This is the third and last place the SHS drop had to be fixed; 140 and 141
-- worked around it rather than through it, because those functions are new and
-- this one is called from a page schools use.
--
-- EFFECT ON EXISTING DATA: none. This function only ever prefills a draft form
-- in the browser; it writes nothing. Submissions already filed keep whatever
-- figures the school typed, including any SHS numbers entered by hand — this
-- does not revisit or rewrite them. What changes is that the next press of
-- "Autofill" returns grades 11-12 instead of nothing.
--
-- Signature and result shape are unchanged, so this is a plain CREATE OR
-- REPLACE with no DROP and no dependent object to rebuild.
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.enrollment_autofill(
  p_school_id BIGINT,
  p_school_year TEXT,
  p_semester SMALLINT
)
RETURNS TABLE (
  grade_level INT,
  male INT,
  female INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  -- DISTINCT collapses an SHS learner's two semester rows into one head.
  WITH learners AS (
    SELECT DISTINCT
      e.grade_level,
      e.student_id,
      s.gender
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_students s ON s.id = e.student_id
    WHERE e.school_id = p_school_id
      AND e.school_year = p_school_year
      AND (p_semester IS NULL OR e.semester = p_semester)
      AND e.enrollment_status IN (
        'active', 'completed', 'promoted', 'retained', 'graduated'
      )
  )
  SELECT
    l.grade_level,
    COUNT(*) FILTER (WHERE l.gender = 'male')::int   AS male,
    COUNT(*) FILTER (WHERE l.gender = 'female')::int AS female
  FROM learners l
  GROUP BY l.grade_level
  ORDER BY l.grade_level;
$$;

COMMENT ON FUNCTION procurements.enrollment_autofill(BIGINT, TEXT, SMALLINT) IS
  'Live per-grade learner counts by sex for one school, used to prefill a '
  'division report submission draft and to render the division school page. '
  'A NULL p_semester means every semester, with SHS learners collapsed so a '
  'learner enrolled in both is counted once.';

-- <<< END 143_enrollment_autofill_shs_semesters.sql

-- ============================================================================
-- >>> BEGIN 144_division_enrollment_actual_categories.sql
-- ============================================================================

-- ============================================================================
-- 144. division_enrollment_actual — derive five more categories
-- ============================================================================
--
-- WHY
-- ---
-- 140 derived only "Enrollment (Total)". Five of the remaining seven categories
-- are equally derivable from data the system already keeps, so schools were
-- typing numbers the database could have answered:
--
--   Transfer In   origin_school_id IS NOT NULL
--   Transfer Out  enrollment_status = 'transferred_out'
--   Dropout       enrollment_status = 'dropped'
--   Promotee      enrollment_status = 'promoted'
--   Repeater      same learner, same grade, previous school year
--
-- The first four are lifted verbatim from `lib/pdf/generateSf4.ts`, which has
-- counted them this way since long before the division module existed. That is
-- deliberate: SF4 is the official form the school files for the same figures,
-- so matching it means the division report and the school's own SF4 cannot
-- disagree. Inventing a cleaner definition here would have been the wrong kind
-- of correct.
--
-- Repeater follows migration 118's definition, not SF4's (SF4 has none): a
-- learner enrolled in grade X this year who was also in grade X last year,
-- WITHIN THE SAME SCHOOL. Per 118, a learner repeating after transferring in
-- is therefore not counted here — the previous year's row belongs to another
-- school. That is the correct reading at school scope; the division-wide KPI
-- page catches those.
--
-- STILL NOT DERIVABLE, and left on the submission path:
--   Balik-Aral   no such field on any learner record
--   4Ps          no such field on any learner record
--   any specific modality — learning modality is not stored anywhere
-- The page keeps reading division_enrollment_summary for those three.
--
-- WHY A DROP
-- ----------
-- `p_category` cannot be added with a DEFAULT beside the existing function:
-- Postgres would hold `(TEXT, SMALLINT, TEXT)` and `(TEXT, SMALLINT, TEXT,
-- TEXT)`, and the three-argument call the page already makes would be
-- ambiguous. Same reasoning, and the same shape, as 142 and 075.
--
-- WHAT THIS DROP AFFECTS: one function created by migration 140, holding no
-- data. No table, column, policy or row is touched. Callers that omit
-- p_category still get "Enrollment (Total)" exactly as before.
--
-- Nothing here writes. Submissions already filed are untouched and still
-- readable through division_enrollment_summary.
-- ============================================================================

DROP FUNCTION IF EXISTS procurements.division_enrollment_actual(
  TEXT, SMALLINT, TEXT
);

CREATE OR REPLACE FUNCTION procurements.division_enrollment_actual(
  p_school_year TEXT,
  p_semester    SMALLINT DEFAULT NULL,
  p_school_type TEXT     DEFAULT NULL,
  p_category    TEXT     DEFAULT 'enrollment'
)
RETURNS TABLE (
  school_id   BIGINT,
  school_name TEXT,
  school_type TEXT,
  grade_level INT,
  male        INT,
  female      INT,
  total       INT,
  status      TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = procurements, public
AS $$
  WITH params AS (
    SELECT
      (SPLIT_PART(p_school_year, '-', 1)::INT - 1)::TEXT
        || '-' || SPLIT_PART(p_school_year, '-', 1) AS prev_sy
  ),
  scoped AS (
    SELECT
      s.id   AS school_id,
      s.name AS school_name,
      s.school_type,
      COALESCE(sub.status, 'missing') AS status
    FROM procurements.sms_schools s
    LEFT JOIN procurements.sms_division_report_submissions sub
      ON sub.school_id = s.id
      AND sub.school_year = p_school_year
      AND sub.report_type = 'enrollment'
      AND (
        (p_semester IS NULL AND sub.semester IS NULL)
        OR sub.semester = p_semester
      )
    WHERE s.is_active
      AND (p_school_type IS NULL OR s.school_type = p_school_type)
  ),
  -- Every category except repeater is a straight predicate on this year's
  -- rows. DISTINCT collapses an SHS learner's two semester rows into one head.
  picked AS (
    SELECT DISTINCT e.school_id, e.grade_level, e.student_id
    FROM procurements.sms_enrollments e
    WHERE e.school_year = p_school_year
      AND e.school_id IS NOT NULL
      AND (p_semester IS NULL OR e.semester = p_semester)
      AND CASE p_category
            WHEN 'enrollment' THEN e.enrollment_status IN (
              'active', 'completed', 'promoted', 'retained', 'graduated'
            )
            WHEN 'transfer_in'  THEN e.origin_school_id IS NOT NULL
            WHEN 'transfer_out' THEN e.enrollment_status = 'transferred_out'
            WHEN 'dropout'      THEN e.enrollment_status = 'dropped'
            WHEN 'promotee'     THEN e.enrollment_status = 'promoted'
            ELSE FALSE
          END
  ),
  -- Repeater needs last year's roll, so it cannot be a predicate on one row.
  repeaters AS (
    SELECT DISTINCT cur.school_id, cur.grade_level, cur.student_id
    FROM (
      SELECT DISTINCT e.school_id, e.grade_level, e.student_id
      FROM procurements.sms_enrollments e
      WHERE p_category = 'repeater'
        AND e.school_year = p_school_year
        AND e.school_id IS NOT NULL
        AND (p_semester IS NULL OR e.semester = p_semester)
        AND e.enrollment_status IN (
          'active', 'completed', 'promoted', 'retained', 'graduated'
        )
    ) cur
    JOIN (
      SELECT DISTINCT e.school_id, e.grade_level, e.student_id
      FROM procurements.sms_enrollments e, params
      WHERE p_category = 'repeater'
        AND e.school_year = params.prev_sy
        AND e.school_id IS NOT NULL
    ) prev
      ON  prev.student_id  = cur.student_id
      AND prev.grade_level = cur.grade_level
      AND prev.school_id   = cur.school_id
  ),
  selected AS (
    SELECT p.school_id, p.grade_level, p.student_id
    FROM picked p
    WHERE p_category <> 'repeater'
    UNION ALL
    SELECT r.school_id, r.grade_level, r.student_id
    FROM repeaters r
    WHERE p_category = 'repeater'
  ),
  agg AS (
    SELECT
      sel.school_id,
      sel.grade_level,
      COUNT(*) FILTER (WHERE st.gender = 'male')::int   AS male,
      COUNT(*) FILTER (WHERE st.gender = 'female')::int AS female
    FROM selected sel
    JOIN procurements.sms_students st ON st.id = sel.student_id
    GROUP BY sel.school_id, sel.grade_level
  )
  SELECT
    sc.school_id,
    sc.school_name,
    sc.school_type,
    -- -99 is 072's "this school has no rows" sentinel; the UI skips it.
    COALESCE(agg.grade_level, -99)                    AS grade_level,
    COALESCE(agg.male, 0)                             AS male,
    COALESCE(agg.female, 0)                           AS female,
    COALESCE(agg.male, 0) + COALESCE(agg.female, 0)   AS total,
    sc.status
  FROM scoped sc
  LEFT JOIN agg ON agg.school_id = sc.school_id
  -- Ordinal, not the name: `grade_level` is also a RETURNS TABLE parameter.
  ORDER BY sc.school_name, 4;
$$;

GRANT EXECUTE ON FUNCTION
  procurements.division_enrollment_actual(TEXT, SMALLINT, TEXT, TEXT)
  TO authenticated;

COMMENT ON FUNCTION
  procurements.division_enrollment_actual(TEXT, SMALLINT, TEXT, TEXT) IS
  'Live per-school/per-grade counts by sex for the derivable division report '
  'categories: enrollment, transfer_in, transfer_out, dropout, promotee, '
  'repeater. Definitions match generateSf4.ts, except repeater which follows '
  'migration 118. Balik-Aral, 4Ps and per-modality figures have no operational '
  'source and remain school-submitted.';

-- <<< END 144_division_enrollment_actual_categories.sql

-- ============================================================================
-- >>> BEGIN 145_shs_section_strand.sql
-- ============================================================================

-- ============================================================================
-- 145. SHS strand on the section — Track & Strand and SHS Specialization
--      stop being typed reports
-- ============================================================================
--
-- WHY
-- ---
-- `lib/constants/shs.ts` has held the full DepEd SHS taxonomy since the
-- division module was built — four tracks, thirteen strands, specialization
-- suggestions per strand — but nothing in the operational schema ever recorded
-- which strand a learner is in. `strand` appears in exactly two places: the
-- report row tables, and one free-text column on historical transcripts. The
-- constant is used only BY the report forms. So a school types "STEM: 40 male,
-- 35 female" and the system has no idea which of its learners are STEM.
--
-- This puts the strand where it is actually decided.
--
-- WHY THE SECTION, NOT THE ENROLMENT
-- ----------------------------------
-- A strand is a curriculum, not a label: two strands mean two different subject
-- sets, which mean two different section schedules. An SHS section therefore
-- follows exactly one strand by construction — the same reasoning migration 136
-- used to pair an ALS subject to an ALS section, and for the same reason
-- (schedules are the only place a subject meets a section; there is no
-- section-subject table).
--
-- The live data agrees: across 13 schools teaching SHS, Grade 11-12 learners
-- sit in far more sections than capacity alone would need — one school runs 19
-- sections for 370 learners, averaging 19.5 each. That is strand separation.
--
-- Recording it on the section means a school sets it ONCE per section instead
-- of once per learner, and every learner enrolled into that section inherits
-- it through `sms_enrollments.section_id`, which is NOT NULL.
--
-- TEXT, NOT AN ENUM OR A CHECK, per the 119/132/133 precedent: DepEd revises
-- the strand and specialization lists, and a revision must not invalidate rows
-- already reported. `lib/constants/shs.ts` stays the only place the taxonomy is
-- written down and the app validates against it. TVL specializations in
-- particular are legion and schools may enter their own.
--
-- TRACK IS NOT STORED. It is a function of the strand
-- (`getTrackForStrand` in the same constants file), so storing it would be a
-- second copy that can disagree. The RPC returns the strand; the page resolves
-- the track. A DepEd revision that moves a strand between tracks is then a
-- constants change, not a data migration.
--
-- The CHECK only stops a Grade 7 section carrying a strand; it says nothing
-- about which strand values are legal. No existing row can violate it, since
-- neither column existed before this.
--
-- Additive: two nullable columns, one guard, two new functions. Nothing is
-- backfilled — every existing section reads as "no strand recorded" and the
-- reports fall back to the submitted figures until schools fill it in.
-- ============================================================================

ALTER TABLE procurements.sms_sections
  ADD COLUMN IF NOT EXISTS strand TEXT;

ALTER TABLE procurements.sms_sections
  ADD COLUMN IF NOT EXISTS specialization TEXT;

ALTER TABLE procurements.sms_sections
  DROP CONSTRAINT IF EXISTS sms_sections_strand_shs_only;
ALTER TABLE procurements.sms_sections
  ADD CONSTRAINT sms_sections_strand_shs_only CHECK (
    (strand IS NULL AND specialization IS NULL)
    OR grade_level IN (11, 12)
  );

COMMENT ON COLUMN procurements.sms_sections.strand IS
  'DepEd SHS strand code, validated in lib/constants/shs.ts. Grades 11-12 only. '
  'The track is derived from this, never stored.';
COMMENT ON COLUMN procurements.sms_sections.specialization IS
  'SHS specialization within the strand (mainly TVL). Free text: the DepEd list '
  'is long and schools legitimately add their own.';

-- ---------------------------------------------------------------------------
-- division_track_strand_actual
-- ---------------------------------------------------------------------------
-- Same result shape as division_track_strand_summary (075) MINUS `track`,
-- which the caller resolves from the strand. Sections with no strand recorded
-- are excluded rather than bucketed as "unknown": a school that has not filled
-- them in should read as no live data, not as a strand called blank.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.division_track_strand_actual(
  p_school_year TEXT,
  p_semester    SMALLINT DEFAULT NULL,
  p_grade_level INT      DEFAULT NULL
)
RETURNS TABLE (
  school_id   BIGINT,
  school_name TEXT,
  school_type TEXT,
  strand      TEXT,
  grade_level INT,
  male        INT,
  female      INT,
  total       INT,
  status      TEXT
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
      AND sub.report_type = 'track_strand'
      AND sub.semester = p_semester
    WHERE s.is_active
  ),
  -- DISTINCT collapses an SHS learner's two semester rows into one head.
  learners AS (
    SELECT DISTINCT
      e.school_id,
      sec.strand,
      e.grade_level,
      e.student_id,
      st.gender
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_sections sec ON sec.id = e.section_id
    JOIN procurements.sms_students st  ON st.id = e.student_id
    WHERE e.school_year = p_school_year
      AND e.school_id IS NOT NULL
      AND sec.strand IS NOT NULL
      AND e.grade_level IN (11, 12)
      AND (p_grade_level IS NULL OR e.grade_level = p_grade_level)
      AND (p_semester IS NULL OR e.semester = p_semester)
      AND e.enrollment_status IN (
        'active', 'completed', 'promoted', 'retained', 'graduated'
      )
  ),
  agg AS (
    SELECT
      l.school_id,
      l.strand,
      l.grade_level,
      COUNT(*) FILTER (WHERE l.gender = 'male')::int   AS male,
      COUNT(*) FILTER (WHERE l.gender = 'female')::int AS female
    FROM learners l
    GROUP BY l.school_id, l.strand, l.grade_level
  )
  SELECT
    sc.school_id,
    sc.school_name,
    sc.school_type,
    agg.strand,
    agg.grade_level,
    agg.male,
    agg.female,
    agg.male + agg.female AS total,
    sc.status
  FROM scoped sc
  JOIN agg ON agg.school_id = sc.school_id
  ORDER BY sc.school_name, 4, 5;
$$;

GRANT EXECUTE ON FUNCTION
  procurements.division_track_strand_actual(TEXT, SMALLINT, INT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- division_shs_specialization_actual
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.division_shs_specialization_actual(
  p_school_year TEXT,
  p_semester    SMALLINT DEFAULT NULL,
  p_grade_level INT      DEFAULT NULL,
  p_strand      TEXT     DEFAULT NULL
)
RETURNS TABLE (
  school_id      BIGINT,
  school_name    TEXT,
  school_type    TEXT,
  strand         TEXT,
  specialization TEXT,
  grade_level    INT,
  male           INT,
  female         INT,
  total          INT,
  status         TEXT
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
      AND sub.report_type = 'shs_specialization'
      AND sub.semester = p_semester
    WHERE s.is_active
  ),
  learners AS (
    SELECT DISTINCT
      e.school_id,
      sec.strand,
      sec.specialization,
      e.grade_level,
      e.student_id,
      st.gender
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_sections sec ON sec.id = e.section_id
    JOIN procurements.sms_students st  ON st.id = e.student_id
    WHERE e.school_year = p_school_year
      AND e.school_id IS NOT NULL
      AND sec.strand IS NOT NULL
      AND sec.specialization IS NOT NULL
      AND e.grade_level IN (11, 12)
      AND (p_grade_level IS NULL OR e.grade_level = p_grade_level)
      AND (p_strand IS NULL OR sec.strand = p_strand)
      AND (p_semester IS NULL OR e.semester = p_semester)
      AND e.enrollment_status IN (
        'active', 'completed', 'promoted', 'retained', 'graduated'
      )
  ),
  agg AS (
    SELECT
      l.school_id,
      l.strand,
      l.specialization,
      l.grade_level,
      COUNT(*) FILTER (WHERE l.gender = 'male')::int   AS male,
      COUNT(*) FILTER (WHERE l.gender = 'female')::int AS female
    FROM learners l
    GROUP BY l.school_id, l.strand, l.specialization, l.grade_level
  )
  SELECT
    sc.school_id,
    sc.school_name,
    sc.school_type,
    agg.strand,
    agg.specialization,
    agg.grade_level,
    agg.male,
    agg.female,
    agg.male + agg.female AS total,
    sc.status
  FROM scoped sc
  JOIN agg ON agg.school_id = sc.school_id
  ORDER BY sc.school_name, 4, 5, 6;
$$;

GRANT EXECUTE ON FUNCTION
  procurements.division_shs_specialization_actual(TEXT, SMALLINT, INT, TEXT)
  TO authenticated;

-- <<< END 145_shs_section_strand.sql

-- ============================================================================
-- >>> BEGIN 146_personnel_sex_and_learning_area.sql
-- ============================================================================

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

-- <<< END 146_personnel_sex_and_learning_area.sql

-- ============================================================================
-- >>> BEGIN 147_division_enrollment_actual_fourps.sql
-- ============================================================================

-- ============================================================================
-- 147. division_enrollment_actual — 4Ps is derivable after all
-- ============================================================================
--
-- CORRECTION TO 144
-- -----------------
-- Migration 144's header states "4Ps — no such field on any learner record".
-- That is wrong. `sms_students.is_4ps` has existed since migration 114
-- (BOOLEAN NOT NULL DEFAULT FALSE, added for SF1), and both the Students form
-- and the teacher's edit modal have captured it ever since. 144 excluded the
-- category on a bad search, not on a real limitation.
--
-- So 4Ps joins the derived set and only two of the eight categories still have
-- no operational source:
--
--   Balik-Aral  — genuinely nothing: no returning-learner flag exists
--   modality    — genuinely nothing: learning modality is stored nowhere
--
-- Both re-checked directly against the schema this time.
--
-- WHAT A 4Ps ROW MEANS HERE
-- -------------------------
-- Of the learners on the roll, those whose household is a 4Ps recipient — the
-- enrolled lifecycle roster AND `is_4ps`. It is a property of the learner, not
-- of the enrolment, which is why this is the first category needing
-- `sms_students` in the predicate rather than only in the sex breakdown.
--
-- CAVEAT WORTH KNOWING: `is_4ps` defaults to FALSE and nothing backfills it, so
-- a school that has never ticked the box reports zero 4Ps learners rather than
-- "unknown". The two states are indistinguishable in the data. A school that
-- has been keeping SF1 properly will already have it; one that has not must
-- fill it in on the learner record before this figure means anything.
--
-- WHY NO DROP: same signature as 144, so this is a plain CREATE OR REPLACE.
-- The guarded DROP of 140's three-argument form is repeated from 144 so this
-- migration lands correctly whether or not 144 was applied first — applying
-- 144 afterwards would simply restore the version without 4Ps, so apply them
-- in order.
-- ============================================================================

DROP FUNCTION IF EXISTS procurements.division_enrollment_actual(
  TEXT, SMALLINT, TEXT
);

CREATE OR REPLACE FUNCTION procurements.division_enrollment_actual(
  p_school_year TEXT,
  p_semester    SMALLINT DEFAULT NULL,
  p_school_type TEXT     DEFAULT NULL,
  p_category    TEXT     DEFAULT 'enrollment'
)
RETURNS TABLE (
  school_id   BIGINT,
  school_name TEXT,
  school_type TEXT,
  grade_level INT,
  male        INT,
  female      INT,
  total       INT,
  status      TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = procurements, public
AS $$
  WITH params AS (
    SELECT
      (SPLIT_PART(p_school_year, '-', 1)::INT - 1)::TEXT
        || '-' || SPLIT_PART(p_school_year, '-', 1) AS prev_sy
  ),
  scoped AS (
    SELECT
      s.id   AS school_id,
      s.name AS school_name,
      s.school_type,
      COALESCE(sub.status, 'missing') AS status
    FROM procurements.sms_schools s
    LEFT JOIN procurements.sms_division_report_submissions sub
      ON sub.school_id = s.id
      AND sub.school_year = p_school_year
      AND sub.report_type = 'enrollment'
      AND (
        (p_semester IS NULL AND sub.semester IS NULL)
        OR sub.semester = p_semester
      )
    WHERE s.is_active
      AND (p_school_type IS NULL OR s.school_type = p_school_type)
  ),
  -- Every category except repeater is a predicate on this year's rows.
  -- DISTINCT collapses an SHS learner's two semester rows into one head.
  -- sms_students is joined here, not only in the aggregate, because 4Ps is a
  -- property of the learner rather than of the enrolment.
  picked AS (
    SELECT DISTINCT e.school_id, e.grade_level, e.student_id, st.gender
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_students st ON st.id = e.student_id
    WHERE e.school_year = p_school_year
      AND e.school_id IS NOT NULL
      AND (p_semester IS NULL OR e.semester = p_semester)
      AND CASE p_category
            WHEN 'enrollment' THEN e.enrollment_status IN (
              'active', 'completed', 'promoted', 'retained', 'graduated'
            )
            WHEN 'transfer_in'  THEN e.origin_school_id IS NOT NULL
            WHEN 'transfer_out' THEN e.enrollment_status = 'transferred_out'
            WHEN 'dropout'      THEN e.enrollment_status = 'dropped'
            WHEN 'promotee'     THEN e.enrollment_status = 'promoted'
            WHEN 'fourps'       THEN st.is_4ps AND e.enrollment_status IN (
              'active', 'completed', 'promoted', 'retained', 'graduated'
            )
            ELSE FALSE
          END
  ),
  -- Repeater needs last year's roll, so it cannot be a predicate on one row.
  repeaters AS (
    SELECT DISTINCT cur.school_id, cur.grade_level, cur.student_id, cur.gender
    FROM (
      SELECT DISTINCT e.school_id, e.grade_level, e.student_id, st.gender
      FROM procurements.sms_enrollments e
      JOIN procurements.sms_students st ON st.id = e.student_id
      WHERE p_category = 'repeater'
        AND e.school_year = p_school_year
        AND e.school_id IS NOT NULL
        AND (p_semester IS NULL OR e.semester = p_semester)
        AND e.enrollment_status IN (
          'active', 'completed', 'promoted', 'retained', 'graduated'
        )
    ) cur
    JOIN (
      SELECT DISTINCT e.school_id, e.grade_level, e.student_id
      FROM procurements.sms_enrollments e, params
      WHERE p_category = 'repeater'
        AND e.school_year = params.prev_sy
        AND e.school_id IS NOT NULL
    ) prev
      ON  prev.student_id  = cur.student_id
      AND prev.grade_level = cur.grade_level
      AND prev.school_id   = cur.school_id
  ),
  selected AS (
    SELECT p.school_id, p.grade_level, p.gender
    FROM picked p
    WHERE p_category <> 'repeater'
    UNION ALL
    SELECT r.school_id, r.grade_level, r.gender
    FROM repeaters r
    WHERE p_category = 'repeater'
  ),
  agg AS (
    SELECT
      sel.school_id,
      sel.grade_level,
      COUNT(*) FILTER (WHERE sel.gender = 'male')::int   AS male,
      COUNT(*) FILTER (WHERE sel.gender = 'female')::int AS female
    FROM selected sel
    GROUP BY sel.school_id, sel.grade_level
  )
  SELECT
    sc.school_id,
    sc.school_name,
    sc.school_type,
    -- -99 is 072's "this school has no rows" sentinel; the UI skips it.
    COALESCE(agg.grade_level, -99)                    AS grade_level,
    COALESCE(agg.male, 0)                             AS male,
    COALESCE(agg.female, 0)                           AS female,
    COALESCE(agg.male, 0) + COALESCE(agg.female, 0)   AS total,
    sc.status
  FROM scoped sc
  LEFT JOIN agg ON agg.school_id = sc.school_id
  -- Ordinal, not the name: `grade_level` is also a RETURNS TABLE parameter.
  ORDER BY sc.school_name, 4;
$$;

GRANT EXECUTE ON FUNCTION
  procurements.division_enrollment_actual(TEXT, SMALLINT, TEXT, TEXT)
  TO authenticated;

COMMENT ON FUNCTION
  procurements.division_enrollment_actual(TEXT, SMALLINT, TEXT, TEXT) IS
  'Live per-school/per-grade counts by sex for the derivable division report '
  'categories: enrollment, transfer_in, transfer_out, dropout, promotee, '
  'repeater, fourps. Definitions match generateSf4.ts, except repeater which '
  'follows migration 118 and fourps which reads sms_students.is_4ps (114). '
  'Balik-Aral and per-modality figures have no operational source and remain '
  'school-submitted.';

-- <<< END 147_division_enrollment_actual_fourps.sql

-- ============================================================================
-- >>> BEGIN 148_enrollment_balik_aral.sql
-- ============================================================================

-- ============================================================================
-- 148. Balik-Aral on the enrolment — the last derivable division category
-- ============================================================================
--
-- WHY THE ENROLMENT, NOT THE LEARNER
-- ----------------------------------
-- Balik-Aral describes how a learner ARRIVED in a given school year: someone
-- returning to formal school after a year or more out. It is true of one
-- enrolment, not of a person. Put it on `sms_students` and the learner stays
-- flagged for life, so next year's report would count them again — wrong, and
-- silently so. `origin_school_id` sits on the enrolment for the same reason.
--
-- WHY NOT DERIVE IT
-- -----------------
-- It is *nearly* derivable — a learner enrolled this year with no enrolment
-- last year but with history in an earlier year is by definition returning.
-- Two things make that a guess rather than a fact here: SY 2025-2026 holds
-- 1,809 enrolment rows against this year's ~11,900, so the history is far too
-- thin to read an absence as meaningful; and a learner returning from a school
-- outside this system is indistinguishable from one who was simply never
-- encoded. A recorded field is honest where that inference would not be.
--
-- DEFAULT FALSE, DELIBERATELY — AND THE LIMIT OF THAT
-- --------------------------------------------------
-- Unlike modality, where any value is plausible, the overwhelming majority of
-- enrolments genuinely are not Balik-Aral, so FALSE is a true default rather
-- than a stand-in for "not asked". Note this is exactly the trap migration
-- 114's `is_4ps` fell into: it defaults FALSE and only 287 of 12,224 learners
-- are flagged, because the default made "no" and "nobody asked" identical.
-- The difference is that the wizard now puts this question in front of the
-- enroller at the moment of enrolment, which is the fix 114 never got.
--
-- Additive: one nullable-safe column with a default, plus the RPC gaining the
-- category. No row is modified and no existing count moves — nothing reads
-- this column until a school ticks it.
-- ============================================================================

ALTER TABLE procurements.sms_enrollments
  ADD COLUMN IF NOT EXISTS is_balik_aral BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN procurements.sms_enrollments.is_balik_aral IS
  'Learner returned to formal school after a year or more out, for THIS '
  'enrolment. Per enrolment, not per learner: the same learner is an ordinary '
  'enrolment the following year.';

CREATE INDEX IF NOT EXISTS idx_sms_enrollments_balik_aral
  ON procurements.sms_enrollments (school_year, school_id)
  WHERE is_balik_aral;

-- ---------------------------------------------------------------------------
-- division_enrollment_actual — add 'balik_aral'
-- ---------------------------------------------------------------------------
-- Full redefinition of 147's function with one more CASE branch. Same
-- signature, so a plain CREATE OR REPLACE; the guarded DROP of 140's
-- three-argument form is repeated so this lands whether or not 144/147 were
-- applied first. Apply 144 -> 147 -> 148 in order.
--
-- After this, `modality` is the ONLY thing on the enrollment report with no
-- operational source. Nothing anywhere records a learning modality, and
-- whether that is worth capturing is a question about whether the division
-- still acts on it, not a technical one.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS procurements.division_enrollment_actual(
  TEXT, SMALLINT, TEXT
);

CREATE OR REPLACE FUNCTION procurements.division_enrollment_actual(
  p_school_year TEXT,
  p_semester    SMALLINT DEFAULT NULL,
  p_school_type TEXT     DEFAULT NULL,
  p_category    TEXT     DEFAULT 'enrollment'
)
RETURNS TABLE (
  school_id   BIGINT,
  school_name TEXT,
  school_type TEXT,
  grade_level INT,
  male        INT,
  female      INT,
  total       INT,
  status      TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = procurements, public
AS $$
  WITH params AS (
    SELECT
      (SPLIT_PART(p_school_year, '-', 1)::INT - 1)::TEXT
        || '-' || SPLIT_PART(p_school_year, '-', 1) AS prev_sy
  ),
  scoped AS (
    SELECT
      s.id   AS school_id,
      s.name AS school_name,
      s.school_type,
      COALESCE(sub.status, 'missing') AS status
    FROM procurements.sms_schools s
    LEFT JOIN procurements.sms_division_report_submissions sub
      ON sub.school_id = s.id
      AND sub.school_year = p_school_year
      AND sub.report_type = 'enrollment'
      AND (
        (p_semester IS NULL AND sub.semester IS NULL)
        OR sub.semester = p_semester
      )
    WHERE s.is_active
      AND (p_school_type IS NULL OR s.school_type = p_school_type)
  ),
  -- Every category except repeater is a predicate on this year's rows.
  -- DISTINCT collapses an SHS learner's two semester rows into one head.
  picked AS (
    SELECT DISTINCT e.school_id, e.grade_level, e.student_id, st.gender
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_students st ON st.id = e.student_id
    WHERE e.school_year = p_school_year
      AND e.school_id IS NOT NULL
      AND (p_semester IS NULL OR e.semester = p_semester)
      AND CASE p_category
            WHEN 'enrollment' THEN e.enrollment_status IN (
              'active', 'completed', 'promoted', 'retained', 'graduated'
            )
            WHEN 'transfer_in'  THEN e.origin_school_id IS NOT NULL
            WHEN 'transfer_out' THEN e.enrollment_status = 'transferred_out'
            WHEN 'dropout'      THEN e.enrollment_status = 'dropped'
            WHEN 'promotee'     THEN e.enrollment_status = 'promoted'
            WHEN 'fourps'       THEN st.is_4ps AND e.enrollment_status IN (
              'active', 'completed', 'promoted', 'retained', 'graduated'
            )
            WHEN 'balik_aral'   THEN e.is_balik_aral AND e.enrollment_status IN (
              'active', 'completed', 'promoted', 'retained', 'graduated'
            )
            ELSE FALSE
          END
  ),
  -- Repeater needs last year's roll, so it cannot be a predicate on one row.
  repeaters AS (
    SELECT DISTINCT cur.school_id, cur.grade_level, cur.student_id, cur.gender
    FROM (
      SELECT DISTINCT e.school_id, e.grade_level, e.student_id, st.gender
      FROM procurements.sms_enrollments e
      JOIN procurements.sms_students st ON st.id = e.student_id
      WHERE p_category = 'repeater'
        AND e.school_year = p_school_year
        AND e.school_id IS NOT NULL
        AND (p_semester IS NULL OR e.semester = p_semester)
        AND e.enrollment_status IN (
          'active', 'completed', 'promoted', 'retained', 'graduated'
        )
    ) cur
    JOIN (
      SELECT DISTINCT e.school_id, e.grade_level, e.student_id
      FROM procurements.sms_enrollments e, params
      WHERE p_category = 'repeater'
        AND e.school_year = params.prev_sy
        AND e.school_id IS NOT NULL
    ) prev
      ON  prev.student_id  = cur.student_id
      AND prev.grade_level = cur.grade_level
      AND prev.school_id   = cur.school_id
  ),
  selected AS (
    SELECT p.school_id, p.grade_level, p.gender
    FROM picked p
    WHERE p_category <> 'repeater'
    UNION ALL
    SELECT r.school_id, r.grade_level, r.gender
    FROM repeaters r
    WHERE p_category = 'repeater'
  ),
  agg AS (
    SELECT
      sel.school_id,
      sel.grade_level,
      COUNT(*) FILTER (WHERE sel.gender = 'male')::int   AS male,
      COUNT(*) FILTER (WHERE sel.gender = 'female')::int AS female
    FROM selected sel
    GROUP BY sel.school_id, sel.grade_level
  )
  SELECT
    sc.school_id,
    sc.school_name,
    sc.school_type,
    -- -99 is 072's "this school has no rows" sentinel; the UI skips it.
    COALESCE(agg.grade_level, -99)                    AS grade_level,
    COALESCE(agg.male, 0)                             AS male,
    COALESCE(agg.female, 0)                           AS female,
    COALESCE(agg.male, 0) + COALESCE(agg.female, 0)   AS total,
    sc.status
  FROM scoped sc
  LEFT JOIN agg ON agg.school_id = sc.school_id
  -- Ordinal, not the name: `grade_level` is also a RETURNS TABLE parameter.
  ORDER BY sc.school_name, 4;
$$;

GRANT EXECUTE ON FUNCTION
  procurements.division_enrollment_actual(TEXT, SMALLINT, TEXT, TEXT)
  TO authenticated;

COMMENT ON FUNCTION
  procurements.division_enrollment_actual(TEXT, SMALLINT, TEXT, TEXT) IS
  'Live per-school/per-grade counts by sex for the derivable division report '
  'categories: enrollment, transfer_in, transfer_out, dropout, promotee, '
  'repeater, fourps, balik_aral. Definitions match generateSf4.ts, except '
  'repeater (migration 118), fourps (sms_students.is_4ps, 114) and balik_aral '
  '(sms_enrollments.is_balik_aral, 148). Only per-modality figures have no '
  'operational source and remain school-submitted.';

-- <<< END 148_enrollment_balik_aral.sql

-- ============================================================================
-- >>> BEGIN 149_iped_and_pwd_fourps_reports.sql
-- ============================================================================

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

-- <<< END 149_iped_and_pwd_fourps_reports.sql

-- ============================================================================
-- >>> BEGIN 150_pwd_from_lsen_tagging.sql
-- ============================================================================

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

-- <<< END 150_pwd_from_lsen_tagging.sql

-- ============================================================================
-- >>> BEGIN 151_ip_learner_from_picklist.sql
-- ============================================================================

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

-- <<< END 151_ip_learner_from_picklist.sql

-- ============================================================================
-- >>> BEGIN 152_philiri_material_question_count.sql
-- ============================================================================

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

-- <<< END 152_philiri_material_question_count.sql

-- ============================================================================
-- >>> BEGIN 153_mapeh_component.sql
-- ============================================================================

-- MAPEH is one learning area, not four subjects.
--
-- DepEd prints MAPEH as a single subject line carrying one grade, with Music,
-- Arts, Physical Education and Health indented beneath it as the breakdown,
-- and it counts ONCE toward the general average. The system had no way to say
-- which subjects were components, so three surfaces each guessed, and all
-- three guessed differently:
--
--   * report card (generateReportCard.ts) and SF9 (generateSf9.ts) printed the
--     four flat and counted each as a full subject — MAPEH weighted 4x
--     against Mathematics;
--   * SF10 (generateSf10.ts) grouped them by running a regex over the subject
--     NAME, then excluded both the header and the components from its general
--     average — MAPEH weighted 0x;
--   * students_gpa_for_grade (128), which is what actually places and promotes
--     a learner, averages every grade row flat — 4x again.
--
-- This makes it a stored fact instead of a guess, and fixes the weighting to
-- 1x on the card, on SF9, and in the GPA function.
--
-- ---------------------------------------------------------------------------
-- WHAT MOVES WHEN THIS IS APPLIED
-- ---------------------------------------------------------------------------
-- Nothing, until a school tags a subject. `mapeh_component` defaults to NULL,
-- which means "not part of MAPEH", so every existing subject keeps the
-- behaviour the app already assumed and no stored grade, GPA or printed form
-- changes on apply. That is the same load-bearing default as 152's
-- question_count and 133's program backfill.
--
-- Once components ARE tagged, the general average on the report card and SF9
-- changes for every learner taking them, and so does the GPA behind section
-- placement and promotion. That is the point of the change, but it means a
-- card reprinted after tagging will not match one already signed on paper.
--
-- WHEN TO CHECK, AND HOW TO BACK OUT
--
-- The impact query below reads `mapeh_component`, so it cannot run before this
-- migration creates that column. The sequencing that makes that safe is:
--
--   1. Apply this migration. Nothing moves — no subject is tagged yet, so
--      every GPA, card and form is byte-identical to the day before.
--   2. Tag the components on /subjects, one grade level at a time.
--   3. Run the query below to see exactly what step 2 moved.
--
-- Backing out needs no migration and drops nothing. Clearing the tags —
--
--   UPDATE procurements.sms_subjects
--      SET mapeh_component = NULL
--    WHERE mapeh_component IS NOT NULL
--      AND school_id = <school>;
--
-- — returns every GPA, report card and SF9 to its previous value exactly,
-- because the tag is the only thing the new behaviour keys on. The column and
-- the function can stay in place; untagged is the old behaviour.
--
-- The audit query. Read-only; returns no rows while nothing is tagged:
--
--   WITH tagged AS (
--     SELECT id FROM procurements.sms_subjects WHERE mapeh_component IS NOT NULL
--   ), rows AS (
--     SELECT g.student_id, g.section_id, g.school_year, g.grading_period,
--            CASE WHEN t.id IS NOT NULL THEN 'mapeh'
--                 ELSE 'subj:' || g.subject_id::text END AS bucket,
--            g.grade
--     FROM procurements.sms_grades g
--     JOIN procurements.sms_subjects s ON s.id = g.subject_id
--     LEFT JOIN tagged t ON t.id = g.subject_id
--     WHERE COALESCE(s.is_madrasah, false) = false AND g.grade > 0
--   )
--   SELECT COUNT(*) AS learners_affected,
--          ROUND(AVG(ABS(new_gpa - old_gpa)), 3) AS avg_shift,
--          MAX(ABS(new_gpa - old_gpa))           AS worst_shift,
--          COUNT(*) FILTER (WHERE (old_gpa >= 75) <> (new_gpa >= 75))
--            AS crosses_passing_mark
--   FROM (
--     SELECT student_id, section_id, school_year,
--            ROUND(AVG(grade)::numeric, 2)     AS old_gpa,
--            ROUND(AVG(collapsed)::numeric, 2) AS new_gpa
--     FROM (
--       SELECT student_id, section_id, school_year, grading_period, bucket,
--              grade, AVG(grade) OVER (
--                PARTITION BY student_id, section_id, school_year,
--                             grading_period, bucket
--              ) AS collapsed
--       FROM rows
--     ) c
--     GROUP BY student_id, section_id, school_year
--   ) cmp
--   WHERE old_gpa IS DISTINCT FROM new_gpa;
--
-- No DML. One ADD COLUMN and one CREATE OR REPLACE FUNCTION; no row is
-- rewritten and no object is dropped.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
-- CHECK-constrained rather than free app-validated TEXT. 119 (LSEN codes) and
-- 132 (answer keys) left their vocabularies open because DepEd revises those
-- lists and a CHECK would invalidate signed history. These four do not move —
-- a fifth component would change the acronym — and each value carries
-- application behaviour (it fixes the print order, which is what the acronym
-- spells). That is 133's `program` case, so this follows 133.

ALTER TABLE procurements.sms_subjects
  ADD COLUMN IF NOT EXISTS mapeh_component TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sms_subjects_mapeh_component_check'
      AND conrelid = 'procurements.sms_subjects'::regclass
  ) THEN
    ALTER TABLE procurements.sms_subjects
      ADD CONSTRAINT sms_subjects_mapeh_component_check
      CHECK (mapeh_component IS NULL
             OR mapeh_component IN ('music', 'arts', 'pe', 'health'));
  END IF;
END $$;

COMMENT ON COLUMN procurements.sms_subjects.mapeh_component IS
  'Which MAPEH component this subject is (music/arts/pe/health), or NULL when it is not part of MAPEH. Tagged subjects are folded into one computed MAPEH row on the report card and SF9, counting once toward the general average. There is deliberately no MAPEH row in this table: the parent is derived at print time, so no teacher can encode a MAPEH grade contradicting its components.';

-- Mirrors 034's is_madrasah index and 133's program index: the interesting
-- rows are the rare tagged ones, so the index is partial.
CREATE INDEX IF NOT EXISTS idx_subjects_mapeh_component
  ON procurements.sms_subjects (mapeh_component)
  WHERE mapeh_component IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The GPA function counts MAPEH once
-- ---------------------------------------------------------------------------
-- 128 made this the single source of truth for section placement and
-- promotion, and it averages every (subject, quarter) grade row equally. With
-- four components tagged, MAPEH contributed four rows per quarter where
-- Mathematics contributed one.
--
-- The fix collapses the tagged components to a single value per quarter before
-- averaging. Everything 128 established is unchanged: madrasah/ALS subjects
-- still excluded, un-encoded zero grades still excluded, same signature, same
-- STABLE volatility, NULL when the learner has no usable grades.
--
-- Rounding stays where 128 put it — once, at the end, to 2 decimals. The
-- per-quarter collapse is deliberately not rounded: this function reports a
-- placement figure to 2dp, where the printed card rounds each level to a whole
-- number because a teacher reproduces those by hand from the page.

CREATE OR REPLACE FUNCTION procurements.students_gpa_for_grade(
  p_student_ids BIGINT[],
  p_grade_level INTEGER,
  p_school_year TEXT DEFAULT NULL,
  p_school_id   BIGINT DEFAULT NULL
)
RETURNS TABLE (student_id BIGINT, gpa NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT ids.sid, avg_row.value
  FROM unnest(COALESCE(p_student_ids, ARRAY[]::BIGINT[])) AS ids(sid)
  -- The enrollment that grade level was taken in …
  LEFT JOIN LATERAL (
    SELECT e.section_id, e.school_year
    FROM procurements.sms_enrollments e
    WHERE e.student_id = ids.sid
      AND e.grade_level = p_grade_level
      AND e.status = 'approved'
      AND (p_school_year IS NULL OR e.school_year = p_school_year)
      AND (p_school_id IS NULL OR e.school_id = p_school_id)
    ORDER BY e.school_year DESC, e.created_at DESC
    LIMIT 1
  ) src ON TRUE
  -- … and its average, excluding MEP/ALS subjects and un-encoded zeros, with
  -- the MAPEH components folded into one value per quarter so the learning
  -- area weighs the same as any other subject.
  LEFT JOIN LATERAL (
    SELECT ROUND(AVG(collapsed.grade)::numeric, 2) AS value
    FROM (
      SELECT AVG(g.grade) AS grade
      FROM procurements.sms_grades g
      JOIN procurements.sms_subjects s ON s.id = g.subject_id
      WHERE g.student_id  = ids.sid
        AND g.section_id  = src.section_id
        AND g.school_year = src.school_year
        AND COALESCE(s.is_madrasah, false) = false
        AND g.grade > 0
      GROUP BY
        g.grading_period,
        -- One bucket for all tagged components, one per subject otherwise.
        CASE WHEN s.mapeh_component IS NOT NULL
             THEN 'mapeh'
             ELSE 'subj:' || s.id::text END
    ) collapsed
  ) avg_row ON TRUE;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION procurements.students_gpa_for_grade IS
  'Average grade per learner for a given grade level, excluding madrasah/ALS subjects and un-encoded (0) grades, with MAPEH components collapsed to one value per quarter so the learning area counts once. The single source of truth for section placement — both the enrollment wizard and Auto Enroll go through it.';

GRANT EXECUTE ON FUNCTION procurements.students_gpa_for_grade(BIGINT[], INTEGER, TEXT, BIGINT)
  TO authenticated;

-- get_student_previous_gpa (076, reduced to a wrapper by 128) is unchanged and
-- picks the new behaviour up through this function.

-- <<< END 153_mapeh_component.sql

COMMIT;
