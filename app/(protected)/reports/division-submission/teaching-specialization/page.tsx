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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LEARNING_AREAS } from "@/lib/constants";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import { getCurrentSchoolYear } from "@/lib/utils/schoolYear";
import { Save, Upload } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

interface RowState {
  learning_area: string;
  male: number;
  female: number;
}

interface Submission {
  id: number;
  status: "draft" | "submitted" | "locked";
  notes: string | null;
}

export default function Page() {
  const user = useAppSelector((state) => state.user.user);
  const params = useSearchParams();
  const syParam = params.get("sy") ?? getCurrentSchoolYear();

  const [sy] = useState(syParam);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");

  const isSchoolUser =
    !!user?.school_id &&
    user.type !== "division_admin" &&
    user.type !== "division_type";

  const emptyRows = useCallback(() => {
    const next: Record<string, RowState> = {};
    for (const a of LEARNING_AREAS) {
      next[a.code] = { learning_area: a.code, male: 0, female: 0 };
    }
    return next;
  }, []);

  const loadSubmission = useCallback(async () => {
    if (!isSchoolUser || !user?.school_id) return;
    setLoading(true);
    try {
      const { data: existing, error: selErr } = await supabase
        .from("sms_division_report_submissions")
        .select("id, status, notes")
        .eq("school_id", user.school_id)
        .eq("school_year", sy)
        .is("semester", null)
        .eq("report_type", "teaching_specialization")
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
            report_type: "teaching_specialization",
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
        .from("sms_report_teaching_specialization_rows")
        .select("learning_area, male, female")
        .eq("submission_id", header.id);
      if (detErr) throw detErr;

      const next = emptyRows();
      for (const d of (detail as RowState[]) || []) {
        next[d.learning_area] = {
          learning_area: d.learning_area,
          male: Number(d.male),
          female: Number(d.female),
        };
      }
      setRows(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load draft");
    } finally {
      setLoading(false);
    }
  }, [isSchoolUser, user?.school_id, sy, emptyRows]);

  useEffect(() => {
    loadSubmission();
  }, [loadSubmission]);

  const handleSave = async (newStatus: "draft" | "submitted") => {
    if (!submission) return;
    setSaving(true);
    try {
      const payload = LEARNING_AREAS.map((a) => ({
        learning_area: a.code,
        male: Math.max(0, Math.floor(Number(rows[a.code]?.male) || 0)),
        female: Math.max(0, Math.floor(Number(rows[a.code]?.female) || 0)),
      }));

      const { error: upsertErr } = await supabase.rpc(
        "upsert_teaching_specialization_rows",
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

  const totals = useMemo(() => {
    let male = 0;
    let female = 0;
    for (const a of LEARNING_AREAS) {
      male += Number(rows[a.code]?.male) || 0;
      female += Number(rows[a.code]?.female) || 0;
    }
    return { male, female, total: male + female };
  }, [rows]);

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
                href="/division/reports/teaching-specialization"
                className="text-primary underline"
              >
                SDO Reports → Teaching Specialization
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
            Teaching Specialization — {sy}
          </h1>
          {statusBadge()}
        </div>
        <p className="text-sm text-muted-foreground">
          Count teachers by their primary subject/learning area. Each teacher
          should be counted exactly once.
        </p>
      </div>

      <div className="app__content space-y-4">
        <Card>
          <CardContent className="flex flex-wrap items-end justify-end gap-2 pt-6">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Teachers by learning area</CardTitle>
            <CardDescription>
              Counts split by Male / Female.
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
                      <TableHead>Learning Area</TableHead>
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
                    {LEARNING_AREAS.map((a) => {
                      const r = rows[a.code] ?? {
                        learning_area: a.code,
                        male: 0,
                        female: 0,
                      };
                      return (
                        <TableRow key={a.code}>
                          <TableCell className="font-medium">{a.label}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              className="ml-auto h-9 w-[90px] text-right"
                              value={r.male === 0 ? "" : r.male}
                              placeholder="0"
                              disabled={isLocked}
                              onChange={(e) =>
                                setRows((prev) => ({
                                  ...prev,
                                  [a.code]: {
                                    learning_area: a.code,
                                    male: Number(e.target.value) || 0,
                                    female: prev[a.code]?.female ?? 0,
                                  },
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              className="ml-auto h-9 w-[90px] text-right"
                              value={r.female === 0 ? "" : r.female}
                              placeholder="0"
                              disabled={isLocked}
                              onChange={(e) =>
                                setRows((prev) => ({
                                  ...prev,
                                  [a.code]: {
                                    learning_area: a.code,
                                    male: prev[a.code]?.male ?? 0,
                                    female: Number(e.target.value) || 0,
                                  },
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {(r.male ?? 0) + (r.female ?? 0)}
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
                placeholder="Any context for division reviewer…"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
