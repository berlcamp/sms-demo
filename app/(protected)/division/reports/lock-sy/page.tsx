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
import { SchoolYearFilter } from "@/components/division-reports/SchoolYearFilter";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import { getCurrentSchoolYear } from "@/lib/utils/schoolYear";
import { Lock, Unlock } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

type ReportType =
  | "enrollment"
  | "track_strand"
  | "shs_specialization"
  | "teaching_specialization";

interface Row {
  school_id: number;
  school_name: string;
  report_type: ReportType;
  semester: number | null;
  submission_id: number | null;
  status: "missing" | "draft" | "submitted" | "locked";
  submitted_at: string | null;
}

const REPORT_LABELS: Record<ReportType, string> = {
  enrollment: "Enrollment",
  track_strand: "Track & Strand",
  shs_specialization: "SHS Specialization",
  teaching_specialization: "Teaching Specialization",
};

export default function Page() {
  const user = useAppSelector((state) => state.user.user);
  const isDivisionAdmin =
    user?.type === "division_admin" || user?.type === "division_type";

  const [sy, setSy] = useState(getCurrentSchoolYear());
  const [reportType, setReportType] = useState<ReportType | "all">("all");
  const [semester, setSemester] = useState<"all" | "1" | "2" | "none">("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const fetch = useCallback(async () => {
    if (!isDivisionAdmin) return;
    setLoading(true);
    const { data, error } = await supabase.rpc(
      "division_submissions_overview",
      { p_school_year: sy },
    );
    if (error) {
      toast.error(error.message);
      setRows([]);
    } else {
      setRows((data as Row[]) || []);
    }
    setLoading(false);
  }, [isDivisionAdmin, sy]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (reportType !== "all" && r.report_type !== reportType) return false;
      if (semester === "none" && r.semester !== null) return false;
      if (semester === "1" && r.semester !== 1) return false;
      if (semester === "2" && r.semester !== 2) return false;
      return true;
    });
  }, [rows, reportType, semester]);

  const counts = useMemo(() => {
    const c = { missing: 0, draft: 0, submitted: 0, locked: 0 };
    for (const r of filtered) c[r.status]++;
    return c;
  }, [filtered]);

  const handleBulkLock = async (lock: boolean) => {
    if (!isDivisionAdmin) return;
    const verb = lock ? "lock" : "unlock";
    const target = lock ? counts.submitted : counts.locked;
    if (target === 0) {
      toast.error(`Nothing to ${verb}.`);
      return;
    }
    if (
      !confirm(
        `${verb[0].toUpperCase()}${verb.slice(1)} ${target} submission${
          target !== 1 ? "s" : ""
        } for SY ${sy}?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("bulk_lock_submissions", {
        p_school_year: sy,
        p_lock: lock,
        p_semester:
          semester === "1"
            ? 1
            : semester === "2"
              ? 2
              : null,
        p_report_type: reportType === "all" ? null : reportType,
      });
      if (error) throw error;
      toast.success(`Affected ${data ?? 0} submission(s).`);
      fetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk action failed");
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (s: Row["status"]) => {
    if (s === "missing")
      return <Badge variant="outline">Not submitted</Badge>;
    if (s === "draft") return <Badge variant="outline">Draft</Badge>;
    if (s === "submitted") return <Badge>Submitted</Badge>;
    return <Badge variant="secondary">Locked</Badge>;
  };

  if (!isDivisionAdmin) {
    return (
      <div className="app__content">
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Division admins only.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="app__title">
        <Link
          href="/division/reports"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← SDO Reports
        </Link>
        <h1 className="app__title_text">Lock / Unlock Submissions</h1>
        <p className="text-sm text-muted-foreground">
          Freeze submitted reports once review is complete so schools cannot
          edit them anymore.
        </p>
      </div>

      <div className="app__content space-y-4">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <SchoolYearFilter value={sy} onChange={setSy} />
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">
                Report Type
              </Label>
              <Select
                value={reportType}
                onValueChange={(v) =>
                  setReportType(v as ReportType | "all")
                }
              >
                <SelectTrigger className="h-9 w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reports</SelectItem>
                  {(Object.keys(REPORT_LABELS) as ReportType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {REPORT_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Semester</Label>
              <Select
                value={semester}
                onValueChange={(v) =>
                  setSemester(v as "all" | "1" | "2" | "none")
                }
              >
                <SelectTrigger className="h-9 w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="none">No semester</SelectItem>
                  <SelectItem value="1">Sem 1</SelectItem>
                  <SelectItem value="2">Sem 2</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto flex items-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkLock(false)}
                disabled={busy || counts.locked === 0}
              >
                <Unlock className="mr-2 h-4 w-4" />
                Unlock {counts.locked} locked
              </Button>
              <Button
                size="sm"
                onClick={() => handleBulkLock(true)}
                disabled={busy || counts.submitted === 0}
              >
                <Lock className="mr-2 h-4 w-4" />
                Lock {counts.submitted} submitted
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Submissions for {sy}
            </CardTitle>
            <CardDescription>
              {counts.submitted} submitted · {counts.locked} locked ·{" "}
              {counts.draft} draft · {counts.missing} not submitted
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No submissions match the current filter.
              </p>
            ) : (
              <div className="app__table_shell">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>School</TableHead>
                      <TableHead>Report</TableHead>
                      <TableHead>Semester</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow
                        key={`${r.school_id}-${r.report_type}-${r.semester ?? "x"}`}
                      >
                        <TableCell className="font-medium">
                          {r.school_name}
                        </TableCell>
                        <TableCell>{REPORT_LABELS[r.report_type]}</TableCell>
                        <TableCell>
                          {r.semester ? `Sem ${r.semester}` : "—"}
                        </TableCell>
                        <TableCell>{statusBadge(r.status)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.submitted_at
                            ? new Date(r.submitted_at).toLocaleDateString()
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
