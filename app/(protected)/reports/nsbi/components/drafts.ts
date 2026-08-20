import { NSBI_FURNITURE_FIELDS, NSBI_WASH_FIELDS } from "@/lib/constants/nsbi";
import type {
  NsbiAmenityMap,
  NsbiBuilding,
  NsbiBuildingCondition,
  NsbiBuildingMaterial,
  NsbiClassification,
  NsbiFundSource,
  NsbiRoom,
  NsbiRoomCondition,
  NsbiRoomUsage,
  NsbiSignatory,
  NsbiSubmission,
} from "@/types";

/**
 * Editable shapes for the NSBI Buildings and Rooms tabs (migration 154).
 *
 * Numeric columns are held as STRINGS while editing so a cleared field stays
 * cleared instead of collapsing to 0 — a blank Col. 7 means "not counted", and
 * on a form four officers sign that is not the same statement as "zero rooms".
 * `numOrNull` converts back on save.
 *
 * Every draft carries a client-side `key` as well as its database `id`. The key
 * is what links a room to its building BEFORE the building has been inserted,
 * so a school head can add a building and its rooms in one sitting and press
 * Save once.
 */

/** Stable client-side identity for a row that may not exist in the database yet. */
let keySeq = 0;
export function nextKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}-${keySeq}`;
}

/** Tri-state Yes/No/unanswered. Radix Select rejects "" as an item value. */
export const TRISTATE_UNSET = "unset";

export function toTristate(value: boolean | null): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return TRISTATE_UNSET;
}

export function fromTristate(value: string): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

/** "" -> null, so clearing a field clears the column rather than writing 0. */
export function numOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function str(value: number | null): string {
  return value === null || value === undefined ? "" : String(value);
}

// ============================================================================
// Building draft — Table 1 (Cols. 1–18) + Table 4A
// ============================================================================

export interface BuildingDraft {
  key: string;
  id: string | null;
  sort_order: number;

  building_name: string;
  building_type: string;
  fund_sources: NsbiFundSource[];
  specific_fund_source: string;
  condition: NsbiBuildingCondition | "";
  storeys: string;
  room_count: string;
  year_completed: string;
  classification: NsbiClassification | "";
  pwd_accessible: boolean | null;
  major_repair_last_5y: boolean | null;
  has_certificate_of_acceptance: boolean | null;
  in_deped_book_of_accounts: boolean | null;
  building_materials: NsbiBuildingMaterial[];
  date_of_acquisition: string;
  acquisition_cost: string;
  book_value: string;
  insurance_info: string;

  // Table 4A
  bowls_male: string;
  bowls_female: string;
  bowls_pwd: string;
  bowls_shared: string;
  bowls_nonfunctional: string;
  washbasins: string;
  urinals: string;
  urinal_troughs: string;
  septic_tank: boolean | null;
  faucets_with_water: string;
  faucets_without_water: string;
}

export function blankBuilding(sortOrder: number): BuildingDraft {
  return {
    key: nextKey("b"),
    id: null,
    sort_order: sortOrder,
    building_name: "",
    building_type: "",
    fund_sources: [],
    specific_fund_source: "",
    condition: "",
    storeys: "",
    room_count: "",
    year_completed: "",
    classification: "",
    pwd_accessible: null,
    major_repair_last_5y: null,
    has_certificate_of_acceptance: null,
    in_deped_book_of_accounts: null,
    building_materials: [],
    date_of_acquisition: "",
    acquisition_cost: "",
    book_value: "",
    insurance_info: "",
    bowls_male: "",
    bowls_female: "",
    bowls_pwd: "",
    bowls_shared: "",
    bowls_nonfunctional: "",
    washbasins: "",
    urinals: "",
    urinal_troughs: "",
    septic_tank: null,
    faucets_with_water: "",
    faucets_without_water: "",
  };
}

export function buildingToDraft(row: NsbiBuilding): BuildingDraft {
  return {
    key: nextKey("b"),
    id: row.id,
    sort_order: row.sort_order,
    building_name: row.building_name ?? "",
    building_type: row.building_type ?? "",
    fund_sources: row.fund_sources ?? [],
    specific_fund_source: row.specific_fund_source ?? "",
    condition: row.condition ?? "",
    storeys: str(row.storeys),
    room_count: str(row.room_count),
    year_completed: str(row.year_completed),
    classification: row.classification ?? "",
    pwd_accessible: row.pwd_accessible,
    major_repair_last_5y: row.major_repair_last_5y,
    has_certificate_of_acceptance: row.has_certificate_of_acceptance,
    in_deped_book_of_accounts: row.in_deped_book_of_accounts,
    building_materials: row.building_materials ?? [],
    date_of_acquisition: row.date_of_acquisition ?? "",
    acquisition_cost: str(row.acquisition_cost),
    book_value: str(row.book_value),
    insurance_info: row.insurance_info ?? "",
    bowls_male: str(row.bowls_male),
    bowls_female: str(row.bowls_female),
    bowls_pwd: str(row.bowls_pwd),
    bowls_shared: str(row.bowls_shared),
    bowls_nonfunctional: str(row.bowls_nonfunctional),
    washbasins: str(row.washbasins),
    urinals: str(row.urinals),
    urinal_troughs: str(row.urinal_troughs),
    septic_tank: row.septic_tank,
    faucets_with_water: str(row.faucets_with_water),
    faucets_without_water: str(row.faucets_without_water),
  };
}

/** The column payload for an insert or update. Never includes `id`. */
export function buildingToRow(
  draft: BuildingDraft,
  submissionId: string,
): Record<string, unknown> {
  return {
    submission_id: Number(submissionId),
    sort_order: draft.sort_order,
    building_name: draft.building_name.trim(),
    building_type: draft.building_type || null,
    fund_sources: draft.fund_sources,
    specific_fund_source: draft.specific_fund_source || null,
    condition: draft.condition || null,
    storeys: numOrNull(draft.storeys),
    room_count: numOrNull(draft.room_count),
    year_completed: numOrNull(draft.year_completed),
    classification: draft.classification || null,
    pwd_accessible: draft.pwd_accessible,
    major_repair_last_5y: draft.major_repair_last_5y,
    has_certificate_of_acceptance: draft.has_certificate_of_acceptance,
    in_deped_book_of_accounts: draft.in_deped_book_of_accounts,
    building_materials: draft.building_materials,
    date_of_acquisition: draft.date_of_acquisition || null,
    acquisition_cost: numOrNull(draft.acquisition_cost),
    book_value: numOrNull(draft.book_value),
    insurance_info: draft.insurance_info.trim() || null,
    bowls_male: numOrNull(draft.bowls_male),
    bowls_female: numOrNull(draft.bowls_female),
    bowls_pwd: numOrNull(draft.bowls_pwd),
    bowls_shared: numOrNull(draft.bowls_shared),
    bowls_nonfunctional: numOrNull(draft.bowls_nonfunctional),
    washbasins: numOrNull(draft.washbasins),
    urinals: numOrNull(draft.urinals),
    urinal_troughs: numOrNull(draft.urinal_troughs),
    septic_tank: draft.septic_tank,
    faucets_with_water: numOrNull(draft.faucets_with_water),
    faucets_without_water: numOrNull(draft.faucets_without_water),
  };
}

// ============================================================================
// Room draft — Table 2 (Cols. 1–8)
// ============================================================================

export interface RoomDraft {
  key: string;
  id: string | null;
  /** The owning building's client key — set before the building has an id. */
  buildingKey: string;
  sort_order: number;

  floor_number: string;
  room_number: string;
  condition: NsbiRoomCondition | "";
  room_usage: NsbiRoomUsage | "";
  /** Duplicates are meaningful here — see the answering guide, note 23. */
  actual_usages: string[];
  width_m: string;
  length_m: string;
  source_room_id: string | null;
}

export function blankRoom(buildingKey: string, sortOrder: number): RoomDraft {
  return {
    key: nextKey("r"),
    id: null,
    buildingKey,
    sort_order: sortOrder,
    floor_number: "",
    room_number: "",
    condition: "",
    room_usage: "",
    actual_usages: [],
    width_m: "",
    length_m: "",
    source_room_id: null,
  };
}

export function roomToDraft(row: NsbiRoom, buildingKey: string): RoomDraft {
  return {
    key: nextKey("r"),
    id: row.id,
    buildingKey,
    sort_order: row.sort_order,
    floor_number: str(row.floor_number),
    room_number: row.room_number ?? "",
    condition: row.condition ?? "",
    room_usage: row.room_usage ?? "",
    actual_usages: row.actual_usages ?? [],
    width_m: str(row.width_m),
    length_m: str(row.length_m),
    source_room_id: row.source_room_id,
  };
}

export function roomToRow(
  draft: RoomDraft,
  submissionId: string,
  buildingId: string,
): Record<string, unknown> {
  return {
    submission_id: Number(submissionId),
    building_id: Number(buildingId),
    sort_order: draft.sort_order,
    floor_number: numOrNull(draft.floor_number),
    room_number: draft.room_number.trim() || null,
    condition: draft.condition || null,
    room_usage: draft.room_usage || null,
    actual_usages: draft.actual_usages,
    width_m: numOrNull(draft.width_m),
    length_m: numOrNull(draft.length_m),
    source_room_id: draft.source_room_id ? Number(draft.source_room_id) : null,
  };
}

// ============================================================================
// Header draft — Tables 3, 4B, 5, 6, 7 and the signatories
// ============================================================================
// The numeric groups (Table 4B and Table 5) are held as string maps keyed on
// the database column rather than as a dozen named fields each: the grids and
// the print generator both iterate the same constant lists, so a map keeps the
// screen, the payload and the printed columns from drifting apart.


export interface HeaderDraft {
  latitude: string;
  longitude: string;

  // Table 3
  tls_count: string;
  tls_sections_count: string;
  makeshift_count: string;
  makeshift_sections_count: string;

  /** Table 4B, keyed on the bare wash field key (not the standalone_ column). */
  standalone: Record<string, string>;
  standalone_septic_tank: boolean | null;

  /** Table 5, keyed on the furniture column name. */
  furniture: Record<string, string>;

  // Tables 6 and 7
  amenities: NsbiAmenityMap;
  access_road_types: string[];
  transport_types: string[];

  signatories: NsbiSignatory[];
  notes: string;
}

function numStr(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function headerToDraft(row: NsbiSubmission): HeaderDraft {
  const standalone: Record<string, string> = {};
  for (const f of NSBI_WASH_FIELDS) {
    if (f.kind !== "number") continue;
    const col = `standalone_${f.key}` as keyof NsbiSubmission;
    standalone[f.key] = numStr(row[col] as number | null);
  }

  const furniture: Record<string, string> = {};
  for (const f of NSBI_FURNITURE_FIELDS) {
    furniture[f.field] = numStr(
      row[f.field as keyof NsbiSubmission] as number | null,
    );
  }

  return {
    latitude: numStr(row.latitude),
    longitude: numStr(row.longitude),
    tls_count: numStr(row.tls_count),
    tls_sections_count: numStr(row.tls_sections_count),
    makeshift_count: numStr(row.makeshift_count),
    makeshift_sections_count: numStr(row.makeshift_sections_count),
    standalone,
    standalone_septic_tank: row.standalone_septic_tank,
    furniture,
    amenities: row.amenities ?? {},
    access_road_types: row.access_road_types ?? [],
    transport_types: row.transport_types ?? [],
    signatories: row.signatories ?? [],
    notes: row.notes ?? "",
  };
}

/** The UPDATE payload. Never carries status, as_of_date or the submit trail. */
export function headerToRow(draft: HeaderDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    latitude: numOrNull(draft.latitude),
    longitude: numOrNull(draft.longitude),
    tls_count: numOrNull(draft.tls_count),
    tls_sections_count: numOrNull(draft.tls_sections_count),
    makeshift_count: numOrNull(draft.makeshift_count),
    makeshift_sections_count: numOrNull(draft.makeshift_sections_count),
    standalone_septic_tank: draft.standalone_septic_tank,
    amenities: draft.amenities,
    access_road_types: draft.access_road_types,
    transport_types: draft.transport_types,
    signatories: draft.signatories,
    notes: draft.notes.trim() || null,
  };

  for (const f of NSBI_WASH_FIELDS) {
    if (f.kind !== "number") continue;
    payload[`standalone_${f.key}`] = numOrNull(draft.standalone[f.key] ?? "");
  }
  for (const f of NSBI_FURNITURE_FIELDS) {
    payload[f.field] = numOrNull(draft.furniture[f.field] ?? "");
  }

  return payload;
}
