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
  'Physical room size in metres as written on paper, e.g. "40 x 30". Free TEXT, shape validated in the app (lib/utils/roomDimension.ts); NULL = not measured. Printed as the Classroom Size column of the Classroom Enrollment and Size report (migration 138).';

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
  'Classroom this section occupies (sms_rooms.id). NULL = none assigned. Distinct from sms_subject_schedules.room_id, which is where one subject meets. Source of the Classroom Size and Capacity columns of the Classroom Enrollment and Size report (migration 138).';
