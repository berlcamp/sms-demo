// DepEd Senior High School taxonomy

export type ShsTrack = "academic" | "tvl" | "sports" | "arts_design";

export const SHS_TRACKS: { value: ShsTrack; label: string }[] = [
  { value: "academic", label: "Academic" },
  { value: "tvl", label: "TVL" },
  { value: "sports", label: "Sports" },
  { value: "arts_design", label: "Arts & Design" },
];

export interface ShsStrand {
  track: ShsTrack;
  code: string;
  label: string;
}

export const SHS_STRANDS: ShsStrand[] = [
  // Academic
  { track: "academic", code: "stem", label: "STEM" },
  { track: "academic", code: "abm", label: "ABM" },
  { track: "academic", code: "humss", label: "HUMSS" },
  { track: "academic", code: "gas", label: "GAS" },
  { track: "academic", code: "pbm", label: "Pre-Baccalaureate Maritime" },
  // TVL
  { track: "tvl", code: "tvl_he", label: "TVL – Home Economics" },
  { track: "tvl", code: "tvl_ict", label: "TVL – ICT" },
  { track: "tvl", code: "tvl_ia", label: "TVL – Industrial Arts" },
  { track: "tvl", code: "tvl_afa", label: "TVL – Agri-Fishery Arts" },
  { track: "tvl", code: "tvl_maritime", label: "TVL – Maritime" },
  // Sports
  { track: "sports", code: "sports", label: "Sports" },
  // Arts & Design
  { track: "arts_design", code: "arts_design", label: "Arts & Design" },
];

/**
 * Senior High is Grades 11-12. Strand, specialization and every other SHS
 * field is meaningful only here — migration 145 enforces the same rule in a
 * CHECK on sms_sections.
 */
export const isShsGrade = (gradeLevel: number | null | undefined): boolean =>
  gradeLevel === 11 || gradeLevel === 12;

export const getStrandLabel = (code: string): string =>
  SHS_STRANDS.find((s) => s.code === code)?.label ?? code;

export const getTrackLabel = (value: ShsTrack | string): string =>
  SHS_TRACKS.find((t) => t.value === value)?.label ?? value;

export const getTrackForStrand = (code: string): ShsTrack | undefined =>
  SHS_STRANDS.find((s) => s.code === code)?.track;

// Common SHS specializations under each strand (guidance only — schools may
// enter custom specializations since TVL specializations are legion).
export const SHS_SPECIALIZATION_SUGGESTIONS: Record<string, string[]> = {
  stem: [],
  abm: [],
  humss: [],
  gas: [],
  tvl_he: [
    "Cookery",
    "Bread and Pastry Production",
    "Food and Beverage Services",
    "Housekeeping",
    "Tourism Promotion Services",
    "Caregiving",
    "Beauty / Nail Care",
    "Dressmaking",
    "Tailoring",
  ],
  tvl_ict: [
    "Computer Systems Servicing",
    "Computer Programming",
    "Animation",
    "Contact Center Services",
  ],
  tvl_ia: [
    "Automotive Servicing",
    "Carpentry",
    "Electrical Installation & Maintenance",
    "Masonry",
    "Plumbing",
    "Shielded Metal Arc Welding",
    "Refrigeration and Air-Conditioning Servicing",
  ],
  tvl_afa: [
    "Agricultural Crops Production",
    "Animal Production",
    "Organic Agriculture Production",
    "Aquaculture",
    "Fish Capture",
    "Fish Processing",
  ],
  tvl_maritime: [
    "Ship's Catering Services",
    "Maritime Seafaring",
  ],
  sports: ["Sports"],
  arts_design: ["Visual Arts", "Performing Arts", "Media Arts"],
  pbm: [],
};
