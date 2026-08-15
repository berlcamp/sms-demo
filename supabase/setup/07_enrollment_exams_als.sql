-- ============================================================================
-- SCHOOL MANAGEMENT SYSTEM — FRESH INSTALL, PART 7 OF 7
-- Enrollment identity & isolation, OMR exam scanning, ALS, multi-school users
-- ============================================================================
-- GENERATED FILE — do not edit by hand; run supabase/setup/generate.sh instead.
-- A byte-for-byte concatenation of the 9 migrations listed below, in the
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
--   137_grant_table_privileges.sql
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
-- >>> BEGIN 137_grant_table_privileges.sql
-- ============================================================================

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

-- <<< END 137_grant_table_privileges.sql

COMMIT;
