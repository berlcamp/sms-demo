/**
 * Staff lookups for schedule / section assignment.
 *
 * A person can leave a school while the rows that name them stay behind: a
 * subject schedule keeps its `teacher_id`, a section keeps its
 * `section_adviser_id`, and moving the user only rewrites `sms_users.school_id`
 * and their `sms_user_schools` rows (migration 134). `/division/users` clears
 * the *current* year's schedules on transfer, but nothing touches past years,
 * rows orphaned before that was added, or an advisership.
 *
 * The two helpers here draw the line those call sites kept getting wrong:
 *
 *   - **Resolving a name** by id is never school-filtered. `sms_users` is
 *     SELECT-able by any authenticated user (001), so the filter bought no
 *     isolation — it only turned a departed colleague's name into "-", which
 *     reads as missing data rather than as someone who moved on.
 *   - **Offering a choice** stays school-scoped, plus whoever the row already
 *     holds, marked `isFormer`. Without that exception the picker silently
 *     shows an empty box over a real value: leave it alone and the departed
 *     teacher is written straight back, with nothing on screen saying so.
 */

import { supabase } from "@/lib/supabase/client";

export interface StaffOption {
  id: string;
  name: string;
  /** Held by the row being edited, but no longer posted to this school. */
  isFormer?: boolean;
}

/** Shown beside a former colleague's name in an assignment picker. */
export const FORMER_STAFF_LABEL = "no longer at this school";

/**
 * Names for the given user ids, whoever they now work for. Ids that resolve to
 * nothing are simply absent from the map.
 */
export async function fetchStaffNames(
  ids: (string | number | null | undefined)[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) return {};

  const { data } = await supabase
    .from("sms_users")
    .select("id, name")
    .in("id", unique);

  const names: Record<string, string> = {};
  (data ?? []).forEach((u) => {
    names[String(u.id)] = u.name;
  });
  return names;
}

/**
 * Everyone assignable at `schoolId`, plus `currentId` when that person is no
 * longer among them — so an edit can see, keep or replace them deliberately.
 *
 * `schoolId` null means division level: no school filter, matching what every
 * one of these pickers already did for a user without a school.
 */
export async function fetchAssignableStaff(
  schoolId: number | string | null | undefined,
  currentId?: string | number | null,
): Promise<StaffOption[]> {
  let query = supabase
    .from("sms_users")
    .select("id, name")
    .neq("type", "division_admin")
    .neq("type", "division_type")
    .eq("is_active", true)
    .order("name");
  if (schoolId != null) {
    query = query.eq("school_id", schoolId);
  }

  const { data, error } = await query;
  if (error) return [];

  const staff: StaffOption[] = (data ?? []).map((u) => ({
    id: String(u.id),
    name: u.name,
  }));

  if (currentId == null) return staff;

  const current = String(currentId);
  if (staff.some((s) => s.id === current)) return staff;

  // Read the holder directly — they are outside every filter above, which is
  // the whole point of asking for them.
  const { data: former } = await supabase
    .from("sms_users")
    .select("id, name")
    .eq("id", current)
    .maybeSingle();

  if (!former) return staff;

  return [...staff, { id: String(former.id), name: former.name, isFormer: true }];
}
