"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ES_SUBJECTS_1_3,
  ES_SUBJECTS_4_6,
  JHS_SUBJECTS,
  SubjectDef,
} from "@/lib/pdf/generateSf10";
import { supabase } from "@/lib/supabase/client";
import { getCurrentSchoolYear } from "@/lib/utils/schoolYear";
import { HistoricalGradeEntry, HistoricalGrades } from "@/types/database";
import {
  Check,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

interface HistoricalGradeFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  schoolId: string;
  gradeLevel: number;
  semester: number | null; // null for K-10; 1 or 2 for SHS
  existing: HistoricalGrades | null;
  defaultSchoolInfo: {
    schoolName: string;
    schoolIdCode: string;
    district: string;
    division: string;
    region: string;
  };
  onSaved: () => void;
  encodedBy: string;
}

const SHS_TRACKS = ["Academic", "TVL", "Sports", "Arts & Design"];

function getGradeLevelLabel(gl: number, semester: number | null): string {
  if (gl === 0) return "Kindergarten";
  if (gl <= 10) return `Grade ${gl}`;
  return `Grade ${gl} · Semester ${semester}`;
}

function getGradeLevelBadge(gl: number): string {
  if (gl === 0) return "K";
  return String(gl);
}

function getStageLabel(gl: number): string {
  if (gl === 0) return "Kindergarten";
  if (gl <= 6) return "Elementary";
  if (gl <= 10) return "Junior High School";
  return "Senior High School";
}

function getSubjectsForLevel(gl: number): SubjectDef[] {
  if (gl >= 1 && gl <= 3) return ES_SUBJECTS_1_3;
  if (gl >= 4 && gl <= 6) return ES_SUBJECTS_4_6;
  if (gl >= 7 && gl <= 10) return JHS_SUBJECTS;
  return []; // SHS uses dynamic subjects
}

function isGradeValid(val: string): boolean {
  if (val === "") return true;
  const num = Number(val);
  return Number.isInteger(num) && num >= 60 && num <= 100;
}

function isSchoolYearValid(val: string): boolean {
  const match = val.match(/^(\d{4})-(\d{4})$/);
  if (!match) return false;
  return Number(match[2]) === Number(match[1]) + 1;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface SHSSubjectRow {
  name: string;
  q1: string;
  q2: string;
}

// ─── Section header w/ numeric eyebrow ─────────────────────────────────────
function SectionHeader({
  index,
  title,
  hint,
  aside,
}: {
  index: string;
  title: string;
  hint?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3 border-b border-border/60 pb-2">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[11px] font-medium tracking-[0.2em] text-muted-foreground">
          {index}
        </span>
        <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
          {title}
        </h3>
        {hint && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            — {hint}
          </span>
        )}
      </div>
      {aside}
    </div>
  );
}

// ─── Required asterisk ─────────────────────────────────────────────────────
function Req() {
  return <span className="ml-0.5 text-destructive">*</span>;
}

export default function HistoricalGradeForm({
  open,
  onOpenChange,
  studentId,
  schoolId,
  gradeLevel,
  semester,
  existing,
  defaultSchoolInfo,
  onSaved,
  encodedBy,
}: HistoricalGradeFormProps) {
  const isSHS = gradeLevel >= 11;
  const isKindergarten = gradeLevel === 0;
  const subjects = getSubjectsForLevel(gradeLevel);

  // School info
  const [schoolName, setSchoolName] = useState("");
  const [schoolIdCode, setSchoolIdCode] = useState("");
  const [district, setDistrict] = useState("");
  const [division, setDivision] = useState("");
  const [region, setRegion] = useState("");

  // Record info
  const [schoolYear, setSchoolYear] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [adviserName, setAdviserName] = useState("");
  const [track, setTrack] = useState("");
  const [strand, setStrand] = useState("");

  // Grades — K-10 predefined subjects
  const [gradeValues, setGradeValues] = useState<
    Record<string, { q1: string; q2: string; q3: string; q4: string }>
  >({});

  // SHS dynamic subjects
  const [shsSubjects, setShsSubjects] = useState<SHSSubjectRow[]>([
    { name: "", q1: "", q2: "" },
  ]);

  const [generalAverage, setGeneralAverage] = useState("");
  const [saving, setSaving] = useState(false);

  // Attachment
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (!open) return;

    if (existing) {
      setSchoolName(existing.school_name || "");
      setSchoolIdCode(existing.school_id_code || "");
      setDistrict(existing.district || "");
      setDivision(existing.division || "");
      setRegion(existing.region || "");
      setSchoolYear(existing.school_year || "");
      setSectionName(existing.section_name || "");
      setAdviserName(existing.adviser_name || "");
      setTrack(existing.track || "");
      setStrand(existing.strand || "");
      setGeneralAverage(
        existing.general_average != null
          ? String(existing.general_average)
          : "",
      );

      if (isSHS) {
        const rows: SHSSubjectRow[] = Object.entries(existing.grades).map(
          ([name, entry]) => ({
            name,
            q1: entry.q1 != null ? String(entry.q1) : "",
            q2: entry.q2 != null ? String(entry.q2) : "",
          }),
        );
        setShsSubjects(rows.length > 0 ? rows : [{ name: "", q1: "", q2: "" }]);
      } else {
        const vals: Record<
          string,
          { q1: string; q2: string; q3: string; q4: string }
        > = {};
        Object.entries(existing.grades).forEach(([key, entry]) => {
          vals[key] = {
            q1: entry.q1 != null ? String(entry.q1) : "",
            q2: entry.q2 != null ? String(entry.q2) : "",
            q3: entry.q3 != null ? String(entry.q3) : "",
            q4: entry.q4 != null ? String(entry.q4) : "",
          };
        });
        setGradeValues(vals);
      }
      setAttachmentUrl(
        (existing as unknown as { attachment_url?: string | null })
          .attachment_url ?? null,
      );
      setAttachmentName(
        (existing as unknown as { attachment_name?: string | null })
          .attachment_name ?? null,
      );
      setAttachmentFile(null);
    } else {
      setSchoolName(defaultSchoolInfo.schoolName);
      setSchoolIdCode(defaultSchoolInfo.schoolIdCode);
      setDistrict(defaultSchoolInfo.district);
      setDivision(defaultSchoolInfo.division);
      setRegion(defaultSchoolInfo.region);
      setSchoolYear("");
      setSectionName("");
      setAdviserName("");
      setTrack("");
      setStrand("");
      setGeneralAverage("");
      setGradeValues({});
      setShsSubjects([{ name: "", q1: "", q2: "" }]);
      setAttachmentFile(null);
      setAttachmentUrl(null);
      setAttachmentName(null);
    }
  }, [open, existing, defaultSchoolInfo, isSHS]);

  const updateGrade = (
    subjectKey: string,
    quarter: "q1" | "q2" | "q3" | "q4",
    value: string,
  ) => {
    setGradeValues((prev) => {
      const current = prev[subjectKey] || { q1: "", q2: "", q3: "", q4: "" };
      return {
        ...prev,
        [subjectKey]: { ...current, [quarter]: value },
      };
    });
  };

  const updateShsSubject = (
    index: number,
    field: "name" | "q1" | "q2",
    value: string,
  ) => {
    setShsSubjects((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  };

  const addShsSubject = () => {
    setShsSubjects((prev) => [...prev, { name: "", q1: "", q2: "" }]);
  };

  const removeShsSubject = (index: number) => {
    setShsSubjects((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Live computed average preview ────────────────────────────────────────
  const computedAverage = useMemo(() => {
    const subjectAverages: number[] = [];
    if (isSHS) {
      for (const row of shsSubjects) {
        if (!row.name.trim()) continue;
        const nums = [row.q1, row.q2]
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (nums.length > 0) {
          subjectAverages.push(nums.reduce((a, b) => a + b, 0) / nums.length);
        }
      }
    } else {
      for (const subj of subjects) {
        if (subj.isHeader) continue;
        const v = gradeValues[subj.key];
        if (!v) continue;
        const nums = [v.q1, v.q2, v.q3, v.q4]
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (nums.length > 0) {
          subjectAverages.push(nums.reduce((a, b) => a + b, 0) / nums.length);
        }
      }
    }
    if (subjectAverages.length === 0) return null;
    const avg =
      subjectAverages.reduce((a, b) => a + b, 0) / subjectAverages.length;
    return Math.round(avg * 100) / 100;
  }, [gradeValues, shsSubjects, subjects, isSHS]);

  // School year dropdown options (current year + ~25 years back, useful for historical encoding)
  const schoolYearOptions = useMemo(() => {
    const current = getCurrentSchoolYear();
    const startYear = Number(current.slice(0, 4));
    const opts: string[] = [];
    for (let i = 0; i <= 25; i++) {
      const y = startYear - i;
      opts.push(`${y}-${y + 1}`);
    }
    // Make sure an existing/saved year that's older than the window still appears
    if (schoolYear && !opts.includes(schoolYear)) {
      opts.push(schoolYear);
    }
    return opts;
  }, [schoolYear]);

  const onPickFile = (f: File | null | undefined) => {
    if (f) setAttachmentFile(f);
  };

  const handleSave = async () => {
    // Validation
    if (!schoolName.trim()) {
      toast.error("School name is required");
      return;
    }
    if (!sectionName.trim() && !isKindergarten) {
      toast.error("Section name is required");
      return;
    }
    if (!schoolYear.trim() || !isSchoolYearValid(schoolYear)) {
      toast.error("School year must be in YYYY-YYYY format (e.g., 2023-2024)");
      return;
    }

    // Build grades JSONB
    const gradesJson: Record<string, HistoricalGradeEntry> = {};

    if (isKindergarten) {
      // No subject grades for kindergarten
    } else if (isSHS) {
      const validRows = shsSubjects.filter((r) => r.name.trim());
      if (validRows.length === 0) {
        toast.error("At least one subject with a name is required");
        return;
      }
      for (const row of validRows) {
        if (!isGradeValid(row.q1) || !isGradeValid(row.q2)) {
          toast.error(
            `Invalid grade for "${row.name}". Grades must be 60-100 or empty.`,
          );
          return;
        }
        gradesJson[row.name.trim()] = {
          q1: row.q1 ? Number(row.q1) : null,
          q2: row.q2 ? Number(row.q2) : null,
          q3: null,
          q4: null,
        };
      }
    } else {
      // K-10 predefined subjects
      for (const subj of subjects) {
        if (subj.isHeader) continue;
        const vals = gradeValues[subj.key];
        if (!vals) continue;
        const q1 = vals.q1 || "";
        const q2 = vals.q2 || "";
        const q3 = vals.q3 || "";
        const q4 = vals.q4 || "";
        if (
          !isGradeValid(q1) ||
          !isGradeValid(q2) ||
          !isGradeValid(q3) ||
          !isGradeValid(q4)
        ) {
          toast.error(
            `Invalid grade for "${subj.label}". Grades must be 60-100 or empty.`,
          );
          return;
        }
        if (q1 || q2 || q3 || q4) {
          gradesJson[subj.key] = {
            q1: q1 ? Number(q1) : null,
            q2: q2 ? Number(q2) : null,
            q3: q3 ? Number(q3) : null,
            q4: q4 ? Number(q4) : null,
          };
        }
      }
    }

    setSaving(true);
    try {
      // Upload attachment if a new file was selected
      let finalAttachmentUrl = attachmentUrl;
      let finalAttachmentName = attachmentName;
      if (attachmentFile) {
        const ext = attachmentFile.name.split(".").pop() || "bin";
        const path = `${schoolId}/${studentId}/historical_${gradeLevel}_${semester ?? 0}_${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("diplomas")
          .upload(path, attachmentFile, {
            upsert: true,
            contentType: attachmentFile.type,
          });
        if (uploadErr) throw uploadErr;
        const { data: pub } = supabase.storage
          .from("diplomas")
          .getPublicUrl(path);
        finalAttachmentUrl = pub.publicUrl;
        finalAttachmentName = attachmentFile.name;
      }

      const record = {
        student_id: studentId,
        school_id: schoolId,
        grade_level: gradeLevel,
        school_year: schoolYear.trim(),
        section_name: sectionName.trim() || null,
        school_name: schoolName.trim(),
        school_id_code: schoolIdCode.trim() || null,
        district: district.trim() || null,
        division: division.trim() || null,
        region: region.trim() || null,
        adviser_name: adviserName.trim() || null,
        semester: semester,
        track: isSHS ? track || null : null,
        strand: isSHS ? strand || null : null,
        grades: gradesJson,
        general_average: generalAverage ? Number(generalAverage) : null,
        encoded_by: encodedBy,
        attachment_url: finalAttachmentUrl,
        attachment_name: finalAttachmentName,
      };

      if (existing) {
        const { error } = await supabase
          .from("sms_historical_grades")
          .update(record)
          .eq("id", existing.id);
        if (error) throw error;
        toast.success("Historical record updated");
      } else {
        const { error } = await supabase
          .from("sms_historical_grades")
          .insert(record);
        if (error) throw error;
        toast.success("Historical record saved");
      }

      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save historical record",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden p-0 gap-0 flex flex-col">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <DialogHeader className="relative shrink-0 border-b bg-gradient-to-br from-muted/40 via-background to-background px-6 py-5">
          {/* Decorative grid lines */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                DepEd · School Form 10 · Historical Record
              </p>
              <DialogTitle className="mt-1.5 text-2xl font-semibold tracking-tight">
                {existing ? "Edit" : "Encode"} Historical Grades
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-muted-foreground">
                {isSHS
                  ? "Add subjects manually — SHS subjects vary by track and strand."
                  : "Enter the student’s academic record for this grade level."}
              </DialogDescription>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {getGradeLevelLabel(gradeLevel, semester)}
                </span>
                <span className="inline-flex items-center rounded-full border bg-background/60 px-2.5 py-1 text-[11px] text-muted-foreground">
                  {getStageLabel(gradeLevel)}
                </span>
                {existing && (
                  <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                    Editing existing record
                  </span>
                )}
              </div>
            </div>
            {/* Grade level badge */}
            <div className="hidden sm:flex relative shrink-0 flex-col items-center justify-center rounded-xl border bg-background px-4 py-3 shadow-sm">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                Grade
              </span>
              <span className="mt-0.5 text-3xl font-semibold leading-none tracking-tight tabular-nums">
                {getGradeLevelBadge(gradeLevel)}
              </span>
              {semester && (
                <span className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  Sem {semester}
                </span>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* ── Scrollable body ─────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-8">
            {/* ── 01 · School Information ─────────────────────────────── */}
            <section>
              <SectionHeader
                index="01"
                title="School Information"
                hint="Where the record originated"
              />
              <div className="grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    School Name
                    <Req />
                  </Label>
                  <Input
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    placeholder="e.g., Central Elementary School"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    School ID Code
                  </Label>
                  <Input
                    value={schoolIdCode}
                    onChange={(e) => setSchoolIdCode(e.target.value)}
                    placeholder="DepEd School ID"
                    className="font-mono"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    District
                  </Label>
                  <Input
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Division
                  </Label>
                  <Input
                    value={division}
                    onChange={(e) => setDivision(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Region
                  </Label>
                  <Input
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                  />
                </div>
              </div>
            </section>

            {/* ── 02 · Class Information ──────────────────────────────── */}
            <section>
              <SectionHeader
                index="02"
                title="Class Information"
                hint="School year, section, adviser"
              />
              <div className="grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-3">
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    School Year
                    <Req />
                  </Label>
                  <Select value={schoolYear} onValueChange={setSchoolYear}>
                    <SelectTrigger className="font-mono">
                      <SelectValue placeholder="Select school year" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {schoolYearOptions.map((sy) => (
                        <SelectItem key={sy} value={sy} className="font-mono">
                          {sy}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Pick the academic year this record covers
                  </p>
                </div>
                {!isKindergarten && (
                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Section Name
                      <Req />
                    </Label>
                    <Input
                      value={sectionName}
                      onChange={(e) => setSectionName(e.target.value)}
                      placeholder="e.g., Mabini"
                    />
                  </div>
                )}
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Adviser Name
                  </Label>
                  <Input
                    value={adviserName}
                    onChange={(e) => setAdviserName(e.target.value)}
                    placeholder="Class adviser"
                  />
                </div>
              </div>
              {isSHS && (
                <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-2">
                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Track
                    </Label>
                    <Select value={track} onValueChange={setTrack}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select track" />
                      </SelectTrigger>
                      <SelectContent>
                        {SHS_TRACKS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Strand
                    </Label>
                    <Input
                      value={strand}
                      onChange={(e) => setStrand(e.target.value)}
                      placeholder="e.g., STEM, HUMSS, ABM, GAS"
                    />
                  </div>
                </div>
              )}
            </section>

            {/* ── 03 · Subject Grades ─────────────────────────────────── */}
            {!isKindergarten && (
              <section>
                <SectionHeader
                  index="03"
                  title="Subject Grades"
                  hint="Numeric grades 60–100 (leave blank if unknown)"
                  aside={
                    computedAverage != null && (
                      <span className="hidden items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground sm:inline-flex">
                        <span className="font-mono uppercase tracking-wider">
                          Avg
                        </span>
                        <span className="font-mono font-semibold tabular-nums text-foreground">
                          {computedAverage.toFixed(2)}
                        </span>
                      </span>
                    )
                  }
                />
                {isSHS ? (
                  /* ── SHS dynamic rows ──────────────────────────────── */
                  <div className="space-y-2">
                    <div className="grid grid-cols-[28px_1fr_84px_84px_36px] items-center gap-2 px-1 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                      <span className="text-center">#</span>
                      <span>Subject</span>
                      <span className="text-center">Q1</span>
                      <span className="text-center">Q2</span>
                      <span />
                    </div>
                    {shsSubjects.map((row, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-[28px_1fr_84px_84px_36px] items-center gap-2 rounded-md border bg-card px-2 py-1.5 transition-colors hover:border-foreground/20"
                      >
                        <span className="text-center font-mono text-[11px] tabular-nums text-muted-foreground">
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        <Input
                          value={row.name}
                          onChange={(e) =>
                            updateShsSubject(idx, "name", e.target.value)
                          }
                          placeholder="Subject name"
                          className="h-8 border-0 bg-transparent text-sm shadow-none focus-visible:ring-1"
                        />
                        <Input
                          type="number"
                          min={60}
                          max={100}
                          value={row.q1}
                          onChange={(e) =>
                            updateShsSubject(idx, "q1", e.target.value)
                          }
                          className="h-8 text-center font-mono text-sm tabular-nums"
                        />
                        <Input
                          type="number"
                          min={60}
                          max={100}
                          value={row.q2}
                          onChange={(e) =>
                            updateShsSubject(idx, "q2", e.target.value)
                          }
                          className="h-8 text-center font-mono text-sm tabular-nums"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeShsSubject(idx)}
                          disabled={shsSubjects.length <= 1}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addShsSubject}
                      className="mt-2 border-dashed"
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Add Subject
                    </Button>
                  </div>
                ) : (
                  /* ── K-10 predefined table ─────────────────────────── */
                  <div className="overflow-hidden rounded-lg border bg-card">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40">
                          <th className="p-2.5 pl-4 text-left font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                            Subject
                          </th>
                          {(["Q1", "Q2", "Q3", "Q4"] as const).map((q) => (
                            <th
                              key={q}
                              className="w-[78px] p-2.5 text-center font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground"
                            >
                              {q}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {subjects.map((subj) => {
                          if (subj.isHeader) {
                            return (
                              <tr
                                key={subj.key}
                                className="border-t bg-muted/25"
                              >
                                <td
                                  colSpan={5}
                                  className="px-4 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-foreground/80"
                                >
                                  {subj.label}
                                </td>
                              </tr>
                            );
                          }
                          const vals = gradeValues[subj.key] || {
                            q1: "",
                            q2: "",
                            q3: "",
                            q4: "",
                          };
                          const filled = [vals.q1, vals.q2, vals.q3, vals.q4].filter(
                            Boolean,
                          ).length;
                          return (
                            <tr
                              key={subj.key}
                              className="border-t transition-colors hover:bg-muted/20"
                            >
                              <td
                                className={`py-1.5 pl-4 pr-2 ${
                                  subj.isSub
                                    ? "pl-8 text-muted-foreground"
                                    : "font-medium"
                                }`}
                              >
                                <span className="inline-flex items-center gap-2">
                                  {subj.isSub && (
                                    <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                                  )}
                                  {subj.label}
                                  {filled === 4 && (
                                    <Check className="h-3 w-3 text-emerald-600/70" />
                                  )}
                                </span>
                              </td>
                              {(["q1", "q2", "q3", "q4"] as const).map((q) => (
                                <td key={q} className="p-1">
                                  <Input
                                    type="number"
                                    min={60}
                                    max={100}
                                    value={vals[q]}
                                    onChange={(e) =>
                                      updateGrade(subj.key, q, e.target.value)
                                    }
                                    className="h-8 border-transparent bg-transparent text-center font-mono text-sm tabular-nums shadow-none hover:border-border focus-visible:border-border focus-visible:bg-background"
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* General Average */}
                <div className="mt-5 flex flex-col gap-3 rounded-lg border border-dashed bg-muted/20 p-4 sm:flex-row sm:items-end sm:justify-between">
                  <div className="max-w-[260px] flex-1">
                    <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      General Average
                      <span className="ml-1 text-muted-foreground/60">
                        (optional override)
                      </span>
                    </Label>
                    <Input
                      type="number"
                      min={60}
                      max={100}
                      step="0.01"
                      value={generalAverage}
                      onChange={(e) => setGeneralAverage(e.target.value)}
                      placeholder="Auto-computed if blank"
                      className="font-mono tabular-nums"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        Computed
                      </p>
                      <p className="font-mono text-2xl font-semibold leading-none tabular-nums text-foreground">
                        {computedAverage != null
                          ? computedAverage.toFixed(2)
                          : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* ── 04 · Supporting Document ────────────────────────────── */}
            <section>
              <SectionHeader
                index={isKindergarten ? "03" : "04"}
                title="Supporting Document"
                hint="Optional — scanned SF10, report card, or transcript"
              />
              {attachmentFile ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                      <FileText className="h-4 w-4 text-foreground/70" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {attachmentFile.name}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {formatBytes(attachmentFile.size)} · ready to upload
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setAttachmentFile(null)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>
              ) : attachmentUrl ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                  <a
                    href={attachmentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex min-w-0 items-center gap-3"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-primary/5">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground group-hover:underline">
                        {attachmentName || "View attachment"}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        Click to open in new tab
                      </p>
                    </div>
                  </a>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setAttachmentUrl(null);
                      setAttachmentName(null);
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Replace
                  </Button>
                </div>
              ) : (
                <label
                  htmlFor="historical-attachment"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    onPickFile(e.dataTransfer.files?.[0]);
                  }}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
                    dragActive
                      ? "border-primary bg-primary/5"
                      : "border-border bg-muted/20 hover:border-foreground/30 hover:bg-muted/40"
                  }`}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border bg-background">
                    <Upload className="h-4 w-4 text-foreground/70" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      <span className="text-primary underline-offset-2 hover:underline">
                        Click to browse
                      </span>{" "}
                      or drag a file here
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      PDF · PNG · JPG
                    </p>
                  </div>
                  <input
                    id="historical-attachment"
                    type="file"
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={(e) => onPickFile(e.target.files?.[0])}
                  />
                </label>
              )}
            </section>
          </div>
        </div>

        {/* ── Sticky footer ───────────────────────────────────────────── */}
        <div className="shrink-0 border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex items-center justify-between gap-3">
            <div className="hidden items-center gap-2 text-[11px] text-muted-foreground sm:flex">
              <Paperclip className="h-3 w-3" />
              <span className="font-mono uppercase tracking-wider">
                Fields marked
              </span>
              <span className="text-destructive">*</span>
              <span className="font-mono uppercase tracking-wider">
                are required
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="min-w-[140px]"
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Saving…
                  </>
                ) : existing ? (
                  "Update Record"
                ) : (
                  "Save Record"
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
