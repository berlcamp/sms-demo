import { EXCLUDE_TEST_SCHOOLS_OR } from "@/lib/constants/landing";
import { supabase } from "@/lib/supabase/client";

/** One school's learners at one grade level, split by sex. */
export interface PublicEnrollmentCount {
  school_id: number;
  grade_level: number;
  male: number;
  female: number;
}

/**
 * Enrollment lifecycle statuses that mean "this learner is on the roll".
 *
 * Copied verbatim from 072's `enrollment_autofill` so the public figures, a
 * school's own autofill and the division report cannot disagree. Note this is
 * `enrollment_status` (lifecycle), NOT `status` (the approval workflow) — see
 * migration 109.
 */
const ENROLLED_LIFECYCLE = [
  "active",
  "completed",
  "promoted",
  "retained",
  "graduated",
];

interface FallbackRow {
  school_id: number | null;
  grade_level: number | null;
  student_id: number | null;
  student: { gender: string | null } | null;
}

/**
 * Per-school, per-grade learner counts for the public landing pages.
 *
 * Aggregates in SQL (migration 141) rather than pulling every enrollment row
 * into the browser — the collection response is subject to the PostgREST row
 * cap, so client-side counting silently stops growing once the division passes
 * it. Falls back to the old client-side path only if the RPC is missing, which
 * is the window between deploying this code and applying migration 141.
 */
export async function fetchPublicEnrollmentCounts(
  schoolYear: string,
): Promise<PublicEnrollmentCount[]> {
  const { data, error } = await supabase.rpc("public_enrollment_counts", {
    p_school_year: schoolYear,
  });

  if (!error) {
    return ((data as PublicEnrollmentCount[]) || []).map((r) => ({
      school_id: Number(r.school_id),
      grade_level: Number(r.grade_level),
      male: Number(r.male || 0),
      female: Number(r.female || 0),
    }));
  }

  // PGRST202 = no such function. Anything else is a real failure.
  if (error.code !== "PGRST202") throw error;

  return fetchCountsClientSide(schoolYear);
}

/**
 * Stopgap for the pre-141 window. Same population and the same SHS collapse as
 * the RPC, but it still reads raw rows and so is still subject to the row cap —
 * it can under-report. Delete this once 141 is applied everywhere.
 */
async function fetchCountsClientSide(
  schoolYear: string,
): Promise<PublicEnrollmentCount[]> {
  const { data, error } = await supabase
    .from("sms_enrollments")
    .select(
      `
      school_id,
      grade_level,
      student_id,
      student:sms_students!sms_enrollments_student_id_fkey(gender)
    `,
    )
    .eq("school_year", schoolYear)
    .in("enrollment_status", ENROLLED_LIFECYCLE)
    .or(EXCLUDE_TEST_SCHOOLS_OR);

  if (error) throw error;

  const seen = new Set<string>();
  const counts = new Map<string, PublicEnrollmentCount>();

  for (const row of (data || []) as unknown as FallbackRow[]) {
    const schoolId = row.school_id;
    const gradeLevel = row.grade_level;
    if (schoolId == null || gradeLevel == null) continue;

    // Collapse an SHS learner's two semester rows into one head.
    const learnerKey = `${schoolId}|${gradeLevel}|${row.student_id}`;
    if (seen.has(learnerKey)) continue;
    seen.add(learnerKey);

    const key = `${schoolId}|${gradeLevel}`;
    let entry = counts.get(key);
    if (!entry) {
      entry = {
        school_id: Number(schoolId),
        grade_level: Number(gradeLevel),
        male: 0,
        female: 0,
      };
      counts.set(key, entry);
    }

    const gender = row.student?.gender?.toLowerCase() ?? "";
    if (gender === "male") entry.male++;
    else if (gender === "female") entry.female++;
  }

  return Array.from(counts.values());
}
