"use client";

import { Badge } from "@/components/ui/badge";
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
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import {
  getCurrentSchoolYear,
  getSchoolYearOptions,
} from "@/lib/utils/schoolYear";
import { FileBarChart } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

type ReportType =
  | "enrollment"
  | "track_strand"
  | "shs_specialization"
  | "teaching_specialization";

interface ReportDef {
  key: ReportType;
  label: string;
  description: string;
  hasSemester: boolean;
  href: (sy: string, sem: number | null) => string;
  available: boolean;
}

const REPORTS: ReportDef[] = [
  {
    key: "enrollment",
    label: "Enrollment",
    description:
      "Learners by grade level, sex, modality, and category.",
    hasSemester: false,
    href: (sy) =>
      `/reports/division-submission/enrollment?sy=${encodeURIComponent(sy)}`,
    available: true,
  },
  {
    key: "track_strand",
    label: "Track & Strand (SHS)",
    description: "SHS learners by track and strand (per semester).",
    hasSemester: true,
    href: (sy, sem) =>
      `/reports/division-submission/track-strand?sy=${encodeURIComponent(
        sy,
      )}&sem=${sem ?? 1}`,
    available: true,
  },
  {
    key: "shs_specialization",
    label: "SHS Specialization",
    description: "SHS learners by specialization under each strand.",
    hasSemester: true,
    href: (sy, sem) =>
      `/reports/division-submission/shs-specialization?sy=${encodeURIComponent(
        sy,
      )}&sem=${sem ?? 1}`,
    available: true,
  },
  {
    key: "teaching_specialization",
    label: "Teaching Specialization",
    description: "Teachers by subject learning area.",
    hasSemester: false,
    href: (sy) =>
      `/reports/division-submission/teaching-specialization?sy=${encodeURIComponent(
        sy,
      )}`,
    available: true,
  },
];

interface SubmissionRow {
  id: number;
  school_year: string;
  semester: number | null;
  report_type: ReportType;
  status: "draft" | "submitted" | "locked";
  submitted_at: string | null;
}

export default function Page() {
  const user = useAppSelector((state) => state.user.user);
  const [sy, setSy] = useState(getCurrentSchoolYear());
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const isSchoolUser =
    !!user?.school_id &&
    user.type !== "division_admin" &&
    user.type !== "division_type";

  useEffect(() => {
    if (!isSchoolUser) {
      setLoading(false);
      return;
    }
    let isMounted = true;
    const fetch = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("sms_division_report_submissions")
        .select("id, school_year, semester, report_type, status, submitted_at")
        .eq("school_id", user.school_id as string | number)
        .eq("school_year", sy);
      if (!isMounted) return;
      if (error) toast.error(error.message);
      setRows(((data as SubmissionRow[]) || []));
      setLoading(false);
    };
    fetch();
    return () => {
      isMounted = false;
    };
  }, [isSchoolUser, user?.school_id, sy]);

  const statusByKey = useMemo(() => {
    const map = new Map<string, SubmissionRow>();
    for (const r of rows) {
      const key = `${r.report_type}|${r.semester ?? 0}`;
      map.set(key, r);
    }
    return map;
  }, [rows]);

  const renderStatus = (r: SubmissionRow | undefined) => {
    if (!r || r.status === "draft") {
      return <Badge variant="outline">Not yet submitted</Badge>;
    }
    if (r.status === "submitted") {
      return <Badge>Submitted</Badge>;
    }
    return <Badge variant="secondary">Locked</Badge>;
  };

  return (
    <div>
      <div className="app__title">
        <h1 className="app__title_text flex items-center gap-2">
          <FileBarChart className="h-5 w-5" />
          Division Submissions
        </h1>
        <p className="text-sm text-muted-foreground">
          Submit your school&apos;s data to the Schools Division Office.
        </p>
      </div>

      <div className="app__content space-y-4">
        {!isSchoolUser ? (
          <Card>
            <CardContent className="py-8 text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                Division submissions are entered by school staff. Division
                admins can view aggregated data under{" "}
                <Link
                  href="/division/reports"
                  className="text-primary underline"
                >
                  SDO Reports
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="flex flex-wrap items-end gap-3 pt-6">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">
                    School Year
                  </Label>
                  <Select value={sy} onValueChange={setSy}>
                    <SelectTrigger className="h-9 w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getSchoolYearOptions().map((y) => (
                        <SelectItem key={y} value={y}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Reports</CardTitle>
                <CardDescription>
                  Pick a report to enter or update data for {sy}.
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
                          <TableHead>Report</TableHead>
                          <TableHead>Semester</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Submitted</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {REPORTS.flatMap((rep) =>
                          rep.hasSemester
                            ? [1, 2].map((sem) => ({
                                rep,
                                sem: sem as number | null,
                              }))
                            : [{ rep, sem: null as number | null }],
                        ).map(({ rep, sem }) => {
                          const r = statusByKey.get(
                            `${rep.key}|${sem ?? 0}`,
                          );
                          return (
                            <TableRow
                              key={`${rep.key}-${sem ?? "none"}`}
                            >
                              <TableCell>
                                <div className="font-medium">{rep.label}</div>
                                <div className="text-xs text-muted-foreground">
                                  {rep.description}
                                </div>
                              </TableCell>
                              <TableCell>
                                {sem ? `Sem ${sem}` : "—"}
                              </TableCell>
                              <TableCell>{renderStatus(r)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {r?.submitted_at
                                  ? new Date(
                                      r.submitted_at,
                                    ).toLocaleDateString()
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-right">
                                {rep.available ? (
                                  <Link
                                    href={rep.href(sy, sem)}
                                    className="text-sm font-medium text-primary hover:underline"
                                  >
                                    {r && r.status !== "draft"
                                      ? "Update"
                                      : "Enter data"}
                                  </Link>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    Coming soon
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
