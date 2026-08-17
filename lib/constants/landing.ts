/**
 * Schools that exist only for testing and must never appear in the public
 * landing pages — not in the school list, not in any dashboard statistic and
 * not in any learner count.
 *
 * These are `sms_schools.id` values (BIGINT), which is also what
 * `sms_enrollments.school_id` references.
 */
export const TEST_SCHOOL_IDS = [9, 10] as const;

/** PostgREST value list for `in` / `not.in` filters, e.g. `"(9,10)"`. */
export const TEST_SCHOOL_ID_FILTER = `(${TEST_SCHOOL_IDS.join(",")})`;

/**
 * `or` expression that drops the test schools while keeping rows whose
 * `school_id` is NULL. `sms_enrollments.school_id` is nullable (migration 013,
 * and the wizard only sets it when the enroller has a school), and a row with
 * no school cannot be a test-school row — excluding it would quietly shrink the
 * division-wide total.
 */
export const EXCLUDE_TEST_SCHOOLS_OR = `school_id.is.null,school_id.not.in.${TEST_SCHOOL_ID_FILTER}`;
