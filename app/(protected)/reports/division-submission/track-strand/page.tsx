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
  SHS_STRANDS,
  SHS_TRACKS,
  getTrackForStrand,
  getTrackLabel,
} from "@/lib/constants";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import { getCurrentSchoolYear } from "@/lib/utils/schoolYear";
import { Save, Upload } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

const GRADE_LEVELS = [11, 12] as const;

type RowKey = `${string}|${11 | 12}`;
interface RowState {
  strand: string;
  grade_level: 11 | 12;
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
  const semParam = Number(params.get("sem")) || 1;

  const [sy] = useState(syParam);
  const [semester, setSemester] = useState<1 | 2>(
    semParam === 2 ? 2 : 1,
  );

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [rows, setRows] = useState<Record<RowKey, RowState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");

  const isSchoolUser =
    !!user?.school_id &&
    user.type !== "division_admin" &&
    user.type !== "division_type";

  const emptyRows = useCallback((): Record<RowKey, RowState> => {
    const map: Record<string, RowState> = {};
    for (const s of SHS_STRANDS) {
      for (const gl of GRADE_LEVELS) {
        map[`${s.code}|${gl}`] = {
          strand: s.code,
          grade_level: gl,
          male: 0,
          female: 0,
        };
      }
    }
    return map as Record<RowKey, RowState>;
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
        .eq("semester", semester)
        .eq("report_type", "track_strand")
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
            report_type: "track_strand",
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
        .from("sms_report_track_strand_rows")
        .select("strand, grade_level, male, female")
        .eq("submission_id", header.id);
      if (detErr) throw detErr;

      const next = emptyRows();
      for (const d of (detail as RowState[]) || []) {
        const key = `${d.strand}|${d.grade_level}` as RowKey;
        next[key] = { ...d, male: Number(d.male), female: Number(d.female) };
      }
      setRows(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load draft");
    } finally {
      setLoading(false);
    }
  }, [isSchoolUser, user?.school_id, sy, semester, emptyRows]);

  useEffect(() => {
    loadSubmission();
  }, [loadSubmission]);

  const handleSave = async (newStatus: "draft" | "submitted") => {
    if (!submission) return;
    setSaving(true);
    try {
      const payload = Object.values(rows)
        .filter((r) => r.male > 0 || r.female > 0)
        .map((r) => ({
          track: getTrackForStrand(r.strand) ?? "academic",
          strand: r.strand,
          grade_level: r.grade_level,
          male: Math.max(0, Math.floor(r.male)),
          female: Math.max(0, Math.floor(r.female)),
        }));

      const { error: upsertErr } = await supabase.rpc(
        "upsert_track_strand_rows",
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
    const byTrack = new Map<string, { male: number; female: number }>();
    let male = 0;
    let female = 0;
    for (const r of Object.values(rows)) {
      male += r.male;
      female += r.female;
      const tr = getTrackForStrand(r.strand) ?? "academic";
      const current = byTrack.get(tr) ?? { male: 0, female: 0 };
      current.male += r.male;
      current.female += r.female;
      byTrack.set(tr, current);
    }
    return { male, female, total: male + female, byTrack };
  }, [rows]);

  const setRow = (
    strand: string,
    grade_level: 11 | 12,
    field: "male" | "female",
    value: number,
  ) =>
    setRows((prev) => ({
      ...prev,
      [`${strand}|${grade_level}`]: {
        ...(prev[`${strand}|${grade_level}` as RowKey] ?? {
          strand,
          grade_level,
          male: 0,
          female: 0,
        }),
        [field]: value,
      },
    }));

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
                href="/division/reports/track-strand"
                className="text-primary underline"
              >
                SDO Reports → Track &amp; Strand
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
            Track &amp; Strand — {sy} · Sem {semester}
          </h1>
          {statusBadge()}
        </div>
        <p className="text-sm text-muted-foreground">
          Enter SHS learner counts per strand, Grade 11 and Grade 12. Leave a
          row at 0/0 if not offered.
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

        {SHS_TRACKS.map((track) => {
          const strandsInTrack = SHS_STRANDS.filter(
            (s) => s.track === track.value,
          );
          const trackTotal = totals.byTrack.get(track.value) ?? {
            male: 0,
            female: 0,
          };
          return (
            <Card key={track.value}>
              <CardHeader>
                <CardTitle className="text-base">
                  {track.label} track
                </CardTitle>
                <CardDescription>
                  M/F counts by strand and grade level.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-20 w-full" />
                ) : (
                  <div className="app__table_shell">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Strand</TableHead>
                          <TableHead>Grade</TableHead>
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
                        {strandsInTrack.map((s) =>
                          GRADE_LEVELS.map((gl) => {
                            const r = rows[
                              `${s.code}|${gl}` as RowKey
                            ] ?? {
                              strand: s.code,
                              grade_level: gl,
                              male: 0,
                              female: 0,
                            };
                            const total = r.male + r.female;
                            return (
                              <TableRow key={`${s.code}-${gl}`}>
                                <TableCell className="font-medium">
                                  {s.label}
                                </TableCell>
                                <TableCell>G{gl}</TableCell>
                                <TableCell className="text-right">
                                  <Input
                                    type="number"
                                    min={0}
                                    className="ml-auto h-9 w-[90px] text-right"
                                    value={r.male === 0 ? "" : r.male}
                                    placeholder="0"
                                    disabled={isLocked}
                                    onChange={(e) =>
                                      setRow(
                                        s.code,
                                        gl,
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
                                    className="ml-auto h-9 w-[90px] text-right"
                                    value={r.female === 0 ? "" : r.female}
                                    placeholder="0"
                                    disabled={isLocked}
                                    onChange={(e) =>
                                      setRow(
                                        s.code,
                                        gl,
                                        "female",
                                        Number(e.target.value) || 0,
                                      )
                                    }
                                  />
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {total}
                                </TableCell>
                              </TableRow>
                            );
                          }),
                        )}
                        <TableRow className="border-t-2 font-semibold bg-muted/30">
                          <TableCell colSpan={2}>
                            {track.label} subtotal
                          </TableCell>
                          <TableCell className="text-right">
                            {trackTotal.male}
                          </TableCell>
                          <TableCell className="text-right">
                            {trackTotal.female}
                          </TableCell>
                          <TableCell className="text-right">
                            {trackTotal.male + trackTotal.female}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        <Card>
          <CardContent className="flex flex-wrap items-center gap-6 pt-6">
            <div>
              <div className="text-xs uppercase text-muted-foreground">
                Total SHS (this semester)
              </div>
              <div className="text-xl font-semibold">
                {totals.total}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({totals.male}M / {totals.female}F)
                </span>
              </div>
            </div>
            <div className="ml-auto min-w-[240px]">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isLocked}
                placeholder="Any context for division reviewer…"
              />
            </div>
          </CardContent>
        </Card>

        <div className="text-xs text-muted-foreground">
          Tracks:{" "}
          {SHS_TRACKS.map((t) => getTrackLabel(t.value)).join(" · ")}
        </div>
      </div>
    </div>
  );
}
