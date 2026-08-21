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
import {
  SHS_SPECIALIZATION_SUGGESTIONS,
  SHS_STRANDS,
  getStrandLabel,
} from "@/lib/constants";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import { getCurrentSchoolYear } from "@/lib/utils/schoolYear";
import { Plus, Save, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

interface Row {
  id: string; // local uid
  strand: string;
  specialization: string;
  grade_level: 11 | 12;
  male: number;
  female: number;
}

interface Submission {
  id: number;
  status: "draft" | "submitted" | "locked";
  notes: string | null;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export default function Page() {
  const user = useAppSelector((state) => state.user.user);
  const params = useSearchParams();
  const syParam = params.get("sy") ?? getCurrentSchoolYear();
  const semParam = Number(params.get("sem")) || 1;

  const [sy] = useState(syParam);
  const [semester, setSemester] = useState<1 | 2>(
    semParam === 2 ? 2 : 1,
  );

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");

  const isSchoolUser =
    !!user?.school_id &&
    user.type !== "division_admin" &&
    user.type !== "division_type";

  const loadSubmission = useCallback(async () => {
    if (!isSchoolUser || !user?.school_id) return;
    setLoading(true);
    try {
      const { data: existing, error: selErr } = await supabase
        .from("sms_division_report_submissions")
        .select("id, status, notes")
        .eq("school_id", user.school_id)
        .eq("school_year", sy)
        .eq("semester", semester)
        .eq("report_type", "shs_specialization")
        .maybeSingle();
      if (selErr) throw selErr;

      let header: Submission;
      if (!existing) {
        const { data: inserted, error: insErr } = await supabase
          .from("sms_division_report_submissions")
          .insert({
            school_id: user.school_id,
            school_year: sy,
            semester,
            report_type: "shs_specialization",
            status: "draft",
          })
          .select("id, status, notes")
          .single();
        if (insErr) throw insErr;
        header = inserted as Submission;
      } else {
        header = existing as Submission;
      }
      setSubmission(header);
      setNotes(header.notes ?? "");

      const { data: detail, error: detErr } = await supabase
        .from("sms_report_shs_specialization_rows")
        .select("strand, specialization, grade_level, male, female")
        .eq("submission_id", header.id);
      if (detErr) throw detErr;

      const mapped: Row[] =
        (detail as Omit<Row, "id">[])?.map((d) => ({
          ...d,
          id: uid(),
          male: Number(d.male),
          female: Number(d.female),
        })) ?? [];
      setRows(mapped);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load draft");
    } finally {
      setLoading(false);
    }
  }, [isSchoolUser, user?.school_id, sy, semester]);

  useEffect(() => {
    loadSubmission();
  }, [loadSubmission]);

  const handleSave = async (newStatus: "draft" | "submitted") => {
    if (!submission) return;
    setSaving(true);
    try {
      const payload = rows
        .filter(
          (r) =>
            r.strand && r.specialization && (r.male > 0 || r.female > 0),
        )
        .map((r) => ({
          strand: r.strand,
          specialization: r.specialization.trim(),
          grade_level: r.grade_level,
          male: Math.max(0, Math.floor(r.male)),
          female: Math.max(0, Math.floor(r.female)),
        }));

      const { error: upsertErr } = await supabase.rpc(
        "upsert_shs_specialization_rows",
        {
          p_submission_id: submission.id,
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

  const addRow = (strand?: string, specialization = "") =>
    setRows((prev) => [
      ...prev,
      {
        id: uid(),
        strand: strand ?? "",
        specialization,
        grade_level: 11,
        male: 0,
        female: 0,
      },
    ]);

  const removeRow = (id: string) =>
    setRows((prev) => prev.filter((r) => r.id !== id));

  const updateRow = <K extends keyof Row>(
    id: string,
    field: K,
    value: Row[K],
  ) =>
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          male: acc.male + r.male,
          female: acc.female + r.female,
          total: acc.total + r.male + r.female,
        }),
        { male: 0, female: 0, total: 0 },
      ),
    [rows],
  );

  const isLocked = submission?.status === "locked";
  const isSubmitted = submission?.status === "submitted";

  const statusBadge = () => {
    if (!submission || submission.status === "draft")
      return <Badge variant="outline">Draft</Badge>;
    if (submission.status === "submitted") return <Badge>Submitted</Badge>;
    return <Badge variant="secondary">Locked</Badge>;
  };

  if (!isSchoolUser) {
    return (
      <div className="app__content">
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              School staff only. Division admins view aggregated data under{" "}
              <Link
                href="/division/reports/shs-specialization"
                className="text-primary underline"
              >
                SDO Reports → SHS Specialization
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
          <h1 className="app__title_text">
            SHS Specialization — {sy} · Sem {semester}
          </h1>
          {statusBadge()}
        </div>
        <p className="text-sm text-muted-foreground">
          Record SHS learners by specific specialization under each strand.
          Add rows only for specializations your school offers.
        </p>
      </div>

      <div className="app__content space-y-4">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Semester</Label>
              <Select
                value={String(semester)}
                onValueChange={(v) => setSemester(Number(v) as 1 | 2)}
                disabled={saving}
              >
                <SelectTrigger className="h-9 w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Sem 1</SelectItem>
                  <SelectItem value="2">Sem 2</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto flex items-end gap-2">
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
            <CardTitle className="text-base">Specialization rows</CardTitle>
            <CardDescription>
              Pick a strand, type the specialization (e.g. &quot;Cookery&quot;),
              choose grade, enter M/F.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <div className="app__table_shell">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[200px]">Strand</TableHead>
                        <TableHead className="min-w-[220px]">
                          Specialization
                        </TableHead>
                        <TableHead className="w-[90px]">Grade</TableHead>
                        <TableHead className="text-right w-[100px]">
                          Male
                        </TableHead>
                        <TableHead className="text-right w-[100px]">
                          Female
                        </TableHead>
                        <TableHead className="text-right w-[90px]">
                          Total
                        </TableHead>
                        <TableHead className="w-[50px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => {
                        const suggestions = r.strand
                          ? SHS_SPECIALIZATION_SUGGESTIONS[r.strand] ?? []
                          : [];
                        return (
                          <TableRow key={r.id}>
                            <TableCell>
                              <Select
                                value={r.strand}
                                onValueChange={(v) =>
                                  updateRow(r.id, "strand", v)
                                }
                                disabled={isLocked}
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue placeholder="Select strand" />
                                </SelectTrigger>
                                <SelectContent>
                                  {SHS_STRANDS.map((s) => (
                                    <SelectItem key={s.code} value={s.code}>
                                      {s.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input
                                list={`spec-sugg-${r.strand}`}
                                className="h-9"
                                value={r.specialization}
                                placeholder={
                                  suggestions.length
                                    ? `e.g. ${suggestions[0]}`
                                    : "Specialization name"
                                }
                                disabled={isLocked}
                                onChange={(e) =>
                                  updateRow(
                                    r.id,
                                    "specialization",
                                    e.target.value,
                                  )
                                }
                              />
                              {suggestions.length > 0 && (
                                <datalist id={`spec-sugg-${r.strand}`}>
                                  {suggestions.map((s) => (
                                    <option key={s} value={s} />
                                  ))}
                                </datalist>
                              )}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={String(r.grade_level)}
                                onValueChange={(v) =>
                                  updateRow(
                                    r.id,
                                    "grade_level",
                                    Number(v) as 11 | 12,
                                  )
                                }
                                disabled={isLocked}
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="11">G11</SelectItem>
                                  <SelectItem value="12">G12</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min={0}
                                className="ml-auto h-9 w-[80px] text-right"
                                value={r.male === 0 ? "" : r.male}
                                placeholder="0"
                                disabled={isLocked}
                                onChange={(e) =>
                                  updateRow(
                                    r.id,
                                    "male",
                                    Number(e.target.value) || 0,
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min={0}
                                className="ml-auto h-9 w-[80px] text-right"
                                value={r.female === 0 ? "" : r.female}
                                placeholder="0"
                                disabled={isLocked}
                                onChange={(e) =>
                                  updateRow(
                                    r.id,
                                    "female",
                                    Number(e.target.value) || 0,
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {r.male + r.female}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => removeRow(r.id)}
                                disabled={isLocked}
                                aria-label="Remove row"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {rows.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className="text-center text-sm text-muted-foreground py-6"
                          >
                            No specializations yet. Click &quot;Add row&quot;.
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow className="border-t-2 font-semibold bg-muted/30">
                        <TableCell colSpan={3}>Total</TableCell>
                        <TableCell className="text-right">{totals.male}</TableCell>
                        <TableCell className="text-right">
                          {totals.female}
                        </TableCell>
                        <TableCell className="text-right">
                          {totals.total}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addRow()}
                    disabled={isLocked}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add row
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Quick add:
                  </span>
                  {SHS_STRANDS.filter(
                    (s) =>
                      (SHS_SPECIALIZATION_SUGGESTIONS[s.code] ?? []).length >
                      0,
                  ).map((s) => (
                    <Button
                      key={s.code}
                      variant="ghost"
                      size="sm"
                      onClick={() => addRow(s.code)}
                      disabled={isLocked}
                    >
                      + {getStrandLabel(s.code)}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="mt-4 flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">
            Notes (optional)
          </Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isLocked}
            placeholder="Any context for division reviewer…"
          />
        </div>
      </div>
    </div>
  );
}
