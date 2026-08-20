import {
  NSBI_KPI_SEAT_MAP,
  NSBI_SIGNATORY_ROLES,
} from "@/lib/constants/nsbi";
import type {
  KpiReference,
  NsbiBuilding,
  NsbiRoom,
  NsbiSignatory,
  NsbiSubmission,
} from "@/types";

/**
 * NSBI derived figures and pre-submission checks (migration 154).
 *
 * NOTHING HERE IS STORED. The inventory records what a school head typed; these
 * are totals the screen shows while filling it in and warnings raised before
 * submitting. The printed form carries the entered figures, so a total computed
 * here never overwrites one on the form.
 */

/** Treats null as zero for a running total, without turning null into 0 on save. */
function n(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// ============================================================================
// Table 4A / 4B — water and sanitation totals
// ============================================================================

export interface NsbiWashTotals {
  functionalBowls: number;
  nonFunctionalBowls: number;
  washbasins: number;
  urinals: number;
  urinalTroughs: number;
  faucets: number;
}

/** Functional bowls are male + female + PWD + shared, per guide note 29. */
export function nsbiBuildingWashTotals(
  buildings: NsbiBuilding[],
): NsbiWashTotals {
  return buildings.reduce<NsbiWashTotals>(
    (acc, b) => ({
      functionalBowls:
        acc.functionalBowls +
        n(b.bowls_male) +
        n(b.bowls_female) +
        n(b.bowls_pwd) +
        n(b.bowls_shared),
      nonFunctionalBowls: acc.nonFunctionalBowls + n(b.bowls_nonfunctional),
      washbasins: acc.washbasins + n(b.washbasins),
      urinals: acc.urinals + n(b.urinals),
      urinalTroughs: acc.urinalTroughs + n(b.urinal_troughs),
      faucets:
        acc.faucets + n(b.faucets_with_water) + n(b.faucets_without_water),
    }),
    {
      functionalBowls: 0,
      nonFunctionalBowls: 0,
      washbasins: 0,
      urinals: 0,
      urinalTroughs: 0,
      faucets: 0,
    },
  );
}

/** Table 4B — the stand-alone blocks, which belong to no building. */
export function nsbiStandaloneWashTotals(
  submission: NsbiSubmission,
): NsbiWashTotals {
  return {
    functionalBowls:
      n(submission.standalone_bowls_male) +
      n(submission.standalone_bowls_female) +
      n(submission.standalone_bowls_pwd) +
      n(submission.standalone_bowls_shared),
    nonFunctionalBowls: n(submission.standalone_bowls_nonfunctional),
    washbasins: n(submission.standalone_washbasins),
    urinals: n(submission.standalone_urinals),
    urinalTroughs: n(submission.standalone_urinal_troughs),
    faucets:
      n(submission.standalone_faucets_with_water) +
      n(submission.standalone_faucets_without_water),
  };
}

/** Whole school: per-building (4A) plus stand-alone (4B). */
export function nsbiTotalWash(
  submission: NsbiSubmission,
  buildings: NsbiBuilding[],
): NsbiWashTotals {
  const a = nsbiBuildingWashTotals(buildings);
  const b = nsbiStandaloneWashTotals(submission);
  return {
    functionalBowls: a.functionalBowls + b.functionalBowls,
    nonFunctionalBowls: a.nonFunctionalBowls + b.nonFunctionalBowls,
    washbasins: a.washbasins + b.washbasins,
    urinals: a.urinals + b.urinals,
    urinalTroughs: a.urinalTroughs + b.urinalTroughs,
    faucets: a.faucets + b.faucets,
  };
}

// ============================================================================
// Table 5 — seats
// ============================================================================

/**
 * The DepEd Memo 12 Oct 2022 seat total, as migration 118 already writes it for
 * the KPI seat-learner ratio:
 *
 *   kinder seats + arm chairs + (school desks x 2) + (2-seater desks x 2)
 *
 * A school desk is a two-seater (guide note 39) and a 2-seater set seats two
 * (note 42), which is where both multipliers come from. Offered so a school
 * head can sanity-check Table 5 against the KPI figure they already maintain —
 * the two are NOT bound to each other, and neither overwrites the other.
 */
export function nsbiSeatTotal(submission: NsbiSubmission): number {
  return (
    n(submission.furniture_kinder_chair) +
    n(submission.furniture_armchair) +
    n(submission.furniture_school_desk) * 2 +
    n(submission.furniture_2seater_elementary) * 2 +
    n(submission.furniture_2seater_jhs) * 2 +
    n(submission.furniture_2seater_shs) * 2 +
    n(submission.furniture_1seater_elementary) +
    n(submission.furniture_1seater_jhs) +
    n(submission.furniture_1seater_shs)
  );
}

// ============================================================================
// Pre-submission checks
// ============================================================================

export interface NsbiWarning {
  /** Which tab to send the school head to. */
  scope: "header" | "buildings" | "rooms" | "furniture" | "signatories";
  message: string;
}

/**
 * Warnings, never blocks. A school genuinely can have a building whose declared
 * room count exceeds the rooms it has listed — the form is filled from a
 * physical walk-through and reconciled afterwards. The point is to surface the
 * discrepancy before four people sign it, not to refuse the return.
 */
export function nsbiWarnings(
  submission: NsbiSubmission,
  buildings: NsbiBuilding[],
  rooms: NsbiRoom[],
): NsbiWarning[] {
  const warnings: NsbiWarning[] = [];

  if (submission.latitude === null || submission.longitude === null) {
    warnings.push({
      scope: "header",
      message: "Longitude and latitude are blank. Page 1 prints them.",
    });
  }

  if (buildings.length === 0) {
    warnings.push({
      scope: "buildings",
      message:
        "No buildings recorded. Prefill from the Rooms module, or copy the previous inventory.",
    });
  }

  for (const b of buildings) {
    const listed = rooms.filter((r) => r.building_id === b.id).length;
    if (b.room_count !== null && b.room_count !== listed) {
      warnings.push({
        scope: "rooms",
        message: `${b.building_name}: Table 1 declares ${b.room_count} room(s) but Table 2 lists ${listed}.`,
      });
    }
    if (!b.condition) {
      warnings.push({
        scope: "buildings",
        message: `${b.building_name}: building condition is blank (Col. 5).`,
      });
    }
    if (
      b.pwd_accessible === true &&
      n(b.bowls_pwd) === 0 &&
      n(submission.standalone_bowls_pwd) === 0
    ) {
      // Guide note 10: PWD accessible means at least one functional ramp AND a
      // functional bathroom. No PWD bowl anywhere makes the Yes hard to support.
      warnings.push({
        scope: "buildings",
        message: `${b.building_name} is marked PWD accessible, but no PWD toilet bowl is recorded anywhere.`,
      });
    }
  }

  for (const r of rooms) {
    if (r.actual_usages.length === 0) {
      warnings.push({
        scope: "rooms",
        message: `Room ${r.room_number ?? "(unnumbered)"}: actual usage is blank (Col. 6).`,
      });
      break; // one is enough; the tab shows the rest
    }
  }

  const missingSignatories = NSBI_SIGNATORY_ROLES.filter((role) => {
    const found = submission.signatories.find((s) => s.role === role.value);
    return !found || !found.name.trim();
  });
  if (missingSignatories.length > 0) {
    warnings.push({
      scope: "signatories",
      message: `Unnamed signatory: ${missingSignatories.map((r) => r.label).join(", ")}.`,
    });
  }

  return warnings;
}

/** A blank set of the four signatories, in the order they sign. */
export function nsbiDefaultSignatories(
  principalName?: string | null,
  principalTitle?: string | null,
): NsbiSignatory[] {
  return NSBI_SIGNATORY_ROLES.map((role) => ({
    role: role.value,
    name: role.value === "school_head" ? (principalName ?? "") : "",
    title:
      role.value === "school_head"
        ? (principalTitle ?? role.defaultTitle)
        : role.defaultTitle,
  }));
}

/** "as of May 31, 2026" — the heading every printed page carries. */
export function formatNsbiAsOf(asOfDate: string): string {
  const parsed = new Date(`${asOfDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return asOfDate;
  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The default inventory date for a new return: 31 May of the current year
 * before June, otherwise 31 May of next year. The form is always headed with a
 * 31 May date and is filed biennially; the school head can override it.
 */
export function nsbiDefaultAsOfDate(today: Date): string {
  const year = today.getMonth() >= 5 ? today.getFullYear() + 1 : today.getFullYear();
  return `${year}-05-31`;
}

// ============================================================================
// Table 5 prefill from the KPI seat inventory (migration 118)
// ============================================================================

/**
 * The school year whose `sms_kpi_reference` row belongs to an inventory date.
 *
 * The NSBI is headed "as of May 31, <year>", which falls at the END of a school
 * year — 31 May 2026 sits in SY 2025-2026, not 2026-2027. Anything from June
 * onward belongs to the school year that opens that month.
 */
export function nsbiSchoolYearForAsOf(asOfDate: string): string {
  const parsed = new Date(`${asOfDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  // getMonth() is 0-based: 5 is June.
  const start = parsed.getMonth() >= 5 ? year : year - 1;
  return `${start}-${start + 1}`;
}

export interface NsbiKpiPrefillResult {
  /** The furniture map to apply. Unchanged entries are carried through. */
  furniture: Record<string, string>;
  /** Labels of columns this filled. */
  filled: string[];
  /** Labels left alone because the school head had already entered a value. */
  kept: string[];
  /** Labels the KPI row itself has no figure for. */
  missing: string[];
}

/**
 * Copies the three mappable KPI seat components into Table 5.
 *
 * ONLY FILLS BLANKS. A column the school head has already counted is never
 * overwritten — this is a convenience for the four figures they would otherwise
 * retype, not a source of truth, and the physical count on the walk-through
 * beats the KPI reconciliation figure every time.
 *
 * The 2-seater columns are untouched by design: see NSBI_KPI_UNMAPPED_NOTE.
 */
export function nsbiFurnitureFromKpi(
  kpi: Pick<
    KpiReference,
    "seats_kindergarten" | "seats_arm_chairs" | "seats_school_desks"
  >,
  current: Record<string, string>,
): NsbiKpiPrefillResult {
  const furniture = { ...current };
  const filled: string[] = [];
  const kept: string[] = [];
  const missing: string[] = [];

  for (const entry of NSBI_KPI_SEAT_MAP) {
    const value = kpi[entry.kpiColumn];
    if (value === null || value === undefined) {
      missing.push(entry.label);
      continue;
    }
    const existing = (furniture[entry.furnitureField] ?? "").trim();
    if (existing !== "") {
      kept.push(entry.label);
      continue;
    }
    furniture[entry.furnitureField] = String(value);
    filled.push(entry.label);
  }

  return { furniture, filled, kept, missing };
}
