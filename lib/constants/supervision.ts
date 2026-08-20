/**
 * Instructional Supervision — PMES / COT catalog and workflow labels.
 *
 * Transcribed from the DepEd Performance Management and Evaluation System
 * (PMES) for Teachers annexes:
 *
 *   Annex E-2  COT Rating Sheet                (per observer)
 *   Annex E-3  COT Inter-Observer Agreement    (consensus final rating)
 *   Annex E-4  COT Observation Notes Form
 *
 * ── THE TWO AXES ────────────────────────────────────────────────────────────
 * The forms vary on two independent axes, and conflating them is the classic
 * error when rebuilding these:
 *
 *   CAREER STAGE  →  the RATING SCALE, nothing else. Every stage rates the same
 *                    indicators, written in Proficient Teacher language; only
 *                    the levels shift (2-6 / 3-7 / 4-8 / 5-9). See CAREER_STAGES.
 *
 *   SCHOOL YEAR   →  WHICH indicators appear. The PMES rotates a three-year
 *                    cycle of indicator sets. See COT_INDICATOR_CYCLE.
 *
 * "Not Observed" (the NO column) is NOT a zero and NOT a blank: each form states
 * it "automatically gets a rating of N", where N is the LOWEST level of that
 * career stage. That is why `notObserved` below always equals `minRating`.
 *
 * Indicator codes are stored in the database as free TEXT and resolved here, so
 * a DepEd revision of the PPST indicator set is a change to this file rather
 * than a migration that invalidates already-signed forms.
 */

// ============================================================================
// CAREER STAGES — rating scale only
// ============================================================================

export type CareerStage =
  | "proficient_a"
  | "proficient_b"
  | "highly_proficient"
  | "distinguished";

export interface CareerStageSpec {
  /** Label as printed in the form footer, e.g. "Proficient Teacher A". */
  formLabel: string;
  /** Plantilla range as printed in the form body, e.g. "Teacher I-III". */
  positionLabel: string;
  /** Short parenthetical used in the footer, e.g. "TI-TIII". */
  positionShort: string;
  minRating: number;
  maxRating: number;
  /** The NO column's automatic rating — always the lowest level of the stage. */
  notObserved: number;
}

export const CAREER_STAGES: Record<CareerStage, CareerStageSpec> = {
  proficient_a: {
    formLabel: "Proficient Teacher A",
    positionLabel: "Teacher I-III",
    positionShort: "TI-TIII",
    minRating: 2,
    maxRating: 6,
    notObserved: 2,
  },
  proficient_b: {
    formLabel: "Proficient Teacher B",
    positionLabel: "Teacher IV-VII",
    positionShort: "TIV-TVII",
    minRating: 3,
    maxRating: 7,
    notObserved: 3,
  },
  highly_proficient: {
    formLabel: "Highly Proficient Teacher",
    positionLabel: "Master Teacher I-II",
    positionShort: "MTI-MTII",
    minRating: 4,
    maxRating: 8,
    notObserved: 4,
  },
  distinguished: {
    formLabel: "Distinguished Teacher",
    positionLabel: "Master Teacher III-V",
    positionShort: "MTIII-MTV",
    minRating: 5,
    maxRating: 9,
    notObserved: 5,
  },
};

export const CAREER_STAGE_ORDER: CareerStage[] = [
  "proficient_a",
  "proficient_b",
  "highly_proficient",
  "distinguished",
];

/** "Proficient Teacher A (Teacher I-III)" — for selects and badges. */
export function careerStageLabel(stage: CareerStage): string {
  const spec = CAREER_STAGES[stage];
  return `${spec.formLabel} (${spec.positionLabel})`;
}

/** The legal levels for a stage, in ascending order — the COT column headers. */
export function ratingScale(stage: CareerStage): number[] {
  const { minRating, maxRating } = CAREER_STAGES[stage];
  const out: number[] = [];
  for (let n = minRating; n <= maxRating; n++) out.push(n);
  return out;
}

export function isRatingInScale(stage: CareerStage, rating: number): boolean {
  const { minRating, maxRating } = CAREER_STAGES[stage];
  return Number.isInteger(rating) && rating >= minRating && rating <= maxRating;
}

/**
 * Best-effort career stage from a free-text `sms_users.position`.
 *
 * `position` is unconstrained TEXT filled in by school staff, so this is a
 * SUGGESTION only — every scheduling form lets the School Head override it, and
 * the chosen value is what gets stored. Returns null when nothing matches
 * rather than guessing a stage, because guessing wrong silently changes the
 * rating scale of a signed form.
 */
export function suggestCareerStage(
  position: string | null | undefined,
): CareerStage | null {
  if (!position) return null;
  const p = position.toUpperCase().replace(/[.\-_]/g, " ").replace(/\s+/g, " ").trim();

  const ROMAN: Record<string, number> = {
    I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7,
  };
  /** Rank from either a roman numeral or an arabic one, e.g. "Teacher 5". */
  const rank = (token: string): number | null =>
    ROMAN[token] ?? (/^\d+$/.test(token) ? Number(token) : null);

  // Head Teacher I-VI is a school-leadership plantilla rated with a different
  // instrument, but "HEAD TEACHER III" contains "TEACHER III". It must be
  // rejected before the teacher branch can claim it.
  if (/\bHEAD\s+TEACHER\b|\bHT\b/.test(p)) return null;

  // Master Teacher next: "MASTER TEACHER I" also contains "TEACHER I".
  const master = p.match(/\b(?:MASTER\s+TEACHER|MT)\s*(I{1,3}|IV|V|\d+)\b/);
  if (master) {
    const n = rank(master[1]);
    if (n == null || n < 1 || n > 5) return null;
    return n <= 2 ? "highly_proficient" : "distinguished";
  }
  // "MASTER TEACHER VI" reaches here: it carries a rank, but not one that maps
  // (MT runs I-V). Falling through to the bare-title default would suggest a
  // scale from a position we demonstrably failed to read.
  if (rankedButUnmapped(p, /\b(?:MASTER\s+TEACHER|MT)\b/)) return null;
  if (/\bMASTER\s+TEACHER\b|\bMT\b/.test(p)) return "highly_proficient";

  const teacher =
    p.match(/\bTEACHER\s*(I{1,3}|IV|V|VI|VII|\d+)\b/) ??
    p.match(/\bT\s*(I{1,3}|IV|V|VI|VII|\d+)\b/);
  if (teacher) {
    const n = rank(teacher[1]);
    // Out of the I-VII plantilla range: say nothing rather than guess a scale.
    if (n == null || n < 1 || n > 7) return null;
    return n <= 3 ? "proficient_a" : "proficient_b";
  }
  // Same guard for "TEACHER VIII" (the plantilla runs I-VII).
  if (rankedButUnmapped(p, /\bTEACHER\b/)) return null;
  if (/\bTEACHER\b/.test(p)) return "proficient_a";
  return null;
}

/**
 * True when `title` is followed by something that is plainly meant as a rank —
 * roman numerals or digits — that the mapping above did not recognise.
 *
 * The bare-title fallbacks ("Master Teacher" -> highly proficient, "Teacher" ->
 * proficient A) exist for positions written without a rank at all. A rank that
 * is present but out of range is different: it means the position was read and
 * not understood, and the honest answer is null.
 */
function rankedButUnmapped(position: string, title: RegExp): boolean {
  const match = position.match(
    new RegExp(`${title.source}\\s+([IVX]+|\\d+)\\b`),
  );
  return match != null;
}

// ============================================================================
// PPST INDICATOR CATALOG
// ============================================================================

export interface PpstIndicator {
  /** PPST code as printed on the form, e.g. "1.1.2". */
  code: string;
  /** The indicator statement, verbatim from the COT. */
  text: string;
  /** PPST domain number, parsed from the code. */
  domain: number;
}

/**
 * Every indicator that appears on a COT form across the three-year cycle,
 * verbatim from Annexes E-2 / E-3.
 */
export const PPST_INDICATORS: PpstIndicator[] = [
  {
    code: "1.1.2",
    domain: 1,
    text: "Apply knowledge of content within and across curriculum teaching areas",
  },
  {
    code: "1.3.2",
    domain: 1,
    text: "Ensure the positive use of ICT to facilitate the teaching and learning process",
  },
  {
    code: "1.4.2",
    domain: 1,
    text: "Use a range of teaching strategies that enhance learner achievement in literacy and numeracy skills",
  },
  {
    code: "1.5.2",
    domain: 1,
    text: "Apply a range of teaching strategies to develop critical and creative thinking, as well as other higher-order thinking skills",
  },
  {
    code: "1.6.2",
    domain: 1,
    text: "Display proficient use of Mother Tongue, Filipino and English to facilitate teaching and learning",
  },
  {
    code: "1.7.2",
    domain: 1,
    text: "Use effective verbal and non-verbal classroom communication strategies to support learner understanding, participation, engagement and achievement",
  },
  {
    code: "2.1.2",
    domain: 2,
    text: "Establish safe and secure learning environments to enhance learning through the consistent implementation of policies, guidelines and procedures",
  },
  {
    code: "2.2.2",
    domain: 2,
    text: "Maintain learning environments that promote fairness, respect and care to encourage learning",
  },
  {
    code: "2.3.2",
    domain: 2,
    text: "Manage classroom structure to engage learners, individually or in groups, in meaningful exploration, discovery and hands-on activities within a range of physical learning environments",
  },
  {
    code: "2.4.2",
    domain: 2,
    text: "Maintain supportive learning environments that nurture and inspire learners to participate, cooperate and collaborate in continued learning",
  },
  {
    code: "2.5.2",
    domain: 2,
    text: "Apply a range of successful strategies that maintain learning environments that motivate learners to work productively by assuming responsibility for their own learning",
  },
  {
    code: "2.6.2",
    domain: 2,
    text: "Manage learner behavior constructively by applying positive and non-violent discipline to ensure learning-focused environments",
  },
  {
    code: "3.1.2",
    domain: 3,
    text: "Use differentiated, developmentally appropriate learning experiences to address learners’ gender, needs, strengths, interests and experiences",
  },
  {
    code: "3.2.2",
    domain: 3,
    text: "Establish a learner-centered culture by using teaching strategies that respond to learners’ linguistic, cultural, socio-economic and religious backgrounds",
  },
  {
    code: "3.3.2",
    domain: 3,
    text: "Design, adapt and implement teaching strategies that are responsive to learners with disabilities, giftedness and talents",
  },
  {
    code: "3.4.2",
    domain: 3,
    text: "Plan and deliver teaching strategies that are responsive to the special educational needs of learners in difficult circumstances, including: geographic isolation; chronic illness; displacement due to armed conflict, urban resettlement or disasters; child abuse and child labor practices",
  },
  {
    code: "3.5.2",
    domain: 3,
    text: "Adapt and use culturally appropriate teaching strategies to address the needs of learners from indigenous groups",
  },
  {
    code: "4.1.2",
    domain: 4,
    text: "Plan, manage and implement developmentally sequenced teaching and learning process to meet curriculum requirements and varied teaching contexts",
  },
  {
    code: "4.5.2",
    domain: 4,
    text: "Select, develop, organize and use appropriate teaching and learning resources, including ICT, to address learning goals",
  },
  {
    code: "5.1.2",
    domain: 5,
    text: "Design, select, organize and use diagnostic, formative and summative assessment strategies consistent with curriculum requirements",
  },
  {
    code: "5.3.2",
    domain: 5,
    text: "Use strategies for providing timely, accurate and constructive feedback to improve learner performance",
  },
];

const INDICATOR_BY_CODE = new Map(PPST_INDICATORS.map((i) => [i.code, i]));

/** Indicator statement for a stored code; falls back to the code if retired. */
export function indicatorText(code: string): string {
  return INDICATOR_BY_CODE.get(code)?.text ?? code;
}

export function getIndicator(code: string): PpstIndicator | undefined {
  return INDICATOR_BY_CODE.get(code);
}

// ============================================================================
// THE THREE-YEAR INDICATOR CYCLE
// ============================================================================

/**
 * Which indicators the COT carries, by school year, exactly as printed in the
 * Annex E-2 / E-3 documents (SY 2025-2026, 2026-2027 and 2027-2028 appear as
 * three successive copies inside each file). The cycle then repeats.
 *
 * Order matters: it is the printed row order of the form.
 */
export const COT_INDICATOR_CYCLE: string[][] = [
  // Cycle year 0 — SY 2025-2026
  ["1.1.2", "1.4.2", "1.5.2", "2.3.2", "2.6.2", "3.1.2", "4.1.2", "4.5.2", "5.1.2"],
  // Cycle year 1 — SY 2026-2027
  ["1.1.2", "1.4.2", "1.5.2", "1.6.2", "2.1.2", "2.2.2", "3.2.2", "3.5.2", "5.3.2"],
  // Cycle year 2 — SY 2027-2028
  ["1.1.2", "1.4.2", "1.3.2", "1.7.2", "2.4.2", "2.5.2", "3.3.2", "3.4.2"],
];

/** The school year that anchors cycle position 0. */
export const COT_CYCLE_ANCHOR_YEAR = 2025;

function schoolYearStart(schoolYear: string): number {
  const n = parseInt(schoolYear.split("-")[0], 10);
  return Number.isFinite(n) ? n : COT_CYCLE_ANCHOR_YEAR;
}

/**
 * The indicator codes a COT filed for `schoolYear` carries.
 *
 * Uses a floored modulo so school years before the anchor (a back-encoded
 * 2024-2025 form, say) land on a real cycle position instead of a negative
 * index. Callers should still store the resolved year on the observation row —
 * see `sms_cot_observations.form_cycle_sy` — so a form keeps its own set when
 * the cycle rolls over.
 */
export function cotIndicatorCodes(schoolYear: string): string[] {
  const offset = schoolYearStart(schoolYear) - COT_CYCLE_ANCHOR_YEAR;
  const len = COT_INDICATOR_CYCLE.length;
  return COT_INDICATOR_CYCLE[((offset % len) + len) % len];
}

/** The same set, resolved to full indicator records in printed order. */
export function cotIndicators(schoolYear: string): PpstIndicator[] {
  return cotIndicatorCodes(schoolYear).map(
    (code) =>
      INDICATOR_BY_CODE.get(code) ?? { code, text: code, domain: 0 },
  );
}

// ============================================================================
// KEY RESULT AREAS (RPMS)
// ============================================================================

export interface KraSpec {
  key: string;
  label: string;
  /** PPST domains this KRA covers. */
  domains: number[];
}

export const RPMS_KRAS: KraSpec[] = [
  {
    key: "kra1",
    label: "KRA 1: Content Knowledge and Pedagogy",
    domains: [1],
  },
  {
    key: "kra2",
    label: "KRA 2: Learning Environment and Diversity of Learners",
    domains: [2, 3],
  },
  {
    key: "kra3",
    label: "KRA 3: Curriculum and Planning, Assessment and Reporting",
    domains: [4, 5],
  },
  {
    key: "kra4",
    label:
      "KRA 4: Community Linkages and Professional Engagement, and Personal Growth and Professional Development",
    domains: [6, 7],
  },
];

/** The KRA an indicator belongs to, derived from its PPST domain. */
export function kraForIndicator(code: string): KraSpec | undefined {
  const domain = getIndicator(code)?.domain;
  if (!domain) return undefined;
  return RPMS_KRAS.find((k) => k.domains.includes(domain));
}

// ============================================================================
// FOCUS OF THE OBSERVATION
// ============================================================================

/**
 * An observation may focus on several KRAs and several indicators, but 121
 * stores each as a single TEXT column. They are kept as a delimited list in
 * that one column rather than widened to an array: every row written before
 * this holds one bare value with no delimiter, and `parseFocusList` reads it
 * back as a one-item list, so no stored slot and no signed slip changes.
 *
 * The delimiter is a pipe, not a comma — a KRA label carries commas of its own
 * ("KRA 3: Curriculum and Planning, Assessment and Reporting").
 */
export const FOCUS_SEPARATOR = " | ";

/** The stored KRA / indicator column read back as the list it represents. */
export function parseFocusList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split("|")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** The list written back to the column; "" when nothing was chosen. */
export function formatFocusList(values: string[]): string {
  return values.filter(Boolean).join(FOCUS_SEPARATOR);
}

/** Stored indicator codes rendered as "code — statement", one per code. */
export function indicatorLabels(value: string | null | undefined): string[] {
  return parseFocusList(value).map((code) => `${code} — ${indicatorText(code)}`);
}

// ============================================================================
// WORKFLOW LABELS
// ============================================================================

export type SupervisionType = "rated" | "non_rated";

export const SUPERVISION_TYPE_LABELS: Record<SupervisionType, string> = {
  rated: "Rated",
  non_rated: "Non-rated (fleeting)",
};

export type SupervisionScheduleStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "completed"
  | "cancelled";

export const SCHEDULE_STATUS_LABELS: Record<SupervisionScheduleStatus, string> = {
  proposed: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type CotFormKind = "rating" | "agreement" | "notes";

export const COT_FORM_LABELS: Record<CotFormKind, string> = {
  rating: "Annex E-2 · COT Rating Sheet",
  agreement: "Annex E-3 · Inter-Observer Agreement Form",
  notes: "Annex E-4 · COT Observation Notes",
};

/**
 * Terms of the supervisory plan, as headed in the source document. Term 3 skips
 * December: the printed plan reads "January to March".
 */
export const SUPERVISION_TERMS = [
  { value: 1, label: "Term 1", months: "June to August" },
  { value: 2, label: "Term 2", months: "September to November" },
  { value: 3, label: "Term 3", months: "January to March" },
] as const;

export function termLabel(term: number): string {
  return SUPERVISION_TERMS.find((t) => t.value === term)?.label ?? `Term ${term}`;
}

export function termMonths(term: number): string {
  return SUPERVISION_TERMS.find((t) => t.value === term)?.months ?? "";
}

/**
 * The term a date falls in, per the plan's own month ranges. December is not
 * covered by any term in the source document, so it returns null rather than
 * being folded into Term 2 or 3.
 */
export function termForDate(date: Date): number | null {
  const m = date.getMonth(); // 0-11
  if (m >= 5 && m <= 7) return 1; // Jun-Aug
  if (m >= 8 && m <= 10) return 2; // Sep-Nov
  if (m >= 0 && m <= 2) return 3; // Jan-Mar
  return null;
}

/**
 * Whether an inter-observer agreement form is called for.
 *
 * Annex E-2 is explicit: "For schools with only one observer, this form will
 * serve as the final rating sheet." The E-3 exists to reconcile two or three
 * observers into one reasoned consensus rating.
 */
export function needsAgreementForm(observerCount: number): boolean {
  return observerCount > 1;
}

/** Maximum observer signature lines on the Annex E-3 form. */
export const MAX_OBSERVERS_PER_OBSERVATION = 3;
