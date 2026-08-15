-- ============================================================================
-- SCHOOL MANAGEMENT SYSTEM — FRESH INSTALL, PART 3 OF 7
-- Promotion & graduation, MPS, division reports, landing pages, storage
-- ============================================================================
-- GENERATED FILE — do not edit by hand; run supabase/setup/generate.sh instead.
-- A byte-for-byte concatenation of the 20 migrations listed below, in the
-- exact order a migration runner would apply them.
--
-- FOR NEW / EMPTY DATABASES ONLY. Never run this against a database that already
-- has the migration history applied — use supabase/migrations/ for that.
--
-- Run the seven parts strictly in order: 01 -> 07. Each part is one transaction,
-- so a failure rolls the whole part back and leaves nothing half-applied.
--
-- Migrations merged into this part:
--   060_principal_to_teacher_evaluation.sql
--   061_atomic_enroll_promoted_retained.sql
--   062_enforce_promotion_deadline_and_graduation_lock.sql
--   063_historical_grades_attachment.sql
--   064_fix_transfer_promoted_students.sql
--   065_fix_promotion_deadline_type_mismatch.sql
--   066_simplify_transfer_enrollment.sql
--   067_add_division_type_user.sql
--   068_evaluation_remarks.sql
--   069_books_quantity.sql
--   070_mps_scores.sql
--   071_division_reports_foundation.sql
--   072_division_reports_submissions.sql
--   073_division_reports_shs.sql
--   074_division_reports_teaching_spec.sql
--   075_division_reports_school_type.sql
--   076_exclude_madrasah_from_gpa.sql
--   077_school_landing_hero.sql
--   078_storage_school_management.sql
--   079_school_slug.sql
-- ============================================================================

BEGIN;

SET search_path TO procurements, public;

-- ============================================================================
-- >>> BEGIN 060_principal_to_teacher_evaluation.sql
-- ============================================================================

-- ============================================================================
-- Add principal_to_teacher evaluation type
-- ============================================================================

SET search_path TO procurements, public;

-- Drop and recreate the CHECK constraint on sms_evaluations.type
ALTER TABLE procurements.sms_evaluations
  DROP CONSTRAINT IF EXISTS sms_evaluations_type_check;

ALTER TABLE procurements.sms_evaluations
  ADD CONSTRAINT sms_evaluations_type_check
  CHECK (type IN ('student_to_teacher', 'teacher_to_principal', 'principal_to_teacher'));

-- Drop and recreate the CHECK constraint on sms_evaluation_responses.respondent_type
ALTER TABLE procurements.sms_evaluation_responses
  DROP CONSTRAINT IF EXISTS sms_evaluation_responses_respondent_type_check;

ALTER TABLE procurements.sms_evaluation_responses
  ADD CONSTRAINT sms_evaluation_responses_respondent_type_check
  CHECK (respondent_type IN ('student', 'teacher', 'principal'));

COMMENT ON TABLE procurements.sms_evaluations IS 'Evaluation questionnaires — student-to-teacher, teacher-to-principal, or principal-to-teacher';

-- <<< END 060_principal_to_teacher_evaluation.sql

-- ============================================================================
-- >>> BEGIN 061_atomic_enroll_promoted_retained.sql
-- ============================================================================

-- Atomic bulk enrollment for promoted/retained students.
--
-- Replaces the previous client-side flow in EnrollStudentsTabContent.tsx that
-- (1) inserted new enrollments and (2) separately marked the old promoted
-- enrollments as 'completed'. If the second step failed (network blip, crash)
-- the system was left with stale 'promoted' rows that re-appeared in the
-- enrollment lists indefinitely.
--
-- This RPC performs both operations in a single transaction. It also marks
-- prior 'retained' enrollments as 'completed' when re-enrolling them, which
-- eliminates duplicate retained rows.
--
-- Inputs:
--   p_records       jsonb[]  – array of new enrollment rows to insert
--   p_source_ids    bigint[] – ids of the prior enrollments to mark completed
--   p_school_id     bigint   – tenant guard; both inserts and updates are
--                              constrained to this school. Pass NULL only for
--                              division-admin (cross-school) callers.
--
-- Returns: { inserted: int, skipped: int }
--
-- Skips rows that violate uq_enrollments_student_school_year (already enrolled
-- for the target school year) and reports them in `skipped`.

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
BEGIN
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
        (v_record->>'enrolled_by')::bigint,
        (v_record->>'approved_by')::bigint,
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

GRANT EXECUTE ON FUNCTION procurements.enroll_students_atomic(jsonb, bigint[], bigint)
  TO authenticated;

-- <<< END 061_atomic_enroll_promoted_retained.sql

-- ============================================================================
-- >>> BEGIN 062_enforce_promotion_deadline_and_graduation_lock.sql
-- ============================================================================

-- Server-side enforcement of two enrollment-status invariants that were
-- previously only checked in the UI.
--
-- (1) Promotion deadline (review item #7)
--     Once `sms_school_settings.promotion_deadline` has passed for a school,
--     transitions into 'promoted', 'graduated', or 'retained' must be
--     blocked. The previous client-side check could be bypassed by any
--     direct supabase.from(...).update(...) call.
--
-- (2) Graduation is final (review item #6)
--     A student whose latest approved enrollment is 'graduated' must not
--     get a new active enrollment row. The original review noted that
--     graduates could be re-enrolled via the wizard if a clerk picked the
--     wrong mode; this trigger blocks every code path.
--
-- Both checks are implemented as BEFORE INSERT/UPDATE triggers on
-- procurements.sms_enrollments so they cover bulk RPC, single-row updates,
-- the wizard, and any future code path.

-- ---------------------------------------------------------------------------
-- (1) Promotion deadline guard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION procurements.enforce_promotion_deadline()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_deadline DATE;
BEGIN
  -- Only react when the lifecycle status is moving INTO one of the
  -- end-of-year transition states.
  IF NEW.enrollment_status NOT IN ('promoted', 'graduated', 'retained') THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only fire when the value actually changed (idempotent
  -- updates from triggers / re-saves shouldn't be blocked).
  IF TG_OP = 'UPDATE'
     AND OLD.enrollment_status IS NOT DISTINCT FROM NEW.enrollment_status THEN
    RETURN NEW;
  END IF;

  -- Look up the school's promotion deadline. Prefer the per-school row;
  -- fall back to the global row (school_id IS NULL) if none exists.
  SELECT promotion_deadline INTO v_deadline
  FROM procurements.sms_school_settings
  WHERE school_id = NEW.school_id
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT promotion_deadline INTO v_deadline
    FROM procurements.sms_school_settings
    WHERE school_id IS NULL
    LIMIT 1;
  END IF;

  IF v_deadline IS NOT NULL AND CURRENT_DATE > v_deadline THEN
    RAISE EXCEPTION
      'Promotion deadline (%) has passed for this school. % transitions are no longer allowed.',
      v_deadline, NEW.enrollment_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_promotion_deadline
  ON procurements.sms_enrollments;

CREATE TRIGGER trg_enforce_promotion_deadline
BEFORE INSERT OR UPDATE OF enrollment_status
ON procurements.sms_enrollments
FOR EACH ROW
EXECUTE FUNCTION procurements.enforce_promotion_deadline();

-- ---------------------------------------------------------------------------
-- (2) Graduation lock — graduated students cannot be re-enrolled
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION procurements.enforce_graduation_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_has_graduated BOOLEAN;
BEGIN
  -- Only enforce on creation of a fresh active enrollment. UPDATEs can
  -- still adjust historical rows (e.g. correcting a grade).
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Allow non-active lifecycle statuses through — only block creating a
  -- new active/pending row for a graduate.
  IF NEW.enrollment_status NOT IN ('active', 'pending_transfer', 'pending_review') THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM procurements.sms_enrollments
    WHERE student_id = NEW.student_id
      AND status = 'approved'
      AND enrollment_status = 'graduated'
  ) INTO v_has_graduated;

  IF v_has_graduated THEN
    RAISE EXCEPTION
      'Student % has already graduated and cannot be re-enrolled.',
      NEW.student_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_graduation_lock
  ON procurements.sms_enrollments;

CREATE TRIGGER trg_enforce_graduation_lock
BEFORE INSERT
ON procurements.sms_enrollments
FOR EACH ROW
EXECUTE FUNCTION procurements.enforce_graduation_lock();

-- <<< END 062_enforce_promotion_deadline_and_graduation_lock.sql

-- ============================================================================
-- >>> BEGIN 063_historical_grades_attachment.sql
-- ============================================================================

-- ============================================================================
-- ADD ATTACHMENT TO SMS_HISTORICAL_GRADES
-- ============================================================================
-- Allows users to attach a supporting document (e.g., scanned SF10/report card)
-- when encoding historical grade records.
-- ============================================================================

SET search_path TO procurements, public;

ALTER TABLE procurements.sms_historical_grades
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT;

COMMENT ON COLUMN procurements.sms_historical_grades.attachment_url IS
  'Public URL of the attached supporting document stored in the diplomas bucket';
COMMENT ON COLUMN procurements.sms_historical_grades.attachment_name IS
  'Original filename of the attached document for display purposes';

-- <<< END 063_historical_grades_attachment.sql

-- ============================================================================
-- >>> BEGIN 064_fix_transfer_promoted_students.sql
-- ============================================================================

-- Fix: enroll_student_with_record_request fails for promoted/graduated/retained students
-- The RPC only checked for enrollment_status IN ('active', 'completed', 'transferred_out')
-- but students who were promoted, graduated, or retained have those statuses instead.

CREATE OR REPLACE FUNCTION procurements.enroll_student_with_record_request(
  p_student_id BIGINT, p_requesting_school_id BIGINT, p_requested_by BIGINT,
  p_section_id BIGINT, p_grade_level INTEGER, p_school_year TEXT,
  p_semester INTEGER DEFAULT NULL, p_remarks TEXT DEFAULT NULL
) RETURNS TABLE (enrollment_id BIGINT, request_id BIGINT) AS $$
DECLARE
  v_origin_school_id BIGINT; v_student_lrn TEXT;
  v_enrollment_id BIGINT; v_request_id BIGINT;
  v_origin_status TEXT;
BEGIN
  SELECT s.lrn INTO v_student_lrn FROM procurements.sms_students s WHERE s.id = p_student_id;
  IF v_student_lrn IS NULL THEN RAISE EXCEPTION 'Student not found'; END IF;

  -- Find the latest approved enrollment (includes promoted/graduated/retained)
  SELECT e.school_id, e.enrollment_status INTO v_origin_school_id, v_origin_status
  FROM procurements.sms_enrollments e
  WHERE e.student_id = p_student_id AND e.status = 'approved'
    AND e.enrollment_status IN ('active', 'completed', 'transferred_out', 'promoted', 'graduated', 'retained')
  ORDER BY e.school_year DESC, e.created_at DESC LIMIT 1;

  IF v_origin_school_id IS NULL THEN RAISE EXCEPTION 'Student has no active enrollment'; END IF;
  IF v_origin_school_id = p_requesting_school_id THEN RAISE EXCEPTION 'Student already at this school'; END IF;

  -- Create record request (always, even for pre-released students)
  INSERT INTO procurements.sms_record_requests (
    student_id, student_lrn, requesting_school_id, origin_school_id,
    requested_by, target_grade_level, target_school_year, remarks
  ) VALUES (
    p_student_id, v_student_lrn, p_requesting_school_id, v_origin_school_id,
    p_requested_by, p_grade_level, p_school_year, p_remarks
  ) RETURNING id INTO v_request_id;

  -- Mark origin enrollment as pending_transfer (only if still active)
  IF v_origin_status = 'active' THEN
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'pending_transfer'
    WHERE student_id = p_student_id AND school_id = v_origin_school_id
      AND status = 'approved' AND enrollment_status = 'active';
  END IF;

  -- Create new enrollment at requesting school (pending until full two-stage approval)
  INSERT INTO procurements.sms_enrollments (
    student_id, school_id, section_id, grade_level, school_year, semester,
    status, enrollment_status, origin_school_id, record_request_id, enrolled_by
  ) VALUES (
    p_student_id, p_requesting_school_id, p_section_id, p_grade_level, p_school_year,
    p_semester, 'pending', 'pending_transfer', v_origin_school_id, v_request_id, p_requested_by
  ) RETURNING id INTO v_enrollment_id;

  -- Update student school_id for backward compat
  UPDATE procurements.sms_students
  SET school_id = p_requesting_school_id, enrollment_status = 'enrolled',
      grade_level = p_grade_level, current_section_id = p_section_id
  WHERE id = p_student_id;

  RETURN QUERY SELECT v_enrollment_id, v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- <<< END 064_fix_transfer_promoted_students.sql

-- ============================================================================
-- >>> BEGIN 065_fix_promotion_deadline_type_mismatch.sql
-- ============================================================================

-- Fix: enforce_promotion_deadline trigger fails with "operator does not exist: text = bigint"
-- because sms_school_settings.school_id is TEXT while sms_enrollments.school_id is BIGINT.
-- Cast NEW.school_id to TEXT for the comparison.

CREATE OR REPLACE FUNCTION procurements.enforce_promotion_deadline()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_deadline DATE;
BEGIN
  IF NEW.enrollment_status NOT IN ('promoted', 'graduated', 'retained') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.enrollment_status IS NOT DISTINCT FROM NEW.enrollment_status THEN
    RETURN NEW;
  END IF;

  -- sms_school_settings.school_id is TEXT; sms_enrollments.school_id is BIGINT
  SELECT promotion_deadline INTO v_deadline
  FROM procurements.sms_school_settings
  WHERE school_id = NEW.school_id::TEXT
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT promotion_deadline INTO v_deadline
    FROM procurements.sms_school_settings
    WHERE school_id IS NULL
    LIMIT 1;
  END IF;

  IF v_deadline IS NOT NULL AND CURRENT_DATE > v_deadline THEN
    RAISE EXCEPTION
      'Promotion deadline (%) has passed for this school. % transitions are no longer allowed.',
      v_deadline, NEW.enrollment_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- <<< END 065_fix_promotion_deadline_type_mismatch.sql

-- ============================================================================
-- >>> BEGIN 066_simplify_transfer_enrollment.sql
-- ============================================================================

-- Simplify transfer enrollment: students are immediately active at the new school.
-- Record requests only control data access to previous school records.
-- The "Pending Reviews" two-stage approval is removed.

-- ============================================================================
-- 1. Rewrite enroll_student_with_record_request
--    Enrollment is now immediately approved & active (not pending).
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.enroll_student_with_record_request(
  p_student_id BIGINT, p_requesting_school_id BIGINT, p_requested_by BIGINT,
  p_section_id BIGINT, p_grade_level INTEGER, p_school_year TEXT,
  p_semester INTEGER DEFAULT NULL, p_remarks TEXT DEFAULT NULL
) RETURNS TABLE (enrollment_id BIGINT, request_id BIGINT) AS $$
DECLARE
  v_origin_school_id BIGINT; v_student_lrn TEXT;
  v_enrollment_id BIGINT; v_request_id BIGINT;
  v_origin_status TEXT;
  v_existing_enrollment_id BIGINT;
BEGIN
  SELECT s.lrn INTO v_student_lrn FROM procurements.sms_students s WHERE s.id = p_student_id;
  IF v_student_lrn IS NULL THEN RAISE EXCEPTION 'Student not found'; END IF;

  SELECT e.school_id, e.enrollment_status INTO v_origin_school_id, v_origin_status
  FROM procurements.sms_enrollments e
  WHERE e.student_id = p_student_id AND e.status = 'approved'
    AND e.enrollment_status IN ('active', 'completed', 'transferred_out', 'promoted', 'graduated', 'retained')
  ORDER BY e.school_year DESC, e.created_at DESC LIMIT 1;

  IF v_origin_school_id IS NULL THEN RAISE EXCEPTION 'Student has no active enrollment'; END IF;
  IF v_origin_school_id = p_requesting_school_id THEN RAISE EXCEPTION 'Student already at this school'; END IF;

  -- Create record request for data access
  INSERT INTO procurements.sms_record_requests (
    student_id, student_lrn, requesting_school_id, origin_school_id,
    requested_by, target_grade_level, target_school_year, remarks
  ) VALUES (
    p_student_id, v_student_lrn, p_requesting_school_id, v_origin_school_id,
    p_requested_by, p_grade_level, p_school_year, p_remarks
  ) RETURNING id INTO v_request_id;

  -- Mark origin enrollment as pending_transfer (only if still active)
  IF v_origin_status = 'active' THEN
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'pending_transfer'
    WHERE student_id = p_student_id AND school_id = v_origin_school_id
      AND status = 'approved' AND enrollment_status = 'active';
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
    -- Reactivate the existing enrollment
    UPDATE procurements.sms_enrollments
    SET section_id = p_section_id, grade_level = p_grade_level,
        status = 'approved', enrollment_status = 'active',
        origin_school_id = v_origin_school_id, record_request_id = v_request_id,
        enrolled_by = p_requested_by, approved_by = p_requested_by,
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
      p_requested_by, p_requested_by
    ) RETURNING id INTO v_enrollment_id;
  END IF;

  -- Update student record
  UPDATE procurements.sms_students
  SET school_id = p_requesting_school_id, enrollment_status = 'enrolled',
      grade_level = p_grade_level, current_section_id = p_section_id
  WHERE id = p_student_id;

  RETURN QUERY SELECT v_enrollment_id, v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 2. Rewrite respond_to_record_request
--    Approve: grant data access only (enrollment is already active).
--    Reject: deny data access only (enrollment stays).
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.respond_to_record_request(
  p_request_id BIGINT, p_action TEXT, p_responder_id BIGINT,
  p_rejection_reason TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE v_request RECORD;
BEGIN
  IF p_action NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Invalid action'; END IF;

  SELECT * INTO v_request FROM procurements.sms_record_requests
  WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  UPDATE procurements.sms_record_requests
  SET status = p_action, approved_by = p_responder_id, responded_at = NOW(),
      rejection_reason = CASE WHEN p_action = 'rejected' THEN p_rejection_reason ELSE NULL END,
      record_access_granted = CASE WHEN p_action = 'approved' THEN TRUE ELSE FALSE END,
      access_granted_at = CASE WHEN p_action = 'approved' THEN NOW() ELSE NULL END
  WHERE id = p_request_id;

  IF p_action = 'approved' THEN
    -- Mark origin enrollment as transferred_out
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'transferred_out', updated_at = NOW()
    WHERE student_id = v_request.student_id AND school_id = v_request.origin_school_id
      AND status = 'approved' AND enrollment_status IN ('active', 'pending_transfer');

  ELSIF p_action = 'rejected' THEN
    -- Revert origin enrollment to active (if it was pending_transfer)
    UPDATE procurements.sms_enrollments
    SET enrollment_status = 'active', updated_at = NOW()
    WHERE student_id = v_request.student_id AND school_id = v_request.origin_school_id
      AND status = 'approved' AND enrollment_status = 'pending_transfer';
    -- Destination enrollment stays active — student remains enrolled
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. Rewrite cancel_record_request
--    Cancel the record request only. Enrollment stays active.
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.cancel_record_request(
  p_request_id BIGINT, p_user_id BIGINT
) RETURNS VOID AS $$
DECLARE v_request RECORD;
BEGIN
  SELECT * INTO v_request FROM procurements.sms_record_requests
  WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  UPDATE procurements.sms_record_requests SET status = 'cancelled' WHERE id = p_request_id;

  -- Revert origin enrollment to active (if it was pending_transfer)
  UPDATE procurements.sms_enrollments
  SET enrollment_status = 'active', updated_at = NOW()
  WHERE student_id = v_request.student_id AND school_id = v_request.origin_school_id
    AND status = 'approved' AND enrollment_status = 'pending_transfer';
  -- Destination enrollment stays active
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 4. New RPC: remove_transfer_student
--    Destination school removes a transferee after reviewing records.
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.remove_transfer_student(
  p_request_id BIGINT,
  p_remover_id BIGINT,
  p_reason TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_request RECORD;
  v_enrollment RECORD;
BEGIN
  -- Must have approved request with data access granted
  SELECT * INTO v_request FROM procurements.sms_record_requests
  WHERE id = p_request_id AND status = 'approved' AND record_access_granted = TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found or records not yet accessible';
  END IF;

  -- Find the active enrollment at the requesting school
  SELECT * INTO v_enrollment FROM procurements.sms_enrollments
  WHERE record_request_id = p_request_id AND status = 'approved' AND enrollment_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active enrollment found for this request';
  END IF;

  -- Drop the enrollment
  UPDATE procurements.sms_enrollments
  SET enrollment_status = 'dropped', status = 'rejected',
      remarks = COALESCE(p_reason, 'Removed after record review'), updated_at = NOW()
  WHERE id = v_enrollment.id;

  -- Revoke data access
  UPDATE procurements.sms_record_requests
  SET record_access_granted = FALSE
  WHERE id = p_request_id;

  -- Revert origin enrollment from transferred_out back to active/previous
  UPDATE procurements.sms_enrollments
  SET enrollment_status = 'active', updated_at = NOW()
  WHERE student_id = v_request.student_id AND school_id = v_request.origin_school_id
    AND status = 'approved' AND enrollment_status = 'transferred_out';

  -- Revert student record to origin school
  UPDATE procurements.sms_students
  SET enrollment_status = 'enrolled',
      school_id = v_request.origin_school_id,
      current_section_id = NULL
  WHERE id = v_request.student_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION procurements.remove_transfer_student TO authenticated;

-- <<< END 066_simplify_transfer_enrollment.sql

-- ============================================================================
-- >>> BEGIN 067_add_division_type_user.sql
-- ============================================================================

-- Add 'division_type' to the sms_users type check constraint
ALTER TABLE procurements.sms_users DROP CONSTRAINT IF EXISTS sms_users_type_check;
ALTER TABLE procurements.sms_users ADD CONSTRAINT sms_users_type_check
  CHECK (type IN ('school_head', 'teacher', 'registrar', 'admin', 'super admin', 'division_admin', 'division_type', 'librarian'));

-- <<< END 067_add_division_type_user.sql

-- ============================================================================
-- >>> BEGIN 068_evaluation_remarks.sql
-- ============================================================================

-- Add optional remarks field to evaluation responses
ALTER TABLE procurements.sms_evaluation_responses
  ADD COLUMN IF NOT EXISTS remarks TEXT;

-- <<< END 068_evaluation_remarks.sql

-- ============================================================================
-- >>> BEGIN 069_books_quantity.sql
-- ============================================================================

-- Add quantity column to sms_books to track total stock per book
-- Quantity represents how many copies the school has in total
-- Available to allocate = quantity - sum(allocations for current school year)

ALTER TABLE procurements.sms_books
ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 0;

-- <<< END 069_books_quantity.sql

-- ============================================================================
-- >>> BEGIN 070_mps_scores.sql
-- ============================================================================

-- ============================================================================
-- MPS (Mean Percentage Score)
-- Teachers manually enter one MPS value per subject/section/quarter/school-year.
-- Reports slice by subject, section, and quarter with mastery-level bands.
-- ============================================================================

SET search_path TO procurements, public;

CREATE TABLE IF NOT EXISTS procurements.sms_mps (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  subject_id BIGINT NOT NULL REFERENCES procurements.sms_subjects(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  grade_level INTEGER NOT NULL,
  school_year TEXT NOT NULL,
  grading_period INTEGER NOT NULL CHECK (grading_period BETWEEN 1 AND 4),
  mps NUMERIC(5,2) NOT NULL CHECK (mps >= 0 AND mps <= 100),
  teacher_id BIGINT NOT NULL REFERENCES procurements.sms_users(id) ON DELETE RESTRICT,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subject_id, section_id, grading_period, school_year)
);

COMMENT ON TABLE procurements.sms_mps IS 'Mean Percentage Score per subject/section/quarter/school-year (DepEd).';

CREATE INDEX idx_sms_mps_school     ON procurements.sms_mps(school_id);
CREATE INDEX idx_sms_mps_subject    ON procurements.sms_mps(subject_id);
CREATE INDEX idx_sms_mps_section    ON procurements.sms_mps(section_id);
CREATE INDEX idx_sms_mps_sy_quarter ON procurements.sms_mps(school_year, grading_period);
CREATE INDEX idx_sms_mps_teacher    ON procurements.sms_mps(teacher_id);

CREATE TRIGGER update_sms_mps_updated_at
  BEFORE UPDATE ON procurements.sms_mps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE procurements.sms_mps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "MPS viewable by authenticated"
  ON procurements.sms_mps FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "MPS insertable by authenticated"
  ON procurements.sms_mps FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "MPS updatable by authenticated"
  ON procurements.sms_mps FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "MPS deletable by authenticated"
  ON procurements.sms_mps FOR DELETE USING (auth.role() = 'authenticated');

GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_mps TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_mps_id_seq TO authenticated;

-- <<< END 070_mps_scores.sql

-- ============================================================================
-- >>> BEGIN 071_division_reports_foundation.sql
-- ============================================================================

-- ============================================================================
-- DIVISION REPORTS FOUNDATION
-- ============================================================================
-- Phase 1 of the SDO Reports module:
--   * sms_schools: principal contact + extra socials + address breakdown
--   * sms_rooms: condition enum
--   * sms_users: staff_category_code (for non-teaching breakdown)
--   * sms_staff_categories (seeded)
--   * sms_class_size_standards (seeded with DepEd defaults)
--   * Direct-derive RPCs for School List, Teaching Personnel, Non-Teaching,
--     Rooms, and Classroom Needs Analysis.
-- Additive only. No destructive changes.
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- 1. sms_schools extensions
-- ============================================================================
ALTER TABLE procurements.sms_schools
  ADD COLUMN IF NOT EXISTS principal_name TEXT,
  ADD COLUMN IF NOT EXISTS principal_email TEXT,
  ADD COLUMN IF NOT EXISTS principal_phone TEXT,
  ADD COLUMN IF NOT EXISTS twitter_url TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_url TEXT,
  ADD COLUMN IF NOT EXISTS barangay TEXT,
  ADD COLUMN IF NOT EXISTS street TEXT;

-- ============================================================================
-- 2. sms_rooms.condition
-- ============================================================================
ALTER TABLE procurements.sms_rooms
  ADD COLUMN IF NOT EXISTS condition TEXT;

ALTER TABLE procurements.sms_rooms
  DROP CONSTRAINT IF EXISTS sms_rooms_condition_check;
ALTER TABLE procurements.sms_rooms
  ADD CONSTRAINT sms_rooms_condition_check
  CHECK (
    condition IS NULL
    OR condition IN ('good', 'needs_minor_repair', 'needs_major_repair', 'condemned')
  );

-- ============================================================================
-- 3. sms_staff_categories (reference for non-teaching breakdown)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_staff_categories (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  is_teaching BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE procurements.sms_staff_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff categories readable by authenticated"
  ON procurements.sms_staff_categories;
CREATE POLICY "Staff categories readable by authenticated"
  ON procurements.sms_staff_categories FOR SELECT
  USING (auth.role() = 'authenticated');

GRANT SELECT ON procurements.sms_staff_categories TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_staff_categories_id_seq TO authenticated;

-- Seed DepEd non-teaching categories
INSERT INTO procurements.sms_staff_categories (code, label, is_teaching, sort_order)
VALUES
  ('admin',    'Administrative',    false, 10),
  ('utility',  'Utility',           false, 20),
  ('security', 'Security',          false, 30),
  ('health',   'Health Services',   false, 40),
  ('library',  'Library',           false, 50),
  ('guidance', 'Guidance',          false, 60),
  ('other',    'Other Non-Teaching',false, 99),
  ('teacher',  'Teaching',          true,  0)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 4. sms_users.staff_category_code
-- ============================================================================
ALTER TABLE procurements.sms_users
  ADD COLUMN IF NOT EXISTS staff_category_code TEXT;

-- Validate against sms_staff_categories
ALTER TABLE procurements.sms_users
  DROP CONSTRAINT IF EXISTS sms_users_staff_category_code_fkey;
-- Not a FK (to avoid lock contention on sms_users); enforce via check list.
ALTER TABLE procurements.sms_users
  DROP CONSTRAINT IF EXISTS sms_users_staff_category_code_check;
ALTER TABLE procurements.sms_users
  ADD CONSTRAINT sms_users_staff_category_code_check
  CHECK (
    staff_category_code IS NULL
    OR staff_category_code IN (
      'admin','utility','security','health','library','guidance','other','teacher'
    )
  );

-- ============================================================================
-- 5. sms_class_size_standards (per-grade DepEd guideline)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_class_size_standards (
  grade_level INT PRIMARY KEY,
  max_students INT NOT NULL CHECK (max_students > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE procurements.sms_class_size_standards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Class size standards readable by authenticated"
  ON procurements.sms_class_size_standards;
CREATE POLICY "Class size standards readable by authenticated"
  ON procurements.sms_class_size_standards FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Class size standards writable by division admin"
  ON procurements.sms_class_size_standards;
CREATE POLICY "Class size standards writable by division admin"
  ON procurements.sms_class_size_standards FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('division_admin','division_type')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.type IN ('division_admin','division_type')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_class_size_standards TO authenticated;

-- Seed typical DepEd class-size guidelines
-- (can be overridden by division admin in Settings → Class Size Standards)
INSERT INTO procurements.sms_class_size_standards (grade_level, max_students) VALUES
  (-1, 15),   -- SNED non-graded
  (0, 30),    -- Kindergarten
  (1, 40), (2, 40), (3, 40),
  (4, 45), (5, 45), (6, 45),
  (7, 50), (8, 50), (9, 50), (10, 50),
  (11, 50), (12, 50)
ON CONFLICT (grade_level) DO NOTHING;

-- ============================================================================
-- 6. Operational indexes (idempotent)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_sms_enrollments_school_year_grade
  ON procurements.sms_enrollments (school_year, grade_level);

CREATE INDEX IF NOT EXISTS idx_sms_users_school_type_active
  ON procurements.sms_users (school_id, type, is_active);

CREATE INDEX IF NOT EXISTS idx_sms_rooms_school_type
  ON procurements.sms_rooms (school_id, room_type);

-- ============================================================================
-- 7. RPC: division_school_list
--    Returns one row per active school in the division plus derived counts.
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.division_school_list()
RETURNS TABLE (
  id BIGINT,
  school_id TEXT,
  name TEXT,
  school_type TEXT,
  district TEXT,
  municipality_city TEXT,
  region TEXT,
  barangay TEXT,
  street TEXT,
  address TEXT,
  email TEXT,
  telephone_number TEXT,
  mobile_number TEXT,
  facebook_url TEXT,
  twitter_url TEXT,
  instagram_url TEXT,
  tiktok_url TEXT,
  principal_name TEXT,
  principal_email TEXT,
  principal_phone TEXT,
  user_count BIGINT,
  teacher_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT
    s.id,
    s.school_id,
    s.name,
    s.school_type,
    s.district,
    s.municipality_city,
    s.region,
    s.barangay,
    s.street,
    s.address,
    s.email,
    s.telephone_number,
    s.mobile_number,
    s.facebook_url,
    s.twitter_url,
    s.instagram_url,
    s.tiktok_url,
    s.principal_name,
    s.principal_email,
    s.principal_phone,
    COALESCE(u.user_count, 0)    AS user_count,
    COALESCE(u.teacher_count, 0) AS teacher_count
  FROM procurements.sms_schools s
  LEFT JOIN (
    SELECT
      school_id,
      COUNT(*) FILTER (WHERE is_active) AS user_count,
      COUNT(*) FILTER (WHERE is_active AND type = 'teacher') AS teacher_count
    FROM procurements.sms_users
    WHERE school_id IS NOT NULL
    GROUP BY school_id
  ) u ON u.school_id = s.id
  WHERE s.is_active
  ORDER BY s.name;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_school_list() TO authenticated;

-- ============================================================================
-- 8. RPC: division_teaching_personnel_summary
--    One row per (school, role) for teaching staff (type='teacher').
--    Optional p_school_type filter narrows to schools of that type.
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.division_teaching_personnel_summary(
  p_school_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  total BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT
    s.id AS school_id,
    s.name AS school_name,
    COUNT(u.id) AS total
  FROM procurements.sms_schools s
  LEFT JOIN procurements.sms_users u
    ON u.school_id = s.id
    AND u.is_active
    AND u.type = 'teacher'
  WHERE s.is_active
    AND (p_school_type IS NULL OR s.school_type = p_school_type)
  GROUP BY s.id, s.name
  ORDER BY s.name;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_teaching_personnel_summary(TEXT) TO authenticated;

-- ============================================================================
-- 9. RPC: division_non_teaching_summary
--    Breakdown by staff_category for non-teaching staff.
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.division_non_teaching_summary()
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  staff_category_code TEXT,
  staff_category_label TEXT,
  total BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT
    s.id AS school_id,
    s.name AS school_name,
    COALESCE(c.code, 'other') AS staff_category_code,
    COALESCE(c.label, 'Other Non-Teaching') AS staff_category_label,
    COUNT(u.id) AS total
  FROM procurements.sms_schools s
  LEFT JOIN procurements.sms_users u
    ON u.school_id = s.id
    AND u.is_active
    AND u.type <> 'teacher'
    AND u.type NOT IN ('division_admin','division_type','super admin')
  LEFT JOIN procurements.sms_staff_categories c
    ON c.code = COALESCE(u.staff_category_code, 'other')
  WHERE s.is_active
  GROUP BY s.id, s.name, c.code, c.label
  ORDER BY s.name, staff_category_label;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_non_teaching_summary() TO authenticated;

-- ============================================================================
-- 10. RPC: division_rooms_summary
--     Per-school room inventory grouped by (room_type, condition).
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.division_rooms_summary()
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  room_type TEXT,
  condition TEXT,
  total BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT
    s.id AS school_id,
    s.name AS school_name,
    COALESCE(r.room_type, 'other') AS room_type,
    COALESCE(r.condition, 'unspecified') AS condition,
    COUNT(r.id) AS total
  FROM procurements.sms_schools s
  LEFT JOIN procurements.sms_rooms r
    ON r.school_id = s.id
    AND r.is_active
  WHERE s.is_active
  GROUP BY s.id, s.name, r.room_type, r.condition
  ORDER BY s.name, room_type, condition;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_rooms_summary() TO authenticated;

-- ============================================================================
-- 11. RPC: division_classroom_needs
--     Classroom shortage/surplus analysis per (school, grade_level)
--     based on live enrollments + classrooms + class size standards.
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.division_classroom_needs(
  p_school_year TEXT
)
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  grade_level INT,
  enrolled BIGINT,
  standard_class_size INT,
  classrooms_needed INT,
  classrooms_available BIGINT,
  delta INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  WITH enroll AS (
    SELECT
      st.school_id,
      e.grade_level,
      COUNT(*) AS enrolled
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_students st ON st.id = e.student_id
    WHERE e.school_year = p_school_year
      AND e.status IN ('active','promoted','retained','graduated','completed')
    GROUP BY st.school_id, e.grade_level
  ),
  classrooms AS (
    SELECT
      r.school_id,
      COUNT(*) AS classrooms_available
    FROM procurements.sms_rooms r
    WHERE r.is_active AND r.room_type = 'classroom'
    GROUP BY r.school_id
  )
  SELECT
    s.id AS school_id,
    s.name AS school_name,
    COALESCE(e.grade_level, 0) AS grade_level,
    COALESCE(e.enrolled, 0) AS enrolled,
    COALESCE(st.max_students, 40) AS standard_class_size,
    CEIL(COALESCE(e.enrolled, 0)::numeric / GREATEST(COALESCE(st.max_students, 40), 1))::int
      AS classrooms_needed,
    COALESCE(c.classrooms_available, 0) AS classrooms_available,
    (COALESCE(c.classrooms_available, 0)::int
      - CEIL(COALESCE(e.enrolled, 0)::numeric / GREATEST(COALESCE(st.max_students, 40), 1))::int
    ) AS delta
  FROM procurements.sms_schools s
  LEFT JOIN enroll e ON e.school_id = s.id
  LEFT JOIN classrooms c ON c.school_id = s.id
  LEFT JOIN procurements.sms_class_size_standards st
    ON st.grade_level = e.grade_level
  WHERE s.is_active
  ORDER BY s.name, grade_level;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_classroom_needs(TEXT) TO authenticated;

COMMENT ON TABLE procurements.sms_staff_categories IS
  'Lookup of staff categories (admin/utility/security/etc.) for non-teaching breakdown';
COMMENT ON TABLE procurements.sms_class_size_standards IS
  'DepEd standard class size per grade level; drives Classroom Needs Analysis';

-- <<< END 071_division_reports_foundation.sql

-- ============================================================================
-- >>> BEGIN 072_division_reports_submissions.sql
-- ============================================================================

-- ============================================================================
-- DIVISION REPORTS: SUBMISSIONS + ENROLLMENT ROWS
-- ============================================================================
-- Phase 2: submission-based enrollment reporting.
--   * sms_division_report_submissions — header (school × SY × semester × report_type)
--   * sms_report_enrollment_rows      — per (grade_level, category, modality) detail
--   * RLS: schools write their own rows; division_admin unrestricted;
--          locked rows only mutable by division_admin.
--   * RPCs:
--       - division_enrollment_summary  — aggregated per-school totals
--       - enrollment_autofill          — prefills draft rows from live data
--       - submit_enrollment_report     — upserts detail rows + marks submitted
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- 1. sms_division_report_submissions (header)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_division_report_submissions (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  semester SMALLINT,
  report_type TEXT NOT NULL CHECK (report_type IN (
    'enrollment','track_strand','shs_specialization','teaching_specialization'
  )),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','locked')),
  submitted_at TIMESTAMPTZ,
  submitted_by_user_id BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique per (school, SY, semester, type); semester may be NULL so use COALESCE.
CREATE UNIQUE INDEX IF NOT EXISTS uq_division_report_submissions_natural
  ON procurements.sms_division_report_submissions
  (school_id, school_year, COALESCE(semester, 0), report_type);

CREATE INDEX IF NOT EXISTS idx_submissions_school_year_sem_type
  ON procurements.sms_division_report_submissions (school_year, semester, report_type);

CREATE INDEX IF NOT EXISTS idx_submissions_school
  ON procurements.sms_division_report_submissions (school_id);

DROP TRIGGER IF EXISTS update_sms_division_report_submissions_updated_at
  ON procurements.sms_division_report_submissions;
CREATE TRIGGER update_sms_division_report_submissions_updated_at
  BEFORE UPDATE ON procurements.sms_division_report_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE procurements.sms_division_report_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "submissions_select"
  ON procurements.sms_division_report_submissions;
CREATE POLICY "submissions_select"
  ON procurements.sms_division_report_submissions FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "submissions_insert"
  ON procurements.sms_division_report_submissions;
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
            u.type IN ('school_head','admin','registrar')
            AND u.school_id = sms_division_report_submissions.school_id
          )
        )
    )
  );

DROP POLICY IF EXISTS "submissions_update"
  ON procurements.sms_division_report_submissions;
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
            u.type IN ('school_head','admin','registrar')
            AND u.school_id = sms_division_report_submissions.school_id
            AND sms_division_report_submissions.status <> 'locked'
          )
        )
    )
  );

DROP POLICY IF EXISTS "submissions_delete"
  ON procurements.sms_division_report_submissions;
CREATE POLICY "submissions_delete"
  ON procurements.sms_division_report_submissions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND u.type IN ('division_admin','division_type')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON procurements.sms_division_report_submissions TO authenticated;
GRANT USAGE, SELECT
  ON SEQUENCE procurements.sms_division_report_submissions_id_seq TO authenticated;

-- ============================================================================
-- 2. sms_report_enrollment_rows (detail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_report_enrollment_rows (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL
    REFERENCES procurements.sms_division_report_submissions(id) ON DELETE CASCADE,
  grade_level INT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'enrollment','transfer_in','transfer_out','dropout','promotee','repeater','balik_aral','fourps'
  )),
  modality TEXT NOT NULL CHECK (modality IN (
    'face_to_face','blended','modular','online','all'
  )),
  male INT NOT NULL DEFAULT 0 CHECK (male >= 0),
  female INT NOT NULL DEFAULT 0 CHECK (female >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, grade_level, category, modality)
);

CREATE INDEX IF NOT EXISTS idx_enrollment_rows_submission
  ON procurements.sms_report_enrollment_rows (submission_id);

CREATE INDEX IF NOT EXISTS idx_enrollment_rows_submission_cat_mod
  ON procurements.sms_report_enrollment_rows (submission_id, category, modality);

ALTER TABLE procurements.sms_report_enrollment_rows ENABLE ROW LEVEL SECURITY;

-- Helper: check if caller can write to a submission_id
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
          u.type IN ('school_head','admin','registrar')
          AND u.school_id = s.school_id
          AND s.status <> 'locked'
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION procurements.can_write_submission(BIGINT) TO authenticated;

DROP POLICY IF EXISTS "enrollment_rows_select"
  ON procurements.sms_report_enrollment_rows;
CREATE POLICY "enrollment_rows_select"
  ON procurements.sms_report_enrollment_rows FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "enrollment_rows_write"
  ON procurements.sms_report_enrollment_rows;
CREATE POLICY "enrollment_rows_write"
  ON procurements.sms_report_enrollment_rows FOR ALL
  USING (procurements.can_write_submission(submission_id))
  WITH CHECK (procurements.can_write_submission(submission_id));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON procurements.sms_report_enrollment_rows TO authenticated;
GRANT USAGE, SELECT
  ON SEQUENCE procurements.sms_report_enrollment_rows_id_seq TO authenticated;

-- ============================================================================
-- 3. RPC: enrollment_autofill
--    Returns live counts from sms_enrollments for the given
--    (school_id, school_year, semester), grouped by grade level and gender.
--    Schools use this to prefill the submission draft.
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
  SELECT
    e.grade_level,
    COUNT(*) FILTER (WHERE s.gender = 'male')::int  AS male,
    COUNT(*) FILTER (WHERE s.gender = 'female')::int AS female
  FROM procurements.sms_enrollments e
  JOIN procurements.sms_students s ON s.id = e.student_id
  WHERE e.school_id = p_school_id
    AND e.school_year = p_school_year
    AND (
      (p_semester IS NULL AND e.semester IS NULL)
      OR e.semester = p_semester
    )
    AND e.enrollment_status IN (
      'active','completed','promoted','retained','graduated'
    )
  GROUP BY e.grade_level
  ORDER BY e.grade_level;
$$;

GRANT EXECUTE ON FUNCTION procurements.enrollment_autofill(BIGINT, TEXT, SMALLINT)
  TO authenticated;

-- ============================================================================
-- 4. RPC: division_enrollment_summary
--    One row per (school, grade_level) for the given (SY, semester, category, modality).
--    Returns male/female/total columns so the UI can pivot or render grade totals.
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.division_enrollment_summary(
  p_school_year TEXT,
  p_semester SMALLINT DEFAULT NULL,
  p_category TEXT DEFAULT 'enrollment',
  p_modality TEXT DEFAULT 'all',
  p_school_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
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
  WITH latest AS (
    SELECT
      s.id AS school_id,
      s.name AS school_name,
      s.school_type,
      sub.id AS submission_id,
      sub.status
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
  )
  SELECT
    latest.school_id,
    latest.school_name,
    COALESCE(r.grade_level, -99) AS grade_level,
    COALESCE(SUM(r.male)::int, 0) AS male,
    COALESCE(SUM(r.female)::int, 0) AS female,
    COALESCE(SUM(r.male + r.female)::int, 0) AS total,
    COALESCE(latest.status, 'missing') AS status
  FROM latest
  LEFT JOIN procurements.sms_report_enrollment_rows r
    ON r.submission_id = latest.submission_id
    AND r.category = p_category
    AND r.modality = p_modality
  GROUP BY latest.school_id, latest.school_name, r.grade_level, latest.status
  ORDER BY latest.school_name, grade_level;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_enrollment_summary(TEXT, SMALLINT, TEXT, TEXT, TEXT)
  TO authenticated;

-- ============================================================================
-- 5. RPC: upsert_enrollment_rows
--    Replaces all detail rows of a given (category, modality) for a submission.
--    Called by the entry form on Save. The caller must already have write access
--    (enforced by enrollment_rows_write policy via can_write_submission).
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.upsert_enrollment_rows(
  p_submission_id BIGINT,
  p_category TEXT,
  p_modality TEXT,
  p_rows JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = procurements, public
AS $$
DECLARE
  r JSONB;
BEGIN
  -- Remove existing rows for this (category, modality)
  DELETE FROM procurements.sms_report_enrollment_rows
  WHERE submission_id = p_submission_id
    AND category = p_category
    AND modality = p_modality;

  -- Insert new rows; ignore rows where both male and female are 0.
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF COALESCE((r->>'male')::int, 0) > 0
       OR COALESCE((r->>'female')::int, 0) > 0 THEN
      INSERT INTO procurements.sms_report_enrollment_rows
        (submission_id, grade_level, category, modality, male, female)
      VALUES (
        p_submission_id,
        (r->>'grade_level')::int,
        p_category,
        p_modality,
        COALESCE((r->>'male')::int, 0),
        COALESCE((r->>'female')::int, 0)
      );
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.upsert_enrollment_rows(BIGINT, TEXT, TEXT, JSONB)
  TO authenticated;

COMMENT ON TABLE procurements.sms_division_report_submissions IS
  'Per-school submission header (one row per SY × semester × report_type)';
COMMENT ON TABLE procurements.sms_report_enrollment_rows IS
  'Enrollment submission detail: counts by (grade_level, category, modality)';

-- <<< END 072_division_reports_submissions.sql

-- ============================================================================
-- >>> BEGIN 073_division_reports_shs.sql
-- ============================================================================

-- ============================================================================
-- DIVISION REPORTS: SHS (TRACK & STRAND, SPECIALIZATION)
-- ============================================================================
-- Phase 3 — SHS submission-based reports. Reuses:
--   * sms_division_report_submissions header (report_type = 'track_strand' or 'shs_specialization')
--   * procurements.can_write_submission(BIGINT) RLS helper from migration 072
-- Adds two detail tables + indexes + RLS + 4 RPCs.
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- 1. sms_report_track_strand_rows
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_report_track_strand_rows (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL
    REFERENCES procurements.sms_division_report_submissions(id) ON DELETE CASCADE,
  track TEXT NOT NULL CHECK (track IN (
    'academic','tvl','sports','arts_design'
  )),
  strand TEXT NOT NULL,
  grade_level INT NOT NULL CHECK (grade_level IN (11, 12)),
  male INT NOT NULL DEFAULT 0 CHECK (male >= 0),
  female INT NOT NULL DEFAULT 0 CHECK (female >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, track, strand, grade_level)
);

CREATE INDEX IF NOT EXISTS idx_track_strand_rows_submission
  ON procurements.sms_report_track_strand_rows (submission_id);

ALTER TABLE procurements.sms_report_track_strand_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "track_strand_select"
  ON procurements.sms_report_track_strand_rows;
CREATE POLICY "track_strand_select"
  ON procurements.sms_report_track_strand_rows FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "track_strand_write"
  ON procurements.sms_report_track_strand_rows;
CREATE POLICY "track_strand_write"
  ON procurements.sms_report_track_strand_rows FOR ALL
  USING (procurements.can_write_submission(submission_id))
  WITH CHECK (procurements.can_write_submission(submission_id));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON procurements.sms_report_track_strand_rows TO authenticated;
GRANT USAGE, SELECT
  ON SEQUENCE procurements.sms_report_track_strand_rows_id_seq TO authenticated;

-- ============================================================================
-- 2. sms_report_shs_specialization_rows
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_report_shs_specialization_rows (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL
    REFERENCES procurements.sms_division_report_submissions(id) ON DELETE CASCADE,
  strand TEXT NOT NULL,
  specialization TEXT NOT NULL,
  grade_level INT NOT NULL CHECK (grade_level IN (11, 12)),
  male INT NOT NULL DEFAULT 0 CHECK (male >= 0),
  female INT NOT NULL DEFAULT 0 CHECK (female >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, strand, specialization, grade_level)
);

CREATE INDEX IF NOT EXISTS idx_shs_spec_rows_submission
  ON procurements.sms_report_shs_specialization_rows (submission_id);

ALTER TABLE procurements.sms_report_shs_specialization_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shs_spec_select"
  ON procurements.sms_report_shs_specialization_rows;
CREATE POLICY "shs_spec_select"
  ON procurements.sms_report_shs_specialization_rows FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "shs_spec_write"
  ON procurements.sms_report_shs_specialization_rows;
CREATE POLICY "shs_spec_write"
  ON procurements.sms_report_shs_specialization_rows FOR ALL
  USING (procurements.can_write_submission(submission_id))
  WITH CHECK (procurements.can_write_submission(submission_id));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON procurements.sms_report_shs_specialization_rows TO authenticated;
GRANT USAGE, SELECT
  ON SEQUENCE procurements.sms_report_shs_specialization_rows_id_seq TO authenticated;

-- ============================================================================
-- 3. RPC: upsert_track_strand_rows
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.upsert_track_strand_rows(
  p_submission_id BIGINT,
  p_rows JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = procurements, public
AS $$
DECLARE
  r JSONB;
BEGIN
  DELETE FROM procurements.sms_report_track_strand_rows
  WHERE submission_id = p_submission_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF COALESCE((r->>'male')::int, 0) > 0
       OR COALESCE((r->>'female')::int, 0) > 0 THEN
      INSERT INTO procurements.sms_report_track_strand_rows
        (submission_id, track, strand, grade_level, male, female)
      VALUES (
        p_submission_id,
        r->>'track',
        r->>'strand',
        (r->>'grade_level')::int,
        COALESCE((r->>'male')::int, 0),
        COALESCE((r->>'female')::int, 0)
      );
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.upsert_track_strand_rows(BIGINT, JSONB)
  TO authenticated;

-- ============================================================================
-- 4. RPC: upsert_shs_specialization_rows
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.upsert_shs_specialization_rows(
  p_submission_id BIGINT,
  p_rows JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = procurements, public
AS $$
DECLARE
  r JSONB;
BEGIN
  DELETE FROM procurements.sms_report_shs_specialization_rows
  WHERE submission_id = p_submission_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF COALESCE((r->>'male')::int, 0) > 0
       OR COALESCE((r->>'female')::int, 0) > 0 THEN
      INSERT INTO procurements.sms_report_shs_specialization_rows
        (submission_id, strand, specialization, grade_level, male, female)
      VALUES (
        p_submission_id,
        r->>'strand',
        r->>'specialization',
        (r->>'grade_level')::int,
        COALESCE((r->>'male')::int, 0),
        COALESCE((r->>'female')::int, 0)
      );
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.upsert_shs_specialization_rows(BIGINT, JSONB)
  TO authenticated;

-- ============================================================================
-- 5. RPC: division_track_strand_summary
--    One row per (school, track, strand) for the given (SY, semester).
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.division_track_strand_summary(
  p_school_year TEXT,
  p_semester SMALLINT,
  p_grade_level INT DEFAULT NULL
)
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  track TEXT,
  strand TEXT,
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
  WITH latest AS (
    SELECT
      s.id AS school_id,
      s.name AS school_name,
      sub.id AS submission_id,
      sub.status
    FROM procurements.sms_schools s
    LEFT JOIN procurements.sms_division_report_submissions sub
      ON sub.school_id = s.id
      AND sub.school_year = p_school_year
      AND sub.semester = p_semester
      AND sub.report_type = 'track_strand'
    WHERE s.is_active
  )
  SELECT
    latest.school_id,
    latest.school_name,
    COALESCE(r.track, '') AS track,
    COALESCE(r.strand, '') AS strand,
    COALESCE(r.grade_level, 0) AS grade_level,
    COALESCE(r.male, 0) AS male,
    COALESCE(r.female, 0) AS female,
    COALESCE(r.male, 0) + COALESCE(r.female, 0) AS total,
    COALESCE(latest.status, 'missing') AS status
  FROM latest
  LEFT JOIN procurements.sms_report_track_strand_rows r
    ON r.submission_id = latest.submission_id
    AND (p_grade_level IS NULL OR r.grade_level = p_grade_level)
  ORDER BY latest.school_name, track, strand, grade_level;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_track_strand_summary(TEXT, SMALLINT, INT)
  TO authenticated;

-- ============================================================================
-- 6. RPC: division_shs_specialization_summary
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.division_shs_specialization_summary(
  p_school_year TEXT,
  p_semester SMALLINT,
  p_grade_level INT DEFAULT NULL,
  p_strand TEXT DEFAULT NULL
)
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  strand TEXT,
  specialization TEXT,
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
  WITH latest AS (
    SELECT
      s.id AS school_id,
      s.name AS school_name,
      sub.id AS submission_id,
      sub.status
    FROM procurements.sms_schools s
    LEFT JOIN procurements.sms_division_report_submissions sub
      ON sub.school_id = s.id
      AND sub.school_year = p_school_year
      AND sub.semester = p_semester
      AND sub.report_type = 'shs_specialization'
    WHERE s.is_active
  )
  SELECT
    latest.school_id,
    latest.school_name,
    COALESCE(r.strand, '') AS strand,
    COALESCE(r.specialization, '') AS specialization,
    COALESCE(r.grade_level, 0) AS grade_level,
    COALESCE(r.male, 0) AS male,
    COALESCE(r.female, 0) AS female,
    COALESCE(r.male, 0) + COALESCE(r.female, 0) AS total,
    COALESCE(latest.status, 'missing') AS status
  FROM latest
  LEFT JOIN procurements.sms_report_shs_specialization_rows r
    ON r.submission_id = latest.submission_id
    AND (p_grade_level IS NULL OR r.grade_level = p_grade_level)
    AND (p_strand IS NULL OR r.strand = p_strand)
  ORDER BY latest.school_name, strand, specialization, grade_level;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_shs_specialization_summary(TEXT, SMALLINT, INT, TEXT)
  TO authenticated;

COMMENT ON TABLE procurements.sms_report_track_strand_rows IS
  'Track & Strand submission detail: SHS learners by track, strand, grade level';
COMMENT ON TABLE procurements.sms_report_shs_specialization_rows IS
  'SHS Specialization submission detail: learners by strand, specialization, grade level';

-- <<< END 073_division_reports_shs.sql

-- ============================================================================
-- >>> BEGIN 074_division_reports_teaching_spec.sql
-- ============================================================================

-- ============================================================================
-- DIVISION REPORTS: TEACHING SPECIALIZATION + LOCK SY
-- ============================================================================
-- Phase 4: Teaching Specialization submission-based report + division admin
-- bulk lock/unlock RPC. Reuses sms_division_report_submissions (migration 072)
-- and the can_write_submission RLS helper.
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- 1. sms_report_teaching_specialization_rows
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_report_teaching_specialization_rows (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL
    REFERENCES procurements.sms_division_report_submissions(id) ON DELETE CASCADE,
  learning_area TEXT NOT NULL,
  male INT NOT NULL DEFAULT 0 CHECK (male >= 0),
  female INT NOT NULL DEFAULT 0 CHECK (female >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, learning_area)
);

CREATE INDEX IF NOT EXISTS idx_teaching_spec_rows_submission
  ON procurements.sms_report_teaching_specialization_rows (submission_id);

ALTER TABLE procurements.sms_report_teaching_specialization_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teaching_spec_select"
  ON procurements.sms_report_teaching_specialization_rows;
CREATE POLICY "teaching_spec_select"
  ON procurements.sms_report_teaching_specialization_rows FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "teaching_spec_write"
  ON procurements.sms_report_teaching_specialization_rows;
CREATE POLICY "teaching_spec_write"
  ON procurements.sms_report_teaching_specialization_rows FOR ALL
  USING (procurements.can_write_submission(submission_id))
  WITH CHECK (procurements.can_write_submission(submission_id));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON procurements.sms_report_teaching_specialization_rows TO authenticated;
GRANT USAGE, SELECT
  ON SEQUENCE procurements.sms_report_teaching_specialization_rows_id_seq TO authenticated;

-- ============================================================================
-- 2. RPC: upsert_teaching_specialization_rows
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.upsert_teaching_specialization_rows(
  p_submission_id BIGINT,
  p_rows JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = procurements, public
AS $$
DECLARE
  r JSONB;
BEGIN
  DELETE FROM procurements.sms_report_teaching_specialization_rows
  WHERE submission_id = p_submission_id;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF COALESCE((r->>'male')::int, 0) > 0
       OR COALESCE((r->>'female')::int, 0) > 0 THEN
      INSERT INTO procurements.sms_report_teaching_specialization_rows
        (submission_id, learning_area, male, female)
      VALUES (
        p_submission_id,
        r->>'learning_area',
        COALESCE((r->>'male')::int, 0),
        COALESCE((r->>'female')::int, 0)
      );
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.upsert_teaching_specialization_rows(BIGINT, JSONB)
  TO authenticated;

-- ============================================================================
-- 3. RPC: division_teaching_specialization_summary
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.division_teaching_specialization_summary(
  p_school_year TEXT
)
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  learning_area TEXT,
  male INT,
  female INT,
  total INT,
  status TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  WITH latest AS (
    SELECT
      s.id AS school_id,
      s.name AS school_name,
      sub.id AS submission_id,
      sub.status
    FROM procurements.sms_schools s
    LEFT JOIN procurements.sms_division_report_submissions sub
      ON sub.school_id = s.id
      AND sub.school_year = p_school_year
      AND sub.semester IS NULL
      AND sub.report_type = 'teaching_specialization'
    WHERE s.is_active
  )
  SELECT
    latest.school_id,
    latest.school_name,
    COALESCE(r.learning_area, '') AS learning_area,
    COALESCE(r.male, 0) AS male,
    COALESCE(r.female, 0) AS female,
    COALESCE(r.male, 0) + COALESCE(r.female, 0) AS total,
    COALESCE(latest.status, 'missing') AS status
  FROM latest
  LEFT JOIN procurements.sms_report_teaching_specialization_rows r
    ON r.submission_id = latest.submission_id
  ORDER BY latest.school_name, learning_area;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_teaching_specialization_summary(TEXT)
  TO authenticated;

-- ============================================================================
-- 4. RPC: bulk_lock_submissions
--    Division admin only. Flips status between 'locked' and 'submitted'
--    for all matching submissions in a given (SY, optional semester, optional type).
--    Only submissions currently in 'submitted' or 'locked' are affected — drafts
--    are ignored to avoid locking empty drafts.
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.bulk_lock_submissions(
  p_school_year TEXT,
  p_lock BOOLEAN,
  p_semester SMALLINT DEFAULT NULL,
  p_report_type TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  affected INT;
BEGIN
  -- Division admin only
  IF NOT EXISTS (
    SELECT 1 FROM procurements.sms_users u
    WHERE u.user_id = auth.uid()
      AND u.is_active
      AND u.type IN ('division_admin','division_type')
  ) THEN
    RAISE EXCEPTION 'Only division admins may lock/unlock submissions';
  END IF;

  UPDATE procurements.sms_division_report_submissions
  SET
    status = CASE WHEN p_lock THEN 'locked' ELSE 'submitted' END,
    updated_at = NOW()
  WHERE school_year = p_school_year
    AND (p_semester IS NULL OR semester = p_semester OR
         (p_semester IS NULL AND semester IS NULL))
    AND (p_report_type IS NULL OR report_type = p_report_type)
    AND status IN ('submitted','locked')
    AND status <> (CASE WHEN p_lock THEN 'locked' ELSE 'submitted' END);

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.bulk_lock_submissions(TEXT, BOOLEAN, SMALLINT, TEXT)
  TO authenticated;

-- ============================================================================
-- 5. RPC: division_submissions_overview
--    Lists every (school × SY × semester × report_type) slot with its current
--    status. Powers the Lock-SY admin page and helps spot missing submissions.
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.division_submissions_overview(
  p_school_year TEXT
)
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  report_type TEXT,
  semester SMALLINT,
  submission_id BIGINT,
  status TEXT,
  submitted_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  WITH slots AS (
    SELECT s.id AS school_id, s.name AS school_name, rt.report_type, sem.semester
    FROM procurements.sms_schools s
    CROSS JOIN (
      VALUES
        ('enrollment'::TEXT),
        ('track_strand'),
        ('shs_specialization'),
        ('teaching_specialization')
    ) AS rt(report_type)
    CROSS JOIN (
      VALUES (NULL::SMALLINT), (1::SMALLINT), (2::SMALLINT)
    ) AS sem(semester)
    WHERE s.is_active
      AND (
        (rt.report_type IN ('enrollment','teaching_specialization') AND sem.semester IS NULL)
        OR (rt.report_type IN ('track_strand','shs_specialization') AND sem.semester IS NOT NULL)
      )
  )
  SELECT
    slots.school_id,
    slots.school_name,
    slots.report_type,
    slots.semester,
    sub.id AS submission_id,
    COALESCE(sub.status, 'missing') AS status,
    sub.submitted_at
  FROM slots
  LEFT JOIN procurements.sms_division_report_submissions sub
    ON sub.school_id = slots.school_id
    AND sub.school_year = p_school_year
    AND sub.report_type = slots.report_type
    AND (
      (slots.semester IS NULL AND sub.semester IS NULL)
      OR sub.semester = slots.semester
    )
  ORDER BY slots.school_name, slots.report_type, slots.semester NULLS FIRST;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_submissions_overview(TEXT)
  TO authenticated;

COMMENT ON TABLE procurements.sms_report_teaching_specialization_rows IS
  'Teaching Specialization submission detail: teachers by learning area';

-- <<< END 074_division_reports_teaching_spec.sql

-- ============================================================================
-- >>> BEGIN 075_division_reports_school_type.sql
-- ============================================================================

-- ============================================================================
-- DIVISION REPORTS: expose school_type on all report RPCs
-- ============================================================================
-- Polish migration. Adds `school_type TEXT` to the result of every division
-- report RPC that didn't already expose it, so the UI can filter by school
-- type (Elementary / Junior High / Senior High / etc.) client-side without
-- round-tripping.
-- ============================================================================

SET search_path TO procurements, public;

-- ---------------------------------------------------------------------------
-- division_enrollment_summary — already takes p_school_type; now also returns it
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS procurements.division_enrollment_summary(
  TEXT, SMALLINT, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION procurements.division_enrollment_summary(
  p_school_year TEXT,
  p_semester SMALLINT DEFAULT NULL,
  p_category TEXT DEFAULT 'enrollment',
  p_modality TEXT DEFAULT 'all',
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
  WITH latest AS (
    SELECT
      s.id AS school_id,
      s.name AS school_name,
      s.school_type,
      sub.id AS submission_id,
      sub.status
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
  )
  SELECT
    latest.school_id,
    latest.school_name,
    latest.school_type,
    COALESCE(r.grade_level, -99) AS grade_level,
    COALESCE(SUM(r.male)::int, 0) AS male,
    COALESCE(SUM(r.female)::int, 0) AS female,
    COALESCE(SUM(r.male + r.female)::int, 0) AS total,
    COALESCE(latest.status, 'missing') AS status
  FROM latest
  LEFT JOIN procurements.sms_report_enrollment_rows r
    ON r.submission_id = latest.submission_id
    AND r.category = p_category
    AND r.modality = p_modality
  GROUP BY latest.school_id, latest.school_name, latest.school_type,
           r.grade_level, latest.status
  ORDER BY latest.school_name, grade_level;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_enrollment_summary(TEXT, SMALLINT, TEXT, TEXT, TEXT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- division_track_strand_summary
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS procurements.division_track_strand_summary(
  TEXT, SMALLINT, INT
);

CREATE OR REPLACE FUNCTION procurements.division_track_strand_summary(
  p_school_year TEXT,
  p_semester SMALLINT,
  p_grade_level INT DEFAULT NULL
)
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  school_type TEXT,
  track TEXT,
  strand TEXT,
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
  WITH latest AS (
    SELECT
      s.id AS school_id,
      s.name AS school_name,
      s.school_type,
      sub.id AS submission_id,
      sub.status
    FROM procurements.sms_schools s
    LEFT JOIN procurements.sms_division_report_submissions sub
      ON sub.school_id = s.id
      AND sub.school_year = p_school_year
      AND sub.semester = p_semester
      AND sub.report_type = 'track_strand'
    WHERE s.is_active
  )
  SELECT
    latest.school_id,
    latest.school_name,
    latest.school_type,
    COALESCE(r.track, '') AS track,
    COALESCE(r.strand, '') AS strand,
    COALESCE(r.grade_level, 0) AS grade_level,
    COALESCE(r.male, 0) AS male,
    COALESCE(r.female, 0) AS female,
    COALESCE(r.male, 0) + COALESCE(r.female, 0) AS total,
    COALESCE(latest.status, 'missing') AS status
  FROM latest
  LEFT JOIN procurements.sms_report_track_strand_rows r
    ON r.submission_id = latest.submission_id
    AND (p_grade_level IS NULL OR r.grade_level = p_grade_level)
  ORDER BY latest.school_name, track, strand, grade_level;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_track_strand_summary(TEXT, SMALLINT, INT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- division_shs_specialization_summary
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS procurements.division_shs_specialization_summary(
  TEXT, SMALLINT, INT, TEXT
);

CREATE OR REPLACE FUNCTION procurements.division_shs_specialization_summary(
  p_school_year TEXT,
  p_semester SMALLINT,
  p_grade_level INT DEFAULT NULL,
  p_strand TEXT DEFAULT NULL
)
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  school_type TEXT,
  strand TEXT,
  specialization TEXT,
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
  WITH latest AS (
    SELECT
      s.id AS school_id,
      s.name AS school_name,
      s.school_type,
      sub.id AS submission_id,
      sub.status
    FROM procurements.sms_schools s
    LEFT JOIN procurements.sms_division_report_submissions sub
      ON sub.school_id = s.id
      AND sub.school_year = p_school_year
      AND sub.semester = p_semester
      AND sub.report_type = 'shs_specialization'
    WHERE s.is_active
  )
  SELECT
    latest.school_id,
    latest.school_name,
    latest.school_type,
    COALESCE(r.strand, '') AS strand,
    COALESCE(r.specialization, '') AS specialization,
    COALESCE(r.grade_level, 0) AS grade_level,
    COALESCE(r.male, 0) AS male,
    COALESCE(r.female, 0) AS female,
    COALESCE(r.male, 0) + COALESCE(r.female, 0) AS total,
    COALESCE(latest.status, 'missing') AS status
  FROM latest
  LEFT JOIN procurements.sms_report_shs_specialization_rows r
    ON r.submission_id = latest.submission_id
    AND (p_grade_level IS NULL OR r.grade_level = p_grade_level)
    AND (p_strand IS NULL OR r.strand = p_strand)
  ORDER BY latest.school_name, strand, specialization, grade_level;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_shs_specialization_summary(TEXT, SMALLINT, INT, TEXT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- division_teaching_specialization_summary
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS procurements.division_teaching_specialization_summary(TEXT);

CREATE OR REPLACE FUNCTION procurements.division_teaching_specialization_summary(
  p_school_year TEXT
)
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  school_type TEXT,
  learning_area TEXT,
  male INT,
  female INT,
  total INT,
  status TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  WITH latest AS (
    SELECT
      s.id AS school_id,
      s.name AS school_name,
      s.school_type,
      sub.id AS submission_id,
      sub.status
    FROM procurements.sms_schools s
    LEFT JOIN procurements.sms_division_report_submissions sub
      ON sub.school_id = s.id
      AND sub.school_year = p_school_year
      AND sub.semester IS NULL
      AND sub.report_type = 'teaching_specialization'
    WHERE s.is_active
  )
  SELECT
    latest.school_id,
    latest.school_name,
    latest.school_type,
    COALESCE(r.learning_area, '') AS learning_area,
    COALESCE(r.male, 0) AS male,
    COALESCE(r.female, 0) AS female,
    COALESCE(r.male, 0) + COALESCE(r.female, 0) AS total,
    COALESCE(latest.status, 'missing') AS status
  FROM latest
  LEFT JOIN procurements.sms_report_teaching_specialization_rows r
    ON r.submission_id = latest.submission_id
  ORDER BY latest.school_name, learning_area;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_teaching_specialization_summary(TEXT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- division_non_teaching_summary
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS procurements.division_non_teaching_summary();

CREATE OR REPLACE FUNCTION procurements.division_non_teaching_summary()
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  school_type TEXT,
  staff_category_code TEXT,
  staff_category_label TEXT,
  total BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT
    s.id AS school_id,
    s.name AS school_name,
    s.school_type,
    COALESCE(c.code, 'other') AS staff_category_code,
    COALESCE(c.label, 'Other Non-Teaching') AS staff_category_label,
    COUNT(u.id) AS total
  FROM procurements.sms_schools s
  LEFT JOIN procurements.sms_users u
    ON u.school_id = s.id
    AND u.is_active
    AND u.type <> 'teacher'
    AND u.type NOT IN ('division_admin','division_type','super admin')
  LEFT JOIN procurements.sms_staff_categories c
    ON c.code = COALESCE(u.staff_category_code, 'other')
  WHERE s.is_active
  GROUP BY s.id, s.name, s.school_type, c.code, c.label
  ORDER BY s.name, staff_category_label;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_non_teaching_summary() TO authenticated;

-- ---------------------------------------------------------------------------
-- division_rooms_summary
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS procurements.division_rooms_summary();

CREATE OR REPLACE FUNCTION procurements.division_rooms_summary()
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  school_type TEXT,
  room_type TEXT,
  condition TEXT,
  total BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT
    s.id AS school_id,
    s.name AS school_name,
    s.school_type,
    COALESCE(r.room_type, 'other') AS room_type,
    COALESCE(r.condition, 'unspecified') AS condition,
    COUNT(r.id) AS total
  FROM procurements.sms_schools s
  LEFT JOIN procurements.sms_rooms r
    ON r.school_id = s.id
    AND r.is_active
  WHERE s.is_active
  GROUP BY s.id, s.name, s.school_type, r.room_type, r.condition
  ORDER BY s.name, room_type, condition;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_rooms_summary() TO authenticated;

-- ---------------------------------------------------------------------------
-- division_classroom_needs
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS procurements.division_classroom_needs(TEXT);

CREATE OR REPLACE FUNCTION procurements.division_classroom_needs(
  p_school_year TEXT
)
RETURNS TABLE (
  school_id BIGINT,
  school_name TEXT,
  school_type TEXT,
  grade_level INT,
  enrolled BIGINT,
  standard_class_size INT,
  classrooms_needed INT,
  classrooms_available BIGINT,
  delta INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  WITH enroll AS (
    SELECT
      st.school_id,
      e.grade_level,
      COUNT(*) AS enrolled
    FROM procurements.sms_enrollments e
    JOIN procurements.sms_students st ON st.id = e.student_id
    WHERE e.school_year = p_school_year
      AND e.status IN ('active','promoted','retained','graduated','completed')
    GROUP BY st.school_id, e.grade_level
  ),
  classrooms AS (
    SELECT
      r.school_id,
      COUNT(*) AS classrooms_available
    FROM procurements.sms_rooms r
    WHERE r.is_active AND r.room_type = 'classroom'
    GROUP BY r.school_id
  )
  SELECT
    s.id AS school_id,
    s.name AS school_name,
    s.school_type,
    COALESCE(e.grade_level, 0) AS grade_level,
    COALESCE(e.enrolled, 0) AS enrolled,
    COALESCE(st.max_students, 40) AS standard_class_size,
    CEIL(COALESCE(e.enrolled, 0)::numeric / GREATEST(COALESCE(st.max_students, 40), 1))::int
      AS classrooms_needed,
    COALESCE(c.classrooms_available, 0) AS classrooms_available,
    (COALESCE(c.classrooms_available, 0)::int
      - CEIL(COALESCE(e.enrolled, 0)::numeric / GREATEST(COALESCE(st.max_students, 40), 1))::int
    ) AS delta
  FROM procurements.sms_schools s
  LEFT JOIN enroll e ON e.school_id = s.id
  LEFT JOIN classrooms c ON c.school_id = s.id
  LEFT JOIN procurements.sms_class_size_standards st
    ON st.grade_level = e.grade_level
  WHERE s.is_active
  ORDER BY s.name, grade_level;
$$;

GRANT EXECUTE ON FUNCTION procurements.division_classroom_needs(TEXT) TO authenticated;

-- <<< END 075_division_reports_school_type.sql

-- ============================================================================
-- >>> BEGIN 076_exclude_madrasah_from_gpa.sql
-- ============================================================================

-- ============================================================================
-- FUNCTION: get_student_previous_gpa (replacement)
-- Same behavior as migration 036, but excludes grades from madrasah subjects
-- (sms_subjects.is_madrasah = true) from the average.
-- DepEd practice: MEP subjects do not count toward the General Average / GPA.
-- ============================================================================

CREATE OR REPLACE FUNCTION procurements.get_student_previous_gpa(
  p_student_id BIGINT,
  p_grade_level INTEGER,
  p_school_id BIGINT DEFAULT NULL
)
RETURNS NUMERIC AS $$
DECLARE
  v_section_id BIGINT;
  v_school_year TEXT;
  v_gpa NUMERIC;
BEGIN
  SELECT e.section_id, e.school_year
    INTO v_section_id, v_school_year
    FROM procurements.sms_enrollments e
   WHERE e.student_id = p_student_id
     AND e.grade_level = p_grade_level - 1
     AND e.status = 'approved'
     AND (p_school_id IS NULL OR e.school_id = p_school_id)
   ORDER BY e.school_year DESC
   LIMIT 1;

  IF v_section_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ROUND(AVG(g.grade)::numeric, 2)
    INTO v_gpa
    FROM procurements.sms_grades g
    JOIN procurements.sms_subjects s ON s.id = g.subject_id
   WHERE g.student_id  = p_student_id
     AND g.section_id  = v_section_id
     AND g.school_year = v_school_year
     AND COALESCE(s.is_madrasah, false) = false;

  RETURN v_gpa;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION procurements.get_student_previous_gpa IS
  'Returns the average grade from a student''s most recent approved enrollment at (grade_level - 1), excluding madrasah subjects. NULL if no data.';

-- <<< END 076_exclude_madrasah_from_gpa.sql

-- ============================================================================
-- >>> BEGIN 077_school_landing_hero.sql
-- ============================================================================

-- ============================================================================
-- PUBLIC SCHOOL PAGE: hero image from school settings
-- ============================================================================
-- Staff set landing_hero_image_url in sms_school_settings (School Settings).
-- Anonymous users read it only via SECURITY DEFINER RPC (not full settings row).
-- ============================================================================

ALTER TABLE procurements.sms_school_settings
  ADD COLUMN IF NOT EXISTS landing_hero_image_url TEXT DEFAULT NULL;

COMMENT ON COLUMN procurements.sms_school_settings.landing_hero_image_url IS
  'Background image URL for the public school page (/schools/[id]); optional.';

CREATE OR REPLACE FUNCTION public.get_school_landing_hero(p_school_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT landing_hero_image_url
  FROM procurements.sms_school_settings
  WHERE school_id = p_school_id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_school_landing_hero(TEXT) IS
  'Returns landing hero image URL for public school profile; callable by anon.';

GRANT EXECUTE ON FUNCTION public.get_school_landing_hero(TEXT) TO anon, authenticated;

-- <<< END 077_school_landing_hero.sql

-- ============================================================================
-- >>> BEGIN 078_storage_school_management.sql
-- ============================================================================

-- ============================================================================
-- STORAGE: school-management bucket (public landing hero + future school assets)
-- ============================================================================
-- Public bucket: hero images load on /schools/[id] via public object URLs.
-- Storage API SELECT/INSERT/UPDATE/DELETE: authenticated only (see policies below).
-- Writes restricted: landing-hero/{sms_schools.id}/... matches caller's school,
-- or division_admin for any path under landing-hero/.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('school-management', 'school-management', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "school_management public read" ON storage.objects;
DROP POLICY IF EXISTS "school_management authenticated read" ON storage.objects;
DROP POLICY IF EXISTS "school_management staff insert" ON storage.objects;
DROP POLICY IF EXISTS "school_management staff update" ON storage.objects;
DROP POLICY IF EXISTS "school_management staff delete" ON storage.objects;

CREATE POLICY "school_management authenticated read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'school-management');

CREATE POLICY "school_management staff insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'school-management'
    AND split_part(name, '/', 1) = 'landing-hero'
    AND (
      EXISTS (
        SELECT 1 FROM procurements.sms_users u
        WHERE u.user_id = auth.uid() AND u.type = 'division_admin'
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
        WHERE u.user_id = auth.uid() AND u.type = 'division_admin'
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
        WHERE u.user_id = auth.uid() AND u.type = 'division_admin'
      )
      OR split_part(name, '/', 2) = (
        SELECT u.school_id::text FROM procurements.sms_users u
        WHERE u.user_id = auth.uid() LIMIT 1
      )
    )
  );

-- <<< END 078_storage_school_management.sql

-- ============================================================================
-- >>> BEGIN 079_school_slug.sql
-- ============================================================================

-- ============================================================================
-- SCHOOL SLUG: pretty URL segment for /schools/[slug]
-- ============================================================================
-- Adds sms_schools.slug (auto-generated from name on insert when blank).
-- - Backfills existing rows; collisions disambiguated by appending the row id.
-- - lower(slug) UNIQUE INDEX so lookups are case-insensitive but stable.
-- - BEFORE INSERT/UPDATE trigger normalizes user-entered slugs and fills blanks.
-- ============================================================================

SET search_path TO procurements, public;

-- ----------------------------------------------------------------------------
-- Helper: convert text to URL-safe slug (lowercase, hyphen-separated)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.sms_slugify(p_input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_result TEXT;
BEGIN
  IF p_input IS NULL THEN
    RETURN NULL;
  END IF;
  v_result := lower(p_input);
  v_result := regexp_replace(v_result, '[^a-z0-9]+', '-', 'g');
  v_result := regexp_replace(v_result, '^-+|-+$', '', 'g');
  RETURN NULLIF(v_result, '');
END;
$$;

-- ----------------------------------------------------------------------------
-- Add column (nullable so backfill can run)
-- ----------------------------------------------------------------------------
ALTER TABLE procurements.sms_schools
  ADD COLUMN IF NOT EXISTS slug TEXT;

-- ----------------------------------------------------------------------------
-- Backfill: every existing row gets a slug; duplicates disambiguated by id.
-- ----------------------------------------------------------------------------
WITH computed AS (
  SELECT
    id,
    CASE
      WHEN COUNT(*) OVER (PARTITION BY procurements.sms_slugify(name)) > 1
        THEN procurements.sms_slugify(name) || '-' || id::TEXT
      ELSE procurements.sms_slugify(name)
    END AS new_slug
  FROM procurements.sms_schools
  WHERE slug IS NULL OR length(trim(slug)) = 0
)
UPDATE procurements.sms_schools s
SET slug = COALESCE(c.new_slug, 'school-' || s.id::TEXT)
FROM computed c
WHERE s.id = c.id;

-- Lock down: slug is required from here on.
ALTER TABLE procurements.sms_schools
  ALTER COLUMN slug SET NOT NULL;

-- Case-insensitive uniqueness so /schools/foo and /schools/FOO can't collide.
CREATE UNIQUE INDEX IF NOT EXISTS sms_schools_slug_lower_unique
  ON procurements.sms_schools (lower(slug));

-- Lookup index for the public landing page query.
CREATE INDEX IF NOT EXISTS idx_sms_schools_slug
  ON procurements.sms_schools (slug);

COMMENT ON COLUMN procurements.sms_schools.slug IS
  'URL-safe identifier for the public school page (/schools/[slug]); auto-generated from name when blank.';

-- ----------------------------------------------------------------------------
-- Trigger: normalize / auto-fill slug, with collision suffixing
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procurements.sms_schools_set_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_base TEXT;
  v_candidate TEXT;
  v_n INT := 1;
BEGIN
  IF NEW.slug IS NULL OR length(trim(NEW.slug)) = 0 THEN
    v_base := procurements.sms_slugify(NEW.name);
    IF v_base IS NULL OR v_base = '' THEN
      v_base := 'school';
    END IF;
  ELSE
    v_base := procurements.sms_slugify(NEW.slug);
    IF v_base IS NULL OR v_base = '' THEN
      v_base := procurements.sms_slugify(NEW.name);
    END IF;
    IF v_base IS NULL OR v_base = '' THEN
      v_base := 'school';
    END IF;
  END IF;

  v_candidate := v_base;

  WHILE EXISTS (
    SELECT 1 FROM procurements.sms_schools
    WHERE lower(slug) = lower(v_candidate)
      AND id IS DISTINCT FROM NEW.id
  ) LOOP
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n::TEXT;
  END LOOP;

  NEW.slug := v_candidate;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sms_schools_set_slug_trg ON procurements.sms_schools;
CREATE TRIGGER sms_schools_set_slug_trg
  BEFORE INSERT OR UPDATE OF slug ON procurements.sms_schools
  FOR EACH ROW EXECUTE FUNCTION procurements.sms_schools_set_slug();

-- <<< END 079_school_slug.sql

COMMIT;
