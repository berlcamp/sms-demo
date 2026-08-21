"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getGradeLevelLabel, GRADE_LEVELS } from "@/lib/constants";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import { getCurrentSchoolYear } from "@/lib/utils/schoolYear";
import { Save, Sparkles, Upload } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

type Category =
  | "enrollment"
  | "transfer_in"
  | "transfer_out"
  | "dropout"
  | "promotee"
  | "repeater"
  | "balik_aral"
  | "fourps";

type Modality = "face_to_face" | "blended" | "modular" | "online" | "all";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "enrollment", label: "Enrollment (Total)" },
  { value: "transfer_in", label: "Transfer In" },
  { value: "transfer_out", label: "Transfer Out" },
  { value: "dropout", label: "Dropout" },
  { value: "promotee", label: "Promotee" },
  { value: "repeater", label: "Repeater" },
  { value: "balik_aral", label: "Balik-Aral" },
  { value: "fourps", label: "4Ps" },
];

const MODALITIES: { value: Modality; label: string }[] = [
  { value: "all", label: "All / Combined" },
  { value: "face_to_face", label: "Face-to-Face" },
  { value: "blended", label: "Blended" },
  { value: "modular", label: "Modular" },
  { value: "online", label: "Online" },
];

interface RowState {
  grade_level: number;
  male: number;
  female: number;
}

interface Submission {
  id: number;
  status: "draft" | "submitted" | "locked";
  submitted_at: string | null;
  notes: string | null;
}

export default function Page() {
  const user = useAppSelector((state) => state.user.user);
  const params = useSearchParams();
  const syParam = params.get("sy") ?? getCurrentSchoolYear();

  const [sy] = useState(syParam);
  const [category, setCategory] = useState<Category>("enrollment");
  const [modality, setModality] = useState<Modality>("all");

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");

  const isSchoolUser =
    !!user?.school_id &&
    user.type !== "division_admin" &&
    user.type !== "division_type";

  const ensureBlankRows = useCallback(() => {
    const next: Record<number, RowState> = {};
    for (const gl of GRADE_LEVELS) {
      next[gl] = { grade_level: gl, male: 0, female: 0 };
    }
    return next;
  }, []);

  const loadSubmission = useCallback(async () => {
    if (!isSchoolUser || !user?.school_id) return;
    setLoading(true);
    try {
      // 1. Upsert draft header (unique on school/sy/sem/report_type).
      //    Avoid clobbering status if a row already exists.
      const { data: existing, error: selErr } = await supabase
        .from("sms_division_report_submissions")
        .select("id, status, submitted_at, notes")
        .eq("school_id", user.school_id)
        .eq("school_year", sy)
        .is("semester", null)
        .eq("report_type", "enrollment")
        .maybeSingle();
      if (selErr) throw selErr;

      let header: Submission;
      if (!existing) {
        const { data: inserted, error: insErr } = await supabase
          .from("sms_division_report_submissions")
          .insert({
            school_id: user.school_id,
            school_year: sy,
            semester: null,
            report_type: "enrollment",
            status: "draft",
          })
          .select("id, status, submitted_at, notes")
          .single();
        if (insErr) throw insErr;
        header = inserted as Submission;
      } else {
        header = existing as Submission;
      }
      setSubmission(header);
      setNotes(header.notes ?? "");

      // 2. Load detail rows for current category/modality
      const { data: detail, error: detErr } = await supabase
        .from("sms_report_enrollment_rows")
        .select("grade_level, male, female")
        .eq("submission_id", header.id)
        .eq("category", category)
        .eq("modality", modality);
      if (detErr) throw detErr;

      const mapped = ensureBlankRows();
      for (const d of (detail as RowState[]) || []) {
        mapped[d.grade_level] = {
          grade_level: d.grade_level,
          male: Number(d.male || 0),
          female: Number(d.female || 0),
        };
      }
      setRows(mapped);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load draft");
    } finally {
      setLoading(false);
    }
  }, [isSchoolUser, user?.school_id, sy, category, modality, ensureBlankRows]);

  useEffect(() => {
    loadSubmission();
  }, [loadSubmission]);

  const handleAutofill = async () => {
    if (!user?.school_id) return;
    if (category !== "enrollment" || modality !== "all") {
      toast.error(
        'Autofill only supports the "Enrollment (Total)" + "All" combination',
      );
      return;
    }
    try {
      const { data, error } = await supabase.rpc("enrollment_autofill", {
        p_school_id: user.school_id,
        p_school_year: sy,
        p_semester: null,
      });
      if (error) throw error;
      const next = ensureBlankRows();
      for (const d of (data as RowState[]) || []) {
        next[d.grade_level] = {
          grade_level: d.grade_level,
          male: Number(d.male || 0),
          female: Number(d.female || 0),
        };
      }
      setRows(next);
      toast.success("Autofilled from current enrollment data.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Autofill failed");
    }
  };

  const handleSave = async (newStatus: "draft" | "submitted") => {
    if (!submission) return;
    setSaving(true);
    try {
      const payload = GRADE_LEVELS.map((gl) => ({
        grade_level: gl,
        male: Math.max(0, Math.floor(Number(rows[gl]?.male) || 0)),
        female: Math.max(0, Math.floor(Number(rows[gl]?.female) || 0)),
      }));

      const { error: upsertErr } = await supabase.rpc(
        "upsert_enrollment_rows",
        {
          p_submission_id: submission.id,
          p_category: category,
          p_modality: modality,
          p_rows: payload,
        },
      );
      if (upsertErr) throw upsertErr;

      const headerPatch: Record<string, unknown> = {
        notes: notes.trim() || null,
      };
      if (newStatus === "submitted") {
        headerPatch.status = "submitted";
        headerPatch.submitted_at = new Date().toISOString();
        if (user?.system_user_id != null) {
          headerPatch.submitted_by_user_id = user.system_user_id;
        }
      } else {
        headerPatch.status = "draft";
      }

      const { error: hdrErr } = await supabase
        .from("sms_division_report_submissions")
        .update(headerPatch)
        .eq("id", submission.id);
      if (hdrErr) throw hdrErr;

      toast.success(
        newStatus === "submitted" ? "Submitted to division." : "Draft saved.",
      );
      loadSubmission();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const totals = useMemo(() => {
    let male = 0;
    let female = 0;
    for (const gl of GRADE_LEVELS) {
      male += Number(rows[gl]?.male) || 0;
      female += Number(rows[gl]?.female) || 0;
    }
    return { male, female, total: male + female };
  }, [rows]);

  const isLocked = submission?.status === "locked";
  const isSubmitted = submission?.status === "submitted";

  const statusBadge = () => {
    if (!submission || submission.status === "draft") {
      return <Badge variant="outline">Draft</Badge>;
    }
    if (submission.status === "submitted") {
      return <Badge>Submitted</Badge>;
    }
    return <Badge variant="secondary">Locked</Badge>;
  };

  if (!isSchoolUser) {
    return (
      <div className="app__content">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              This page is for school-level staff. Division admins view
              aggregated data under{" "}
              <Link
                href="/division/reports/enrollment"
                className="text-primary underline"
              >
                SDO Reports → Enrollment
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="app__title">
        <Link
          href="/reports/division-submission"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Division Submissions
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="app__title_text">Enrollment — {sy}</h1>
          {statusBadge()}
        </div>
        <p className="text-sm text-muted-foreground">
          Enter learner counts by grade level. Split by Male / Female. Use
          autofill to pre-populate from your current enrollment records.
        </p>
      </div>

      <div className="app__content space-y-4">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as Category)}
                disabled={saving}
              >
                <SelectTrigger className="h-9 w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Modality</Label>
              <Select
                value={modality}
                onValueChange={(v) => setModality(v as Modality)}
                disabled={saving}
              >
                <SelectTrigger className="h-9 w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODALITIES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto flex items-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAutofill}
                disabled={loading || saving || isLocked}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Autofill
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSave("draft")}
                disabled={loading || saving || isLocked}
              >
                <Save className="mr-2 h-4 w-4" />
                Save Draft
              </Button>
              <Button
                size="sm"
                onClick={() => handleSave("submitted")}
                disabled={loading || saving || isLocked}
              >
                <Upload className="mr-2 h-4 w-4" />
                {isSubmitted ? "Re-submit" : "Submit"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Counts by grade level
            </CardTitle>
            <CardDescription>
              {CATEGORIES.find((c) => c.value === category)?.label} ·{" "}
              {MODALITIES.find((m) => m.value === modality)?.label}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="app__table_shell">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Grade Level</TableHead>
                      <TableHead className="text-right w-[120px]">
                        Male
                      </TableHead>
                      <TableHead className="text-right w-[120px]">
                        Female
                      </TableHead>
                      <TableHead className="text-right w-[100px]">
                        Total
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {GRADE_LEVELS.map((gl) => {
                      const row = rows[gl] ?? {
                        grade_level: gl,
                        male: 0,
                        female: 0,
                      };
                      const total =
                        Number(row.male || 0) + Number(row.female || 0);
                      return (
                        <TableRow key={gl}>
                          <TableCell className="font-medium">
                            {getGradeLevelLabel(gl)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              className="ml-auto h-9 w-[100px] text-right"
                              value={row.male === 0 ? "" : row.male}
                              placeholder="0"
                              disabled={isLocked}
                              onChange={(e) =>
                                setRows((prev) => ({
                                  ...prev,
                                  [gl]: {
                                    grade_level: gl,
                                    male: Number(e.target.value) || 0,
                                    female: prev[gl]?.female ?? 0,
                                  },
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              className="ml-auto h-9 w-[100px] text-right"
                              value={row.female === 0 ? "" : row.female}
                              placeholder="0"
                              disabled={isLocked}
                              onChange={(e) =>
                                setRows((prev) => ({
                                  ...prev,
                                  [gl]: {
                                    grade_level: gl,
                                    male: prev[gl]?.male ?? 0,
                                    female: Number(e.target.value) || 0,
                                  },
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {total}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="border-t-2 font-semibold bg-muted/30">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">{totals.male}</TableCell>
                      <TableCell className="text-right">
                        {totals.female}
                      </TableCell>
                      <TableCell className="text-right">
                        {totals.total}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="mt-4 flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">
                Notes (optional)
              </Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isLocked}
                placeholder="Any context for the division reviewer…"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
