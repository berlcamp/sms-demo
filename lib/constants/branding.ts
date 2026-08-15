/**
 * Public-facing product and organisation names.
 *
 * Every user-visible surface reads these instead of hardcoding a division, so
 * cloning the system to another division is a one-file change rather than a
 * find-and-replace across the app. Kept deliberately generic — no city, no
 * region — because the same build is deployed to more than one division.
 *
 * NOTE: the DepEd PDF form headers in lib/pdf/ still carry their own division
 * name. Those print onto official documents and are not wired to this file.
 */

/** Short product name. Wordmarks, nav, page titles. */
export const APP_NAME = "School Management System";

/** Full product name. Browser title, login heading. */
export const APP_TITLE = "School Management System for Division";

/** Organisation line shown under the wordmark. */
export const ORG_NAME = "Division Office";

/** Attribution line for footers. */
export const ORG_FOOTER = "Department of Education · Division Office";

/** One-line description. Metadata, hero subcopy. */
export const APP_DESCRIPTION =
  "Enrollment statistics, school directory and public services for the division.";
