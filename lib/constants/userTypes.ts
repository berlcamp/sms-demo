/**
 * `sms_users.type` — the staff roles, their labels, and which of them may sign
 * in.
 *
 * This lives in the app rather than being read back from the CHECK constraint
 * (migration 135) on purpose: the database only needs to know a value is legal,
 * while the label and the login rule are application behaviour. Follows the
 * `lib/constants/subjects.ts` precedent.
 */

/** Roles a school may assign to its own staff, in the order the pickers show. */
export const SCHOOL_STAFF_USER_TYPES = [
  "school_head",
  "assistant_school_head",
  "teacher",
  "volunteer_teacher",
  "registrar",
  "admin",
  "librarian",
  "guidance_counselor",
  "school_nurse",
  "accounting",
] as const;

export type SchoolStaffUserType = (typeof SCHOOL_STAFF_USER_TYPES)[number];

/** What the division office may assign — its own role first, then the school
 *  roles, matching how the Users page has always ordered the picker. */
export const DIVISION_ASSIGNABLE_USER_TYPES = [
  "division_type",
  ...SCHOOL_STAFF_USER_TYPES,
] as const;

export type DivisionAssignableUserType =
  (typeof DIVISION_ASSIGNABLE_USER_TYPES)[number];

/** Human-readable label for any `sms_users.type` value, including the
 *  division-only ones that no picker offers. */
export const USER_TYPE_LABELS: Record<string, string> = {
  school_head: "School Head",
  assistant_school_head: "Assistant School Principal",
  teacher: "Teacher",
  volunteer_teacher: "Volunteer Teacher",
  registrar: "Registrar",
  admin: "Admin",
  librarian: "Librarian",
  guidance_counselor: "Guidance Counselor",
  school_nurse: "School Nurse",
  accounting: "Accounting",
  "super admin": "Super Admin",
  division_admin: "Division Admin",
  division_type: "Division User",
  tutor: "Tutor",
};

/**
 * Roles that stand in front of a class and therefore work the Teacher Menu.
 *
 * A **volunteer teacher** is a teacher the school has not been given a plantilla
 * item for — a parent, an LSB-funded helper, a retiree — who nonetheless advises
 * a section, carries a teaching load and encodes grades. They are a `teacher`
 * everywhere in this system except enrolment (see `canEnrolLearners`), so every
 * teacher-facing gate should ask `isTeacherRole()` rather than compare to the
 * literal `"teacher"`.
 *
 * Deliberately NOT applied to the DepEd personnel counts, which stay keyed to
 * the literal `'teacher'` in SQL (071's teaching-personnel summary, 112's SRC,
 * 118's teacher–learner ratio): those report plantilla teaching items, and a
 * volunteer is not one. Their staff record files under the `teacher` staff
 * category (`DEFAULT_STAFF_CATEGORY` below), which keeps them out of the
 * Non-Teaching Personnel matrix as well — counted in neither, which is what a
 * volunteer is.
 */
export const TEACHING_USER_TYPES = ["teacher", "volunteer_teacher"] as const;

/** True for a regular teacher and for a volunteer teacher. */
export function isTeacherRole(type?: string | null): boolean {
  if (!type) return false;
  return (TEACHING_USER_TYPES as readonly string[]).includes(type);
}

/**
 * Roles that may hold a full staff account but must never enrol a learner.
 *
 * Enrolment is the act that puts a learner on a school's official roll and, for
 * a transferee, opens a record request against another school. A volunteer is
 * not accountable for that roll, so the duty stays with the school's own staff.
 *
 * Enforced in three places, because the app is not the only way in:
 *   1. the sidebar drops the Enrollment entry and `/enrollment` refuses to open;
 *   2. `can_write_enrollment` (migration 140) refuses the row through RLS;
 *   3. `assert_enrollment_staff` (migration 140) refuses the enrolment RPCs.
 */
export const ENROLLMENT_BLOCKED_USER_TYPES = ["volunteer_teacher"] as const;

/** True when this role may enrol learners. Unknown/absent roles are refused. */
export function canEnrolLearners(type?: string | null): boolean {
  if (!type) return false;
  return !(ENROLLMENT_BLOCKED_USER_TYPES as readonly string[]).includes(type);
}

/**
 * Roles that exist as a staff record but hold no account in this system.
 *
 * Accounting personnel belong on the plantilla and in the Division
 * Non-Teaching Personnel report, but the system carries no financial module for
 * them and learner records are outside their function — so the row is a
 * personnel record only, never a login. Enforced in the OAuth callback and in
 * `AuthGuard`, both of which sign the session straight back out, mirroring how
 * an inactive `sms_users` row is already handled.
 */
export const LOGIN_DISABLED_USER_TYPES = ["accounting"] as const;

/** True when this role may hold a staff record but must not reach the app. */
export function isLoginDisabledUserType(type?: string | null): boolean {
  if (!type) return false;
  return (LOGIN_DISABLED_USER_TYPES as readonly string[]).includes(type);
}

/** Shown on the unverified screen when a blocked role tries to sign in. */
export const NO_PORTAL_ACCESS_MESSAGE =
  "Your role does not have access to the School Management System. Please contact your school head if you believe this is an error.";

/**
 * Staff category to fall back on when the role implies one and nobody picked
 * it. Only the roles added in migrations 135 and 140 are listed: the
 * pre-existing ones keep their "leave it blank" behaviour so no saved record
 * changes meaning. Feeds the Division Non-Teaching Personnel report.
 */
export const DEFAULT_STAFF_CATEGORY: Partial<Record<string, string>> = {
  guidance_counselor: "guidance",
  school_nurse: "health",
  accounting: "admin",
  // A volunteer teaches, so filing them under `teacher` keeps them out of the
  // Non-Teaching Personnel matrix — which drops that category — without adding
  // them to the plantilla teaching count, which reads `type` and not this.
  volunteer_teacher: "teacher",
};
