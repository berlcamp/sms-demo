"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  computePhilIriLadder,
  getGradeLevelLabel,
  isPhilIriScreeningEnrichment,
  philIriGstConfig,
  philIriIndividualFormCode,
  philIriPhaseLabel,
  philIriScreeningRemark,
  philIriQuestionCount,
  philIriRecordQuestionCount,
  PHILIRI_PHASES,
  type PhilIriLevel,
} from "@/lib/constants";
import { generatePhilIriIndividual } from "@/lib/pdf/generatePhilIriIndividual";
import { generatePhilIriIndividualSummary } from "@/lib/pdf/generatePhilIriIndividualSummary";
import { generatePhilIriIsr } from "@/lib/pdf/generatePhilIriIsr";
import { usableMaterialsFilter } from "@/lib/assessments/scope";
import { supabase } from "@/lib/supabase/client";
import { formatLrn } from "@/lib/utils";
import { PhilIriComprehensionAnswer, PhilIriMaterial, PhilIriRecord, Student } from "@/types";
import { Download, Loader2, Pencil, Printer, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  deriveFinalProfile,
  isrTypeScores,
  rawCorrectOf,
  screeningLevelBadgeClass,
  type PhilIriIsrRow,
} from "../philiriUtils";
import { PhilIriIsrSummary } from "./PhilIriIsrSummary";
import {
  emptyAnswers,
  emptyMiscues,
  emptyPassageValue,
  PassageFormValue,
  passageComputed,
  PhilIriPassageFields,
  questionKeysOf,
  totalSecondsOf,
} from "./PhilIriPassageFields";

/** Chronological index of a Phil-IRI phase (Pre → Mid → Post) for sorting. */
const philiriPhaseOrder = (p: string) =>
  PHILIRI_PHASES.findIndex((x) => x.value === p);

interface LadderRead {
  recordId: string;
  phase: string;
  material: PhilIriMaterial;
  value: PassageFormValue;
  overallLevel: string | null;
  wordReadingLevel: string | null;
  comprehensionLevel: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  student: Student;
  sectionId: number;
  sectionName: string;
  sectionGrade: number;
  schoolId: number;
  teacherId: number;
  teacherName: string;
  language: string;
  phase: string;
  schoolYear: string;
  gstTotal: number | null;
  screeningResult: string | null;
  locked: boolean;
}

// Normalize a stored comprehension_answers entry into the typed {correct,type}
// shape, tolerating legacy free-text values (which carry no correctness/type).
//
// `count` is the number of questions the read was SCORED AGAINST — the record's
// own comprehension_total, falling back to the material's current count. A
// stored key past that count is still kept rather than dropped: if a passage is
// later edited from 10 questions down to 7, the teacher must still see the q8-10
// marks that produced the score already saved on the record.
function normalizeAnswers(
  stored: PhilIriRecord["comprehension_answers"],
  count: number,
): Record<string, PhilIriComprehensionAnswer> {
  const base = emptyAnswers(count);
  if (!stored) return base;
  Object.entries(stored).forEach(([q, v]) => {
    if (!v || typeof v !== "object" || !("type" in v)) return;
    const fallback = base[q] ?? {
      correct: null,
      type: "literal" as PhilIriComprehensionAnswer["type"],
    };
    base[q] = {
      correct: (v as PhilIriComprehensionAnswer).correct ?? null,
      type: (v as PhilIriComprehensionAnswer).type ?? fallback.type,
    };
  });
  return base;
}

function valueFromRecord(
  rec: PhilIriRecord,
  material: PhilIriMaterial,
): PassageFormValue {
  const total = rec.reading_time_seconds;
  return {
    minutes: total !== null && total !== undefined ? Math.floor(total / 60) : null,
    seconds: total !== null && total !== undefined ? total % 60 : null,
    answers: normalizeAnswers(
      rec.comprehension_answers,
      philIriRecordQuestionCount(rec, material),
    ),
    miscues: {
      ...emptyMiscues(),
      ...Object.fromEntries(
        Object.entries(rec.miscue_counts || {}).map(([k, v]) => [k, Number(v)]),
      ),
    },
    dateAssessed: rec.date_assessed ?? "",
    remarks: rec.remarks ?? "",
  };
}

export function PhilIriLadderModal({
  isOpen,
  onClose,
  onSaved,
  student,
  sectionId,
  sectionName,
  sectionGrade,
  schoolId,
  teacherId,
  teacherName,
  language,
  phase,
  schoolYear,
  gstTotal,
  screeningResult,
  locked,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reads, setReads] = useState<LadderRead[]>([]);
  const [historyReads, setHistoryReads] = useState<LadderRead[]>([]);
  const [addOptions, setAddOptions] = useState<PhilIriMaterial[]>([]);
  const [editing, setEditing] = useState<{
    material: PhilIriMaterial;
    recordId: string | null;
    value: PassageFormValue;
  } | null>(null);

  const passed = isPhilIriScreeningEnrichment(screeningResult);
  const gstRemark = philIriScreeningRemark(gstTotal, sectionGrade);

  const load = useCallback(async () => {
    setLoading(true);
    setEditing(null);

    // Materials available for the individual test: this language, active, at or
    // below the learner's grade (they read down-grade passages).
    const { data: mats } = await supabase
      .from("sms_philiri_materials")
      .select("*")
      .or(usableMaterialsFilter(schoolId))
      .eq("language", language)
      .eq("is_active", true)
      .lte("grade_level", sectionGrade)
      .order("grade_level")
      .order("set_label");
    const addList = (mats || []) as PhilIriMaterial[];

    // Existing individual records for this learner / SY, ACROSS all phases — the
    // Reading history table shows the full year (Pre/Mid/Post); the current-phase
    // subset drives the ladder, final profile and ISR below.
    const { data: recs } = await supabase
      .from("sms_philiri_records")
      .select("*")
      .eq("student_id", student.id)
      .eq("school_year", schoolYear)
      .eq("form_type", "individual");
    const records = (recs || []) as PhilIriRecord[];

    // Resolve the material for each record (may be a grade filtered out above).
    const byId: Record<string, PhilIriMaterial> = {};
    addList.forEach((m) => (byId[String(m.id)] = m));
    const missingIds = records
      .map((r) => String(r.material_id))
      .filter((id) => !byId[id]);
    if (missingIds.length > 0) {
      const { data: extra } = await supabase
        .from("sms_philiri_materials")
        .select("*")
        .in("id", missingIds);
      (extra || []).forEach((m) => (byId[String(m.id)] = m as PhilIriMaterial));
    }

    const built: LadderRead[] = records
      .map((r) => {
        const material = byId[String(r.material_id)];
        if (!material) return null;
        return {
          recordId: String(r.id),
          phase: r.phase,
          material,
          value: valueFromRecord(r, material),
          overallLevel: r.overall_reading_level,
          wordReadingLevel: r.word_reading_level,
          comprehensionLevel: r.comprehension_level,
        } as LadderRead;
      })
      .filter((x): x is LadderRead => x !== null);

    // Full-year history: grouped by phase (Pre → Mid → Post), then grade.
    const allReads = [...built].sort(
      (a, b) =>
        philiriPhaseOrder(a.phase) - philiriPhaseOrder(b.phase) ||
        a.material.grade_level - b.material.grade_level,
    );
    // Current-phase reads drive the ladder / final profile / ISR / picker.
    const currentReads = built
      .filter((r) => r.phase === phase)
      .sort((a, b) => a.material.grade_level - b.material.grade_level);

    setAddOptions(addList);
    setReads(currentReads);
    setHistoryReads(allReads);
    setLoading(false);
  }, [language, sectionGrade, student.id, phase, schoolYear]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const passageReads = reads.map((r) => ({
    grade: r.material.grade_level,
    overallLevel: (r.overallLevel as PhilIriLevel | null) ?? null,
  }));

  // Final profile: driven by the current phase's reads, or — when the current
  // phase has none yet (e.g. Post-Test not started) — carried over from the most
  // recent earlier phase in the reading history, so the learner's last known
  // standing still shows.
  let profileReads = passageReads;
  let profileFromPhase: string | null = null;
  if (reads.length === 0 && historyReads.length > 0) {
    const currentOrder = philiriPhaseOrder(phase);
    const prior = historyReads.filter(
      (r) => philiriPhaseOrder(r.phase) <= currentOrder,
    );
    if (prior.length > 0) {
      const latest = Math.max(...prior.map((r) => philiriPhaseOrder(r.phase)));
      profileFromPhase = PHILIRI_PHASES[latest]?.value ?? null;
      profileReads = prior
        .filter((r) => philiriPhaseOrder(r.phase) === latest)
        .map((r) => ({
          grade: r.material.grade_level,
          overallLevel: (r.overallLevel as PhilIriLevel | null) ?? null,
        }));
    }
  }
  const finalProfile = deriveFinalProfile(profileReads);

  // Running ladder state (CURRENT phase only): before any read the "suggested
  // next" follows the GST recommendation (2-3 grade levels down); after each read
  // it advances up (or down) with the learner's overall level. The Grade-1 floor
  // is the function's own — a grade-3 learner "2 levels down" must be pointed at
  // Grade 1 regardless of which materials happen to exist.
  let ladder = computePhilIriLadder(passageReads, sectionGrade, gstTotal);
  // Fresh phase with a carried-over profile → resume at the grade the earlier
  // phase's ladder pointed to (e.g. Post-Test starts at Grade 2, like Mid-Test),
  // not the raw GST recommendation.
  if (profileFromPhase) {
    const priorLadder = computePhilIriLadder(
      profileReads,
      sectionGrade,
      gstTotal,
    );
    const start =
      priorLadder.nextGrade ?? finalProfile.grade ?? ladder.nextGrade;
    ladder = {
      ...ladder,
      nextGrade: start,
      recommendation: `Resume at Grade ${start} — carried over from ${philIriPhaseLabel(profileFromPhase)}.`,
    };
  }
  const hasReads = ladder.currentGrade !== null;

  // Passage picker: every graded passage (already-read ones stay selectable so a
  // read can be re-administered / confirmed), suggested next grade first.
  const readMaterialIds = new Set(reads.map((r) => String(r.material.id)));
  const pickerOptions = [...addOptions].sort((a, b) => {
    const aSuggested = a.grade_level === ladder.nextGrade ? 0 : 1;
    const bSuggested = b.grade_level === ladder.nextGrade ? 0 : 1;
    if (aSuggested !== bSuggested) return aSuggested - bSuggested;
    return a.grade_level - b.grade_level;
  });

  const openNew = (materialId: string) => {
    const material = addOptions.find((m) => String(m.id) === materialId);
    if (!material) return;
    const existing = reads.find((r) => String(r.material.id) === materialId);
    setEditing({
      material,
      recordId: existing?.recordId ?? null,
      value: existing
        ? existing.value
        : emptyPassageValue(philIriQuestionCount(material)),
    });
  };

  const openEdit = (read: LadderRead) =>
    setEditing({
      material: read.material,
      recordId: read.recordId,
      value: read.value,
    });

  const saveEditing = async () => {
    if (!editing || saving || locked) return;
    setSaving(true);
    try {
      const { material, value } = editing;
      const computed = passageComputed(material, value);
      const numericMiscues = Object.fromEntries(
        Object.entries(value.miscues).filter(([, v]) => typeof v === "number"),
      );
      const payload = {
        material_id: Number(material.id),
        school_id: schoolId,
        section_id: sectionId,
        student_id: Number(student.id),
        teacher_id: teacherId,
        phase,
        school_year: schoolYear,
        form_type: "individual",
        reading_time_seconds: totalSecondsOf(value),
        reading_rate: computed.readingRate,
        // Raw comprehension score is derived from the per-question ✓ marks.
        comprehension_raw: rawCorrectOf(value.answers),
        // Snapshot the denominator this read was scored against, so re-editing
        // the passage's question count later cannot rescore a filled-in form.
        comprehension_total: questionKeysOf(value).length,
        comprehension_answers: value.answers,
        comprehension_score: computed.comprehensionScore,
        comprehension_level: computed.comprehensionLevel,
        miscue_counts:
          Object.keys(numericMiscues).length > 0 ? numericMiscues : null,
        miscues: computed.totalMiscues,
        word_reading_score: computed.wordReadingScore,
        word_reading_level: computed.wordReadingLevel,
        overall_reading_level: computed.overallReadingLevel,
        date_assessed: value.dateAssessed || null,
        remarks: value.remarks.trim() || null,
      };
      const { error } = await supabase
        .from("sms_philiri_records")
        .upsert(payload, {
          onConflict: "material_id,student_id,phase,school_year,form_type",
        });
      if (error) throw new Error(error.message);
      toast.success("Passage read saved!");
      await load();
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const deleteRead = async (read: LadderRead) => {
    if (locked) return;
    const { error } = await supabase
      .from("sms_philiri_records")
      .delete()
      .eq("id", read.recordId);
    if (error) {
      toast.error("Failed to delete.");
      return;
    }
    toast.success("Passage read removed.");
    await load();
    onSaved();
  };

  const printRead = (read: LadderRead) =>
    generatePhilIriIndividual({
      schoolId,
      schoolName: "",
      material: read.material,
      student,
      sectionName,
      teacherName,
      phase: read.phase,
      readingTimeSeconds: totalSecondsOf(read.value),
      comprehensionRaw: rawCorrectOf(read.value.answers),
      comprehensionTotal: questionKeysOf(read.value).length,
      comprehensionAnswers: read.value.answers,
      miscueCounts: read.value.miscues,
      dateAssessed: read.value.dateAssessed || null,
      remarks: read.value.remarks || null,
    }).catch(() => toast.error("Failed to generate the form."));

  // Individual Summary Record (Form 4) rows, one per recorded passage read,
  // shared by the on-screen ISR table and the printed form.
  const isrRows: PhilIriIsrRow[] = reads.map((r) => {
    const c = passageComputed(r.material, r.value);
    const keys = questionKeysOf(r.value);
    return {
      grade: r.material.grade_level,
      title: r.material.title,
      answers: keys.map((k) => r.value.answers[k]),
      byType: isrTypeScores(r.value.answers),
      rawCorrect: rawCorrectOf(r.value.answers),
      totalQuestions: keys.length,
      comprehensionScore: c.comprehensionScore,
      readingLevel: c.comprehensionLevel,
    };
  });

  const printIsr = () =>
    generatePhilIriIsr({
      schoolId,
      student,
      sectionName,
      teacherName,
      language,
      phase,
      rows: isrRows,
    }).catch(() => toast.error("Failed to generate the ISR."));

  const printSummary = () =>
    generatePhilIriIndividualSummary({
      schoolId,
      student,
      sectionName,
      sectionGrade,
      teacherName,
      language,
      phase,
      gstTotal,
      finalProfileLabel: finalProfile.label,
      reads: reads.map((r) => {
        const c = passageComputed(r.material, r.value);
        return {
          grade: r.material.grade_level,
          title: r.material.title,
          wordReadingScore: c.wordReadingScore,
          wordReadingLevel: c.wordReadingLevel,
          comprehensionScore: c.comprehensionScore,
          comprehensionLevel: c.comprehensionLevel,
          overallLevel: c.overallReadingLevel,
        };
      }),
    }).catch(() => toast.error("Failed to generate the summary."));

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-[760px] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {philIriIndividualFormCode(language)} — {student.last_name},{" "}
            {student.first_name}
          </DialogTitle>
          <DialogDescription>
            {sectionName} · {language} ·{" "}
            <span className="font-mono">{formatLrn(student.lrn)}</span>
          </DialogDescription>
        </DialogHeader>

        {/* GST screening result — the starting point for the individual test */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <span className="font-medium">
            GST:{" "}
            {gstTotal === null
              ? "—"
              : `${gstTotal}/${philIriGstConfig(sectionGrade).totalMax}`}
          </span>
          {screeningResult && (
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${screeningLevelBadgeClass(screeningResult)}`}
            >
              {screeningResult}
            </span>
          )}
          {hasReads ? (
            <>
              {ladder.currentLevel && (
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${screeningLevelBadgeClass(ladder.currentLevel)}`}
                >
                  Current: {ladder.currentLevel}
                </span>
              )}
              <span className="text-muted-foreground">
                Recommendation:{" "}
                <span className="font-medium text-foreground">
                  {ladder.recommendation}
                </span>
              </span>
              {!ladder.done && ladder.nextGrade !== null && (
                <span className="text-muted-foreground">
                  · Suggested next: {getGradeLevelLabel(ladder.nextGrade)}
                </span>
              )}
            </>
          ) : (
            <>
              {gstRemark && (
                <span className="text-muted-foreground">
                  Recommendation:{" "}
                  <span className="font-medium text-foreground">{gstRemark}</span>
                </span>
              )}
              {!passed && ladder.nextGrade !== null && (
                <span className="text-muted-foreground">
                  · Suggested start: {getGradeLevelLabel(ladder.nextGrade)}
                </span>
              )}
            </>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            {/* Reading history — every recorded passage read across all phases
                (Pre / Mid / Post), grouped by phase then grade. Only current-phase
                rows are editable; other phases are shown read-only. */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Reading history</p>
              <span className="text-xs text-muted-foreground">
                {historyReads.length}{" "}
                {historyReads.length === 1 ? "passage" : "passages"} recorded
              </span>
            </div>
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="px-3 py-1.5 text-left w-24">Phase</th>
                    <th className="px-3 py-1.5 text-left">Passage</th>
                    <th className="px-2 py-1.5 text-center w-24">Word Reading</th>
                    <th className="px-2 py-1.5 text-center w-24">Comprehension</th>
                    <th className="px-2 py-1.5 text-center w-24">Overall</th>
                    <th className="px-2 py-1.5 text-center w-28">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {historyReads.map((r) => {
                    const isCurrentPhase = r.phase === phase;
                    return (
                      <tr
                        key={r.recordId}
                        className={`border-t ${isCurrentPhase ? "" : "bg-muted/20"}`}
                      >
                        <td className="px-3 py-1.5 text-xs">
                          <span
                            className={
                              isCurrentPhase
                                ? "font-medium text-foreground"
                                : "text-muted-foreground"
                            }
                          >
                            {philIriPhaseLabel(r.phase)}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="font-medium">
                            {getGradeLevelLabel(r.material.grade_level)}
                          </span>{" "}
                          <span className="text-muted-foreground">
                            · {r.material.title}
                            {r.material.set_label
                              ? ` (${r.material.set_label})`
                              : ""}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-center text-xs">
                          {r.wordReadingLevel ?? "-"}
                        </td>
                        <td className="px-2 py-1.5 text-center text-xs">
                          {r.comprehensionLevel ?? "-"}
                        </td>
                        <td className="px-2 py-1.5 text-center text-xs font-semibold">
                          {r.overallLevel ?? "-"}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center justify-center gap-1">
                            {isCurrentPhase && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => openEdit(r)}
                                title="Edit"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => printRead(r)}
                              title="Print form"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                            {isCurrentPhase && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteRead(r)}
                                disabled={locked}
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {historyReads.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-4 text-center text-muted-foreground"
                      >
                        No passage reads yet. Start at the suggested grade below.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Final profile + stop rule */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                Final profile: {finalProfile.label}
              </span>
              {profileFromPhase ? (
                <span className="text-xs text-muted-foreground">
                  Carried over from {philIriPhaseLabel(profileFromPhase)} — no{" "}
                  {philIriPhaseLabel(phase)} reads recorded yet.
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Continue upward until the learner reaches Frustration; the
                  profile reflects the highest grade tested.
                </span>
              )}
            </div>

            {/* Individual Summary Record (Form 4) — Summary of Comprehension
                Responses, derived from the recorded passage reads. */}
            {isrRows.length > 0 && (
              <PhilIriIsrSummary
                language={language}
                phase={phase}
                rows={isrRows}
              />
            )}

            {/* Add-read picker */}
            {!editing && !locked && (
              <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                <div className="min-w-64">
                  <Label className="mb-1 block text-xs">Add a passage read</Label>
                  {!ladder.done && ladder.nextGrade !== null && (
                    <p className="mb-1 text-xs text-muted-foreground">
                      Suggested next:{" "}
                      <span className="font-medium text-foreground">
                        {getGradeLevelLabel(ladder.nextGrade)}
                      </span>
                    </p>
                  )}
                  <Select value="" onValueChange={openNew}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a graded passage…" />
                    </SelectTrigger>
                    <SelectContent>
                      {pickerOptions.map((m) => (
                        <SelectItem key={m.id} value={String(m.id)}>
                          {getGradeLevelLabel(m.grade_level)} · {m.title}
                          {m.set_label ? ` (${m.set_label})` : ""}
                          {m.grade_level === ladder.nextGrade &&
                          !ladder.done ? (
                            <span className="ml-1 text-primary">· Suggested</span>
                          ) : readMaterialIds.has(String(m.id)) ? (
                            <span className="ml-1 text-muted-foreground">
                              · recorded
                            </span>
                          ) : null}
                        </SelectItem>
                      ))}
                      {pickerOptions.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          No graded passages available.
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Active read editor */}
            {editing && (
              <div className="rounded-md border p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">
                    {getGradeLevelLabel(editing.material.grade_level)} ·{" "}
                    {editing.material.title}
                    {editing.material.set_label
                      ? ` (${editing.material.set_label})`
                      : ""}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {editing.material.word_count} words
                    </span>
                  </p>
                  <div className="flex items-center gap-1">
                    {editing.material.file_url && (
                      <Button size="sm" variant="outline" asChild>
                        <a
                          href={editing.material.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                        >
                          <Download className="h-3.5 w-3.5 mr-1" /> Passage
                        </a>
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setEditing(null)}
                      disabled={saving}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <PhilIriPassageFields
                  material={editing.material}
                  value={editing.value}
                  disabled={saving || locked}
                  onChange={(patch) =>
                    setEditing((prev) =>
                      prev ? { ...prev, value: { ...prev.value, ...patch } } : prev,
                    )
                  }
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setEditing(null)}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={saveEditing}
                    disabled={saving || locked}
                    className="min-w-[110px]"
                  >
                    {saving ? "Saving…" : "Save read"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 gap-2 border-t bg-background px-6 py-4 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={printSummary}
            disabled={reads.length === 0}
          >
            <Printer className="h-4 w-4 mr-1" /> Print summary
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={printIsr}
            disabled={reads.length === 0}
          >
            <Printer className="h-4 w-4 mr-1" /> Print ISR (Form 4)
          </Button>
          <Button type="button" onClick={onClose} disabled={saving}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
