/**
 * Layout constants for the IPEd Program Data Set and the PWD / 4Ps Beneficiary
 * Data Set (migration 149).
 *
 * These two DepEd forms are matrices, not lists: every figure sits at the
 * intersection of a BAND (Elem / IS / JHS / SHS) and, on three of the IPEd
 * blocks, a HALF (A. IPEd Implementing Schools vs B. Schools Serving IP
 * Learners). Writing the axes down once means the table header, the input grid
 * and the Excel export are all generated from the same source and cannot drift
 * apart — the classic failure of a hand-built matrix form.
 */

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

export type IpedBand = "elem" | "is" | "jhs" | "shs";

export const IPED_BANDS: { value: IpedBand; label: string }[] = [
  { value: "elem", label: "Elem" },
  { value: "is", label: "IS" },
  { value: "jhs", label: "JHS" },
  { value: "shs", label: "SHS" },
];

/**
 * The A / B halves. Which one a school reports under follows the typed
 * `implementing_iped` flag — a designation the system does not hold — so a
 * school that has not answered appears under neither.
 */
export type IpedHalf = "a" | "b";

export const IPED_HALVES: { value: IpedHalf; label: string }[] = [
  { value: "a", label: "A. IPEd Implementing Schools" },
  { value: "b", label: "B. Schools Serving IP Learners" },
];

/**
 * TYPE OF SCHOOL — the form's four columns, ticked from `sms_schools.school_type`.
 * A complete secondary school ticks both JHS and SHS; every other type ticks one.
 */
export function schoolTypeBands(schoolType: string | null | undefined): IpedBand[] {
  switch (schoolType) {
    case "elementary":
      return ["elem"];
    case "integrated":
      return ["is"];
    case "junior_high":
      return ["jhs"];
    case "senior_high":
      return ["shs"];
    case "complete_secondary":
      return ["jhs", "shs"];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Fiscal year
// ---------------------------------------------------------------------------

/**
 * The form is titled "FY <year>" but its enrolment column is headed "Total
 * Enrolment SY <year>-<year+1>", so a fiscal year selects that school year.
 */
export function schoolYearForFiscalYear(fiscalYear: number): string {
  return `${fiscalYear}-${fiscalYear + 1}`;
}

/** Fiscal years offered in the picker: this calendar year and the years around it. */
export function fiscalYearOptions(span = 6): number[] {
  const now = new Date().getFullYear();
  return Array.from({ length: span }, (_, i) => now + 1 - i);
}

// ---------------------------------------------------------------------------
// The typed IPEd columns
// ---------------------------------------------------------------------------

/** Every numeric cell a user types on the IPEd form, in printed order. */
export interface IpedNumericField {
  key: IpedEntryNumericKey;
  /** Block the cell belongs to, used to group the input grid. */
  block: "teachers" | "teachers_oriented" | "heads_oriented" | "resources";
  label: string;
}

export type IpedEntryNumericKey =
  | "teachers_ip_male"
  | "teachers_non_ip_male"
  | "teachers_ip_female"
  | "teachers_non_ip_female"
  | "teachers_oriented_a_elem"
  | "teachers_oriented_a_is"
  | "teachers_oriented_a_jhs"
  | "teachers_oriented_a_shs"
  | "teachers_oriented_b_elem"
  | "teachers_oriented_b_is"
  | "teachers_oriented_b_jhs"
  | "teachers_oriented_b_shs"
  | "heads_oriented_a_elem"
  | "heads_oriented_a_is"
  | "heads_oriented_a_jhs"
  | "heads_oriented_a_shs"
  | "heads_oriented_b_elem"
  | "heads_oriented_b_is"
  | "heads_oriented_b_jhs"
  | "heads_oriented_b_shs"
  | "contextualized_resources";

export type IpedEntryTextKey =
  | "major_activities"
  | "cab_officers"
  | "major_issues";

/** `teachers_oriented_a_elem` and friends, built from the two axes. */
export function orientedKey(
  block: "teachers_oriented" | "heads_oriented",
  half: IpedHalf,
  band: IpedBand,
): IpedEntryNumericKey {
  return `${block}_${half}_${band}` as IpedEntryNumericKey;
}

export const IPED_TEACHER_CELLS: {
  key: IpedEntryNumericKey;
  sex: "Male" | "Female";
  ip: "IPs" | "Non-IPs";
}[] = [
  { key: "teachers_ip_male", sex: "Male", ip: "IPs" },
  { key: "teachers_non_ip_male", sex: "Male", ip: "Non-IPs" },
  { key: "teachers_ip_female", sex: "Female", ip: "IPs" },
  { key: "teachers_non_ip_female", sex: "Female", ip: "Non-IPs" },
];

export const IPED_TEXT_FIELDS: { key: IpedEntryTextKey; label: string }[] = [
  {
    key: "major_activities",
    label: "Major Activities conducted (categorized based on specific program/direction)",
  },
  { key: "cab_officers", label: "Name of Division CAB Officers (Recent)" },
  { key: "major_issues", label: "Major Issues / Concerns (elevated to RO/CO)" },
];

// ---------------------------------------------------------------------------
// PWD / 4Ps categories
// ---------------------------------------------------------------------------

export type PwdFourPsCategory = "pwd" | "fourps" | "ip";

export const PWD_FOURPS_CATEGORIES: {
  value: PwdFourPsCategory;
  label: string;
  maleKey: "pwd_male" | "fourps_male" | "ip_male";
  femaleKey: "pwd_female" | "fourps_female" | "ip_female";
}[] = [
  {
    value: "pwd",
    label: "Person with Disability (PWD)",
    maleKey: "pwd_male",
    femaleKey: "pwd_female",
  },
  {
    value: "fourps",
    label: "4P's Beneficiary",
    maleKey: "fourps_male",
    femaleKey: "fourps_female",
  },
  { value: "ip", label: "IP Students", maleKey: "ip_male", femaleKey: "ip_female" },
];
