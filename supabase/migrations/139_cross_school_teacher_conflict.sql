-- ============================================================================
-- Migration 139: Make the teacher double-booking check see every school
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
