/**
 * "Classroom Enrollment and Size" data, shared by the report page and its
 * printable. One row per section of the current school year, with the section's
 * classroom (migration 137) and its actual enrollee count.
 */

import { supabase } from "@/lib/supabase/client";
import { formatRoomDimension } from "@/lib/utils/roomDimension";

/**
 * Lifecycle values that mean the learner is (or finished the year) enrolled in
 * this section. `enrollment_status` is the lifecycle column; `status` is the
 * approval one — mixing them up is what migration 109 had to repair.
 * Deliberately excluded: transferred_out, dropped, pending_transfer.
 */
export const ENROLLED_LIFECYCLE_STATUSES = [
  "active",
  "promoted",
  "retained",
  "graduated",
  "completed",
];

export interface ClassroomEnrollmentRow {
  sectionId: string;
  gradeLevel: number;
  sectionName: string;
  roomName: string | null;
  /** Room dimension as stored, e.g. "40 x 30". */
  dimension: string | null;
  /** Display form of the dimension, e.g. "40 × 30 m". */
  classroomSize: string;
  capacity: number | null;
  enrollees: number;
  remarks: string;
}

interface SectionQueryRow {
  id: number;
  name: string;
  grade_level: number;
  room_id: number | null;
  sms_rooms: { name: string; dimension: string | null; capacity: number | null } | null;
}

/**
 * Remarks are derived, never stored: the sheet is a snapshot of how the
 * classrooms sit today. Blank when there is nothing to say, so the printed
 * form still leaves room for a handwritten note.
 */
function buildRemarks(
  roomName: string | null,
  capacity: number | null,
  enrollees: number,
): string {
  if (!roomName) return "No classroom assigned";
  if (capacity == null || capacity <= 0) return "";
  if (enrollees > capacity) return `Over capacity by ${enrollees - capacity}`;
  if (enrollees === capacity) return "At full capacity";
  return `${capacity - enrollees} vacant`;
}

/**
 * Every section of one school for one school year, with its classroom and the
 * number of learners actually enrolled in it.
 */
export async function fetchClassroomEnrollment(
  schoolId: string | number,
  schoolYear: string,
): Promise<ClassroomEnrollmentRow[]> {
  const { data, error } = await supabase
    .from("sms_sections")
    .select(
      `id, name, grade_level, room_id,
       sms_rooms ( name, dimension, capacity )`,
    )
    .eq("school_id", schoolId)
    .eq("school_year", schoolYear)
    .eq("is_active", true);

  if (error) throw error;
  const sections = (data ?? []) as unknown as SectionQueryRow[];
  if (sections.length === 0) return [];

  // Enrollee counts for every section in one batched query rather than per row.
  const { data: enrollments, error: enrollError } = await supabase
    .from("sms_enrollments")
    .select("section_id")
    .eq("school_id", schoolId)
    .eq("school_year", schoolYear)
    .in(
      "section_id",
      sections.map((s) => Number(s.id)),
    )
    .in("enrollment_status", ENROLLED_LIFECYCLE_STATUSES);

  if (enrollError) throw enrollError;

  const enrolleesBySection = new Map<string, number>();
  enrollments?.forEach((e) => {
    const sid = String(e.section_id);
    enrolleesBySection.set(sid, (enrolleesBySection.get(sid) || 0) + 1);
  });

  return sections
    .map((section) => {
      const room = section.sms_rooms;
      const roomName = room?.name ?? null;
      const capacity = room?.capacity ?? null;
      const enrollees = enrolleesBySection.get(String(section.id)) || 0;

      return {
        sectionId: String(section.id),
        gradeLevel: section.grade_level,
        sectionName: section.name,
        roomName,
        dimension: room?.dimension ?? null,
        classroomSize: formatRoomDimension(room?.dimension),
        capacity,
        enrollees,
        remarks: buildRemarks(roomName, capacity, enrollees),
      };
    })
    .sort(
      (a, b) =>
        a.gradeLevel - b.gradeLevel ||
        a.sectionName.localeCompare(b.sectionName),
    );
}
