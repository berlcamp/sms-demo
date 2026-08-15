"use client";

/**
 * The per-exam scanning workspace: answer key → answer sheets → scan → results.
 *
 * Mounted for both the teacher and the division pages because the answer key is
 * a property of the exam, not of who is looking at it. What differs is what the
 * role can do:
 *
 *   - the exam's author edits the key; everyone else sees it read-only, so a
 *     division-authored exam cannot pick up a different key at each school;
 *   - sheets, scanning and results are per-section and belong to a teacher, so
 *     the division view offers a single sample sheet to check the layout
 *     against a printer and nothing more.
 *
 * The key is loaded once here and passed down. Every tab has to agree on it:
 * the sheet is laid out from it, the scan is read against it and the slips are
 * printed from it, and a tab holding a stale copy would silently mis-score.
 */

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTeacherSections } from "@/hooks/useExamRoster";
import { getGradeLevelLabel } from "@/lib/constants";
import type { AnswerKeyItem } from "@/lib/omr/score";
import { generateAnswerSheets } from "@/lib/pdf/generateAnswerSheets";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import { fetchAnswerKey } from "@/lib/utils/examAnswerKey";
import {
  getCurrentSchoolYear,
  getGradingPeriodLabel,
  getSchoolYearOptions,
} from "@/lib/utils/schoolYear";
import { generateTosTitle } from "@/lib/utils/tos";
import {
  FileDown,
  FileSpreadsheet,
  KeyRound,
  ListChecks,
  Loader2,
  ScanLine,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AnswerKeyEditor } from "./AnswerKeyEditor";
import { AnswerSheetPanel } from "./AnswerSheetPanel";
import { ExamResultsPanel } from "./ExamResultsPanel";
import { ScanScorePanel } from "./ScanScorePanel";

interface ExamHeader {
  id: string;
  versionLabel: string;
  title: string | null;
  schoolId: number | null;
  createdBy: string | null;
  tos: {
    subject_name: string;
    grade_level: number;
    exam_type: string;
    grading_period: number;
    school_year: string;
    title: string | null;
  };
}

interface ExamScanWorkspaceProps {
  examId: string;
  mode: "teacher" | "division";
}

export function ExamScanWorkspace({ examId, mode }: ExamScanWorkspaceProps) {
  const user = useAppSelector((state) => state.user.user);
  const userId = user?.system_user_id ?? null;
  const isSuperAdmin = user?.type === "super admin";
  const schoolId = user?.school_id != null ? Number(user.school_id) : null;

  const [exam, setExam] = useState<ExamHeader | null>(null);
  const [answerKey, setAnswerKey] = useState<AnswerKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [schoolYear, setSchoolYear] = useState(getCurrentSchoolYear());
  const [sectionId, setSectionId] = useState("");
  const [resultsToken, setResultsToken] = useState(0);

  const { sections, loading: sectionsLoading } = useTeacherSections(
    schoolYear,
    userId,
    isSuperAdmin,
  );
  const [schoolName, setSchoolName] = useState("");

  // The key is editable by whoever may edit the exam itself, matching ExamList:
  // division rows in division mode, the teacher's own rows in teacher mode.
  const canEditKey =
    exam != null &&
    (mode === "division" ||
      (exam.schoolId != null && String(exam.createdBy) === String(userId)));

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from("sms_exams")
      // Kept as one literal — PostgREST types the select string at the type
      // level, and a concatenated string loses that inference.
      .select(
        "id, version_label, title, school_id, created_by, tos:tos_id!inner(subject_name, grade_level, exam_type, grading_period, school_year, title)",
      )
      .eq("id", Number(examId))
      .maybeSingle();

    if (error || !data) {
      setLoadError(error?.message ?? "This exam could not be found.");
      setLoading(false);
      return;
    }

    const tos = (Array.isArray(data.tos) ? data.tos[0] : data.tos) as
      ExamHeader["tos"];

    setExam({
      id: String(data.id),
      versionLabel: data.version_label,
      title: data.title,
      schoolId: data.school_id != null ? Number(data.school_id) : null,
      createdBy: data.created_by != null ? String(data.created_by) : null,
      tos,
    });
    setSchoolYear(tos.school_year || getCurrentSchoolYear());

    try {
      setAnswerKey(await fetchAnswerKey(examId));
    } catch (keyError) {
      toast.error(
        keyError instanceof Error ? keyError.message : String(keyError),
      );
    }
    setLoading(false);
  }, [examId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!schoolId) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("sms_schools")
        .select("name")
        .eq("id", schoolId)
        .maybeSingle();
      if (active && data?.name) setSchoolName(data.name as string);
    })();
    return () => {
      active = false;
    };
  }, [schoolId]);

  if (loading) {
    return (
      <div className="app__content flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading exam…
      </div>
    );
  }

  if (loadError || !exam) {
    return (
      <div className="app__content">
        <div className="app__empty_state">
          <p className="app__empty_state_title">Exam not available</p>
          <p className="app__empty_state_description">{loadError}</p>
        </div>
      </div>
    );
  }

  const examTitle =
    exam.title?.trim() || generateTosTitle(exam.tos) || "Examination";
  const backHref =
    mode === "teacher"
      ? "/teacher/examinations/exam"
      : "/division/examinations/exam";

  const printSampleSheet = () => {
    if (answerKey.length === 0) {
      toast.error("Set the answer key first — it defines the sheet layout.");
      return;
    }
    try {
      generateAnswerSheets({
        schoolName: schoolName || "Division Office",
        examTitle,
        subjectName: exam.tos.subject_name,
        sectionName: "SAMPLE",
        schoolYear: exam.tos.school_year,
        versionLabel: exam.versionLabel,
        answerKey,
        learners: [{ studentId: 0, name: "Sample Learner", lrn: null }],
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div>
      <div className="app__title">
        <Link
          href={backHref}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Exam Creator
        </Link>
        <h1 className="app__title_text flex items-center gap-2">
          <ScanLine className="h-5 w-5" />
          {examTitle}
        </h1>
        <p className="text-xs text-muted-foreground">
          {exam.versionLabel} · {exam.tos.subject_name} ·{" "}
          {getGradeLevelLabel(exam.tos.grade_level)} ·{" "}
          {getGradingPeriodLabel(exam.tos.school_year, exam.tos.grading_period)}
          {exam.schoolId == null && " · authored by the division office"}
        </p>
      </div>

      <div className="app__content">
        <Tabs defaultValue="key" className="w-full">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="key">
                <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                Answer Key
              </TabsTrigger>
              {mode === "teacher" && (
                <>
                  <TabsTrigger value="sheets">
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                    Answer Sheets
                  </TabsTrigger>
                  <TabsTrigger value="scan">
                    <ScanLine className="mr-1.5 h-3.5 w-3.5" />
                    Scan &amp; Score
                  </TabsTrigger>
                  <TabsTrigger value="results">
                    <ListChecks className="mr-1.5 h-3.5 w-3.5" />
                    Results
                  </TabsTrigger>
                </>
              )}
            </TabsList>

            {mode === "teacher" && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  School year
                </span>
                <Select
                  value={schoolYear}
                  onValueChange={(sy) => {
                    setSchoolYear(sy);
                    setSectionId("");
                  }}
                >
                  <SelectTrigger className="h-8 w-32" aria-label="School year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getSchoolYearOptions().map((sy) => (
                      <SelectItem key={sy} value={sy}>
                        {sy}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <TabsContent value="key" className="mt-4">
            <AnswerKeyEditor
              examId={examId}
              answerKey={answerKey}
              canEdit={canEditKey}
              onChange={setAnswerKey}
              onSaved={setAnswerKey}
            />

            {mode === "division" && (
              <div className="mt-6 rounded-lg border bg-muted/20 p-3">
                <p className="mb-2 text-sm font-medium">Check the layout</p>
                <p className="mb-3 text-xs text-muted-foreground">
                  Print one sample sheet and run it through a school scanner
                  before sharing this exam. Schools print their own personalised
                  sheets per learner from the teacher workspace.
                </p>
                <Button size="sm" variant="outline" onClick={printSampleSheet}>
                  <FileDown className="mr-1.5 h-4 w-4" />
                  Download sample answer sheet
                </Button>
              </div>
            )}
          </TabsContent>

          {mode === "teacher" && (
            <>
              <TabsContent value="sheets" className="mt-4">
                <AnswerSheetPanel
                  answerKey={answerKey}
                  schoolName={schoolName}
                  examTitle={examTitle}
                  subjectName={exam.tos.subject_name}
                  versionLabel={exam.versionLabel}
                  schoolYear={schoolYear}
                  sections={sections}
                  sectionId={sectionId}
                  onSectionChange={setSectionId}
                  sectionsLoading={sectionsLoading}
                />
              </TabsContent>

              <TabsContent value="scan" className="mt-4">
                <ScanScorePanel
                  examId={examId}
                  answerKey={answerKey}
                  schoolYear={schoolYear}
                  sections={sections}
                  sectionId={sectionId}
                  onSectionChange={setSectionId}
                  sectionsLoading={sectionsLoading}
                  teacherId={userId}
                  fallbackSchoolId={schoolId}
                  onSaved={() => setResultsToken((n) => n + 1)}
                />
              </TabsContent>

              <TabsContent value="results" className="mt-4">
                <ExamResultsPanel
                  examId={examId}
                  answerKey={answerKey}
                  schoolName={schoolName}
                  examTitle={examTitle}
                  subjectName={exam.tos.subject_name}
                  versionLabel={exam.versionLabel}
                  schoolYear={schoolYear}
                  sections={sections}
                  sectionId={sectionId}
                  onSectionChange={setSectionId}
                  sectionsLoading={sectionsLoading}
                  teacherName={user?.name ?? null}
                  refreshToken={resultsToken}
                />
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </div>
  );
}
