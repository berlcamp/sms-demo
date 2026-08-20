"use client";

import { Button } from "@/components/ui/button";
import {
  deriveFinalProfile,
  PHILIRI_GRADES,
  PHILIRI_SCREENING_LEVELS,
  type PhilIriLevel,
} from "@/lib/constants";
import {
  generatePhilIriConsolidated,
  type PhilIriConsolidatedSection,
  type PhilIriTally,
} from "@/lib/pdf/generatePhilIriConsolidated";
import {
  generatePhilIriMatrix,
  type PhilIriMatrixLearner,
} from "@/lib/pdf/generatePhilIriMatrix";
import { supabase } from "@/lib/supabase/client";
import { fetchSchoolSettings } from "@/lib/utils/schoolSettings";
import type { PhilIriComprehensionAnswer, Student } from "@/types";
import { FileSpreadsheet, Loader2, Table2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import type { AdviserSection } from "../page";

/** Enrollment statuses that count a learner as on the section roster. */
const ROSTER_STATUSES = [
  "active",
  "promoted",
  "graduated",
  "retained",
  "completed",
];

interface IndividualRow {
  student_id: number | string;
  overall_reading_level: string | null;
  miscue_counts: Record<string, number> | null;
  miscues: number | null;
  word_reading_score: number | null;
  word_reading_level: string | null;
  comprehension_answers: Record<string, PhilIriComprehensionAnswer> | null;
  comprehension_raw: number | null;
  comprehension_total: number | null;
  comprehension_score: number | null;
  comprehension_level: string | null;
  material: { grade_level: number } | null;
}

const INDIVIDUAL_COLUMNS =
  "student_id, overall_reading_level, miscue_counts, miscues, word_reading_score, word_reading_level, comprehension_answers, comprehension_raw, comprehension_total, comprehension_score, comprehension_level, material:sms_philiri_materials!inner(grade_level, language)";

const emptyTally = (): PhilIriTally => ({ M: 0, F: 0, T: 0 });

function bump(t: PhilIriTally, gender: string | null | undefined): void {
  if (gender === "male") t.M += 1;
  else if (gender === "female") t.F += 1;
  t.T += 1;
}

interface Props {
  section: AdviserSection | null;
  students: Student[];
  schoolYear: string;
  phase: string;
  language: string;
  teacherName: string;
  /** The school the consolidated report covers (the user's own school). */
  schoolId: number | null;
}

/**
 * Print actions that read straight from the database rather than from the
 * on-screen table: the section Matrix of Reading Profile (Form 3A/3B detail per
 * learner) and the school-wide consolidated result grouped by grade level.
 */
export function PhilIriPrintBar({
  section,
  students,
  schoolYear,
  phase,
  language,
  teacherName,
  schoolId,
}: Props) {
  const [busy, setBusy] = useState<"matrix" | "consolidated" | null>(null);

  const printMatrix = async () => {
    if (!section || busy) return;
    if (students.length === 0) {
      toast.error("This section has no enrolled learners.");
      return;
    }
    setBusy("matrix");
    try {
      const studentIds = students.map((s) => Number(s.id));

      // Every graded-passage read for the roster, so the frontier read (the
      // highest grade the learner reached) can be picked per learner — that is
      // the read deriveFinalProfile() bases the reading profile on.
      const { data: individualData, error: individualError } = await supabase
        .from("sms_philiri_records")
        .select(INDIVIDUAL_COLUMNS)
        .eq("phase", phase)
        .eq("school_year", schoolYear)
        .eq("form_type", "individual")
        .eq("material.language", language)
        .in("student_id", studentIds);
      if (individualError) throw individualError;

      const reads = (individualData || []) as unknown as IndividualRow[];
      const byStudent = new Map<string, IndividualRow[]>();
      reads.forEach((r) => {
        if (!r.material) return;
        const key = String(r.student_id);
        if (!byStudent.has(key)) byStudent.set(key, []);
        byStudent.get(key)!.push(r);
      });

      // Learners screened out of the individual test still need a profile —
      // fall back to their Group Screening Test level.
      const { data: screeningData, error: screeningError } = await supabase
        .from("sms_philiri_records")
        .select(
          "student_id, screening_result, material:sms_philiri_materials!inner(language)",
        )
        .eq("phase", phase)
        .eq("school_year", schoolYear)
        .eq("form_type", "screening")
        .eq("material.language", language)
        .in("student_id", studentIds);
      if (screeningError) throw screeningError;

      const screening = new Map<string, string | null>();
      (screeningData || []).forEach((r) => {
        screening.set(String(r.student_id), r.screening_result as string | null);
      });

      const learners: PhilIriMatrixLearner[] = students.map((student) => {
        // Key by String: `id` arrives from a BIGINT column as a number, and Map
        // lookups do not coerce the way object indexing does.
        const key = String(student.id);
        const rows = byStudent.get(key) ?? [];
        const scored = rows.filter((r) => r.material !== null);
        const frontier =
          scored.length > 0
            ? scored.reduce((a, b) =>
                b.material!.grade_level > a.material!.grade_level ? b : a,
              )
            : null;

        const profile = deriveFinalProfile(
          scored.map((r) => ({
            grade: r.material!.grade_level,
            overallLevel: (r.overall_reading_level as PhilIriLevel | null) ?? null,
          })),
        );

        const gst = screening.get(key) ?? null;
        const readingProfile =
          profile.profile !== null
            ? profile.label
            : gst
              ? `${gst} (screening)`
              : "";

        return {
          student,
          miscueCounts: frontier?.miscue_counts ?? null,
          totalMiscues: frontier?.miscues ?? null,
          wordReadingScore:
            frontier?.word_reading_score === null ||
            frontier?.word_reading_score === undefined
              ? null
              : Number(frontier.word_reading_score),
          wordReadingLevel: frontier?.word_reading_level ?? null,
          answers: frontier?.comprehension_answers ?? null,
          comprehensionTotal: frontier?.comprehension_total ?? null,
          comprehensionRaw: frontier?.comprehension_raw ?? null,
          comprehensionScore:
            frontier?.comprehension_score === null ||
            frontier?.comprehension_score === undefined
              ? null
              : Number(frontier.comprehension_score),
          comprehensionLevel: frontier?.comprehension_level ?? null,
          readingProfile,
        };
      });

      await generatePhilIriMatrix({
        schoolId: Number(section.school_id),
        schoolName: section.school_name,
        language,
        gradeLevel: section.grade_level,
        sectionName: section.name,
        teacherName,
        phase,
        schoolYear,
        learners,
      });
    } catch (e) {
      console.error(e);
      toast.error("Failed to generate the matrix.");
    } finally {
      setBusy(null);
    }
  };

  const printConsolidated = async () => {
    if (busy) return;
    // Report the school the selected section belongs to, not the account's own.
    // They differ for a super admin, whose section list spans every school —
    // keying off user.school_id there consolidates a school they are not
    // looking at, which comes out as a page of zeroes.
    const reportSchoolId = section ? Number(section.school_id) : schoolId;
    if (!reportSchoolId) {
      toast.error("No school is assigned to your account.");
      return;
    }
    setBusy("consolidated");
    try {
      const [{ data: school }, { data: sectionRows }, settings] =
        await Promise.all([
          supabase
            .from("sms_schools")
            .select("name, district")
            .eq("id", reportSchoolId)
            .single(),
          supabase
            .from("sms_sections")
            .select("id, name, grade_level")
            .eq("school_id", reportSchoolId)
            .eq("school_year", schoolYear)
            .eq("is_active", true)
            .in("grade_level", PHILIRI_GRADES)
            .order("grade_level")
            .order("name"),
          fetchSchoolSettings(reportSchoolId),
        ]);

      const sections = (sectionRows || []).map((s) => ({
        id: String(s.id),
        name: s.name as string,
        grade_level: s.grade_level as number,
      }));

      if (sections.length === 0) {
        toast.error(`No Phil-IRI sections found for ${schoolYear}.`);
        return;
      }

      const sectionIds = sections.map((s) => Number(s.id));
      const { data: enrollmentRows, error: enrollmentError } = await supabase
        .from("sms_enrollments")
        .select("student_id, section_id")
        .in("section_id", sectionIds)
        .eq("school_year", schoolYear)
        .eq("status", "approved")
        .in("enrollment_status", ROSTER_STATUSES);
      if (enrollmentError) throw enrollmentError;

      const enrollments = enrollmentRows || [];
      const studentIds = [
        ...new Set(enrollments.map((e) => Number(e.student_id))),
      ];
      if (studentIds.length === 0) {
        toast.error("No enrolled learners found for this school year.");
        return;
      }

      const { data: studentRows, error: studentError } = await supabase
        .from("sms_students")
        .select("id, gender")
        .in("id", studentIds);
      if (studentError) throw studentError;

      const genderOf = new Map<string, string | null>();
      (studentRows || []).forEach((s) => {
        genderOf.set(String(s.id), (s.gender as string | null) ?? null);
      });

      // A learner's reported level is their full Phil-IRI profile when they took
      // the individual test, otherwise the screening level (the only source of
      // "Non-Reader", which the individual form's 3-level scale cannot express).
      const [individualRes, screeningRes] = await Promise.all([
        supabase
          .from("sms_philiri_records")
          .select(
            "student_id, overall_reading_level, material:sms_philiri_materials!inner(grade_level, language)",
          )
          .eq("phase", phase)
          .eq("school_year", schoolYear)
          .eq("form_type", "individual")
          .eq("material.language", language)
          .in("student_id", studentIds),
        supabase
          .from("sms_philiri_records")
          .select(
            "student_id, screening_result, material:sms_philiri_materials!inner(language)",
          )
          .eq("phase", phase)
          .eq("school_year", schoolYear)
          .eq("form_type", "screening")
          .eq("material.language", language)
          .in("student_id", studentIds),
      ]);
      if (individualRes.error) throw individualRes.error;
      if (screeningRes.error) throw screeningRes.error;

      const readsOf = new Map<string, { grade: number; level: string | null }[]>();
      (
        individualRes.data as unknown as {
          student_id: number | string;
          overall_reading_level: string | null;
          material: { grade_level: number } | null;
        }[]
      ).forEach((r) => {
        if (!r.material) return;
        const key = String(r.student_id);
        if (!readsOf.has(key)) readsOf.set(key, []);
        readsOf.get(key)!.push({
          grade: r.material.grade_level,
          level: r.overall_reading_level,
        });
      });

      const screeningOf = new Map<string, string | null>();
      (screeningRes.data || []).forEach((r) => {
        screeningOf.set(
          String(r.student_id),
          (r.screening_result as string | null) ?? null,
        );
      });

      /** Reported reading level, or null when the learner was not tested. */
      const levelOf = (studentId: string): string | null => {
        const reads = readsOf.get(studentId);
        if (reads && reads.length > 0) {
          const profile = deriveFinalProfile(
            reads.map((r) => ({
              grade: r.grade,
              overallLevel: (r.level as PhilIriLevel | null) ?? null,
            })),
          );
          if (profile.profile !== null) return profile.profile;
        }
        return screeningOf.get(studentId) ?? null;
      };

      const bySection = new Map<string, PhilIriConsolidatedSection>();
      sections.forEach((s) => {
        bySection.set(s.id, {
          gradeLevel: s.grade_level,
          sectionName: s.name,
          enrolment: emptyTally(),
          tested: emptyTally(),
          levels: Object.fromEntries(
            PHILIRI_SCREENING_LEVELS.map((l) => [l, emptyTally()]),
          ),
        });
      });

      enrollments.forEach((e) => {
        const row = bySection.get(String(e.section_id));
        if (!row) return;
        const studentId = String(e.student_id);
        const gender = genderOf.get(studentId) ?? null;
        bump(row.enrolment, gender);

        const level = levelOf(studentId);
        if (!level) return;
        bump(row.tested, gender);
        if (row.levels[level]) bump(row.levels[level], gender);
      });

      await generatePhilIriConsolidated({
        schoolName: (school?.name as string) ?? "",
        district: (school?.district as string | null) ?? null,
        schoolYear,
        phase,
        language,
        sections: sections.map((s) => bySection.get(s.id)!),
        preparedBy: teacherName,
        principalName: settings.principal_name,
        principalTitle: settings.principal_title,
      });
    } catch (e) {
      console.error(e);
      toast.error("Failed to generate the consolidated report.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={!section || busy !== null}
        onClick={printMatrix}
      >
        {busy === "matrix" ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <Table2 className="h-4 w-4 mr-1" />
        )}
        Matrix
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy !== null}
        onClick={printConsolidated}
      >
        {busy === "consolidated" ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <FileSpreadsheet className="h-4 w-4 mr-1" />
        )}
        Consolidated Report
      </Button>
    </>
  );
}
