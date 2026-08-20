/**
 * Constants & helpers for the DepEd diagnostic assessments:
 *   - CRLA    (Comprehensive Rapid Literacy Assessment)  Grades 1-3, per language
 *   - Phil-IRI (Philippine Informal Reading Inventory)   Grades 3-10, per language
 *   - RMA     (Rapid Mathematics Assessment)             Grades 1-10
 *
 * Division admins author the materials; section advisers record per-student
 * scores three times a year (BoSY / MoSY / EoSY).
 */

export type AssessmentType = "CRLA" | "PHIL_IRI" | "RMA" | "PABASA";

// ---------------------------------------------------------------------------
// Administration phases (Beginning / Middle / End of School Year)
// ---------------------------------------------------------------------------
export type AssessmentPhase = "BoSY" | "MoSY" | "EoSY";

export const ASSESSMENT_PHASES: { value: AssessmentPhase; label: string }[] = [
  { value: "BoSY", label: "Beginning of SY (BoSY)" },
  { value: "MoSY", label: "Middle of SY (MoSY)" },
  { value: "EoSY", label: "End of SY (EoSY)" },
];

export const ASSESSMENT_PHASE_VALUES = ASSESSMENT_PHASES.map((p) => p.value);

export function getAssessmentPhaseLabel(phase: string | null | undefined): string {
  if (!phase) return "-";
  return ASSESSMENT_PHASES.find((p) => p.value === phase)?.label ?? phase;
}

// Phil-IRI reuses the same stored phase values (BoSY / MoSY / EoSY) but is
// labelled Pre-Test / Mid-Test / Post-Test throughout its own screens & PDF.
export const PHILIRI_PHASES: { value: AssessmentPhase; label: string }[] = [
  { value: "BoSY", label: "Pre-Test" },
  { value: "MoSY", label: "Mid-Test" },
  { value: "EoSY", label: "Post-Test" },
];

export function philIriPhaseLabel(phase: string | null | undefined): string {
  if (!phase) return "-";
  return PHILIRI_PHASES.find((p) => p.value === phase)?.label ?? phase;
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------
export const CRLA_LANGUAGES = ["English", "Filipino", "Mother Tongue"] as const;
export type CrlaLanguage = (typeof CRLA_LANGUAGES)[number];

export const PHILIRI_LANGUAGES = ["English", "Filipino"] as const;
export type PhilIriLanguage = (typeof PHILIRI_LANGUAGES)[number];

// ---------------------------------------------------------------------------
// Grade-level coverage per assessment
// ---------------------------------------------------------------------------
export const CRLA_GRADES = [1, 2, 3];
export const PHILIRI_GRADES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const RMA_GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// ---------------------------------------------------------------------------
// CRLA — reading-profile bands. Lookup is on the RAW total score.
// DepEd CRLA is a 3-task branching flow (Task 1, Task 2L, Task 2H) with a
// 30-point total. See crlaUtils.ts for the branching/auto-fill rules.
//
// Grade 3 English is the one exception: DepEd ships a reduced 2-task /
// 20-point form with no branch. Use crlaTaskSeed() / crlaBandSeed() rather
// than the DEFAULT constants so the right shape is seeded per grade+language.
// ---------------------------------------------------------------------------
export interface AssessmentBandSeed {
  min_score: number;
  max_score: number;
  label: string;
}

export interface AssessmentTaskSeed {
  label: string;
  task_type: string;
  max_score: number;
}

export const CRLA_DEFAULT_BANDS: AssessmentBandSeed[] = [
  { min_score: 0, max_score: 10, label: "Full Refresher" },
  { min_score: 11, max_score: 16, label: "Moderate Refresher" },
  { min_score: 17, max_score: 26, label: "Light Refresher" },
  { min_score: 27, max_score: 30, label: "Grade Ready" },
];

// Three ordered tasks (10 points each, 30-point total). Order matters: the
// branching logic keys off position — index 0 = Task 1, 1 = Task 2L, 2 = Task 2H.
// task_type is cosmetic (constrained to letters|words|sentences|passage).
export const CRLA_DEFAULT_TASKS: AssessmentTaskSeed[] = [
  { label: "Task 1", task_type: "letters", max_score: 10 },
  { label: "Task 2L", task_type: "words", max_score: 10 },
  { label: "Task 2H", task_type: "sentences", max_score: 10 },
];

// ---------------------------------------------------------------------------
// CRLA — Grade 3 English special case (2 tasks, 20-point total).
//
// Grade 3 English has no Task 2L/2H branch: both tasks are always recorded,
// nothing is auto-awarded, and every learner gets a Part 2 Record Form. Bands
// are scored against the 0–20 total.
// ---------------------------------------------------------------------------
export const CRLA_G3_ENGLISH_TASKS: AssessmentTaskSeed[] = [
  { label: "Task 1", task_type: "letters", max_score: 10 },
  { label: "Task 2", task_type: "words", max_score: 10 },
];

export const CRLA_G3_ENGLISH_BANDS: AssessmentBandSeed[] = [
  { min_score: 0, max_score: 0, label: "Full Refresher" },
  { min_score: 1, max_score: 10, label: "Moderate Refresher" },
  { min_score: 11, max_score: 16, label: "Light Refresher" },
  { min_score: 17, max_score: 20, label: "Grade Ready" },
];

/** Grade 3 English uses the reduced 2-task / 20-point form. */
export function isCrlaTwoTaskForm(
  gradeLevel: number | string | null | undefined,
  language: string | null | undefined,
): boolean {
  return Number(gradeLevel) === 3 && language === "English";
}

/** Task seed for a new CRLA material of this grade + language. */
export function crlaTaskSeed(
  gradeLevel: number | string | null | undefined,
  language: string | null | undefined,
): AssessmentTaskSeed[] {
  return (
    isCrlaTwoTaskForm(gradeLevel, language)
      ? CRLA_G3_ENGLISH_TASKS
      : CRLA_DEFAULT_TASKS
  ).map((t) => ({ ...t }));
}

/** Band seed for a new CRLA material of this grade + language. */
export function crlaBandSeed(
  gradeLevel: number | string | null | undefined,
  language: string | null | undefined,
): AssessmentBandSeed[] {
  return (
    isCrlaTwoTaskForm(gradeLevel, language)
      ? CRLA_G3_ENGLISH_BANDS
      : CRLA_DEFAULT_BANDS
  ).map((b) => ({ ...b }));
}

// ---------------------------------------------------------------------------
// CRLA — refresher enrolment recommendation derived from the reading profile.
// Full & Moderate Refresher → mandatory remedial enrolment; Light Refresher →
// optional (encouraged, if the number of tutors permits); Grade Ready → none.
// ---------------------------------------------------------------------------
export type CrlaEnrolmentRecommendation = "Mandatory" | "Optional (encouraged)";

export const CRLA_ENROLMENT_BY_LABEL: Record<string, CrlaEnrolmentRecommendation> = {
  "Full Refresher": "Mandatory",
  "Moderate Refresher": "Mandatory",
  "Light Refresher": "Optional (encouraged)",
};

export function crlaEnrolmentRecommendation(
  label: string | null | undefined,
): CrlaEnrolmentRecommendation | null {
  if (!label) return null;
  return CRLA_ENROLMENT_BY_LABEL[label] ?? null;
}

// ---------------------------------------------------------------------------
// CRLA Part 2 — Record Form (Reading Fluency & Comprehension)
// ---------------------------------------------------------------------------

// Fluency "Observations" rubric (screenshot Part 2). Descriptions are editable
// per record form; these are the DepEd defaults seeded on creation.
export const CRLA_OBSERVATION_LEVELS: { level_no: number; description: string }[] = [
  { level_no: 1, description: "Reads word by word or lower" },
  { level_no: 2, description: "Reads words in chunks" },
  { level_no: 3, description: "Reads fluently but not observing punctuation marks" },
  { level_no: 4, description: "Reads fluently with proper expression" },
];

// Per-question mark on the record form: ✓ / ✗ / N/A.
export const CRLA_ANSWER_STATUSES = ["correct", "wrong", "na"] as const;
export type CrlaAnswerStatus = (typeof CRLA_ANSWER_STATUSES)[number];

export const CRLA_ANSWER_STATUS_LABELS: Record<CrlaAnswerStatus, string> = {
  correct: "✓",
  wrong: "✗",
  na: "N/A",
};

/** "Learner Experience" rating on the DepEd CRLA reading scoresheet. */
export const CRLA_LEARNER_EXPERIENCE_MAX = 5;

// ---------------------------------------------------------------------------
// CRLA — the 5-level READING PROFILE reported on the DepEd workbook's Reading
// Scoresheet / Class Record / Class Summary sheets. This is a DIFFERENT ladder
// from the Part 1 refresher band (Full/Moderate/Light Refresher, Grade Ready):
// it combines Part 1 with the Part 2 reading accuracy and comprehension.
//
// Per the workbook's "Scoring Reference" sheet:
//   Low Emerging Reader   — Part 1 lands in a refresher band below Light
//                           (i.e. the learner never proceeds to Part 2)
//   High Emerging Reader  — reads under 25% of the passage in 1 minute AND
//                           answers no question correctly
//   Developing Reader     — reads 26-50% accurately AND answers 1 correctly
//   Transitioning Reader  — reads 51-75% accurately AND answers 2-3 correctly
//   Reading At Grade Level— reads 76-100% accurately AND answers 4-5 correctly
//
// The two criteria disagree often in real data, and the workbook resolves that
// by taking the MORE SEVERE of the two (e.g. 98% accuracy with 3 correct is
// Transitioning, not Reading At Grade Level). crlaReadingProfile() does that.
// ---------------------------------------------------------------------------
export const CRLA_PROFILE_LOW_EMERGING = "Low Emerging Reader";
export const CRLA_PROFILE_HIGH_EMERGING = "High Emerging Reader";
export const CRLA_PROFILE_DEVELOPING = "Developing Reader";
export const CRLA_PROFILE_TRANSITIONING = "Transitioning Reader";
export const CRLA_PROFILE_AT_GRADE_LEVEL = "Reading At Grade Level";

/** Reading profiles ordered weakest → strongest (report column order). */
export const CRLA_READING_PROFILES = [
  CRLA_PROFILE_LOW_EMERGING,
  CRLA_PROFILE_HIGH_EMERGING,
  CRLA_PROFILE_DEVELOPING,
  CRLA_PROFILE_TRANSITIONING,
  CRLA_PROFILE_AT_GRADE_LEVEL,
] as const;

export type CrlaReadingProfile = (typeof CRLA_READING_PROFILES)[number];

/**
 * Part 1 bands that stop a learner short of Part 2, making them Low Emerging.
 * Expressed as labels (not a score cutoff) so it holds for both the 30-point
 * branching form and the 20-point Grade 3 English flat form, whose numeric
 * band edges differ.
 */
export const CRLA_LOW_EMERGING_PART1_LABELS: readonly string[] = [
  "Full Refresher",
  "Moderate Refresher",
];

/** Profile implied by reading accuracy alone (% of correct words read). */
export function crlaAccuracyProfile(pct: number): CrlaReadingProfile {
  if (pct <= 25) return CRLA_PROFILE_HIGH_EMERGING;
  if (pct <= 50) return CRLA_PROFILE_DEVELOPING;
  if (pct <= 75) return CRLA_PROFILE_TRANSITIONING;
  return CRLA_PROFILE_AT_GRADE_LEVEL;
}

/** Profile implied by the number of comprehension questions answered correctly. */
export function crlaComprehensionProfile(correct: number): CrlaReadingProfile {
  if (correct <= 0) return CRLA_PROFILE_HIGH_EMERGING;
  if (correct === 1) return CRLA_PROFILE_DEVELOPING;
  if (correct <= 3) return CRLA_PROFILE_TRANSITIONING;
  return CRLA_PROFILE_AT_GRADE_LEVEL;
}

/**
 * The learner's reported CRLA reading profile. Low Emerging short-circuits on
 * the Part 1 band; otherwise it is the more severe of the accuracy and
 * comprehension profiles. Returns null while Part 2 is unscored.
 */
export function crlaReadingProfile(params: {
  part1Label: string | null | undefined;
  accuracyPct: number | null | undefined;
  comprehensionCorrect: number | null | undefined;
}): CrlaReadingProfile | null {
  const { part1Label, accuracyPct, comprehensionCorrect } = params;

  if (part1Label && CRLA_LOW_EMERGING_PART1_LABELS.includes(part1Label)) {
    return CRLA_PROFILE_LOW_EMERGING;
  }
  if (
    accuracyPct === null ||
    accuracyPct === undefined ||
    comprehensionCorrect === null ||
    comprehensionCorrect === undefined
  ) {
    return null;
  }

  const byAccuracy = crlaAccuracyProfile(accuracyPct);
  const byComprehension = crlaComprehensionProfile(comprehensionCorrect);
  return CRLA_READING_PROFILES.indexOf(byAccuracy) <=
    CRLA_READING_PROFILES.indexOf(byComprehension)
    ? byAccuracy
    : byComprehension;
}

// ---------------------------------------------------------------------------
// Phil-IRI — reading levels (Phil-IRI Manual 2018). Word-reading level is based
// on the miscue percentage; comprehension level on the comprehension percentage.
// ---------------------------------------------------------------------------
export type PhilIriLevel = "Independent" | "Instructional" | "Frustration";

const PHILIRI_LEVEL_SEVERITY: Record<PhilIriLevel, number> = {
  Frustration: 0,
  Instructional: 1,
  Independent: 2,
};

/** Word-reading level from word-reading score % (≥97 Ind, 90-96 Inst, ≤89 Frus). */
export function wordReadingLevel(pct: number): PhilIriLevel {
  if (pct >= 97) return "Independent";
  if (pct >= 90) return "Instructional";
  return "Frustration";
}

/** Comprehension level from comprehension score % (≥80 Ind, 59-79 Inst, ≤58 Frus). */
export function comprehensionLevel(pct: number): PhilIriLevel {
  if (pct >= 80) return "Independent";
  if (pct >= 59) return "Instructional";
  return "Frustration";
}

/** Overall reading level = the more severe (lower) of the two component levels. */
export function overallReadingLevel(
  word: PhilIriLevel,
  comp: PhilIriLevel,
): PhilIriLevel {
  return PHILIRI_LEVEL_SEVERITY[word] <= PHILIRI_LEVEL_SEVERITY[comp]
    ? word
    : comp;
}

export const PHILIRI_QUESTION_TYPES = ["literal", "inferential", "critical"] as const;
export type PhilIriQuestionType = (typeof PHILIRI_QUESTION_TYPES)[number];

/** Full and abbreviated (L / I / C) labels for the comprehension question types. */
export const PHILIRI_QUESTION_TYPE_LABELS: Record<PhilIriQuestionType, string> = {
  literal: "Literal",
  inferential: "Inferential",
  critical: "Critical",
};
export const PHILIRI_QUESTION_TYPE_ABBR: Record<PhilIriQuestionType, string> = {
  literal: "L",
  inferential: "I",
  critical: "C",
};

// Default Literal/Inferential/Critical layout for the 7-question individual
// passage comprehension check (mirrors the GST 7/7/6 proportion, scaled down).
// The teacher can override any question's type per passage while scoring.
export const PHILIRI_DEFAULT_QUESTION_TYPES: PhilIriQuestionType[] = [
  "literal",
  "literal",
  "literal",
  "inferential",
  "inferential",
  "critical",
  "critical",
];

// Share of an n-question passage given to each type when laying out the default
// L/I/C spread. Largest-remainder apportionment over these weights reproduces
// PHILIRI_DEFAULT_QUESTION_TYPES exactly at n = 7 (3 L / 2 I / 2 C), so a
// 7-question passage is unchanged by the variable-count support.
const PHILIRI_QUESTION_TYPE_WEIGHTS: Record<PhilIriQuestionType, number> = {
  literal: 0.4,
  inferential: 0.3,
  critical: 0.3,
};

/**
 * Default L/I/C layout for a passage with `count` comprehension questions,
 * apportioned by largest remainder so every question gets a type and the mix
 * stays literal-led. Guidance only — the teacher retypes any question while
 * scoring, and the stored answer carries its own type.
 */
export function philIriDefaultQuestionTypes(
  count: number,
): PhilIriQuestionType[] {
  const n = Math.max(0, Math.trunc(count));
  if (n === 0) return [];

  const quotas = PHILIRI_QUESTION_TYPES.map((type) => {
    const exact = n * PHILIRI_QUESTION_TYPE_WEIGHTS[type];
    return { type, whole: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let assigned = quotas.reduce((sum, q) => sum + q.whole, 0);
  // Hand the leftover questions to the largest fractional parts, ties going to
  // the earlier (more literal) type.
  [...quotas]
    .sort((a, b) => b.remainder - a.remainder)
    .forEach((q) => {
      if (assigned >= n) return;
      quotas.find((x) => x.type === q.type)!.whole += 1;
      assigned += 1;
    });

  return quotas.flatMap((q) => new Array<PhilIriQuestionType>(q.whole).fill(q.type));
}

/**
 * Default question type for the 0-based question index on a passage of `count`
 * questions (fallback: literal). Defaults to the standard 7-question layout so
 * pre-152 callers that know no count keep their behaviour.
 */
export function philIriDefaultQuestionType(
  index: number,
  count: number = PHILIRI_COMPREHENSION_QUESTIONS,
): PhilIriQuestionType {
  if (count === PHILIRI_COMPREHENSION_QUESTIONS) {
    return PHILIRI_DEFAULT_QUESTION_TYPES[index] ?? "literal";
  }
  return philIriDefaultQuestionTypes(count)[index] ?? "literal";
}

// ---------------------------------------------------------------------------
// Phil-IRI Group Screening Test — Class Reading Record (STCRR / Form 1B for
// English, TPPK / Form 1A for Filipino). Section advisers tally the number of
// correct responses per learner in three categories.
//
// The instrument is scaled by key stage:
//   - Grades 3-6:  20-item form (7 literal / 7 inferential / 6 critical),
//                  pass threshold ≥14 (learner need not take the full Phil-IRI).
//   - Grades 7-10: 40-item form (14 literal / 14 inferential / 12 critical),
//                  pass threshold ≥28.
// ---------------------------------------------------------------------------
export const PHILIRI_GST_LITERAL_MAX = 7;
export const PHILIRI_GST_INFERENTIAL_MAX = 7;
export const PHILIRI_GST_CRITICAL_MAX = 6;
export const PHILIRI_GST_TOTAL_MAX =
  PHILIRI_GST_LITERAL_MAX + PHILIRI_GST_INFERENTIAL_MAX + PHILIRI_GST_CRITICAL_MAX; // 20
export const PHILIRI_GST_PASS_THRESHOLD = 14;

export interface PhilIriGstConfig {
  // The DepEd form's nominal item split. These are the STANDARD distribution,
  // not a cap: a division- or school-authored passage may carry a different mix
  // (e.g. 6/8/6) and still total the same, so scoring must not reject a category
  // count above the nominal figure. Only `totalMax` bounds an entry.
  literalMax: number;
  inferentialMax: number;
  criticalMax: number;
  totalMax: number;
  // Screening reading-level cutoffs (see philIriScreeningResult):
  //   0              → Non-Reader
  //   1 .. pass-1    → Frustration
  //   pass .. ind-1  → Instructional (for enrichment)
  //   ind .. total   → Independent   (for enrichment)
  passThreshold: number; // lowest Instructional score
  independentThreshold: number; // lowest Independent score
  // Highest score that still starts the individual test 3 grade levels down
  // (see philIriScreeningRemark / philIriSuggestedStartGrade).
  threeLevelsDownMax: number;
}

/** Grades 3-6 — 20-item form. */
export const PHILIRI_GST_ELEM_CONFIG: PhilIriGstConfig = {
  literalMax: PHILIRI_GST_LITERAL_MAX,
  inferentialMax: PHILIRI_GST_INFERENTIAL_MAX,
  criticalMax: PHILIRI_GST_CRITICAL_MAX,
  totalMax: PHILIRI_GST_TOTAL_MAX,
  passThreshold: PHILIRI_GST_PASS_THRESHOLD, // 14
  independentThreshold: 18,
  threeLevelsDownMax: 7,
};

/** Grades 7-10 — 40-item form (double the elementary items, ≥28 to pass). */
export const PHILIRI_GST_JHS_CONFIG: PhilIriGstConfig = {
  literalMax: 14,
  inferentialMax: 14,
  criticalMax: 12,
  totalMax: 40,
  passThreshold: 28,
  independentThreshold: 36,
  threeLevelsDownMax: 15,
};

/** GST scoring config for a section grade: Grades 7-10 use the 40-item form. */
export function philIriGstConfig(
  gradeLevel: number | null | undefined,
): PhilIriGstConfig {
  return gradeLevel != null && gradeLevel >= 7
    ? PHILIRI_GST_JHS_CONFIG
    : PHILIRI_GST_ELEM_CONFIG;
}

// Screening reading-level labels (also used by the division assessment reports
// rollup). Grade-agnostic so both the 20- and 40-item forms share buckets.
export const PHILIRI_SCREENING_NON_READER = "Non-Reader";
export const PHILIRI_SCREENING_FRUSTRATION = "Frustration";
export const PHILIRI_SCREENING_INSTRUCTIONAL = "Instructional";
export const PHILIRI_SCREENING_INDEPENDENT = "Independent";

/** Screening reading levels, ordered lowest → highest (report column order). */
export const PHILIRI_SCREENING_LEVELS = [
  PHILIRI_SCREENING_NON_READER,
  PHILIRI_SCREENING_FRUSTRATION,
  PHILIRI_SCREENING_INSTRUCTIONAL,
  PHILIRI_SCREENING_INDEPENDENT,
] as const;

/**
 * Screening reading level from the total (null while unscored). Cutoffs depend
 * on the section grade (see PhilIriGstConfig):
 *   Grades 3-6:  0 → Non-Reader · 1-13 Frustration · 14-17 Instructional · 18-20 Independent
 *   Grades 7-10: 0 → Non-Reader · 1-27 Frustration · 28-35 Instructional · 36-40 Independent
 * Instructional / Independent are "for enrichment" (no full Phil-IRI needed).
 */
export function philIriScreeningResult(
  total: number | null,
  gradeLevel?: number | null,
): string | null {
  if (total === null) return null;
  const { passThreshold, independentThreshold } = philIriGstConfig(gradeLevel);
  if (total <= 0) return PHILIRI_SCREENING_NON_READER;
  if (total < passThreshold) return PHILIRI_SCREENING_FRUSTRATION;
  if (total < independentThreshold) return PHILIRI_SCREENING_INSTRUCTIONAL;
  return PHILIRI_SCREENING_INDEPENDENT;
}

/**
 * Whether a screening result places the learner "for enrichment" (Instructional
 * or Independent) — i.e. they need not take the full individual Phil-IRI.
 */
export function isPhilIriScreeningEnrichment(result: string | null): boolean {
  return (
    result === PHILIRI_SCREENING_INSTRUCTIONAL ||
    result === PHILIRI_SCREENING_INDEPENDENT
  );
}

// Screening remarks — where to start the individual (oral reading) test.
export const PHILIRI_REMARK_3_DOWN = "3 grade levels down";
export const PHILIRI_REMARK_2_DOWN = "2 grade levels down";
export const PHILIRI_REMARK_NO_PRETEST = "no need for pretest (for enrichment)";

/**
 * Auto-derived Remarks for the Class Reading Record, from the GST total:
 *   Grades 3-6:  0-7  → 3 down · 8-13  → 2 down · 14+ → no pretest (enrichment)
 *   Grades 7-10: 0-15 → 3 down · 16-27 → 2 down · 28+ → no pretest (enrichment)
 * Returns null while unscored.
 */
export function philIriScreeningRemark(
  total: number | null,
  gradeLevel?: number | null,
): string | null {
  if (total === null) return null;
  const { passThreshold, threeLevelsDownMax } = philIriGstConfig(gradeLevel);
  if (total >= passThreshold) return PHILIRI_REMARK_NO_PRETEST;
  if (total <= threeLevelsDownMax) return PHILIRI_REMARK_3_DOWN;
  return PHILIRI_REMARK_2_DOWN;
}

// Bilingual column labels for the printed / on-screen Class Reading Record.
export interface PhilIriGstLabels {
  formTitle: string;
  formCode: string;
  testTaken: string;
  correctResponses: string;
  literal: string;
  inferential: string;
  critical: string;
  total: string;
  below: string;
  atOrAbove: string;
  note: string;
}

export const PHILIRI_GST_LABELS: Record<"English" | "Filipino", PhilIriGstLabels> = {
  English: {
    formTitle: "Screening Test Class Reading Record (STCRR)",
    formCode: "Phil-IRI Form 1B",
    testTaken: "Test Taken",
    correctResponses: "Number of Correct Responses",
    literal: "Literal",
    inferential: "Inferential",
    critical: "Critical",
    total: "Total Score",
    below: "Mark < 14",
    atOrAbove: "Mark ≥ 14",
    note: "Students with a total score of ≥ 14/20 need not take the Phil-IRI.",
    // `below` / `atOrAbove` / `note` are placeholders — philIriGstLabels()
    // fills in the grade-appropriate threshold and total (14/20 or 28/40).
  },
  Filipino: {
    formTitle: "Talaan ng Pangkatang Pagtatasa ng Klase (TPPK)",
    formCode: "Phil-IRI Form 1A",
    testTaken: "Nakuha ang Pagtatasa",
    correctResponses: "Bilang ng Tamang Sagot",
    literal: "Literal",
    inferential: "Paghihinuha",
    critical: "Kritikal",
    total: "Kabuuang Marka",
    below: "Markang < 14",
    atOrAbove: "Markang ≥ 14",
    note: "Ang mag-aaral na nagtamo ng kabuuang marka na ≥ 14/20 ay hindi na kailangang kumuha ng Phil-IRI.",
  },
};

export function philIriGstLabels(
  language: string,
  gradeLevel?: number | null,
): PhilIriGstLabels {
  const isFilipino = language === "Filipino";
  const base = isFilipino
    ? PHILIRI_GST_LABELS.Filipino
    : PHILIRI_GST_LABELS.English;
  const { passThreshold, totalMax } = philIriGstConfig(gradeLevel);
  return {
    ...base,
    below: isFilipino ? `Markang < ${passThreshold}` : `Mark < ${passThreshold}`,
    atOrAbove: isFilipino
      ? `Markang ≥ ${passThreshold}`
      : `Mark ≥ ${passThreshold}`,
    note: isFilipino
      ? `Ang mag-aaral na nagtamo ng kabuuang marka na ≥ ${passThreshold}/${totalMax} ay hindi na kailangang kumuha ng Phil-IRI.`
      : `Students with a total score of ≥ ${passThreshold}/${totalMax} need not take the Phil-IRI.`,
  };
}

// ---------------------------------------------------------------------------
// Phil-IRI Individual Record Form (Form 3A Filipino / Form 3B English) — the
// per-learner oral reading test given to learners flagged by the screening.
// ---------------------------------------------------------------------------
export type PhilIriFormType = "screening" | "individual";

export const PHILIRI_FORM_TYPES: { value: PhilIriFormType; label: string }[] = [
  { value: "screening", label: "Group Screening (Class Reading Record)" },
  { value: "individual", label: "Individual Record Form (3A / 3B)" },
];

/** Individual-form code shown on the form, per language. */
export function philIriIndividualFormCode(language: string): string {
  return language === "Filipino" ? "Phil-IRI Form 3A" : "Phil-IRI Form 3B";
}

// Word-reading miscue types (Part B). Filipino gloss shown on Form 3A/3B.
export const PHILIRI_MISCUE_TYPES: {
  key: string;
  en: string;
  fil: string;
}[] = [
  { key: "mispronunciation", en: "Mispronunciation", fil: "Maling Bigkas" },
  { key: "omission", en: "Omission", fil: "Pagkakaltas" },
  { key: "substitution", en: "Substitution", fil: "Pagpapalit" },
  { key: "insertion", en: "Insertion", fil: "Pagsisingit" },
  { key: "repetition", en: "Repetition", fil: "Pag-uulit" },
  { key: "transposition", en: "Transposition", fil: "Pagpapalit ng lugar" },
  { key: "reversal", en: "Reversal", fil: "Paglilipat" },
];

// Self-corrections are tallied alongside the miscues on Form 3A/3B and get their
// own column on the Matrix of Reading Profile, but Phil-IRI does NOT count them
// as miscues — they must never enter the word-reading total. Kept OUT of
// PHILIRI_MISCUE_TYPES for exactly that reason; computeIndividual() filters this
// key out of the sum.
export const PHILIRI_SELF_CORRECTION = {
  key: "self_correction",
  en: "Self-Correction",
  fil: "Pagwawasto sa Sarili",
} as const;

// Standard number of comprehension questions on the individual record form.
// This is the DEFAULT ONLY (and the pre-152 assumption): DepEd's graded passages
// carry different question counts per grade level and per set, so the authored
// count lives on the material (sms_philiri_materials.question_count, migration
// 152) and a filled-in form snapshots it into sms_philiri_records.
// comprehension_total. Read it through philIriQuestionCount() / the record's own
// total, never as a bare constant.
export const PHILIRI_COMPREHENSION_QUESTIONS = 7;

// A passage may legally carry 1-20 comprehension questions (migration 152's
// CHECK). Kept here so the material form and the app agree on the bounds.
export const PHILIRI_QUESTION_COUNT_MIN = 1;
export const PHILIRI_QUESTION_COUNT_MAX = 20;

/**
 * How many comprehension questions a passage carries. Falls back to the
 * standard 7 for a material authored before migration 152 (or one read through
 * a projection that omitted the column), so nothing renders zero rows.
 */
export function philIriQuestionCount(
  material: { question_count?: number | null } | null | undefined,
): number {
  const n = Number(material?.question_count);
  return Number.isFinite(n) && n > 0
    ? Math.trunc(n)
    : PHILIRI_COMPREHENSION_QUESTIONS;
}

/**
 * The denominator a SAVED passage read was scored against. The record's own
 * comprehension_total wins over the material's current count — editing a
 * passage's question count must never retroactively rescore a form that was
 * already filled in on paper (the 121 career_stage rule).
 */
export function philIriRecordQuestionCount(
  record: { comprehension_total?: number | null } | null | undefined,
  material: { question_count?: number | null } | null | undefined,
): number {
  const stored = Number(record?.comprehension_total);
  return Number.isFinite(stored) && stored > 0
    ? Math.trunc(stored)
    : philIriQuestionCount(material);
}

/**
 * Suggested STARTING grade for a learner's individual (oral reading) test,
 * derived from their GST screening total. The DepEd flow starts the graded
 * passages ~2-3 levels below the learner's grade: a lower GST score suggests
 * starting further down. This is GUIDANCE ONLY — the teacher picks the actual
 * grade. Result is clamped to `minGrade` (Grade 1 is the lowest Phil-IRI graded
 * passage; callers with a known material set may pass a higher floor).
 */
export function philIriSuggestedStartGrade(
  sectionGrade: number,
  gstTotal: number | null,
  minGrade = 1,
): number {
  // ≤ threeLevelsDownMax (7/20 or 15/40) → 3 levels down; otherwise → 2 levels
  // down (also the default when the GST total is unknown).
  const { threeLevelsDownMax } = philIriGstConfig(sectionGrade);
  const offset = gstTotal !== null && gstTotal <= threeLevelsDownMax ? 3 : 2;
  return Math.max(minGrade, sectionGrade - offset);
}

export const PHILIRI_START_GRADE_HINT =
  "Start ~2-3 grade levels below the learner's grade, based on the GST score. Adjust as needed.";

// ---------------------------------------------------------------------------
// Phil-IRI individual ladder — interpreting a learner's graded-passage reads
// into a running "next step" (which grade to read next) and a FINAL reading
// profile. Shared by the Form 3B modal and the ARAL candidate engine.
// ---------------------------------------------------------------------------

export interface PhilIriPassageRead {
  grade: number;
  overallLevel: PhilIriLevel | null;
}

export interface PhilIriFinalProfile {
  grade: number | null;
  profile: PhilIriLevel | null;
  label: string;
}

/**
 * Interpret a learner's ladder of graded-passage reads into the FINAL reading
 * profile — the HIGHEST grade the learner was tested at (the ladder frontier)
 * and how they performed on it. Since the ladder is administered by ascending
 * grade until the learner frustrates, the latest/highest read is the learner's
 * current standing. Reads with no computed overall level are ignored.
 */
export function deriveFinalProfile(
  reads: PhilIriPassageRead[],
): PhilIriFinalProfile {
  const scored = reads.filter((r) => r.overallLevel !== null);
  if (scored.length === 0) {
    return { grade: null, profile: null, label: "Not yet assessed" };
  }

  const frontier = scored.reduce((a, b) => (b.grade > a.grade ? b : a));
  const grade = frontier.grade;
  const profile = frontier.overallLevel;
  const label =
    profile === "Frustration"
      ? `Frustration — Grade ${grade}`
      : `Grade ${grade} — ${profile}`;
  return { grade, profile, label };
}

export interface PhilIriLadderState {
  currentGrade: number | null; // highest grade read so far (exploration frontier)
  currentLevel: PhilIriLevel | null; // overall level at currentGrade
  nextGrade: number | null; // suggested next passage grade; null when done
  recommendation: string; // guidance text for the modal header
  done: boolean; // profile established — stop
}

/**
 * Compute the running ladder state from the reads recorded so far, following the
 * DepEd oral-reading protocol: start at the GST-suggested grade, move UP while
 * the learner is Independent/Instructional, and DOWN while Frustration, until the
 * boundary — the highest Instructional/Independent grade below a Frustration, or
 * the learner's own grade — is found. Pure; safe to recompute on every render.
 */
export function computePhilIriLadder(
  reads: PhilIriPassageRead[],
  sectionGrade: number,
  gstTotal: number | null,
): PhilIriLadderState {
  const scored = reads.filter((r) => r.overallLevel !== null);

  // No scored reads yet → start at the GST recommendation.
  if (scored.length === 0) {
    const start = philIriSuggestedStartGrade(sectionGrade, gstTotal);
    return {
      currentGrade: null,
      currentLevel: null,
      nextGrade: start,
      recommendation: `Start at Grade ${start} (GST recommendation)`,
      done: false,
    };
  }

  const highest = scored.reduce((a, b) => (b.grade > a.grade ? b : a));
  const currentGrade = highest.grade;
  const currentLevel = highest.overallLevel;

  const passGrades = scored
    .filter(
      (r) =>
        r.overallLevel === "Independent" || r.overallLevel === "Instructional",
    )
    .map((r) => r.grade);

  // Some passage was read at Independent/Instructional level → the suggested
  // next grade is always one above the HIGHEST passed grade. It stays there even
  // once that grade comes back Frustration (that grade is the frustration
  // ceiling) — it only advances when a higher grade is itself passed.
  if (passGrades.length > 0) {
    const highestPass = Math.max(...passGrades);
    if (highestPass >= sectionGrade) {
      return {
        currentGrade,
        currentLevel,
        nextGrade: null,
        done: true,
        recommendation: `Reached the learner's own grade — profile established.`,
      };
    }
    const next = highestPass + 1;
    const frustratedNext = scored.some(
      (r) => r.overallLevel === "Frustration" && r.grade === next,
    );
    return {
      currentGrade,
      currentLevel,
      nextGrade: next,
      done: false,
      recommendation: frustratedNext
        ? `Grade ${highestPass} is the highest passed; Grade ${next} is the frustration level.`
        : `Proceed to Grade ${next}.`,
    };
  }

  // All reads Frustration → descend until a passage is passed.
  const lowestFail = Math.min(...scored.map((r) => r.grade));
  if (lowestFail <= 1) {
    return {
      currentGrade,
      currentLevel,
      nextGrade: null,
      done: true,
      recommendation: `Frustration at Grade 1 — lowest passage; profile established.`,
    };
  }
  const next = lowestFail - 1;
  return {
    currentGrade,
    currentLevel,
    nextGrade: next,
    done: false,
    recommendation: `Move down to Grade ${next}.`,
  };
}

// ---------------------------------------------------------------------------
// RMA — Rapid Mathematics Assessment (DepEd KS1 three-level profile).
//
// The instrument is a fixed 8-task form (A-H) worth 20 points. Levelling is a
// lookup on the PERCENTAGE of the total possible score:
//   Intervention  < 75%
//   Consolidation 75-84%
//   Enhancement   >= 85%
// Administered twice a year: a Pre-Test and a Post-Test (stored under the
// existing `phase` column as BoSY / EoSY so the division rollup keeps working).
// ---------------------------------------------------------------------------

/** Default KS1 task template (A-H). Sum of max scores = 20. */
export const RMA_KS1_TASKS: { key: string; label: string; max_score: number }[] = [
  { key: "A", label: "Task A", max_score: 2 },
  { key: "B", label: "Task B", max_score: 1 },
  { key: "C", label: "Task C", max_score: 2 },
  { key: "D", label: "Task D", max_score: 3 },
  { key: "E", label: "Task E", max_score: 3 },
  { key: "F", label: "Task F", max_score: 2 },
  { key: "G", label: "Task G", max_score: 3 },
  { key: "H", label: "Task H", max_score: 4 },
];

export const RMA_KS1_TOTAL = RMA_KS1_TASKS.reduce((s, t) => s + t.max_score, 0); // 20

// KS1 levelling labels (canonical). Stored on sms_rma_records.mastery_label.
export const RMA_LEVEL_INTERVENTION = "Intervention";
export const RMA_LEVEL_CONSOLIDATION = "Consolidation";
export const RMA_LEVEL_ENHANCEMENT = "Enhancement";

/** Percentage cut-offs, per the KS1 profile. */
export const RMA_CONSOLIDATION_THRESHOLD = 75;
export const RMA_ENHANCEMENT_THRESHOLD = 85;

/**
 * KS1 levelling bands (percentage lookup). Max scores are set just below the
 * next threshold so `bandLabelForScore` on the rounded percentage lands exactly
 * on spec: 74.99 -> Intervention, 75.00 -> Consolidation, 85.00 -> Enhancement.
 */
export const RMA_DEFAULT_BANDS: AssessmentBandSeed[] = [
  { min_score: 0, max_score: 74.99, label: RMA_LEVEL_INTERVENTION },
  { min_score: 75, max_score: 84.99, label: RMA_LEVEL_CONSOLIDATION },
  { min_score: 85, max_score: 100, label: RMA_LEVEL_ENHANCEMENT },
];

/** Static reference for the "KS1 Levelling Guide" card. */
export const RMA_LEVELS: { label: string; range: string; definition: string }[] = [
  {
    label: RMA_LEVEL_INTERVENTION,
    range: "Below 75%",
    definition:
      "Needs intensive support to master fundamental numeracy skills.",
  },
  {
    label: RMA_LEVEL_CONSOLIDATION,
    range: "75–84%",
    definition: "Needs practice to strengthen acquired numeracy skills.",
  },
  {
    label: RMA_LEVEL_ENHANCEMENT,
    range: "85% and above",
    definition: "Ready for advanced numeracy challenges.",
  },
];

/**
 * RMA is administered as a Pre-Test / Post-Test. The stored `phase` values reuse
 * BoSY (Pre) and EoSY (Post) so the division reports rollup needs no change
 * (mirrors the PHILIRI_PHASES relabelling above).
 */
export const RMA_PHASES: { value: AssessmentPhase; label: string }[] = [
  { value: "BoSY", label: "Pre-Test" },
  { value: "EoSY", label: "Post-Test" },
];

export function rmaPhaseLabel(phase: string | null | undefined): string {
  if (!phase) return "-";
  return RMA_PHASES.find((p) => p.value === phase)?.label ?? phase;
}

// ---------------------------------------------------------------------------
// PABASA — Division Pabasa Reading Program (DepEd, Grades 11-12).
//
// A division-initiated reading program. Every Senior High learner is tested in
// BOTH Filipino and English; while the learner reads, the adviser marks a single
// reading-readiness LEVEL (Average / Fast / Spontaneous) — no numeric scoring,
// materials, tasks or bands. Administered three times a year (BoSY / MoSY / EoSY,
// shown as Pretest / Midtest / Posttest).
// ---------------------------------------------------------------------------
export const PABASA_GRADES = [11, 12];

export const PABASA_LANGUAGES = ["Filipino", "English"] as const;
export type PabasaLanguage = (typeof PABASA_LANGUAGES)[number];

// Reading-readiness levels (stored Title-Cased on sms_pabasa_records.reading_level
// so the division rollup can group on the raw column value directly).
export const PABASA_LEVELS = ["Average", "Fast", "Spontaneous"] as const;
export type PabasaLevel = (typeof PABASA_LEVELS)[number];

// Reuses the stored BoSY / MoSY / EoSY phase values but is labelled
// Pretest / Midtest / Posttest throughout its own screens & PDF.
export const PABASA_PHASES: { value: AssessmentPhase; label: string }[] = [
  { value: "BoSY", label: "Pretest" },
  { value: "MoSY", label: "Midtest" },
  { value: "EoSY", label: "Posttest" },
];

export function pabasaPhaseLabel(phase: string | null | undefined): string {
  if (!phase) return "-";
  return PABASA_PHASES.find((p) => p.value === phase)?.label ?? phase;
}

/** Tailwind text colour for a PABASA reading-readiness level. */
export function pabasaLevelColor(label: string | null): string {
  switch (label) {
    case "Average":
      return "text-amber-600 dark:text-amber-400";
    case "Fast":
      return "text-blue-600 dark:text-blue-400";
    case "Spontaneous":
      return "text-green-600 dark:text-green-400";
    default:
      return "text-muted-foreground";
  }
}

/** Find the band label whose [min_score, max_score] contains `score` (inclusive). */
export function bandLabelForScore(
  bands: { min_score: number; max_score: number; label: string }[],
  score: number,
): string | null {
  const match = bands.find((b) => score >= b.min_score && score <= b.max_score);
  return match ? match.label : null;
}
