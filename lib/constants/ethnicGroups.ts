/**
 * Indigenous Peoples groups of the Caraga Region (Region XIII) — the picklist
 * behind the learner record's "IP (Ethnic Group)" field.
 *
 * WHY A PICKLIST. The field was a free-text input, sitting one box away from a
 * second free-text "Ethnicity" input that nothing in the system ever read. The
 * two were trivially confusable, and `sms_students.ip_ethnic_group` is the sole
 * input to the IPEd Program Data Set's IPs / Non-IPs split — so a group name
 * typed into the wrong box, or a placeholder like "N/A" typed into the right
 * one, moved the division's IPEd return with nothing to catch it. Constraining
 * the values is what makes that report answerable.
 *
 * WHY NOT A CHECK CONSTRAINT. `ip_ethnic_group` stays free TEXT and this list
 * is validated in the app only, following the precedent of 119's LSEN codes and
 * 133's subject programs: an NCIP or DepEd revision of the list is then a
 * one-line change here rather than a migration, and — the load-bearing half —
 * learner records already carrying a value outside the list stay valid and keep
 * printing. Nothing is rewritten by adding or removing an entry below.
 *
 * REVISE THIS LIST FREELY. It follows the groups commonly listed for Caraga by
 * the NCIP; the division should reconcile it against its own NCIP roster, and
 * `OTHER_IP_GROUP` exists so a registrar is never blocked by an omission.
 */

/** Stored when the learner belongs to no Indigenous Peoples group. */
export const NOT_IP = "";

/** Escape hatch for a group not yet on the list. Still counts as IP. */
export const OTHER_IP_GROUP = "Other IP group";

/**
 * Caraga IP groups, most numerous first within each province cluster. Manobo
 * subgroups are listed separately because DepEd and NCIP returns name them
 * separately — a learner recorded as Umayamnon should not have to be filed
 * under the parent group.
 */
export const CARAGA_ETHNIC_GROUPS: string[] = [
  "Manobo",
  "Agusan Manobo",
  "Umayamnon",
  "Tigwahanon",
  "Higaonon",
  "Banwaon",
  "Talaandig",
  "Mamanwa",
  "Mandaya",
  "Manguangan",
  "Kamayo",
  OTHER_IP_GROUP,
];

/**
 * Values that mean "no IP group" but were typed into the field while it was
 * free text. The report treats these as blank, so a placeholder answer left
 * over from the old input does not count a learner as IP.
 *
 * Kept in step with the same list in migration 151, which is the one the
 * reports actually apply. Compared case-insensitively after trimming.
 */
export const NON_IP_SENTINELS: string[] = [
  "n/a",
  "na",
  "none",
  "no",
  "not ip",
  "non-ip",
  "non ip",
  "wala",
  "0",
  "-",
  "--",
];

/**
 * Whether a stored value marks the learner as an Indigenous Peoples learner —
 * the same test migrations 149/151 apply, so the form, the learner list and
 * the IPEd report agree on who is IP.
 */
export function isIpLearner(value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return false;
  return !NON_IP_SENTINELS.includes(trimmed.toLowerCase());
}

/**
 * Options for the picklist, including the leading "Not IP" entry. The Radix
 * Select cannot hold an empty string as an item value, so that entry carries a
 * sentinel token which the form maps back to NULL on save.
 */
export const NOT_IP_OPTION_VALUE = "__not_ip__";

export const ETHNIC_GROUP_OPTIONS: { value: string; label: string }[] = [
  { value: NOT_IP_OPTION_VALUE, label: "Not IP" },
  ...CARAGA_ETHNIC_GROUPS.map((g) => ({ value: g, label: g })),
];

/** Picklist value → what is stored. "Not IP" and legacy sentinels store NULL. */
export function ethnicGroupToStored(value: string | undefined): string | null {
  if (!value || value === NOT_IP_OPTION_VALUE) return null;
  return isIpLearner(value) ? value.trim() : null;
}

/**
 * Stored value → picklist value. A legacy free-text entry outside the list is
 * preserved as its own option by the form rather than silently reset, so
 * opening and saving a learner record never destroys what a registrar typed.
 */
export function storedToEthnicGroup(value: string | null | undefined): string {
  return isIpLearner(value) ? (value as string).trim() : NOT_IP_OPTION_VALUE;
}
