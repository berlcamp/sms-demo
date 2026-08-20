import type {
  NsbiAmenityKey,
  NsbiBuildingCondition,
  NsbiBuildingMaterial,
  NsbiClassification,
  NsbiFundSource,
  NsbiPageKey,
  NsbiRoomCondition,
  NsbiRoomUsage,
  NsbiSignatoryRole,
} from "@/types";

/**
 * National School Building Inventory (NSBI) — the DepEd School Building
 * Inventory Form's answering guide, transcribed as data (migration 154).
 *
 * The guide is pages 6–15 of the issued file. It is reference material for
 * whoever fills the form in, so it lives here as picklists and field help
 * rather than in the printed output, which is the five form pages only.
 *
 * Codes are stored; labels are printed. Where a list is app-validated rather
 * than CHECK-constrained in the database (building types, actual usages), a
 * DepEd revision is a change to this file and nothing else — per the 119/132
 * precedent that a list revision must never invalidate an already-signed form.
 */

// ============================================================================
// Table 1, Col. 3 — Fund Source/s
// ============================================================================
// Multi-select: the guide notes "if building has multiple fund source, specify
// in column 3".

export const NSBI_FUND_SOURCES: {
  value: NsbiFundSource;
  label: string;
  help: string;
}[] = [
  {
    value: "deped_national",
    label: "DepEd National Funded",
    help: "Funded by DepEd.",
  },
  {
    value: "lgu",
    label: "LGU Funded",
    help: "Funded by LGUs (provincial, city and municipality).",
  },
  {
    value: "foreign",
    label: "Foreign Funded",
    help: "Funded by a foreign institution.",
  },
  {
    value: "private_sector",
    label: "Private Sector Funded",
    help: "Funded by private corporations, companies, individuals and associations.",
  },
  {
    value: "house_senate",
    label: "House of Representatives / Senate Funded",
    help: "Funded through the House of Representatives or Senate (CDF, PDAF, etc.).",
  },
  {
    value: "other_nga",
    label: "Other National Government Agency Funded",
    help: "Funded by other government agencies.",
  },
];

// ============================================================================
// Table 1, Col. 2 — Building Type, grouped under its fund source
// ============================================================================
// Choosing a fund source filters this list. Every group ends with an "Other …"
// entry because the guide's own tables end with an open row, and the column is
// free TEXT in the database so a type absent from this list can still be typed.
//
// `year` is the guide's "Start of Implementation", shown as a hint beside the
// option to help a school head tell two similar types apart. Blank where the
// guide leaves it blank.
//
// Spellings are corrected against the guide's evident typos (Jolibee, Schiool,
// Projecy, Schoolm, Philipiines, AGAPSchool), since these are labels a school
// head reads and the stored value is our own code, not the guide's text.

export interface NsbiBuildingTypeOption {
  value: string;
  label: string;
  year?: string;
}

export const NSBI_BUILDING_TYPES: Record<
  NsbiFundSource,
  { group: string; options: NsbiBuildingTypeOption[] }[]
> = {
  deped_national: [
    {
      group: "Academic Classroom Buildings",
      options: [
        { value: "army_type", label: "Army Type School Building", year: "1957" },
        { value: "blsb_type_1", label: "Bagong Lipunan School Building (BLSB) Type I", year: "1975" },
        { value: "blsb_type_2", label: "Bagong Lipunan School Building (BLSB) Type II" },
        { value: "blsb_type_3", label: "Bagong Lipunan School Building (BLSB) Type III", year: "1975" },
        { value: "deped_modified_7x7", label: "DepEd Modified School Building (7 x 7)", year: "2006" },
        { value: "deped_standard", label: "DepEd Standard School Building", year: "2005" },
        { value: "dpwh_bod", label: "DPWH-BOD School Building" },
        { value: "fvr_2000", label: "FVR 2000 Building", year: "2000" },
        { value: "gabaldon", label: "Gabaldon School Building", year: "1920" },
        { value: "home_economics", label: "Home Economics Building", year: "2005" },
        { value: "imelda_type", label: "Imelda Type School Building", year: "1983" },
        { value: "industrial_arts", label: "Industrial Arts Building", year: "2005" },
        { value: "lapus", label: "Learning and Public Use School (LAPUS) Building", year: "2007" },
        { value: "magsaysay_type", label: "Magsaysay Type", year: "1950" },
        { value: "marcos_type", label: "Marcos Pre-Fabricated School Building (Marcos Type)", year: "1970" },
        { value: "multipurpose_workshop", label: "Multi-Purpose Workshop Building", year: "2006" },
        { value: "preschool_kinder", label: "Pre-School / Kindergarten Building", year: "2011" },
        { value: "psip", label: "Public-Private School Infrastructure Project (PSIP School Building)", year: "2013" },
        { value: "ramos_type", label: "Readily Assembled Multi-Option Shelter (RAMOS) Type" },
        { value: "science_laboratory", label: "Science Laboratory Building", year: "2006" },
        { value: "ppp", label: "Public-Private Partnership (PPP)" },
        { value: "ramos_demountable", label: "Ramos Demountable School Building" },
        { value: "prefab", label: "Pre-FAB" },
      ],
    },
    {
      group: "Technical Vocational School Buildings",
      options: [
        { value: "tvl_aquaculture", label: "Aqua-Culture NC II Building", year: "2013" },
        { value: "tvl_automotive", label: "Automotive Servicing NC II Building", year: "2013" },
        { value: "tvl_beauty_care", label: "Beauty Care NC II Building", year: "2013" },
        { value: "tvl_carpentry", label: "Carpentry NC II Building", year: "2013" },
        { value: "tvl_commercial_cooking", label: "Commercial Cooking NC II Building", year: "2013" },
        { value: "tvl_consumer_electronics", label: "Consumer Electronic Technician NC II Building", year: "2013" },
        { value: "tvl_dressmaking", label: "Dress Making NC II Building", year: "2013" },
        { value: "tvl_electrical", label: "Electrical Installation Maintenance NC II Building", year: "2013" },
        { value: "tvl_food_processing", label: "Food Processing NC II Building", year: "2013" },
        { value: "tvl_smaw", label: "Shielded Metal Arc Welding NC II Building", year: "2013" },
        { value: "tvl_state_of_the_art", label: "State of the Art Tech-Voc Building" },
      ],
    },
    {
      group: "Other",
      options: [
        { value: "deped_other", label: "Other DepEd National Funded Building Type" },
      ],
    },
  ],

  lgu: [
    {
      group: "LGU Funded Building Types",
      options: [
        { value: "lgu_joson", label: "Joson Type" },
        { value: "lgu_ynares", label: "Ynares Type" },
        { value: "lgu_provincial_school_board", label: "Provincial School Board" },
        { value: "lgu_municipal", label: "Municipal Building" },
        { value: "lgu_espino_building", label: "Espino Building" },
        { value: "lgu_umali", label: "UMALI Building" },
        { value: "lgu_tulagan", label: "Tulagan Building" },
        { value: "lgu_violago", label: "Violago Type" },
        { value: "lgu_gonzales", label: "Gonzales Type" },
        { value: "lgu_joey_lina", label: "Joey Lina Building" },
        { value: "lgu_lazaro", label: "Lazaro Building" },
        { value: "lgu_agbayani_bldg", label: "Agbayani Bldg." },
        { value: "lgu_celeste", label: "Celeste Building" },
        { value: "lgu_rodriguez", label: "Rodriguez Building" },
        { value: "lgu_alfelor", label: "Alfelor Type" },
        { value: "lgu_estrella", label: "Estrella" },
        { value: "lgu_mandanas", label: "Mandanas Building" },
        { value: "lgu_montelibano", label: "Montelibano Type" },
        { value: "lgu_san_luis", label: "San Luis Building" },
        { value: "lgu_deloso", label: "Deloso Type Building" },
        { value: "lgu_maliksi", label: "Maliksi Building" },
        { value: "lgu_lajara", label: "Lajara Type Building" },
        { value: "lgu_gatuslao", label: "Gatuslao Building" },
        { value: "lgu_luna", label: "Luna Building" },
        { value: "lgu_dy", label: "Dy Building" },
        { value: "lgu_espino", label: "Espino" },
        { value: "lgu_gwen", label: "Gwen Bldg." },
        { value: "lgu_mathay", label: "Mathay Building" },
        { value: "lgu_agbayani_type", label: "Agbayani Type" },
        { value: "lgu_duque", label: "Duque Building" },
        { value: "lgu_gustilo", label: "Gustilo Type" },
        { value: "lgu_other", label: "Other LGU Funded Building Type" },
      ],
    },
  ],

  foreign: [
    {
      group: "Foreign Funded Building Types",
      options: [
        { value: "esf", label: "Economic Support Fund (ESF) School Building", year: "1985" },
        { value: "jica_efip", label: "JICA — Educational Facilities Improvement Program (EFIP)", year: "1994" },
        { value: "spain_grant", label: "Government of Spain — Spanish Grant School Building" },
        { value: "sbp4be_ausaid", label: "SBP4BE Building — AusAid", year: "2013" },
        { value: "sedip", label: "Secondary Education Development Improvement Program (SEDIP)" },
        { value: "sedp", label: "Secondary Education Development Program (SEDP)", year: "2002" },
        { value: "sphere_ausaid", label: "SPHERE Building — AusAid", year: "2011" },
        { value: "teep", label: "Third Elementary Education Project (TEEP) School Building", year: "1999–2006" },
        { value: "jica_trsbp", label: "JICA — Typhoon Resistant School Building Program (TRSBP)", year: "1988" },
        { value: "foreign_other", label: "Other Foreign Funded Building Type" },
      ],
    },
  ],

  private_sector: [
    {
      group: "Private Sector Funded Building Types",
      options: [
        { value: "ffcccii", label: "Federation of Filipino Chinese Chamber of Commerce and Industry, Inc. (FFCCCII) School Building" },
        { value: "coca_cola_little_red", label: "Little Red School House — Coca-Cola Philippines" },
        { value: "abs_cbn", label: "ABS-CBN School Building" },
        { value: "gma_kapuso", label: "GMA Kapuso School Building" },
        { value: "private_foundation", label: "Private Foundation Building" },
        { value: "security_bank", label: "Security Bank School Building" },
        { value: "petron", label: "Petron School Building" },
        { value: "plan_international", label: "Plan International School Building" },
        { value: "agap", label: "AGAP School Building" },
        { value: "aboitiz", label: "Aboitiz School Building" },
        { value: "pamana", label: "PAMANA School Building" },
        { value: "rpn", label: "RPN School Building" },
        { value: "rotary", label: "Rotary School Building" },
        { value: "lions_club", label: "Lions Club School Building" },
        { value: "jollibee", label: "Jollibee School Building" },
        { value: "mcdonald", label: "McDonald School House" },
        { value: "kabisig", label: "KABISIG School Building" },
        { value: "gawad_kalinga", label: "Gawad-Kalinga School Building" },
        { value: "pldt", label: "PLDT School Building" },
        { value: "sm_foundation", label: "SM Foundation School Building" },
        { value: "tzu_chi", label: "TZU CHI Foundation School Building" },
        { value: "ayala", label: "Ayala School Building" },
        { value: "jaycees", label: "JAYCEES School Building" },
        { value: "philip_morris", label: "Philip Morris School Building" },
        { value: "rc_cola", label: "RC Cola Building" },
        { value: "dmci", label: "DMCI School Building" },
        { value: "kiwanis", label: "KIWANIS School Building" },
        { value: "steeltech", label: "SteelTech School Building" },
        { value: "private_other", label: "Other Private Sector Funded Building Type" },
      ],
    },
  ],

  house_senate: [
    {
      group: "House of Representatives / Senate Funded Building Types",
      options: [
        { value: "hs_gonzales", label: "Gonzales Type" },
        { value: "hs_cojuangco", label: "Cojuangco Building" },
        { value: "hs_umali", label: "Umali" },
        { value: "hs_maceda", label: "Maceda" },
        { value: "hs_chipeco", label: "Chipeco Type Building" },
        { value: "hs_tanada", label: "Tanada Building" },
        { value: "hs_villareal", label: "Villareal Building" },
        { value: "hs_ferrer", label: "Ferrer" },
        { value: "hs_bayan_muna", label: "Bayan Muna" },
        { value: "hs_angara", label: "Angara Building" },
        { value: "hs_abaya", label: "Abaya Type" },
        { value: "hs_fuentebella", label: "Fuentebella Building" },
        { value: "hs_joson", label: "Joson Type Building" },
        { value: "hs_legarda", label: "Legarda Building" },
        { value: "hs_drilon", label: "Drilon Building" },
        { value: "hs_enverga", label: "Enverga Building" },
        { value: "hs_andaya", label: "Andaya" },
        { value: "hs_diaz", label: "Diaz Type" },
        { value: "hs_recto", label: "Recto Building" },
        { value: "hs_enrile", label: "Enrile Building" },
        { value: "hs_alvarez", label: "Alvarez" },
        { value: "hs_loren_legarda", label: "Loren Legarda Building" },
        { value: "hs_cibac", label: "Cibac" },
        { value: "hs_lagman", label: "Lagman Type" },
        { value: "hs_romulo", label: "Romulo" },
        { value: "hs_suarez", label: "Serbisyong Suarez Building" },
        { value: "hs_syjuco", label: "Syjuco Building" },
        { value: "hs_villareal_bldg", label: "Villareal Bldg." },
        { value: "hs_antonino", label: "Antonino" },
        { value: "hs_arenas", label: "Arenas" },
        { value: "hs_other", label: "Other House of Representatives / Senate Funded Building Type" },
      ],
    },
  ],

  other_nga: [
    {
      group: "Other National Government Agency Funded Building Types",
      options: [
        { value: "dost_science_lab", label: "DOST Science Laboratory Building" },
        { value: "pagcor", label: "PAGCOR School Building" },
        { value: "kalahi_cidss", label: "KALAHI-CIDSS" },
        { value: "pag_ibig", label: "PAG-IBIG" },
        { value: "nga_other", label: "Other National Government Agency Funded Building Type" },
      ],
    },
  ],
};

/** Every building type across every fund source, for label lookup at print time. */
export const NSBI_BUILDING_TYPE_LABELS: Record<string, string> = Object.values(
  NSBI_BUILDING_TYPES,
)
  .flat()
  .flatMap((g) => g.options)
  .reduce<Record<string, string>>((acc, o) => {
    acc[o.value] = o.label;
    return acc;
  }, {});

// ============================================================================
// Table 1, Col. 4 — Specific Fund Source/s
// ============================================================================

export const NSBI_SPECIFIC_FUND_SOURCES: { value: string; label: string }[] = [
  { value: "deped_budget", label: "DepEd Budget" },
  { value: "alumni", label: "Alumni" },
  { value: "jica", label: "JICA" },
  { value: "worldbank", label: "World Bank" },
  { value: "ausaid", label: "AusAid" },
  { value: "coca_cola", label: "Coca-Cola Philippines" },
  { value: "others", label: "Others" },
];

// ============================================================================
// Table 1, Col. 5 — Building Condition (seven values)
// ============================================================================
// The Php 50,000 threshold in the help text is the guide's own, and is what
// separates a minor from a major repair.

export const NSBI_BUILDING_CONDITIONS: {
  value: NsbiBuildingCondition;
  label: string;
  help: string;
}[] = [
  {
    value: "good",
    label: "Good Condition",
    help: "Does not need repair.",
  },
  {
    value: "needs_minor_repair",
    label: "Needs Minor Repair",
    help: "Repair or replacement of components not subject to critical structural loads, costing less than Php 50,000 — windows, doors, partitions and the like.",
  },
  {
    value: "needs_major_repair",
    label: "Needs Major Repair",
    help: "Repair or replacement of components subject to critical structural loads, costing Php 50,000 or more — roof frames, posts and exterior walls.",
  },
  {
    value: "ongoing_construction",
    label: "On-going Construction",
    help: "Not yet completed.",
  },
  {
    value: "for_completion",
    label: "For Completion",
    help: "Not completed according to the design, e.g. one storey built from a two-storey plan.",
  },
  {
    value: "for_condemnation",
    label: "For Condemnation",
    help: "Not safe for occupancy and not currently used, but without official declaration from the Municipal/City Engineer.",
  },
  {
    value: "condemned",
    label: "Condemned / For Demolition",
    help: "Officially declared by the Municipal/City Engineer to be dangerous to life, health, property or safety.",
  },
];

// ============================================================================
// Table 2, Col. 4 — Room Condition (five values)
// ============================================================================
// Table 2's list drops On-going Construction and For Completion, which describe
// a building and not a room. Kept as its own list rather than a filter over the
// building list so a future divergence stays a one-line change.

export const NSBI_ROOM_CONDITIONS: {
  value: NsbiRoomCondition;
  label: string;
  help: string;
}[] = [
  { value: "good", label: "Good Condition", help: "Does not need repair." },
  {
    value: "needs_minor_repair",
    label: "Needs Minor Repair",
    help: "Components not subject to critical structural loads, costing less than Php 50,000 of a standard room unit.",
  },
  {
    value: "needs_major_repair",
    label: "Needs Major Repair",
    help: "Components subject to critical structural loads, costing Php 50,000 or more of a standard room.",
  },
  {
    value: "for_condemnation",
    label: "For Condemnation",
    help: "Not safe for occupancy and not currently used, but without official declaration from the Municipal/City Engineer.",
  },
  {
    value: "condemned",
    label: "Condemned / For Demolition",
    help: "Officially declared by the Municipal/City Engineer to be dangerous.",
  },
];

/**
 * sms_rooms.condition (four values, migration 071) maps 1:1 into the room list
 * above — it is a strict subset, so the prefill invents nothing. Declared here
 * so the mapping is written down once, beside both lists.
 */
export const NSBI_ROOM_CONDITION_FROM_SMS_ROOMS: Record<
  string,
  NsbiRoomCondition
> = {
  good: "good",
  needs_minor_repair: "needs_minor_repair",
  needs_major_repair: "needs_major_repair",
  condemned: "condemned",
};

// ============================================================================
// Table 1, Col. 9 — Classification of Building
// ============================================================================

export const NSBI_CLASSIFICATIONS: {
  value: NsbiClassification;
  label: string;
  help: string;
}[] = [
  {
    value: "permanent",
    label: "Permanent",
    help: "Strong and durable materials, 80% of which is concrete (including Gabaldon buildings).",
  },
  {
    value: "semi_permanent",
    label: "Semi-Permanent",
    help: "A combination of materials such as concrete and 80% lumber.",
  },
];

// ============================================================================
// Table 1, Col. 14 — Building Materials (multi-select)
// ============================================================================

export const NSBI_BUILDING_MATERIALS: {
  value: NsbiBuildingMaterial;
  label: string;
}[] = [
  { value: "concrete", label: "Concrete" },
  { value: "wood", label: "Wood" },
  { value: "steel", label: "Steel" },
  { value: "plastic", label: "Plastic" },
  { value: "stone", label: "Stone" },
  { value: "glass", label: "Glass" },
];

// ============================================================================
// Table 2, Col. 5 — Room Usage
// ============================================================================

export const NSBI_ROOM_USAGES: {
  value: NsbiRoomUsage;
  label: string;
  help: string;
}[] = [
  { value: "instructional", label: "Instructional", help: "Rooms used for academic purposes." },
  { value: "non_instructional", label: "Non-Instructional", help: "Rooms supporting the school's operation." },
  { value: "combination", label: "Combination", help: "Combination of instructional and non-instructional purposes." },
];

// ============================================================================
// Table 2, Col. 6 — Actual Usage/s
// ============================================================================
// MULTI-SELECT, AND DUPLICATES ARE MEANINGFUL. The guide is explicit: "it
// should correspond to the number of usages (e.g. if the room is shared by two
// SPED classes held at the same time, actual usage is SPED classroom and SPED
// classroom)". The UI must therefore let the same entry be added twice, and the
// count of entries is the count of concurrent usages.
//
// Free TEXT in the database, validated against this list, so a DepEd revision
// never invalidates a signed return.

export const NSBI_ACTUAL_USAGES: {
  group: "instructional" | "non_instructional";
  groupLabel: string;
  options: { value: string; label: string }[];
}[] = [
  {
    group: "instructional",
    groupLabel: "Instructional",
    options: [
      { value: "classroom_sped", label: "Classroom SPED" },
      { value: "classroom_elementary", label: "Classroom Elementary (Kindergarten, Grades 1–6)" },
      { value: "classroom_jhs", label: "Classroom JHS (Grades 7–10)" },
      { value: "classroom_shs", label: "Classroom SHS (Grades 11–12)" },
      { value: "als_room", label: "ALS Room" },
      { value: "audio_visual", label: "Audio Visual" },
      { value: "computer_room", label: "Computer Room" },
      { value: "industrial_arts_room", label: "Industrial Arts Room" },
      { value: "home_economics_room", label: "Home Economics Room" },
      { value: "science_laboratory", label: "Science Laboratory" },
      { value: "speech_laboratory", label: "Speech Laboratory" },
      { value: "research_laboratory", label: "Research Laboratory" },
      { value: "not_currently_used_instructional", label: "Not Currently Used" },
      { value: "others_instructional", label: "Others" },
    ],
  },
  {
    group: "non_instructional",
    groupLabel: "Non-Instructional",
    options: [
      { value: "library_lrc", label: "Library / Learning Resource Center" },
      { value: "canteen", label: "Canteen" },
      { value: "clinic", label: "Clinic" },
      { value: "conference_room", label: "Conference Room" },
      { value: "offices", label: "Offices" },
      { value: "faculty_room", label: "Faculty Room" },
      { value: "museum", label: "Museum" },
      { value: "guidance_office", label: "Guidance Office" },
      { value: "principal_office", label: "Principal Office" },
      { value: "supply_room", label: "Supply Room" },
      { value: "records_room", label: "Data File Room / Records Room" },
      { value: "student_cocurricular_center", label: "Student Co-Curricular Center" },
      { value: "youth_development_center", label: "Youth Development Center" },
      { value: "not_currently_used_non_instructional", label: "Not Currently Used" },
      { value: "others_non_instructional", label: "Others" },
    ],
  },
];

export const NSBI_ACTUAL_USAGE_LABELS: Record<string, string> =
  NSBI_ACTUAL_USAGES.flatMap((g) => g.options).reduce<Record<string, string>>(
    (acc, o) => {
      acc[o.value] = o.label;
      return acc;
    },
    {},
  );

// ============================================================================
// Tables 4A and 4B — Water and Sanitation Facilities
// ============================================================================
// The two tables measure exactly the same things; 4A counts them per building
// and 4B counts the stand-alone blocks, which belong to no building. One list
// drives both, the grid and the printed columns, so they cannot drift. The
// column on sms_nsbi_submissions is this key prefixed with "standalone_"; the
// column on sms_nsbi_buildings is the bare key.

export const NSBI_WASH_FIELDS: {
  key: string;
  label: string;
  kind: "number" | "tristate";
}[] = [
  { key: "bowls_male", label: "Functional Toilet Bowls — Male", kind: "number" },
  { key: "bowls_female", label: "Functional Toilet Bowls — Female", kind: "number" },
  { key: "bowls_pwd", label: "Functional Toilet Bowls — PWD", kind: "number" },
  { key: "bowls_shared", label: "Functional Toilet Bowls — Shared", kind: "number" },
  { key: "bowls_nonfunctional", label: "Non-Functional Toilet Bowls", kind: "number" },
  { key: "washbasins", label: "Sink / Washbasin", kind: "number" },
  { key: "urinals", label: "Urinals", kind: "number" },
  { key: "urinal_troughs", label: "Urinal Trough", kind: "number" },
  { key: "septic_tank", label: "With Septic Tank", kind: "tristate" },
  { key: "faucets_with_water", label: "Faucets — With Water Supply", kind: "number" },
  { key: "faucets_without_water", label: "Faucets — Without Water Supply", kind: "number" },
];

/** The sms_nsbi_submissions column backing a Table 4B cell. */
export function nsbiStandaloneColumn(key: string): string {
  return `standalone_${key}`;
}

// ============================================================================
// Table 5 — Existing Number of Usable Furniture (Cols. 1–12)
// ============================================================================
// Column order follows the printed form exactly, because the grid is laid out
// from this array and the printed table is read against the paper original.

export const NSBI_FURNITURE_FIELDS: {
  field: string;
  label: string;
  help?: string;
  group?: string;
}[] = [
  { field: "furniture_kinder_modular_table", label: "Kinder Modular Table", help: "Standard modular table used by a kindergarten learner." },
  { field: "furniture_kinder_chair", label: "Kinder Chair", help: "Chair used by a kindergarten learner." },
  { field: "furniture_armchair", label: "Armchair", help: "Usable armchairs, regardless of material (wood, plastic)." },
  { field: "furniture_school_desk", label: "School Desk", help: "Usable two-seater desks." },
  { field: "furniture_other_table", label: "Other Classroom Table", help: "Learner tables not named elsewhere in this table." },
  { field: "furniture_other_chair", label: "Other Classroom Chair", help: "Learner chairs not named elsewhere in this table." },
  { field: "furniture_1seater_elementary", label: "Elementary", group: "1-Seater Table & Chair" },
  { field: "furniture_1seater_jhs", label: "Junior High School", group: "1-Seater Table & Chair" },
  { field: "furniture_1seater_shs", label: "Senior High School", group: "1-Seater Table & Chair" },
  { field: "furniture_2seater_elementary", label: "Elementary", group: "2-Seater Table & Chair" },
  { field: "furniture_2seater_jhs", label: "Junior High School", group: "2-Seater Table & Chair" },
  { field: "furniture_2seater_shs", label: "Senior High School", group: "2-Seater Table & Chair" },
];

/**
 * A 1-seater set is one table and one chair; a 2-seater set is one table and
 * two chairs (guide note 42). Recorded here because it is what makes the seat
 * arithmetic in lib/utils/nsbi.ts legible.
 */
export const NSBI_SEATS_PER_SET = { one_seater: 1, two_seater: 2 } as const;

/**
 * Table 5 prefill from 118's `sms_kpi_reference` seat inventory.
 *
 * Only THREE of the four KPI seat components map onto a Table 5 column. The
 * fourth, `seats_two_seater_desks`, is a single school-wide total, where the
 * form splits 2-seater sets across Elementary / Junior High / Senior High —
 * and a total cannot be apportioned across three levels without inventing a
 * distribution. On a return four officers sign, a fabricated split is worse
 * than a blank the school head fills from the actual count, so it is left out
 * deliberately rather than overlooked.
 *
 * `seats_kindergarten` is the memo's "kinder seats", which is the CHAIR a
 * kindergarten learner sits on (guide note 37) — not the modular table (note
 * 36), which is furniture but not a seat.
 *
 * One-way, exactly like the room prefill: correcting a KPI figure in a later
 * school year must never reach back into an inventory already signed.
 */
export const NSBI_KPI_SEAT_MAP: {
  kpiColumn: keyof Pick<
    import("@/types").KpiReference,
    "seats_kindergarten" | "seats_arm_chairs" | "seats_school_desks"
  >;
  furnitureField: string;
  label: string;
}[] = [
  {
    kpiColumn: "seats_kindergarten",
    furnitureField: "furniture_kinder_chair",
    label: "Kinder Chair",
  },
  {
    kpiColumn: "seats_arm_chairs",
    furnitureField: "furniture_armchair",
    label: "Armchair",
  },
  {
    kpiColumn: "seats_school_desks",
    furnitureField: "furniture_school_desk",
    label: "School Desk",
  },
];

/** Named so the UI can explain the one column it deliberately will not fill. */
export const NSBI_KPI_UNMAPPED_NOTE =
  "2-Seater Table & Chair is not prefilled: the KPI inventory holds one school-wide total, and the form splits it across Elementary, Junior High and Senior High.";

// ============================================================================
// Table 6 — Other Facilities/Amenities (13 Yes/No flags)
// ============================================================================
// `column` is the printed layout: the form lays these out in three column
// pairs, five rows down the first two and three down the third.

export const NSBI_AMENITIES: {
  value: NsbiAmenityKey;
  label: string;
  help: string;
  column: 1 | 2 | 3;
}[] = [
  { value: "covered_court", label: "Covered Court", column: 1, help: "An area within the campus covered by roof, usually on steel trusses, used for sports and school activities." },
  { value: "gymnasium", label: "Gymnasium", column: 1, help: "A room or building equipped for gymnastics, games and physical exercise; often also an indoor venue, sometimes with bleachers." },
  { value: "solar_panel", label: "Solar Panel", column: 1, help: "Panels absorbing the sun's rays to generate electricity for the school." },
  { value: "permanent_perimeter_fence", label: "Permanent Perimeter Fence", column: 1, help: "A permanent structure demarcating the school perimeter to prevent access." },
  { value: "temporary_perimeter_fence", label: "Temporary Perimeter Fence", column: 1, help: "Same purpose as a permanent fence but temporary in nature and possibly less sturdy." },
  { value: "flood_marker", label: "Flood Marker", column: 2, help: "A graduated post or pole recording the high water mark during a flood." },
  { value: "playground", label: "Playground", column: 2, help: "An outdoor area specifically provided for learners to play on." },
  { value: "school_garden", label: "School Garden", column: 2, help: "An area used for growing plants." },
  { value: "entrance_gate", label: "Entrance Gate", column: 2, help: "A barrier used as the school entrance, closable and lockable beyond school hours." },
  { value: "exit_gate", label: "Exit Gate", column: 2, help: "A barrier used as the school exit, closable and lockable beyond school hours." },
  { value: "bike_racks", label: "Bike Racks", column: 3, help: "A row of frames where bikes can be securely left or parked." },
  { value: "paved_pathway_entrance_to_building", label: "Paved Pathway from Entrance Gate to Building", column: 3, help: "A completely paved pathway connecting the entrance gate to the nearest building, at least 1.5 metres wide." },
  { value: "pathway_cover_roofing", label: "Pathway Cover / Roofing", column: 3, help: "Complete roofing or cover over the paved pathway from the entrance gate to the nearest building." },
];

// ============================================================================
// Table 7 — Access going to School (check all applicable)
// ============================================================================

export const NSBI_ACCESS_ROAD_TYPES: {
  value: string;
  label: string;
  help: string;
}[] = [
  { value: "paved", label: "Paved", help: "Constructed with a hard, smooth surface of asphalt, concrete or other pavement suitable for walking or driving." },
  { value: "unpaved", label: "Unpaved", help: "Not covered with a firm, level surface of asphalt, concrete, etc." },
  { value: "levelled", label: "Levelled", help: "On a horizontal plane with a surface of completely equal height." },
  { value: "unlevelled_rough", label: "Unlevelled / Rough road", help: "Not smooth; uneven or irregular ground, rough grazing, covered with scrub, boulders, etc." },
  { value: "ongoing_construction", label: "On-going construction", help: "The road is being built in the area." },
];

/**
 * Twelve entries, in the printed grid's column order.
 *
 * NOTE the issued file disagrees with itself: the form's Table 7 grid lists
 * Biking, while the answering guide's note 57 lists only eleven and omits it.
 * The FORM is what gets signed, so Biking is included.
 */
export const NSBI_TRANSPORT_TYPES: { value: string; label: string }[] = [
  { value: "private_4wheel", label: "Private 4-Wheel Vehicle" },
  { value: "private_motorcycle", label: "Private Motorcycle" },
  { value: "boat", label: "Boat" },
  { value: "uv_express", label: "UV Express" },
  { value: "pedicab", label: "Pedicab" },
  { value: "tricycle", label: "Tricycle" },
  { value: "jeepney", label: "Jeepney" },
  { value: "habal_habal", label: "Habal-habal" },
  { value: "train", label: "Train" },
  { value: "bus", label: "Bus" },
  { value: "biking", label: "Biking" },
  { value: "walking_hiking", label: "Walking / Hiking" },
];

// ============================================================================
// Signatories, and the printed page they sign
// ============================================================================
// The form is NOT uniform. Page 1 carries four signatories; pages 2–5 carry
// three, omitting the Supply Officer. The caption also differs: page 1 reads
// "Prepared & Certified True and Correct by", pages 2–5 read "Prepared,
// Certified True and Correct by". Both are reproduced as issued.

export const NSBI_SIGNATORY_ROLES: {
  value: NsbiSignatoryRole;
  label: string;
  defaultTitle: string;
  caption: string;
}[] = [
  { value: "school_head", label: "School Head", defaultTitle: "School Head", caption: "Prepared, Certified True and Correct by:" },
  { value: "planning_officer", label: "Planning Officer III", defaultTitle: "Planning Officer III\n(Schools Division Office)", caption: "Verified by:" },
  { value: "supply_officer", label: "Supply Officer", defaultTitle: "Supply Officer\n(Schools Division Office)", caption: "Verified by:" },
  { value: "engineer", label: "Engineer III", defaultTitle: "Engineer III\n(Schools Division Office)", caption: "Validated by:" },
];

/**
 * The five printed pages, in order, with what each carries and who signs it.
 * The print generator drives entirely off this — the page groupings are the
 * form's, not one table per page.
 */
export const NSBI_PAGES: {
  key: NsbiPageKey;
  tables: string[];
  showCoordinates: boolean;
  signatories: NsbiSignatoryRole[];
  /** Page 1 alone uses the ampersand form of the caption. */
  preparedCaption: string;
}[] = [
  {
    key: "page_1",
    tables: ["Table 1. Summary of Existing Building"],
    showCoordinates: true,
    signatories: ["school_head", "planning_officer", "supply_officer", "engineer"],
    preparedCaption: "Prepared & Certified True and Correct by:",
  },
  {
    key: "page_2",
    tables: ["Table 2. Existing Rooms per Building"],
    showCoordinates: false,
    signatories: ["school_head", "planning_officer", "engineer"],
    preparedCaption: "Prepared, Certified True and Correct by:",
  },
  {
    key: "page_3",
    tables: [
      "Table 3. Number of Temporary Learning Space/s (TLS) & Makeshift Room/s",
      "Table 4A. Existing Number of Water and Sanitation Facilities",
    ],
    showCoordinates: false,
    signatories: ["school_head", "planning_officer", "engineer"],
    preparedCaption: "Prepared, Certified True and Correct by:",
  },
  {
    key: "page_4",
    tables: [
      "Table 4B. Existing Number of Stand-Alone Water and Sanitation Facilities",
      "Table 5. Existing Number of Usable Furniture",
      "Table 6. Other Facilities/Amenities",
    ],
    showCoordinates: false,
    signatories: ["school_head", "planning_officer", "engineer"],
    preparedCaption: "Prepared, Certified True and Correct by:",
  },
  {
    key: "page_5",
    tables: ["Table 7. Access going to School"],
    showCoordinates: false,
    signatories: ["school_head", "planning_officer", "engineer"],
    preparedCaption: "Prepared, Certified True and Correct by:",
  },
];

// ============================================================================
// Field help for the columns that carry a definition worth surfacing inline
// ============================================================================
// Keyed on the database column so a form field can look up its own help.

export const NSBI_FIELD_HELP: Record<string, string> = {
  latitude:
    "Angular distance north or south of the equator, in degrees and minutes.",
  longitude:
    "Angular distance east or west of the meridian at Greenwich, in degrees and minutes.",
  building_name: "The name or number of the building in the school.",
  building_type: "The design of the school building.",
  storeys: "The number of levels or floors in the building.",
  room_count: "The number of rooms.",
  year_completed:
    "The year the building was completed and officially turned over to the school.",
  pwd_accessible:
    "Yes when the building has at least one functional ramp and functional bathroom (BP 344, RA 7277).",
  major_repair_last_5y: "Underwent repair within the last 5 years.",
  has_certificate_of_acceptance:
    "Newly constructed and duly accepted by DepEd through the Principal/School Head signing the Certificate of Acceptance.",
  in_deped_book_of_accounts:
    "Already booked as a DepEd asset under standard accounting procedures.",
  date_of_acquisition: "The date the building was accepted.",
  acquisition_cost: "The cost of the building upon acquisition.",
  book_value:
    "Acquisition cost less depreciation, plus cost of repair, plus accumulation cost.",
  insurance_info:
    "The building's current insurance policy. State if none.",
  floor_number: "The level or storey the room is on.",
  room_number: "The number assigned to the room.",
  width_m: "Width is the chalkboard side, in metres.",
  length_m: "Length is the window side, in metres.",
  tls_count:
    "Temporary structures provided to calamity-stricken schools for short-term use while permanent classrooms are built or rehabilitated.",
  tls_sections_count:
    "The number of classes or sections using Temporary Learning Space/s.",
  makeshift_count:
    "Classrooms made of non-standard or substitute materials, temporary in nature — usually salvaged or found on site.",
  makeshift_sections_count:
    "The number of classes or sections using makeshift room/s.",
  bowls_pwd:
    "PWD toilet bowls must have nearby grab bars on the wall to be counted.",
  bowls_nonfunctional: "Non-serviceable toilet bowls.",
  septic_tank:
    "A sewage-disposal unit for schools not connected to sewer lines.",
  standalone_bowls_pwd:
    "PWD toilet bowls must have nearby grab bars on the wall to be counted.",
  standalone_septic_tank:
    "A sewage-disposal unit for schools not connected to sewer lines.",
};
