/**
 * ARAL candidate engine.
 *
 * Reads the diagnostic RESULTS already recorded by the Assessments module and
 * returns the learners in a set of sections who fall in an ARAL program's target
 * range. Nothing is scored here — each assessment's stored level column is mapped
 * to an ARAL tier via the resolvers in lib/constants/aral.ts.
 *
 * Queries are scoped to the sections of a single grade level (all passed section
 * ids share the same grade), so the grade level is a single number and no
 * material join is needed. Each candidate carries the section_id of the record it
 * came from, so an enrollment can be recorded under the learner's own section.
 *
 * Every fetcher reads one row per assessment RECORD, and a learner has one
 * record per material (grade + language + set) — so the lists are collapsed to
 * one row per learner by dedupeCandidates before they leave fetchCandidates.
 */
import {
  crlaTier,
  deriveFinalProfile,
  pabasaTier,
  philiriFinalProfileTier,
  philiriReadingTier,
  philiriScienceEligible,
  readingSourceForGrade,
  rmaScienceEligible,
  rmaTier,
  suggestedStartGrade,
  type PhilIriFinalProfile,
  type PhilIriLevel,
} from "@/lib/constants";
import { supabase } from "@/lib/supabase/client";
import type { AralProgram, AralSourceAssessment, AralTier } from "@/types";

export interface AralCandidate {
  student_id: string;
  section_id: string;
  source_assessment: AralSourceAssessment;
  source_level: string;
  tier: AralTier;
  suggested_start_grade: number | null;
}

/**
 * Collapse candidate lists to ONE row per learner, keeping the most severe
 * result.
 *
 * A learner legitimately holds several assessment records per phase / school
 * year, because every records table is keyed per MATERIAL and a material is one
 * grade level + LANGUAGE + set: CRLA (English / Filipino / Mother Tongue, 083),
 * Phil-IRI (English / Filipino, 084/090) and RMA (085) all behave this way. A
 * learner screened in both languages therefore produces two rows, and the table
 * showed them as two learners — with a different tier and suggested start each,
 * since the resolvers ran per record. Worse, `sms_aral_enrollments` is
 * `UNIQUE (student_id, program, school_year)` (097), so enrolling a selection
 * containing a repeat failed the whole insert and nobody was enrolled.
 *
 * Severity order: `priority` outranks `secondary`; on a tie the LOWER
 * suggested-start grade wins (the deeper gap is the one the intervention has to
 * close). A null start grade carries no information and loses to a known one.
 */
function isMoreSevere(c: AralCandidate, existing: AralCandidate): boolean {
  if (c.tier !== existing.tier) return c.tier === "priority";
  const a = c.suggested_start_grade;
  const b = existing.suggested_start_grade;
  if (a == null) return false;
  if (b == null) return true;
  return a < b;
}

function dedupeCandidates(...lists: AralCandidate[][]): AralCandidate[] {
  const byStudent = new Map<string, AralCandidate>();
  for (const list of lists) {
    for (const c of list) {
      const existing = byStudent.get(c.student_id);
      if (!existing || isMoreSevere(c, existing)) {
        byStudent.set(c.student_id, c);
      }
    }
  }
  return Array.from(byStudent.values());
}

/**
 * Build each learner's individual-test final reading profile across the given
 * sections, by grouping their recorded oral-reading passages
 * (form_type='individual') and running deriveFinalProfile. Returns an empty map
 * when no individual reads exist (the common case — only GST-flagged learners
 * take the individual test).
 */
async function fetchPhiliriFinalProfiles(
  sectionIds: string[],
  schoolYear: string,
  phase: string,
): Promise<Map<string, PhilIriFinalProfile>> {
  const { data } = await supabase
    .from("sms_philiri_records")
    .select("student_id, material_id, overall_reading_level")
    .in("section_id", sectionIds)
    .eq("school_year", schoolYear)
    .eq("phase", phase)
    .eq("form_type", "individual");
  const rows = data || [];
  if (rows.length === 0) return new Map();

  // Resolve each passage material's grade level (the read's ladder rung).
  const materialIds = Array.from(new Set(rows.map((r) => Number(r.material_id))));
  const { data: mats } = await supabase
    .from("sms_philiri_materials")
    .select("id, grade_level")
    .in("id", materialIds);
  const gradeById = new Map<string, number>();
  (mats || []).forEach((m) => gradeById.set(String(m.id), Number(m.grade_level)));

  // Group passage reads per learner, then derive the final profile.
  const readsByStudent = new Map<
    string,
    { grade: number; overallLevel: PhilIriLevel | null }[]
  >();
  rows.forEach((r) => {
    const grade = gradeById.get(String(r.material_id));
    if (grade === undefined) return;
    const sid = String(r.student_id);
    const list = readsByStudent.get(sid) ?? [];
    list.push({
      grade,
      overallLevel: (r.overall_reading_level as PhilIriLevel | null) ?? null,
    });
    readsByStudent.set(sid, list);
  });

  const profiles = new Map<string, PhilIriFinalProfile>();
  readsByStudent.forEach((reads, sid) => {
    profiles.set(sid, deriveFinalProfile(reads));
  });
  return profiles;
}

async function fetchReadingCandidates(
  sectionIds: string[],
  schoolYear: string,
  phase: string,
  grade: number,
): Promise<AralCandidate[]> {
  const source = readingSourceForGrade(grade);

  if (source === "crla") {
    const { data } = await supabase
      .from("sms_crla_records")
      .select("student_id, profile_label, section_id")
      .in("section_id", sectionIds)
      .eq("school_year", schoolYear)
      .eq("phase", phase);
    return (data || []).flatMap((r) => {
      const level = r.profile_label as string | null;
      const tier = crlaTier(level);
      if (!tier) return [];
      return [
        {
          student_id: String(r.student_id),
          section_id: String(r.section_id),
          source_assessment: "crla" as const,
          source_level: level ?? "",
          tier,
          suggested_start_grade: suggestedStartGrade("crla", level, grade),
        },
      ];
    });
  }

  if (source === "philiri") {
    // GST screening gates who is a candidate; the individual oral-reading ladder
    // (form_type='individual'), when recorded, refines each learner's tier and
    // suggested-start grade via the derived final reading profile.
    const [{ data: screening }, finalProfiles] = await Promise.all([
      supabase
        .from("sms_philiri_records")
        .select("student_id, screening_result, total_score, section_id")
        .in("section_id", sectionIds)
        .eq("school_year", schoolYear)
        .eq("phase", phase)
        .eq("form_type", "screening"),
      fetchPhiliriFinalProfiles(sectionIds, schoolYear, phase),
    ]);

    return (screening || []).flatMap((r) => {
      const studentId = String(r.student_id);
      const sectionId = String(r.section_id);
      const level = r.screening_result as string | null;
      const gstTier = philiriReadingTier(level);
      if (!gstTier) return []; // not flagged by the GST → not a candidate

      const profile = finalProfiles.get(studentId);
      if (profile) {
        // Individual test recorded → refine tier + suggested-start from the
        // final profile; drop the learner if they now read at/above grade level.
        const tier = philiriFinalProfileTier(profile, grade);
        if (!tier) return [];
        return [
          {
            student_id: studentId,
            section_id: sectionId,
            source_assessment: "philiri" as const,
            source_level: profile.label,
            tier,
            suggested_start_grade: Math.max(1, profile.grade ?? grade),
          },
        ];
      }

      // No individual reads → fall back to the GST-based tier + suggested start.
      return [
        {
          student_id: studentId,
          section_id: sectionId,
          source_assessment: "philiri" as const,
          source_level: level ?? "",
          tier: gstTier,
          suggested_start_grade: suggestedStartGrade(
            "philiri",
            level,
            grade,
            r.total_score as number | null,
          ),
        },
      ];
    });
  }

  // PABASA (Grades 11-12): a learner is tested in both languages; eligible if
  // Average in either. Dedup by student.
  const { data } = await supabase
    .from("sms_pabasa_records")
    .select("student_id, reading_level, section_id")
    .in("section_id", sectionIds)
    .eq("school_year", schoolYear)
    .eq("phase", phase);
  const seen = new Set<string>();
  const out: AralCandidate[] = [];
  (data || []).forEach((r) => {
    const tier = pabasaTier(r.reading_level as string | null);
    const sid = String(r.student_id);
    if (!tier || seen.has(sid)) return;
    seen.add(sid);
    out.push({
      student_id: sid,
      section_id: String(r.section_id),
      source_assessment: "pabasa",
      source_level: (r.reading_level as string) ?? "",
      tier,
      suggested_start_grade: suggestedStartGrade("pabasa", null, grade),
    });
  });
  return out;
}

async function fetchMathCandidates(
  sectionIds: string[],
  schoolYear: string,
  phase: string,
  grade: number,
): Promise<AralCandidate[]> {
  const { data } = await supabase
    .from("sms_rma_records")
    .select("student_id, mastery_label, section_id")
    .in("section_id", sectionIds)
    .eq("school_year", schoolYear)
    .eq("phase", phase);
  return (data || []).flatMap((r) => {
    const tier = rmaTier(r.mastery_label as string | null);
    if (!tier) return [];
    return [
      {
        student_id: String(r.student_id),
        section_id: String(r.section_id),
        source_assessment: "rma" as const,
        source_level: (r.mastery_label as string) ?? "",
        tier,
        suggested_start_grade: suggestedStartGrade("rma", null, grade),
      },
    ];
  });
}

async function fetchScienceCandidates(
  sectionIds: string[],
  schoolYear: string,
  phase: string,
  grade: number,
): Promise<AralCandidate[]> {
  // Cross-tab: learners at Frustration (Phil-IRI screening) AND Intervention (RMA).
  const [{ data: philiri }, { data: rma }] = await Promise.all([
    supabase
      .from("sms_philiri_records")
      .select("student_id, screening_result")
      .in("section_id", sectionIds)
      .eq("school_year", schoolYear)
      .eq("phase", phase)
      .eq("form_type", "screening"),
    supabase
      .from("sms_rma_records")
      .select("student_id, mastery_label, section_id")
      .in("section_id", sectionIds)
      .eq("school_year", schoolYear)
      .eq("phase", phase),
  ]);

  const philiriSet = new Set(
    (philiri || [])
      .filter((r) => philiriScienceEligible(r.screening_result as string | null))
      .map((r) => String(r.student_id)),
  );
  const out: AralCandidate[] = [];
  const seen = new Set<string>();
  (rma || []).forEach((r) => {
    const sid = String(r.student_id);
    if (
      rmaScienceEligible(r.mastery_label as string | null) &&
      philiriSet.has(sid) &&
      !seen.has(sid)
    ) {
      seen.add(sid);
      out.push({
        student_id: sid,
        section_id: String(r.section_id),
        source_assessment: "cross_tab",
        source_level: "Frustration (Phil-IRI) + Intervention (RMA)",
        tier: "priority",
        suggested_start_grade: suggestedStartGrade("cross_tab", null, grade),
      });
    }
  });
  return out;
}

/**
 * Eligible learners for a program across the sections of one grade level.
 * `phase` is the basis phase (BoSY / MoSY / EoSY). The Summer program always
 * reads the End-of-SY (EoSY) results and unions the Reading + Math target ranges.
 */
export async function fetchCandidates(
  program: AralProgram,
  sectionIds: string[],
  schoolYear: string,
  phase: string,
  grade: number,
): Promise<AralCandidate[]> {
  if (sectionIds.length === 0) return [];
  // Every branch is deduped here rather than inside each fetcher: a learner is
  // one candidate however many materials/languages they were assessed in.
  switch (program) {
    case "reading":
      return dedupeCandidates(
        await fetchReadingCandidates(sectionIds, schoolYear, phase, grade),
      );
    case "mathematics":
      return dedupeCandidates(
        await fetchMathCandidates(sectionIds, schoolYear, phase, grade),
      );
    case "science":
      return dedupeCandidates(
        await fetchScienceCandidates(sectionIds, schoolYear, phase, grade),
      );
    case "summer": {
      const [reading, math] = await Promise.all([
        fetchReadingCandidates(sectionIds, schoolYear, "EoSY", grade),
        fetchMathCandidates(sectionIds, schoolYear, "EoSY", grade),
      ]);
      return dedupeCandidates(reading, math);
    }
    default:
      return [];
  }
}

/** Student IDs already enrolled in this program for the school year (to exclude). */
export async function fetchEnrolledStudentIds(
  program: AralProgram,
  schoolYear: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("sms_aral_enrollments")
    .select("student_id")
    .eq("program", program)
    .eq("school_year", schoolYear);
  return new Set((data || []).map((r) => String(r.student_id)));
}
